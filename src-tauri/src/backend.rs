/* ------------------------------------------------------------------ */
/* backend.rs：Tauri 对接层 —— 复用守护引擎，桥接为 IPC(命令) + 事件推送   */
/* 替代原 egui 界面层：窗口/托盘交给 Tauri，前端经 invoke/listen 交互      */
/* ------------------------------------------------------------------ */

use std::sync::mpsc::Sender;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, State};
use tauri::menu::{MenuBuilder, MenuItemBuilder};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};

use crate::core::events::Event;
use crate::core::supervisor::{Command, SharedState, Supervisor};
use crate::infra::config::{Config, TaskConfig, seed_config};
use crate::infra::logbuf;

/// 后端共享状态（Tauri managed）
pub struct BackendState {
    cmd_tx: Sender<Command>,
    state: Arc<Mutex<SharedState>>,
}

/* ---------------- 可序列化视图（DTO） ---------------- */

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
    /// 最近一次退出码（含正常 0；运行中/停机未观测到退出为 null）
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
    /// 退避到期时刻（绝对 unix 毫秒，与前端 Date.now() 同域）
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

/* ---------------- 初始化：启动守护引擎 + 事件/快照线程 + 托盘 ---------------- */

pub fn init(app: &AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    // 配置加载（便携目录 <exe>\data；缺失时先从旧 %APPDATA%\TaskWarden 一次性迁移，再不存在则写种子）
    let config_path = Config::default_path();
    Config::migrate_from_appdata(&config_path);
    let cfg = match Config::load(&config_path) {
        Ok(c) if !c.tasks.is_empty() => c,
        _ => {
            let seed = seed_config();
            let _ = seed.save(&config_path);
            seed
        }
    };
    Config::migrate_logs_from_appdata(&Config::resolve_log_dir(&cfg.settings.log_dir));
    // 启动守护引擎线程
    let (cmd_tx, state, _evt_tx, evt_rx) = Supervisor::launch(cfg, config_path);

    // 事件线程：把核心事件转发为前端 "notice" / "log-event"
    spawn_events(app.clone(), evt_rx);
    // 快照线程：250ms 推送全量状态
    spawn_snapshot(app.clone(), state.clone());

    app.manage(BackendState { cmd_tx, state });

    // 系统托盘
    build_tray(app)?;
    Ok(())
}

fn spawn_events(app: AppHandle, rx: std::sync::mpsc::Receiver<Event>) {
    std::thread::spawn(move || {
        while let Ok(evt) = rx.recv() {
            match evt {
                Event::Log { id, level, msg } => {
                    let line = LogLineDto { t_ms: now_ms_f64(), level: level.to_string(), msg };
                    let _ = app.emit("log-event", serde_json::json!({ "task": id, "line": line }));
                }
                Event::SpawnFailed { id, error } => {
                    let _ = app.emit("notice", serde_json::json!({ "kind": "err", "text": format!("任务 \"{id}\" 启动失败：{error}") }));
                }
                Event::BreakerTripped { id, .. } => {
                    let _ = app.emit("notice", serde_json::json!({ "kind": "warn", "text": format!("任务 \"{id}\" 已熔断，需手动干预") }));
                }
                Event::Exited { id, code } => {
                    if code != 0 {
                        let _ = app.emit("notice", serde_json::json!({ "kind": "err", "text": format!("任务 \"{id}\" 意外退出 (code {code})") }));
                    }
                }
                _ => {}
            }
        }
    });
}

fn spawn_snapshot(app: AppHandle, state: Arc<Mutex<SharedState>>) {
    std::thread::spawn(move || loop {
        // 主窗口隐藏（收进托盘）时跳过全量推送省 IPC；重新可见后 ≤250ms 即恢复推送
        let visible = app
            .get_webview_window("main")
            .map(|w| w.is_visible().unwrap_or(true))
            .unwrap_or(true);
        if visible {
            let dto = {
                let st = state.lock().unwrap_or_else(|e| e.into_inner());
                to_snapshot(&st)
            };
            let _ = app.emit("snapshot", dto);
        }
        std::thread::sleep(Duration::from_millis(250));
    });
}

fn build_tray(app: &AppHandle) -> tauri::Result<()> {
    let show = MenuItemBuilder::with_id("show", "显示主窗口").build(app)?;
    let quit = MenuItemBuilder::with_id("quit", "退出程序").build(app)?;
    let menu = MenuBuilder::new(app).items(&[&show, &quit]).build()?;
    // 托盘专用图标（编译期内嵌）：无底板、图形撑满画布，16~24px 下依然清晰；
    // 解码失败退回窗口默认图标
    let tray_icon = tauri::image::Image::from_bytes(include_bytes!("../icons/tray-icon.png"))
        .unwrap_or_else(|_| app.default_window_icon().cloned().expect("内嵌了默认窗口图标"));
    TrayIconBuilder::new()
        .icon(tray_icon)
        .icon_as_template(false)
        .menu(&menu)
        .tooltip("TaskWarden · 轻量级后台任务守护监督器")
        .on_menu_event(|app, ev| match ev.id().as_ref() {
            "show" => {
                if let Some(w) = app.get_webview_window("main") {
                    let _ = w.show();
                    let _ = w.set_focus();
                }
            }
            "quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, ev| {
            if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = ev {
                let app = tray.app_handle();
                if let Some(w) = app.get_webview_window("main") {
                    let _ = w.show();
                    let _ = w.set_focus();
                }
            }
        })
        .build(app)?;
    Ok(())
}

/* ---------------- Tauri Commands ---------------- */

#[tauri::command]
pub fn list_snapshot(state: State<'_, BackendState>) -> SnapshotDto {
    let st = state.state.lock().unwrap_or_else(|e| e.into_inner());
    to_snapshot(&st)
}

/// 发送命令到守护引擎；引擎不可达（supervisor 线程已退出）时返回错误，便于前端提示。
fn send_cmd(state: &State<'_, BackendState>, cmd: Command) -> Result<(), String> {
    state.cmd_tx.send(cmd).map_err(|_| "守护引擎未就绪".to_string())
}

#[tauri::command]
pub fn start(state: State<'_, BackendState>, id: String) -> Result<(), String> {
    send_cmd(&state, Command::Start(id))
}

#[tauri::command]
pub fn stop(state: State<'_, BackendState>, id: String) -> Result<(), String> {
    send_cmd(&state, Command::Stop(id))
}

#[tauri::command]
pub fn restart(state: State<'_, BackendState>, id: String) -> Result<(), String> {
    send_cmd(&state, Command::Restart(id))
}

#[tauri::command]
pub fn start_all(state: State<'_, BackendState>) -> Result<(), String> {
    send_cmd(&state, Command::StartAll)
}

#[tauri::command]
pub fn stop_all(state: State<'_, BackendState>) -> Result<(), String> {
    send_cmd(&state, Command::StopAll)
}

#[tauri::command]
pub fn crash(state: State<'_, BackendState>, id: String) -> Result<(), String> {
    send_cmd(&state, Command::Crash(id))
}

#[tauri::command]
pub fn reset_breaker(state: State<'_, BackendState>, id: String) -> Result<(), String> {
    send_cmd(&state, Command::ResetBreaker(id))
}

#[tauri::command]
pub fn add_task(state: State<'_, BackendState>, cfg: TaskConfig) -> Result<(), String> {
    send_cmd(&state, Command::Add(cfg))
}

#[tauri::command]
pub fn update_task(state: State<'_, BackendState>, cfg: TaskConfig) -> Result<(), String> {
    send_cmd(&state, Command::Update(cfg))
}

#[tauri::command]
pub fn remove_task(state: State<'_, BackendState>, id: String) -> Result<(), String> {
    send_cmd(&state, Command::Remove(id))
}

#[tauri::command]
pub fn set_fault_inject(state: State<'_, BackendState>, flag: bool) -> Result<(), String> {
    send_cmd(&state, Command::SetFaultInject(flag))
}

#[tauri::command]
pub fn shutdown(state: State<'_, BackendState>) -> Result<(), String> {
    // 退出程序：停止所有子进程并落盘配置
    send_cmd(&state, Command::Shutdown)
}

#[tauri::command]
pub fn get_logs(state: State<'_, BackendState>, id: String) -> Vec<LogLineDto> {
    let st = state.state.lock().unwrap_or_else(|e| e.into_inner());
    st.tasks
        .iter()
        .find(|t| t.name == id)
        .map(|t| {
            t.log
                .lock()
                .map(|g| g.iter().map(to_log_line_dto).collect())
                .unwrap_or_default()
        })
        .unwrap_or_default()
}

/// 清空任务内存环缓冲（logs/<name>.log 文件日志保留，供审计）。
/// 修复：前端清空后切换卡片再回来，get_logs 从后端把旧日志「复活」的问题。
#[tauri::command]
pub fn clear_logs(state: State<'_, BackendState>, id: String) -> Result<(), String> {
    let log = {
        let st = state.state.lock().unwrap_or_else(|e| e.into_inner());
        st.tasks
            .iter()
            .find(|t| t.name == id)
            .map(|t| t.log.clone())
            .ok_or_else(|| "任务不存在".to_string())?
    }; // 先释放 SharedState 守卫，再取日志锁（锁序与快照线程一致且持锁更短）
    {
        let mut g = log.lock().map_err(|_| "日志锁已毒化".to_string())?;
        g.clear();
    }
    Ok(())
}

fn now_ms_f64() -> f64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as f64)
        .unwrap_or(0.0)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::core::events::TaskState;
    use crate::core::supervisor::{StatsView, TaskView};
    use crate::infra::config::{HealthMode, Kind, Strategy};
    use crate::infra::logbuf;

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
        // 前端 TaskDto 接口按 camelCase 定义：协议漂移必须在 CI 拦截
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
