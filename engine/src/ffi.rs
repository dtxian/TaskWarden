/* ------------------------------------------------------------------ */
/* ffi.rs：C ABI 对接层 —— 替代 Tauri 版 backend.rs                      */
/* Qt 壳（C++）经 UTF-8 字符串 + JSON 与引擎交互；不回调，C++ 主动轮询。    */
/* 设计约束：                                                             */
/*  - 每个入口 catch_unwind，panic 写 last_error 并返回 -1，绝不跨 FFI；  */
/*  - 命令用 try_send，队列满返回 -2，不阻塞 UI；                         */
/*  - 快照 JSON 复用 SnapshotDto（camelCase），与 src/sim/useSimulator.ts */
/*    的字段形状对齐；cfg_json 复用 TaskConfig（snake_case）。             */
/*  - tw_engine_free 同步终结：发 Shutdown → join supervisor 线程。        */
/* ------------------------------------------------------------------ */

use std::collections::VecDeque;
use std::ffi::{CStr, CString};
use std::os::raw::{c_char, c_int};
use std::path::Path;
use std::sync::mpsc::{SyncSender, TrySendError};
use std::sync::{Arc, Mutex};

use serde::Serialize;

use crate::core::events::{Event, EventReceiver};
use crate::core::supervisor::{Command, SharedState, Supervisor};
use crate::infra::config::{Config, TaskConfig, seed_config};
use crate::infra::logbuf;

/* ---------------- 引擎句柄 ---------------- */

pub struct TwEngine {
    cmd_tx: SyncSender<Command>,
    state: Arc<Mutex<SharedState>>,
    /// 待取通知队列（drain 语义：tw_notices_json 取走并清空）
    notices: Arc<Mutex<VecDeque<NoticeDto>>>,
    last_error: Arc<Mutex<String>>,
    supervisor_handle: Option<std::thread::JoinHandle<()>>,
    events_handle: Option<std::thread::JoinHandle<()>>,
}

/* ---------------- 可序列化视图（DTO）—— 与 Tauri 版 backend.rs 同构 ---------------- */

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskDto {
    pub name: String,
    pub state: String,
    pub pid: Option<u32>,
    pub restarts: u64,
    pub probe_ms: Option<u128>,
    pub probe_ok: Option<bool>,
    pub last_error: Option<String>,
    pub exit_code: Option<i32>,
    pub kind: String,
    pub path: String,
    pub args: Vec<String>,
    pub cwd: String,
    pub strategy: String,
    pub health_mode: String,
    pub health_target: String,
    pub graceful_timeout: u64,
    pub deps: Vec<String>,
    pub started_at_ms: Option<u64>,
    pub backoff_until_ms: Option<u64>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StatsDto {
    pub spawned: u64,
    pub restarts: u64,
    pub last_error: Option<String>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SnapshotDto {
    pub tasks: Vec<TaskDto>,
    pub running_count: usize,
    pub cpu: f32,
    pub mem: f32,
    pub gpu: f32,
    pub gpu_temp: Option<f32>,
    pub vram_used: Option<u64>,
    pub vram_total: Option<u64>,
    pub cpu_hist: Vec<f32>,
    pub gpu_hist: Vec<f32>,
    pub stats: StatsDto,
    pub config_path: String,
    pub fault_inject: bool,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LogLineDto {
    pub t_ms: f64,
    pub level: String,
    pub msg: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NoticeDto {
    pub kind: String,
    pub text: String,
}

fn to_log_line_dto(l: &logbuf::LogLine) -> LogLineDto {
    LogLineDto { t_ms: l.t_ms as f64, level: l.level.to_string(), msg: l.msg.clone() }
}

fn to_snapshot(st: &SharedState) -> SnapshotDto {
    SnapshotDto {
        tasks: st
            .tasks
            .iter()
            .map(|t| TaskDto {
                name: t.name.clone(),
                state: t.state.as_str().to_string(),
                pid: t.pid,
                restarts: t.restarts,
                probe_ms: t.probe_ms,
                probe_ok: t.probe_ok,
                last_error: t.last_error.clone(),
                exit_code: t.exit_code,
                kind: t.kind.as_str().to_string(),
                path: t.path.clone(),
                args: t.args.clone(),
                cwd: t.cwd.clone(),
                strategy: t.strategy.as_str().to_string(),
                health_mode: t.health_mode.as_str().to_string(),
                health_target: t.health_target.clone(),
                graceful_timeout: t.graceful_timeout,
                deps: t.deps.clone(),
                started_at_ms: t.started_at_ms,
                backoff_until_ms: t.backoff_until_ms,
            })
            .collect(),
        running_count: st.running_count,
        cpu: st.cpu,
        mem: st.mem,
        gpu: st.gpu,
        gpu_temp: st.gpu_temp,
        vram_used: st.vram.map(|v| v.0),
        vram_total: st.vram.map(|v| v.1),
        cpu_hist: st.cpu_hist.iter().copied().collect(),
        gpu_hist: st.gpu_hist.iter().copied().collect(),
        stats: StatsDto {
            spawned: st.stats.spawned,
            restarts: st.stats.restarts,
            last_error: st.stats.last_error.clone(),
        },
        config_path: st.config_path.clone(),
        fault_inject: st.fault_inject,
    }
}

/* ---------------- FFI 辅助 ---------------- */

unsafe fn cstr<'a>(p: *const c_char) -> &'a str {
    if p.is_null() {
        return "";
    }
    CStr::from_ptr(p).to_str().unwrap_or("")
}

fn to_c_string(s: String) -> *mut c_char {
    CString::new(s).map(CString::into_raw).unwrap_or_else(|_| CString::new("").unwrap().into_raw())
}

fn set_error(e: &TwEngine, msg: impl Into<String>) {
    *e.last_error.lock().unwrap_or_else(|x| x.into_inner()) = msg.into();
}

fn panic_msg(p: Box<dyn std::any::Any + Send>) -> String {
    p.downcast_ref::<&str>()
        .map(|s| s.to_string())
        .or_else(|| p.downcast_ref::<String>().cloned())
        .unwrap_or_else(|| "未知 panic".to_string())
}

/// 命令入口统一护栏：非空指针 + catch_unwind + last_error。
/// panic → 写 last_error 并返回 -1；队列满 → -2。
unsafe fn guarded(e: *mut TwEngine, f: impl FnOnce(&TwEngine) -> i32) -> i32 {
    if e.is_null() {
        return -1;
    }
    let eng = &*e;
    match std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| f(eng))) {
        Ok(v) => v,
        Err(p) => {
            set_error(eng, panic_msg(p));
            -1
        }
    }
}

/// 字符串返回入口统一护栏：panic → 返回 JSON "null"（调用方按解析失败处理）。
unsafe fn guarded_str(e: *mut TwEngine, f: impl FnOnce(&TwEngine) -> String) -> *mut c_char {
    if e.is_null() {
        return to_c_string("null".to_string());
    }
    let eng = &*e;
    let s = match std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| f(eng))) {
        Ok(s) => s,
        Err(p) => {
            set_error(eng, panic_msg(p));
            "null".to_string()
        }
    };
    to_c_string(s)
}

fn send_cmd(e: &TwEngine, cmd: Command) -> i32 {
    match e.cmd_tx.try_send(cmd) {
        Ok(_) => 0,
        Err(TrySendError::Full(_)) => {
            set_error(e, "命令队列已满");
            -2
        }
        Err(TrySendError::Disconnected(_)) => {
            set_error(e, "守护引擎未就绪");
            -1
        }
    }
}

fn push_notice(notices: &Arc<Mutex<VecDeque<NoticeDto>>>, kind: &str, text: String) {
    if let Ok(mut q) = notices.lock() {
        q.push_back(NoticeDto { kind: kind.to_string(), text });
    }
}

/* ---------------- 事件线程：核心事件 → 通知队列 ---------------- */

fn spawn_events(rx: EventReceiver, notices: Arc<Mutex<VecDeque<NoticeDto>>>) -> std::thread::JoinHandle<()> {
    std::thread::Builder::new()
        .name("events".into())
        .spawn(move || {
            while let Ok(evt) = rx.recv() {
                match evt {
                    Event::SpawnFailed { id, error } => {
                        push_notice(&notices, "err", format!("任务 \"{id}\" 启动失败：{error}"));
                    }
                    Event::BreakerTripped { id, .. } => {
                        push_notice(&notices, "warn", format!("任务 \"{id}\" 已熔断，需手动干预"));
                    }
                    Event::Exited { id, code } if code != 0 => {
                        push_notice(&notices, "err", format!("任务 \"{id}\" 意外退出 (code {code})"));
                    }
                    _ => {}
                }
            }
        })
        .expect("spawn events thread")
}

/* ---------------- 极简文件日志（沿用 app.log 诊断行为） ---------------- */

struct AppLogger {
    file: Mutex<Option<std::io::BufWriter<std::fs::File>>>,
}

impl log::Log for AppLogger {
    fn enabled(&self, _m: &log::Metadata) -> bool {
        true
    }
    fn log(&self, record: &log::Record) {
        if let Ok(mut g) = self.file.lock() {
            if let Some(w) = g.as_mut() {
                use std::io::Write;
                let _ = writeln!(w, "[{}] {:<5} {}", logbuf::format_time(now_ms()), record.level(), record.args());
            }
        }
    }
    fn flush(&self) {
        if let Ok(mut g) = self.file.lock() {
            if let Some(w) = g.as_mut() {
                use std::io::Write;
                let _ = w.flush();
            }
        }
    }
}

/* ---------------- 生命周期 ---------------- */

/// 创建引擎。data_dir_utf8 为便携数据根目录（如 "<exe 目录>\data"）；空则退回 current_exe 推导。
/// 失败返回 NULL。
#[no_mangle]
pub unsafe extern "C" fn tw_engine_new(data_dir: *const c_char) -> *mut TwEngine {
    let data_dir = cstr(data_dir);
    let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        let config_path = if !data_dir.is_empty() {
            crate::infra::config::set_data_dir_override(Path::new(data_dir));
            Path::new(data_dir).join("config.toml")
        } else {
            Config::default_path()
        };
        // 配置加载（便携目录；缺失先 %APPDATA% 一次性迁移，再写 5 任务种子）
        Config::migrate_from_appdata(&config_path);
        let cfg = match Config::load(&config_path) {
            Ok(c) if !c.tasks.is_empty() => c,
            _ => {
                let seed = seed_config();
                let _ = seed.save(&config_path);
                seed
            }
        };
        let log_root = Config::resolve_log_dir(&cfg.settings.log_dir);
        Config::migrate_logs_from_appdata(&log_root);
        // 诊断日志：<data>\logs\app.log（尽力而为，失败不阻断）
        let _ = std::fs::create_dir_all(&log_root);
        let app_log = std::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(log_root.join("app.log"))
            .map(std::io::BufWriter::new)
            .ok();
        let _ = log::set_boxed_logger(Box::new(AppLogger { file: Mutex::new(app_log) }))
            .map(|_| log::set_max_level(log::LevelFilter::Info));

        let (cmd_tx, state, _evt_tx, evt_rx, supervisor_handle) = Supervisor::launch(cfg, config_path);
        let notices = Arc::new(Mutex::new(VecDeque::new()));
        let events_handle = spawn_events(evt_rx, notices.clone());
        Box::into_raw(Box::new(TwEngine {
            cmd_tx,
            state,
            notices,
            last_error: Arc::new(Mutex::new(String::new())),
            supervisor_handle: Some(supervisor_handle),
            events_handle: Some(events_handle),
        }))
    }));
    match result {
        Ok(p) => p,
        Err(p) => {
            eprintln!("[TaskWarden] tw_engine_new panic: {}", panic_msg(p));
            std::ptr::null_mut()
        }
    }
}

/// 释放引擎：同步 shutdown（停全部子进程 + 落盘配置）→ join 引擎/事件线程。
#[no_mangle]
pub unsafe extern "C" fn tw_engine_free(e: *mut TwEngine) {
    if e.is_null() {
        return;
    }
    let mut eng = Box::from_raw(e);
    // 同步终结：命令队列可能已满，退化为 send（阻塞）确保 Shutdown 必达
    let _ = eng.cmd_tx.send(Command::Shutdown);
    if let Some(h) = eng.supervisor_handle.take() {
        let _ = h.join();
    }
    if let Some(h) = eng.events_handle.take() {
        let _ = h.join();
    }
}

/// 最近一次错误信息（线程内有效；无错误返回空串）。
#[no_mangle]
pub unsafe extern "C" fn tw_last_error(e: *mut TwEngine) -> *const c_char {
    if e.is_null() {
        return std::ptr::null();
    }
    let eng = &*e;
    let msg = eng.last_error.lock().unwrap_or_else(|x| x.into_inner()).clone();
    thread_local! {
        static BUF: std::cell::RefCell<String> = const { std::cell::RefCell::new(String::new()) };
    }
    BUF.with(|b| {
        *b.borrow_mut() = msg;
        b.borrow().as_ptr() as *const c_char
    })
}

/* ---------------- 命令 ---------------- */

#[no_mangle]
pub unsafe extern "C" fn tw_start(e: *mut TwEngine, id: *const c_char) -> c_int {
    guarded(e, |eng| send_cmd(eng, Command::Start(cstr(id).to_string())))
}

#[no_mangle]
pub unsafe extern "C" fn tw_stop(e: *mut TwEngine, id: *const c_char) -> c_int {
    guarded(e, |eng| send_cmd(eng, Command::Stop(cstr(id).to_string())))
}

#[no_mangle]
pub unsafe extern "C" fn tw_restart(e: *mut TwEngine, id: *const c_char) -> c_int {
    guarded(e, |eng| send_cmd(eng, Command::Restart(cstr(id).to_string())))
}

#[no_mangle]
pub unsafe extern "C" fn tw_start_all(e: *mut TwEngine) -> c_int {
    guarded(e, |eng| send_cmd(eng, Command::StartAll))
}

#[no_mangle]
pub unsafe extern "C" fn tw_stop_all(e: *mut TwEngine) -> c_int {
    guarded(e, |eng| send_cmd(eng, Command::StopAll))
}

#[no_mangle]
pub unsafe extern "C" fn tw_crash(e: *mut TwEngine, id: *const c_char) -> c_int {
    guarded(e, |eng| send_cmd(eng, Command::Crash(cstr(id).to_string())))
}

#[no_mangle]
pub unsafe extern "C" fn tw_reset_breaker(e: *mut TwEngine, id: *const c_char) -> c_int {
    guarded(e, |eng| send_cmd(eng, Command::ResetBreaker(cstr(id).to_string())))
}

#[no_mangle]
pub unsafe extern "C" fn tw_add_task(e: *mut TwEngine, cfg_json: *const c_char) -> c_int {
    guarded(e, |eng| {
        let cfg: TaskConfig = match serde_json::from_str(cstr(cfg_json)) {
            Ok(c) => c,
            Err(err) => {
                set_error(eng, format!("TaskConfig 解析失败: {err}"));
                return -1;
            }
        };
        send_cmd(eng, Command::Add(cfg))
    })
}

#[no_mangle]
pub unsafe extern "C" fn tw_update_task(e: *mut TwEngine, cfg_json: *const c_char) -> c_int {
    guarded(e, |eng| {
        let cfg: TaskConfig = match serde_json::from_str(cstr(cfg_json)) {
            Ok(c) => c,
            Err(err) => {
                set_error(eng, format!("TaskConfig 解析失败: {err}"));
                return -1;
            }
        };
        send_cmd(eng, Command::Update(cfg))
    })
}

#[no_mangle]
pub unsafe extern "C" fn tw_remove_task(e: *mut TwEngine, id: *const c_char) -> c_int {
    guarded(e, |eng| send_cmd(eng, Command::Remove(cstr(id).to_string())))
}

#[no_mangle]
pub unsafe extern "C" fn tw_set_fault_inject(e: *mut TwEngine, flag: c_int) -> c_int {
    guarded(e, |eng| send_cmd(eng, Command::SetFaultInject(flag != 0)))
}

#[no_mangle]
pub unsafe extern "C" fn tw_clear_logs(e: *mut TwEngine, id: *const c_char) -> c_int {
    guarded(e, |eng| {
        let log = {
            let st = eng.state.lock().unwrap_or_else(|x| x.into_inner());
            match st.tasks.iter().find(|t| t.name == cstr(id)) {
                Some(t) => t.log.clone(),
                None => {
                    set_error(eng, "任务不存在");
                    return -1;
                }
            }
        };
        let mut g = log.lock().unwrap_or_else(|x| x.into_inner());
        g.clear();
        0
    })
}

#[no_mangle]
pub unsafe extern "C" fn tw_shutdown(e: *mut TwEngine) -> c_int {
    guarded(e, |eng| send_cmd(eng, Command::Shutdown))
}

/* ---------------- 查询 ---------------- */

#[no_mangle]
pub unsafe extern "C" fn tw_snapshot_json(e: *mut TwEngine) -> *mut c_char {
    guarded_str(e, |eng| {
        let st = eng.state.lock().unwrap_or_else(|x| x.into_inner());
        serde_json::to_string(&to_snapshot(&st)).unwrap_or_else(|_| "null".to_string())
    })
}

#[no_mangle]
pub unsafe extern "C" fn tw_logs_json(e: *mut TwEngine, id: *const c_char, limit: u32) -> *mut c_char {
    let limit = limit as usize;
    guarded_str(e, |eng| {
        let id = cstr(id);
        let st = eng.state.lock().unwrap_or_else(|x| x.into_inner());
        let lines: Vec<LogLineDto> = st
            .tasks
            .iter()
            .find(|t| t.name == id)
            .map(|t| {
                t.log
                    .lock()
                    .map(|g| {
                        let all: Vec<&logbuf::LogLine> = g.iter().collect();
                        let start = all.len().saturating_sub(limit);
                        all.into_iter().skip(start).map(to_log_line_dto).collect::<Vec<_>>()
                    })
                    .unwrap_or_default()
            })
            .unwrap_or_default();
        serde_json::to_string(&lines).unwrap_or_else(|_| "[]".to_string())
    })
}

#[no_mangle]
pub unsafe extern "C" fn tw_notices_json(e: *mut TwEngine) -> *mut c_char {
    guarded_str(e, |eng| {
        let mut q = eng.notices.lock().unwrap_or_else(|x| x.into_inner());
        let v: Vec<NoticeDto> = q.drain(..).collect();
        serde_json::to_string(&v).unwrap_or_else(|_| "[]".to_string())
    })
}

#[no_mangle]
pub unsafe extern "C" fn tw_free_string(p: *mut c_char) {
    if !p.is_null() {
        drop(CString::from_raw(p));
    }
}

fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

/* ---------------- 测试 ---------------- */

#[cfg(test)]
mod tests {
    use super::*;
    use crate::core::events::TaskState;
    use crate::core::supervisor::{StatsView, TaskView};
    use crate::infra::config::{HealthMode, Kind, Strategy};

    fn view() -> TaskView {
        TaskView {
            name: "svc".into(),
            state: TaskState::Backoff,
            pid: None,
            restarts: 2,
            probe_ms: Some(13),
            probe_ok: Some(false),
            last_error: Some("boom".into()),
            exit_code: Some(1073807364),
            log: logbuf::shared("svc", 8),
            kind: Kind::Exe,
            path: "a.exe".into(),
            args: vec!["--x".into()],
            cwd: "C:\\a".into(),
            strategy: Strategy::Always,
            health_mode: HealthMode::Tcp,
            health_target: "127.0.0.1:80".into(),
            graceful_timeout: 5,
            deps: vec!["dep".into()],
            started_at_ms: Some(1000),
            backoff_until_ms: Some(2000),
        }
    }

    #[test]
    fn snapshot_maps_exit_code_and_absolute_backoff() {
        let mut st = SharedState::default();
        st.tasks = vec![view()];
        st.running_count = 0;
        st.stats = StatsView { spawned: 3, restarts: 2, last_error: Some("x".into()) };
        let dto = to_snapshot(&st);
        assert_eq!(dto.tasks.len(), 1);
        let t = &dto.tasks[0];
        assert_eq!(t.exit_code, Some(1073807364));
        assert_eq!(t.backoff_until_ms, Some(2000));
        assert_eq!(t.state, "backoff");
        assert_eq!(t.restarts, 2);
        assert_eq!(t.probe_ms, Some(13));
        assert_eq!(t.health_mode, "tcp");
        assert_eq!(t.graceful_timeout, 5);
        assert_eq!(dto.stats.restarts, 2);
    }

    #[test]
    fn snapshot_serializes_camel_case() {
        // 前端/ffi DTO 接口按 camelCase 定义：协议漂移必须在 CI 拦截
        let mut st = SharedState::default();
        st.tasks = vec![view()];
        let json = serde_json::to_value(to_snapshot(&st)).unwrap();
        let t = &json["tasks"][0];
        assert!(t.get("exitCode").is_some(), "缺 exitCode 字段");
        assert!(t.get("backoffUntilMs").is_some(), "缺 backoffUntilMs 字段");
        assert!(t.get("healthMode").is_some(), "缺 healthMode 字段");
        assert!(t.get("health_mode").is_none(), "不应出现 snake_case 泄漏");
    }
}
