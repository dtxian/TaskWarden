/* ------------------------------------------------------------------ */
/* supervisor.rs：监督器 —— 单任务生命周期状态机 + 重启策略分发            */
/* Stopped → Starting → Running → (Backoff ⇄) → Fused                    */
/* 独立线程 + std mpsc：命令进入、事件出、250ms 固定节拍（4Hz 指标采样）    */
/* 阻塞性操作（tcp/http 探针、优雅等待、taskkill）全部移出引擎线程：        */
/*   探针 → 短命线程回灌 Command::ProbeDone；停机 → 回收线程回灌 StopDone； */
/*   就绪等待(ready) → 引擎节拍内消费 stdout（不再劫持管道，见 ReadyWait）  */
/* ------------------------------------------------------------------ */

use std::collections::VecDeque;
use std::path::PathBuf;
use std::process::Child;
use std::sync::mpsc::{Receiver, RecvTimeoutError, Sender};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use crate::core::breaker::{Breaker, Decision};
use crate::core::events::{channel_events, Event, EventSender, TaskState};
use crate::core::health::{probe_http, probe_tcp, ProbeReport};
use crate::core::scheduler::{dependents, reverse_topo, topo_levels};
use crate::infra::config::{Config, HealthMode, Kind, Settings, Strategy, TaskConfig};
use crate::infra::logbuf::{self, SharedLog};
use crate::infra::sysinfo::Sampler;
use crate::runtime::job::JobHandle;
use crate::runtime::killer::{force_kill_tree, graceful_stop};
use crate::runtime::process::{spawn_task, ProcessHandle};

/// 节拍周期：250ms（4Hz 指标采样 + 状态推进），与命令吞吐解耦
const TICK: Duration = Duration::from_millis(250);
/// 健康重探周期（tick 数，250ms/tick → 5s）
const PROBE_EVERY_TICKS: u32 = 20;
/// 就绪等待超时
const READY_TIMEOUT: Duration = Duration::from_secs(10);
/// 单次 tcp/http 探针超时
const PROBE_TIMEOUT: Duration = Duration::from_secs(2);
/// 最短稳定存活时长：always 策略任务快于该值正常退出按「崩溃循环」计入熔断，
/// 防止「秒退 → 立即重拉 → 又秒退」的无退避重生循环
const MIN_STABLE_LIFETIME: Duration = Duration::from_secs(5);

/// 监督器命令（前端下发 + 引擎内部回灌：ProbeDone / StopDone）
#[derive(Debug, Clone)]
pub enum Command {
    Start(String),
    Stop(String),
    Restart(String),
    StartAll,
    StopAll,
    /// 模拟意外退出（演示守护链路）
    Crash(String),
    ResetBreaker(String),
    Add(TaskConfig),
    Update(TaskConfig),
    Remove(String),
    SetFaultInject(bool),
    Shutdown,
    /// 探针线程完成 → 引擎线程套用结果（网络超时永不冻结引擎）
    ProbeDone { id: String, ok: bool, ms: u128, detail: String },
    /// 停机回收线程完成（进程树已终结）→ 唤醒 restart_pending 的续启动
    StopDone { id: String },
}

/// 就绪等待（stdout 关键字）状态 —— 由引擎 tick 消费已 drain 的 stdout 推进。
/// 旧实现把 stdout 通道交给一次性探针线程并随手关闭：探针结束后无人排空，
/// 子进程写满管道缓冲区即永久阻塞，且运行期 stdout 日志全部丢失。现方案两者皆免。
pub struct ReadyWait {
    pub keyword: String,
    pub deadline: Instant,
    pub t0: Instant,
}

/// 单个任务的运行时状态
pub struct TaskRuntime {
    pub cfg: TaskConfig,
    pub state: TaskState,
    pub pid: Option<u32>,
    pub handle: Option<ProcessHandle>,
    pub job: Option<JobHandle>,
    pub restarts: u64,
    pub breaker: Breaker,
    pub log: SharedLog,
    /// 日志事件直通端：保证「环缓冲 + 实时流」同源（见 emit_log）
    pub evt: EventSender,
    pub probe_ms: Option<u128>,
    pub probe_ok: Option<bool>,
    /// 探针线程在途标志：防止重探堆叠
    pub probe_inflight: bool,
    pub last_error: Option<String>,
    /// 当前进程运行的单调时钟起点（存活时长/快速退出判定）
    pub started_at: Option<Instant>,
    pub started_at_ms: Option<u64>,
    /// 是否曾派生过进程：首启不计「重启」
    pub has_spawned: bool,
    /// 最近一次退出码（含正常 0；停机/未退出为 None）
    pub last_exit: Option<i32>,
    pub backoff_until: Option<Instant>,
    /// 就绪等待（ready 探针）在途状态
    pub ready: Option<ReadyWait>,
    /// Restart 命令：停机回收完成后自动续启动
    pub restart_pending: bool,
}

impl TaskRuntime {
    fn new(cfg: TaskConfig, breaker_window: Duration, breaker_max: u32, log_cap: usize, evt: EventSender) -> Self {
        let log = logbuf::shared(&cfg.name, log_cap);
        Self {
            cfg,
            state: TaskState::Stopped,
            pid: None,
            handle: None,
            job: None,
            restarts: 0,
            breaker: Breaker::new(breaker_window, breaker_max),
            log,
            evt,
            probe_ms: None,
            probe_ok: None,
            probe_inflight: false,
            last_error: None,
            started_at: None,
            started_at_ms: None,
            has_spawned: false,
            last_exit: None,
            backoff_until: None,
            ready: None,
            restart_pending: false,
        }
    }

    fn log(&self, level: &'static str, msg: impl Into<String>) {
        emit_log(&self.log, &self.evt, &self.cfg.name, level, msg.into());
    }

    fn strategy_label(&self) -> &'static str {
        match self.cfg.strategy {
            Strategy::Always => "always",
            Strategy::OnFailure => "on-failure",
            Strategy::Never => "never",
        }
    }
}

/// 日志行唯一入口：写定容环缓冲（含落盘）+ 发 Event::Log（backend 转发 "log-event"）。
/// 引擎线程与回收线程共用此入口，保证实时流与 get_logs 拉取内容一致。
pub fn emit_log(log: &SharedLog, evt: &EventSender, id: &str, level: &'static str, msg: String) {
    logbuf::push_shared(log, now_ms(), level, msg.clone());
    let _ = evt.send(Event::Log { id: id.to_string(), level, msg });
}

/// stderr 行分级：大量工具（llama.cpp、node、golang 服务…）把常规 INFO 也写到 stderr，
/// 全部标红会造成误报。按内容启发：错误关键字 → ERR；警告/弃用 → WARN；
/// 明确信息特征 → INFO；无线索保守为 WARN。
pub fn classify_stderr(line: &str) -> &'static str {
    let low = line.to_ascii_lowercase();
    if ["error", "fatal", "panic", "exception", "traceback", "abort", "assert", "failed", "cannot"]
        .iter()
        .any(|k| low.contains(k))
    {
        return logbuf::LEVEL_ERR;
    }
    if ["warn", "deprecat", " w ", "unsafe", "risk", "ignored", "retrying"]
        .iter()
        .any(|k| low.contains(k))
    {
        return logbuf::LEVEL_WARN;
    }
    if [" i ", "info", "debug", "listening", "loading", "init:", "started"]
        .iter()
        .any(|k| low.contains(k))
    {
        return logbuf::LEVEL_INFO;
    }
    logbuf::LEVEL_WARN
}

/// 共享状态快照（GUI 读取）
#[derive(Debug, Clone, Default)]
pub struct StatsView {
    pub spawned: u64,
    pub restarts: u64,
    pub last_error: Option<String>,
}

#[derive(Debug, Clone)]
pub struct TaskView {
    pub name: String,
    pub state: TaskState,
    pub pid: Option<u32>,
    pub restarts: u64,
    pub probe_ms: Option<u128>,
    pub probe_ok: Option<bool>,
    pub last_error: Option<String>,
    pub exit_code: Option<i32>,
    pub log: SharedLog,
    pub kind: Kind,
    pub path: String,
    pub args: Vec<String>,
    pub cwd: String,
    pub strategy: Strategy,
    pub health_mode: HealthMode,
    pub health_target: String,
    pub graceful_timeout: u64,
    pub deps: Vec<String>,
    pub started_at_ms: Option<u64>,
    /// 退避到期的绝对 unix 毫秒时间戳（非剩余时长，前端可直接与 Date.now() 比较）
    pub backoff_until_ms: Option<u64>,
}

impl TaskView {
    /// 还原为可落盘的配置（供「编辑」对话框回填与持久化）
    pub fn to_cfg(&self) -> TaskConfig {
        TaskConfig {
            name: self.name.clone(),
            kind: self.kind,
            path: self.path.clone(),
            args: self.args.clone(),
            cwd: self.cwd.clone(),
            strategy: self.strategy,
            graceful_timeout: self.graceful_timeout,
            deps: self.deps.clone(),
            health: crate::infra::config::Health {
                mode: self.health_mode,
                target: self.health_target.clone(),
            },
            enabled: true,
        }
    }

    /// 完整启动命令文本（卡片命令行预览，所见即所得）
    pub fn command_line(&self) -> String {
        let q = |s: &str| -> String {
            if s.is_empty() {
                s.to_string()
            } else if s.chars().any(|c| c.is_whitespace()) && !(s.starts_with('"') && s.ends_with('"')) {
                format!("\"{s}\"")
            } else {
                s.to_string()
            }
        };
        let mut parts: Vec<String> = match self.kind {
            Kind::Exe => vec![q(&self.path)],
            Kind::Bat => vec!["cmd".into(), "/c".into(), q(&self.path)],
            Kind::Ps1 => vec!["powershell".into(), "-ExecutionPolicy".into(), "Bypass".into(), "-File".into(), q(&self.path)],
        };
        parts.extend(self.args.iter().map(|a| q(a)));
        parts.join(" ")
    }
}

#[derive(Clone, Default)]
pub struct SharedState {
    pub tasks: Vec<TaskView>,
    pub running_count: usize,
    pub cpu: f32,
    pub mem: f32,
    pub gpu: f32,
    pub gpu_temp: Option<f32>,
    pub vram: Option<(u64, u64)>,
    pub cpu_hist: VecDeque<f32>,
    pub gpu_hist: VecDeque<f32>,
    pub stats: StatsView,
    pub config_path: String,
    pub fault_inject: bool,
}

impl SharedState {
    pub fn task(&self, name: &str) -> Option<&TaskView> {
        self.tasks.iter().find(|t| t.name == name)
    }
}

/// 正常退出（code 0）的处置决策（纯函数，可独立单测）
#[derive(Debug, PartialEq, Eq)]
enum CleanAct {
    /// always 且存活足够 → 重新拉起
    Relaunch,
    /// 保持已停止（非 always / 无运行记录）
    KeepStopped,
    /// always 但存活过短 → 视为崩溃循环，计入熔断退避
    CountFailure,
}

fn clean_exit_action(strategy: Strategy, lifetime: Option<Duration>) -> CleanAct {
    match strategy {
        Strategy::Always => match lifetime {
            Some(d) if d < MIN_STABLE_LIFETIME => CleanAct::CountFailure,
            Some(_) => CleanAct::Relaunch,
            None => CleanAct::KeepStopped,
        },
        _ => CleanAct::KeepStopped,
    }
}

/// 失败处置决策（breaker 判定结果）
#[derive(Debug, PartialEq, Eq)]
enum FailAct {
    /// 策略 never：不重试
    Never,
    /// 计数但未触发（理论上罕见）
    Ok,
    /// 指数退避 delay 后重试
    Backoff(Duration),
    /// 熔断：等待手动干预
    Trip,
}

pub struct Supervisor {
    tasks: Vec<TaskRuntime>,
    breaker_window: Duration,
    breaker_max: u32,
    config_path: PathBuf,
    /// 任务日志根目录（<exe 目录>\data\logs，可经 settings.log_dir 覆写）
    log_root: PathBuf,
    evt_tx: EventSender,
    /// 命令通道自持克隆：探针/回收线程经回灌命令把结果交还引擎线程
    self_tx: Sender<Command>,
    stats: StatsView,
    fault_inject: bool,
    state: Arc<Mutex<SharedState>>,
    sampler: Sampler,
    tick: u32,
}

impl Supervisor {
    fn new(cfg: Config, config_path: PathBuf, evt_tx: EventSender, state: Arc<Mutex<SharedState>>, self_tx: Sender<Command>) -> Self {
        let window = Duration::from_secs(cfg.settings.breaker_window_sec.max(1));
        let max = cfg.settings.breaker_max_fails.max(1);
        let log_root = Config::resolve_log_dir(&cfg.settings.log_dir);
        let tasks = cfg
            .tasks
            .iter()
            .filter(|t| t.enabled)
            .map(|t| {
                let rt = TaskRuntime::new(t.clone(), window, max, logbuf::LOG_CAP, evt_tx.clone());
                if let Ok(mut g) = rt.log.lock() {
                    g.attach_file(&log_root); // 落盘 logs/<任务名>.log
                }
                rt
            })
            .collect();
        {
            let mut st = state.lock().unwrap_or_else(|e| e.into_inner());
            st.config_path = config_path.display().to_string();
        }
        Self {
            tasks,
            breaker_window: window,
            breaker_max: max,
            config_path,
            log_root,
            evt_tx,
            self_tx,
            stats: StatsView { spawned: 0, restarts: 0, last_error: None },
            fault_inject: false,
            state,
            sampler: Sampler::new(),
            tick: 0,
        }
    }

    /// 启动监督器线程。返回（命令发送端, 共享状态, 事件发送端, 事件接收端）。
    pub fn launch(
        cfg: Config,
        config_path: PathBuf,
    ) -> (Sender<Command>, Arc<Mutex<SharedState>>, EventSender, crate::core::events::EventReceiver) {
        let (evt_tx, evt_rx) = channel_events();
        let state = Arc::new(Mutex::new(SharedState::default()));
        let (cmd_tx, cmd_rx) = std::sync::mpsc::channel::<Command>();
        let mut sup = Self::new(cfg, config_path, evt_tx.clone(), state.clone(), cmd_tx.clone());
        sup.sync_views();
        std::thread::Builder::new()
            .name("supervisor".into())
            .spawn(move || sup.run(cmd_rx))
            .expect("spawn supervisor thread");
        (cmd_tx, state, evt_tx, evt_rx)
    }

    fn run(&mut self, cmd_rx: Receiver<Command>) {
        let mut next_tick = Instant::now() + TICK;
        loop {
            let mut should_stop = false;
            // 整个循环体（命令/节拍/快照同步）纳入 panic 保护：
            // 单次异常不杀线程，避免「引擎崩溃 → 后续命令全部失效」导致界面冻结
            let r = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                // 命令处理与 4Hz 节拍解耦：命令风暴不再额外触发 tick/快照，
                // tick 严格按 250ms 推进（落后则对齐下一周期，不补跑）
                let wait = next_tick.saturating_duration_since(Instant::now());
                match cmd_rx.recv_timeout(wait) {
                    Ok(cmd) => {
                        if self.dispatch(cmd) {
                            should_stop = true;
                        }
                        // 一次唤醒排空全部在途命令（均非阻塞）
                        while let Ok(cmd) = cmd_rx.try_recv() {
                            if self.dispatch(cmd) {
                                should_stop = true;
                            }
                        }
                    }
                    Err(RecvTimeoutError::Timeout) => {}
                    Err(RecvTimeoutError::Disconnected) => {
                        self.shutdown_all();
                        should_stop = true;
                    }
                }
                if Instant::now() >= next_tick {
                    self.tick();
                    next_tick += TICK;
                    if next_tick <= Instant::now() {
                        next_tick = Instant::now() + TICK;
                    }
                }
                self.sync_views();
            }));
            if let Err(payload) = r {
                let msg = payload
                    .downcast_ref::<&str>()
                    .map(|s| s.to_string())
                    .or_else(|| payload.downcast_ref::<String>().cloned())
                    .unwrap_or_else(|| "未知 panic".to_string());
                log::error!("TaskWarden 守护引擎循环异常（已捕获，继续运行）: {msg}");
            }
            if should_stop {
                break;
            }
        }
    }

    /// 返回 true 表示退出循环
    fn dispatch(&mut self, cmd: Command) -> bool {
        log::info!("[TaskWarden 命令] {:?}", cmd);
        match cmd {
            Command::Start(name) => self.start(&name, false),
            Command::Stop(name) => {
                self.terminate(&name, true, false);
            }
            Command::Restart(name) => {
                self.log_task(&name, "SYS", "执行重启 …");
                // 有存活进程 → 等回收线程回执(StopDone)再启动，避免端口/文件竞争；
                // 无存活进程 → 立即启动
                let live = self.terminate(&name, false, true);
                if let Some(rt) = self.find_mut(&name) {
                    rt.restart_pending = live;
                }
                if !live {
                    let n = name.clone();
                    self.start(&n, false);
                }
            }
            Command::StartAll => {
                let levels = topo_levels(&self.task_configs());
                for level in &levels {
                    for name in level {
                        let ready = matches!(
                            self.find(name).map(|t| t.state),
                            None | Some(TaskState::Stopped) | Some(TaskState::Backoff)
                        );
                        if ready {
                            self.log_task(name, "SYS", "按 DAG 拓扑序启动（依赖优先）");
                            let n = name.clone();
                            self.start(&n, false);
                        }
                    }
                }
            }
            Command::StopAll => {
                let levels = reverse_topo(&self.task_configs());
                for level in &levels {
                    for name in level {
                        self.terminate(name, false, false);
                    }
                }
            }
            Command::Crash(name) => self.crash(&name),
            Command::ResetBreaker(name) => {
                if let Some(rt) = self.find_mut(&name) {
                    rt.breaker.reset();
                    rt.state = TaskState::Stopped;
                    rt.last_error = None;
                    rt.backoff_until = None;
                    rt.restart_pending = false;
                    rt.log("SYS", "熔断计数已手动重置");
                    let _ = self.evt_tx.send(Event::BreakerReset { id: name.clone() });
                }
            }
            Command::Add(cfg) => self.add_task(cfg),
            Command::Update(cfg) => self.update_task(cfg),
            Command::Remove(name) => self.remove_task(&name),
            Command::SetFaultInject(v) => {
                self.fault_inject = v;
                self.state.lock().unwrap_or_else(|e| e.into_inner()).fault_inject = v;
            }
            Command::Shutdown => {
                self.shutdown_all();
                return true;
            }
            Command::ProbeDone { id, ok, ms, detail } => {
                if let Some(rt) = self.find_mut(&id) {
                    rt.probe_inflight = false;
                    rt.probe_ms = Some(ms);
                    rt.probe_ok = Some(ok);
                }
                let _ = self.evt_tx.send(Event::Probe { id, ok, ms, detail });
            }
            Command::StopDone { id } => {
                let relaunch = match self.find_mut(&id) {
                    Some(rt) => {
                        let p = rt.restart_pending;
                        rt.restart_pending = false;
                        p
                    }
                    None => false,
                };
                if relaunch {
                    let n = id.clone();
                    self.start(&n, false);
                }
            }
        }
        false
    }

    /* ---------------- 启动 ---------------- */

    fn start(&mut self, name: &str, _manual: bool) {
        // DAG：依赖未运行则先行启动上游（先收集，避免借用冲突）
        let deps: Vec<String> = self.find(name).map(|t| t.cfg.deps.clone()).unwrap_or_default();
        for dep in &deps {
            let dep_state = self.find(dep).map(|t| t.state);
            if matches!(dep_state, Some(TaskState::Stopped) | Some(TaskState::Backoff)) {
                self.log_task(name, "WARN", format!("依赖 \"{dep}\" 未运行 → 先行启动上游"));
                self.start(dep, false);
            }
        }

        let Some(rt) = self.find_mut(name) else { return };
        if rt.state == TaskState::Running || rt.state == TaskState::Starting {
            return;
        }
        if rt.state == TaskState::Fused {
            rt.log("SYS", "手动启动：熔断计数已重置");
            rt.breaker.reset();
        }
        rt.state = TaskState::Starting;
        rt.last_error = None;
        rt.backoff_until = None;
        rt.restart_pending = false;
        rt.ready = None;
        rt.probe_ms = None;
        rt.probe_ok = None;
        let _ = self.evt_tx.send(Event::StateChanged { id: name.to_string(), state: TaskState::Starting });

        // 故障注入（一次性）：模拟 CreateProcessW 失败 → 完整反馈链路
        if self.fault_inject {
            self.fault_inject = false;
            self.state.lock().unwrap_or_else(|e| e.into_inner()).fault_inject = false;
            if let Some(rt) = self.find_mut(name) {
                rt.state = TaskState::Stopped;
            }
            let err = "CreateProcessW 失败: The system cannot find the file specified. (os error 2)";
            self.log_task(name, "ERR", format!("派生失败 · {err}"));
            self.log_task(name, "SYS", "启动失败反馈链路已触发：托盘通知 + 卡片红框 + 错误详情");
            self.spawn_failed(name, err);
            return;
        }

        self.log_task(name, "SYS", "派生子进程 · CREATE_NO_WINDOW");
        let Some(cfg) = self.find(name).map(|t| t.cfg.clone()) else { return };
        match spawn_task(&cfg) {
            Ok(handle) => {
                // 绑定 Job Object：进程树纳入监管
                let job_name = format!("Global\\TaskWarden_{}", handle.pid);
                match JobHandle::new(&job_name) {
                    Ok(job) => {
                        if let Err(e) = job.assign(&handle.child) {
                            self.log_task(name, "WARN", format!("Job Object 绑定失败: {e}（进程树兜底回收不可用）"));
                        } else {
                            self.log_task(name, "SYS", "已绑定 Job Object · 进程树纳入监管");
                        }
                        if let Some(rt) = self.find_mut(name) {
                            rt.job = Some(job);
                        }
                    }
                    Err(e) => self.log_task(name, "WARN", format!("创建 Job Object 失败: {e}")),
                }
                let pid = handle.pid;
                let started = Instant::now();
                if let Some(rt) = self.find_mut(name) {
                    rt.pid = Some(pid);
                    rt.state = TaskState::Running;
                    rt.started_at = Some(started);
                    rt.started_at_ms = Some(now_ms());
                    rt.last_exit = None;
                    // 首启不计「重启」，与模拟端语义对齐
                    if rt.has_spawned {
                        rt.restarts += 1;
                    } else {
                        rt.has_spawned = true;
                    }
                }
                self.stats.spawned += 1;
                self.stats_update();
                self.log_task(name, "INFO", format!("进程已派生 · PID={pid} · 无窗口标志已置位"));
                let _ = self.evt_tx.send(Event::Spawned { id: name.to_string(), pid });
                let _ = self.evt_tx.send(Event::StateChanged { id: name.to_string(), state: TaskState::Running });
                if let Some(rt) = self.find_mut(name) {
                    rt.handle = Some(handle);
                }
                // 初始探针（全部不阻塞引擎线程）
                match cfg.health.mode {
                    HealthMode::Tcp | HealthMode::Http => {
                        self.spawn_probe(name, cfg.health.mode, cfg.health.target.clone());
                    }
                    HealthMode::Ready => {
                        let keyword = if cfg.health.target.is_empty() { "ready".to_string() } else { cfg.health.target.clone() };
                        if let Some(rt) = self.find_mut(name) {
                            rt.ready = Some(ReadyWait { keyword, deadline: started + READY_TIMEOUT, t0: started });
                        }
                    }
                    HealthMode::None => {}
                }
            }
            Err(e) => {
                if let Some(rt) = self.find_mut(name) {
                    rt.state = TaskState::Stopped;
                }
                self.spawn_failed(name, &e);
            }
        }
    }

    /// tcp/http 探针交给短命线程，结果经 Command::ProbeDone 回灌：
    /// 引擎线程不再被 2s 网络超时卡住（头部阻塞消除）。
    fn spawn_probe(&mut self, name: &str, mode: HealthMode, target: String) {
        if let Some(rt) = self.find_mut(name) {
            rt.probe_inflight = true;
        }
        let tx = self.self_tx.clone();
        let id = name.to_string();
        std::thread::spawn(move || {
            let rep = if mode == HealthMode::Http {
                probe_http(&target, PROBE_TIMEOUT)
            } else {
                probe_tcp(&target, PROBE_TIMEOUT)
            };
            let _ = tx.send(Command::ProbeDone { id, ok: rep.ok, ms: rep.ms, detail: rep.detail });
        });
    }

    /// spawn 失败反馈链路：熔断/退避决策 + 级联通告
    fn spawn_failed(&mut self, name: &str, err: &str) {
        self.set_last_error(name, err);
        let _ = self.evt_tx.send(Event::SpawnFailed { id: name.to_string(), error: err.to_string() });
        let max = self.breaker_max;
        let window_sec = self.breaker_window.as_secs();
        let act = self.register_failure(name, &format!("启动失败 · {err}"));
        match act {
            FailAct::Never => {}
            FailAct::Backoff(d) => {
                self.log_task(name, "WARN", format!("启动失败计入熔断窗口 → 指数退避 {}s 后重试", d.as_secs()));
            }
            FailAct::Trip => {
                let _ = self.evt_tx.send(Event::BreakerTripped { id: name.to_string(), window_sec, max_fails: max });
                self.notify_dependents(name, "熔断 → 依赖链风险通告");
            }
            FailAct::Ok => {}
        }
    }

    /// 统一失败处置：策略分发 + 滑动窗口熔断 + 指数退避状态迁移。
    /// 只改状态/计数，日志与事件由各调用方按上下文补（保留差异化文案）。
    fn register_failure(&mut self, name: &str, err: &str) -> FailAct {
        let max = self.breaker_max;
        let window_sec = self.breaker_window.as_secs();
        let Some(rt) = self.find_mut(name) else { return FailAct::Never };
        if rt.cfg.strategy == Strategy::Never {
            rt.state = TaskState::Stopped;
            rt.last_error = Some(format!("{err}（策略 never，不重试）"));
            return FailAct::Never;
        }
        let now = Instant::now();
        match rt.breaker.record_failure(now) {
            Decision::Trip => {
                rt.state = TaskState::Fused;
                rt.last_error = Some(format!("熔断触发：窗口内失败 {max} 次（{window_sec}s），自动重试已暂停"));
                FailAct::Trip
            }
            Decision::Backoff(delay) => {
                rt.state = TaskState::Backoff;
                rt.backoff_until = Some(now + delay);
                rt.last_error = Some(err.to_string());
                FailAct::Backoff(delay)
            }
            Decision::Ok => {
                rt.state = TaskState::Stopped;
                rt.last_error = Some(err.to_string());
                FailAct::Ok
            }
        }
    }

    /* ---------------- 停止 ---------------- */

    /// 统一终结：清空任务运行时并把 Child/Job 移交给回收线程，引擎线程立即返回。
    /// emit_event：是否广播 StateChanged；notify：回收完成后是否回灌 StopDone（Restart 续启动用）。
    /// 返回 true = 存在存活进程且已移交回收。
    fn terminate(&mut self, name: &str, emit_event: bool, notify: bool) -> bool {
        let Some(rt) = self.find_mut(name) else { return false };
        if rt.state == TaskState::Stopped {
            return false;
        }
        rt.ready = None;
        rt.probe_inflight = false;
        rt.restart_pending = false;
        let plan = match rt.pid.take() {
            Some(pid) => {
                let use_grace = rt.cfg.kind == Kind::Exe && rt.cfg.graceful_timeout > 0;
                if use_grace {
                    rt.log("SYS", format!("优雅停止窗口 {}s：等待自然退出 → 超时强杀进程树", rt.cfg.graceful_timeout));
                }
                let child = rt.handle.take().map(|h| h.child);
                let job = rt.job.take();
                let grace = if use_grace { Duration::from_secs(rt.cfg.graceful_timeout) } else { Duration::ZERO };
                Some((pid, child, job, grace, rt.log.clone()))
            }
            None => {
                rt.log("SYS", "任务已取消");
                None
            }
        };
        rt.state = TaskState::Stopped;
        rt.handle = None;
        rt.job = None;
        rt.backoff_until = None;
        rt.probe_ms = None;
        rt.probe_ok = None;
        rt.started_at = None;
        rt.started_at_ms = None;
        if emit_event {
            let _ = self.evt_tx.send(Event::StateChanged { id: name.to_string(), state: TaskState::Stopped });
        }
        self.cascade_stop(name);
        match plan {
            Some((pid, child, job, grace, log)) => {
                self.spawn_reaper(name.to_string(), pid, child, job, grace, log, notify);
                true
            }
            None => false,
        }
    }

    /// 停机回收线程：宽限轮询退出 → 超时/无宽限 → taskkill /T /F 整树 → 关 Job → StopDone。
    /// 全程不占用引擎线程（旧实现在此最长阻塞 graceful_timeout 秒）。
    fn spawn_reaper(&self, name: String, pid: u32, child: Option<Child>, job: Option<JobHandle>, grace: Duration, log: SharedLog, notify: bool) {
        let evt = self.evt_tx.clone();
        let self_tx = self.self_tx.clone();
        std::thread::spawn(move || {
            let mut exited = false;
            if let Some(mut ch) = child {
                let deadline = Instant::now() + grace;
                loop {
                    match ch.try_wait() {
                        Ok(Some(_)) => {
                            exited = true;
                            break;
                        }
                        Ok(None) => {}
                        Err(_) => break,
                    }
                    if Instant::now() >= deadline {
                        break;
                    }
                    std::thread::sleep(Duration::from_millis(50));
                }
            }
            if exited {
                emit_log(&log, &evt, &name, "SYS", "子进程已优雅退出 · 进程树回收完成".to_string());
            } else {
                emit_log(&log, &evt, &name, "SYS", format!("taskkill /T /F /PID {pid} · 整棵进程树已终结"));
                let _ = force_kill_tree(pid);
            }
            if let Some(job) = job {
                let _ = job.terminate(0); // 显式终结进程树；Drop 关句柄时 KILL_ON_JOB_CLOSE 再兜底
            }
            if notify {
                let _ = self_tx.send(Command::StopDone { id: name });
            }
        });
    }

    /// 级联：停止依赖本任务的所有下游
    fn cascade_stop(&mut self, name: &str) {
        let children: Vec<String> = dependents(&self.task_configs())
            .remove(name)
            .unwrap_or_default()
            .into_iter()
            .filter(|c| !matches!(self.find(c).map(|t| t.state), Some(TaskState::Stopped)))
            .collect();
        for child in children {
            self.log_task(&child, "WARN", format!("上游 \"{name}\" 已停止 → 级联停止"));
            self.terminate(&child, false, false);
        }
    }

    fn notify_dependents(&mut self, name: &str, msg: &str) {
        let children: Vec<String> = dependents(&self.task_configs()).remove(name).unwrap_or_default();
        for child in children {
            if matches!(self.find(&child).map(|t| t.state), Some(TaskState::Running) | Some(TaskState::Starting)) {
                self.log_task(&child, "WARN", format!("上游 \"{name}\" {msg}"));
            }
        }
    }

    /* ---------------- 崩溃与熔断 ---------------- */

    /// 模拟意外退出：TerminateProcess 子进程，tick 中 try_wait 捕获后走真实退出路径
    fn crash(&mut self, name: &str) {
        let Some(rt) = self.find_mut(name) else { return };
        if rt.state != TaskState::Running {
            return;
        }
        if let Some(h) = rt.handle.as_mut() {
            let _ = h.child.kill();
        }
    }

    /// 意外退出处理：策略分发 + 熔断 + 退避 + 级联通告
    fn handle_exit(&mut self, name: &str, code: Option<i32>) {
        let max = self.breaker_max;
        let window_sec = self.breaker_window.as_secs();
        let code = code.unwrap_or(-1);

        // ---------- 正常退出（code 0）----------
        if code == 0 {
            let (act, lifetime_secs) = {
                let Some(rt) = self.find_mut(name) else { return };
                if rt.state != TaskState::Running {
                    return;
                }
                let lifetime = rt.started_at.map(|t| t.elapsed());
                let act = clean_exit_action(rt.cfg.strategy, lifetime);
                let pid = rt.pid.take().unwrap_or(0);
                rt.handle = None;
                rt.job = None;
                rt.ready = None;
                rt.probe_ms = None;
                rt.probe_ok = None;
                rt.started_at = None;
                rt.started_at_ms = None;
                rt.last_exit = Some(0);
                let secs = lifetime.map(|d| d.as_secs_f64()).unwrap_or(0.0);
                rt.log("SYS", format!("进程正常退出 · exit_code=0 · PID={pid} · 存活 {secs:.1}s"));
                match act {
                    CleanAct::KeepStopped => {
                        rt.state = TaskState::Stopped;
                        rt.last_error = Some("进程正常退出 (code 0)".into());
                        rt.log("SYS", "策略非 always → 保持已停止");
                    }
                    CleanAct::Relaunch => {
                        rt.state = TaskState::Stopped;
                        rt.log("SYS", "策略 always → 重新拉起（常驻要求）");
                    }
                    CleanAct::CountFailure => {
                        rt.log("WARN", format!("正常退出但存活不足 {}s → 按崩溃循环计入熔断", MIN_STABLE_LIFETIME.as_secs()));
                    }
                }
                (act, secs)
            };
            let _ = self.evt_tx.send(Event::Exited { id: name.to_string(), code: 0 });
            match act {
                CleanAct::Relaunch => {
                    let n = name.to_string();
                    self.start(&n, false);
                }
                CleanAct::CountFailure => {
                    let err = format!("进程启动后立即正常退出（code 0 · 存活 {lifetime_secs:.1}s < {}s）", MIN_STABLE_LIFETIME.as_secs());
                    self.stats.restarts += 1;
                    self.stats.last_error = Some(format!("[{name}] {err}"));
                    self.stats_update();
                    let act = self.register_failure(name, &err);
                    self.failure_feedback(name, &act, max, window_sec);
                }
                CleanAct::KeepStopped => {}
            }
            return;
        }

        // ---------- 异常退出（code != 0）----------
        {
            let Some(rt) = self.find_mut(name) else { return };
            if rt.state != TaskState::Running {
                return;
            }
            let pid = rt.pid.take().unwrap_or(0);
            rt.handle = None;
            rt.job = None;
            rt.ready = None;
            rt.probe_ms = None;
            rt.probe_ok = None;
            rt.started_at = None;
            rt.started_at_ms = None;
            rt.last_exit = Some(code);
            rt.log("ERR", format!("进程意外退出 · exit_code={code} · PID={pid}"));
        }
        let err = format!("进程意外退出 (code {code})");
        let act = self.register_failure(name, &err);
        if act == FailAct::Never {
            return;
        }
        let _ = self.evt_tx.send(Event::Exited { id: name.to_string(), code });
        self.stats.restarts += 1;
        self.stats.last_error = Some(format!("[{name}] {err}"));
        self.stats_update();
        self.failure_feedback(name, &act, max, window_sec);
    }

    /// 失败决策的统一反馈尾：退避日志 / 熔断日志+事件+级联通告
    fn failure_feedback(&mut self, name: &str, act: &FailAct, max: u32, window_sec: u64) {
        match act {
            FailAct::Backoff(d) => {
                if let Some(rt) = self.find_mut(name) {
                    rt.log("WARN", format!("策略 {} → 指数退避 {}s 后重试 (第 {} 次)", rt.strategy_label(), d.as_secs(), rt.breaker.backoff_attempt()));
                }
            }
            FailAct::Trip => {
                if let Some(rt) = self.find_mut(name) {
                    rt.log("ERR", format!("熔断触发：滑动窗口 {window_sec}s 内失败 {max} 次 → 暂停自动重启"));
                }
                let _ = self.evt_tx.send(Event::BreakerTripped { id: name.to_string(), window_sec, max_fails: max });
                self.notify_dependents(name, "熔断 → 依赖链风险通告");
            }
            _ => {}
        }
    }

    /* ---------------- 节拍 ---------------- */

    fn tick(&mut self) {
        self.tick = self.tick.wrapping_add(1);
        let now = Instant::now();
        let mut exited: Vec<(String, Option<i32>)> = Vec::new();

        for i in 0..self.tasks.len() {
            let (name, state, backoff_until, mode) = {
                let rt = &self.tasks[i];
                (rt.cfg.name.clone(), rt.state, rt.backoff_until, rt.cfg.health.mode)
            };
            match state {
                TaskState::Running => {
                    // 1) 进程退出检测（退出前先采集 stdout/stderr，避免丢失信息）
                    let status = self.tasks[i].handle.as_mut().and_then(|h| h.try_wait().ok().flatten());
                    if let Some(st) = status {
                        let out = self.tasks[i].handle.as_mut().and_then(|h| h.drain_stdout());
                        let err = self.tasks[i].handle.as_mut().and_then(|h| h.drain_stderr());
                        if let Some(frame) = &out {
                            self.log_stdout(&name, frame);
                        }
                        if let Some(frame) = &err {
                            self.log_stderr(&name, frame);
                        }
                        self.advance_ready(i, &name, out.as_deref());
                        exited.push((name, st.code()));
                        continue;
                    }
                    // 2) stdout 采集（正常输出 → 逐行 INFO；ready 探针复用同一帧数据）
                    let out = self.tasks[i].handle.as_mut().and_then(|h| h.drain_stdout());
                    if let Some(frame) = &out {
                        self.log_stdout(&name, frame);
                    }
                    // 3) stderr 采集（逐行按内容分级，不一律标红）
                    if let Some(frame) = self.tasks[i].handle.as_mut().and_then(|h| h.drain_stderr()) {
                        self.log_stderr(&name, &frame);
                    }
                    // 4) 就绪等待推进（引擎内处理：关键字命中/超时 → 记探针结果）
                    self.advance_ready(i, &name, out.as_deref());
                    // 5) 周期健康重探（tcp/http）：交给短命线程，在途则跳过（不堆叠、不阻塞）
                    let inflight = self.tasks[i].probe_inflight;
                    if self.tick % PROBE_EVERY_TICKS == 0 && (mode == HealthMode::Tcp || mode == HealthMode::Http) && !inflight {
                        let target = self.tasks[i].cfg.health.target.clone();
                        self.spawn_probe(&name, mode, target);
                    }
                }
                TaskState::Backoff => {
                    if let Some(until) = backoff_until {
                        if now >= until {
                            self.tasks[i].backoff_until = None;
                            let n = name.clone();
                            self.start(&n, false);
                        }
                    }
                }
                _ => {}
            }
        }

        for (name, code) in exited {
            self.handle_exit(&name, code);
        }

        // 指标采样（4Hz）→ 共享状态
        let s = self.sampler.sample();
        {
            let mut st = self.state.lock().unwrap_or_else(|e| e.into_inner());
            st.cpu = s.cpu_pct;
            st.mem = s.mem_pct;
            st.gpu = s.gpu_pct.unwrap_or(0.0);
            st.gpu_temp = s.gpu_temp_c;
            st.vram = match (s.vram_used_mb, s.vram_total_mb) {
                (Some(u), Some(t)) => Some((u, t)),
                _ => None,
            };
            if st.cpu_hist.len() >= 60 {
                st.cpu_hist.pop_front();
            }
            st.cpu_hist.push_back(s.cpu_pct);
            if st.gpu_hist.len() >= 60 {
                st.gpu_hist.pop_front();
            }
            st.gpu_hist.push_back(s.gpu_pct.unwrap_or(0.0));
        }
    }

    /// 就绪等待推进（引擎节拍内，零线程）：stdout 帧命中关键字 → 成功；超期 → 失败。
    /// 无论命中与否，stdout 日志已由 tick 写入环缓冲，数据不再被探针吞掉。
    fn advance_ready(&mut self, i: usize, name: &str, frame: Option<&str>) {
        let waiting = self.tasks[i].ready.as_ref().map(|r| (r.keyword.clone(), r.deadline, r.t0));
        let Some((keyword, deadline, t0)) = waiting else { return };
        let hit = frame.map(|f| f.contains(keyword.as_str())).unwrap_or(false);
        if hit {
            self.tasks[i].ready = None;
            let ms = t0.elapsed().as_millis();
            self.tasks[i].probe_inflight = false;
            self.record_probe(name, ProbeReport::ok(ms, format!("stdout 捕获关键字 \"{keyword}\"")));
        } else if Instant::now() >= deadline {
            self.tasks[i].ready = None;
            let ms = t0.elapsed().as_millis();
            self.record_probe(name, ProbeReport::fail(ms, format!("就绪等待超时：stdout 未出现关键字 \"{keyword}\"")));
        }
    }

    fn record_probe(&mut self, name: &str, rep: ProbeReport) {
        if let Some(rt) = self.find_mut(name) {
            rt.probe_ms = Some(rep.ms);
            rt.probe_ok = Some(rep.ok);
        }
        let _ = self.evt_tx.send(Event::Probe {
            id: name.to_string(),
            ok: rep.ok,
            ms: rep.ms,
            detail: rep.detail,
        });
    }

    /* ---------------- 配置变更 ---------------- */

    fn add_task(&mut self, cfg: TaskConfig) {
        if self.tasks.iter().any(|t| t.cfg.name == cfg.name) {
            self.log_task(&cfg.name, "WARN", "任务名已存在");
            return;
        }
        let rt = TaskRuntime::new(cfg.clone(), self.breaker_window, self.breaker_max, logbuf::LOG_CAP, self.evt_tx.clone());
        if let Ok(mut g) = rt.log.lock() {
            g.attach_file(&self.log_root);
        }
        self.tasks.push(rt);
        self.log_task(&cfg.name, "SYS", "任务已创建 · 配置写入 config.toml（原子替换落盘）");
        self.persist_config();
        let _ = self.evt_tx.send(Event::ConfigChanged { config: self.task_configs() });
        let _ = self.evt_tx.send(Event::TasksChanged);
    }

    fn update_task(&mut self, cfg: TaskConfig) {
        let Some(idx) = self.tasks.iter().position(|t| t.cfg.name == cfg.name) else { return };
        let was_running = self.tasks[idx].state == TaskState::Running;
        self.tasks[idx].cfg = cfg.clone();
        if !was_running {
            self.tasks[idx].state = TaskState::Stopped;
        }
        self.log_task(&cfg.name, "SYS", "配置已更新 · config.toml 已落盘（下次启动生效）");
        self.persist_config();
        let _ = self.evt_tx.send(Event::ConfigChanged { config: self.task_configs() });
        let _ = self.evt_tx.send(Event::TasksChanged);
    }

    fn remove_task(&mut self, name: &str) {
        if let Some(idx) = self.tasks.iter().position(|t| t.cfg.name == name) {
            if self.tasks[idx].state == TaskState::Running {
                self.terminate(name, false, false);
            }
            let removed = self.tasks.remove(idx);
            removed.log("SYS", "任务已删除（含日志文件）");
            self.persist_config();
            let _ = self.evt_tx.send(Event::ConfigChanged { config: self.task_configs() });
            let _ = self.evt_tx.send(Event::TasksChanged);
        }
    }

    fn persist_config(&mut self) {
        let cfg = Config {
            settings: Settings {
                log_dir: "logs".into(),
                breaker_window_sec: self.breaker_window.as_secs(),
                breaker_max_fails: self.breaker_max,
                theme: "dark".into(),
            },
            tasks: self.task_configs(),
        };
        let path = self.config_path.clone();
        let _ = cfg.save(&path);
    }

    /* ---------------- 收尾 ---------------- */

    fn shutdown_all(&mut self) {
        let names: Vec<String> = self.tasks.iter().map(|t| t.cfg.name.clone()).collect();
        for name in &names {
            // 关机路径用同步终结：引擎线程随即退出，进程树必须在此等完，
            // 不能交给回收线程（进程先死会让强杀做不完；Job Drop 只是最后兜底）
            if let Some(rt) = self.find_mut(name) {
                if let Some(pid) = rt.pid.take() {
                    let use_grace = rt.cfg.kind == Kind::Exe && rt.cfg.graceful_timeout > 0;
                    if use_grace {
                        let grace = Duration::from_secs(rt.cfg.graceful_timeout);
                        let exited = rt.handle.as_mut().map(|h| graceful_stop(&mut h.child, grace)).unwrap_or(false);
                        if !exited {
                            rt.log("SYS", format!("优雅退出超时 · taskkill /T /F /PID {pid} 兜底强杀进程树"));
                            let _ = force_kill_tree(pid);
                        }
                    } else {
                        let _ = force_kill_tree(pid);
                    }
                }
                rt.state = TaskState::Stopped;
                rt.ready = None;
                rt.handle = None;
                rt.job = None;
            }
        }
        self.persist_config();
    }

    /* ---------------- 工具 ---------------- */

    fn find(&self, name: &str) -> Option<&TaskRuntime> {
        self.tasks.iter().find(|t| t.cfg.name == name)
    }

    fn find_mut(&mut self, name: &str) -> Option<&mut TaskRuntime> {
        self.tasks.iter_mut().find(|t| t.cfg.name == name)
    }

    fn task_configs(&self) -> Vec<TaskConfig> {
        self.tasks.iter().map(|t| t.cfg.clone()).collect()
    }

    /// 任务日志（写内存 Ring Buffer + 追加文件 + 实时事件流）。不占用 &mut self 之外的借用。
    fn log_task(&mut self, name: &str, level: &'static str, msg: impl Into<String>) {
        let msg = msg.into();
        if let Some(rt) = self.tasks.iter_mut().find(|t| t.cfg.name == name) {
            rt.log(level, msg);
        }
    }

    /// stdout 帧逐行投递：pump 已行缓冲，一行一条（INFO），面板与文件日志整齐可读
    fn log_stdout(&mut self, name: &str, frame: &str) {
        for line in frame.lines() {
            let t = line.trim();
            if !t.is_empty() {
                self.log_task(name, "INFO", t.to_string());
            }
        }
    }

    /// stderr 帧逐行投递：级别按内容启发判定（llama.cpp 等不再整屏标红）
    fn log_stderr(&mut self, name: &str, frame: &str) {
        for line in frame.lines() {
            let t = line.trim();
            if !t.is_empty() {
                self.log_task(name, classify_stderr(t), t.to_string());
            }
        }
    }

    fn set_last_error(&mut self, name: &str, err: &str) {
        self.stats.last_error = Some(format!("[{name}] {err}"));
        if let Some(rt) = self.find_mut(name) {
            rt.last_error = Some(err.to_string());
        }
        self.stats_update();
    }

    fn stats_update(&mut self) {
        let _ = self.evt_tx.send(Event::Stats {
            spawned: self.stats.spawned,
            restarts: self.stats.restarts,
            last_error: self.stats.last_error.clone(),
        });
    }

    /// 同步共享状态快照（GUI 读取）
    fn sync_views(&mut self) {
        let mut st = self.state.lock().unwrap_or_else(|e| e.into_inner());
        st.tasks = self
            .tasks
            .iter()
            .map(|rt| TaskView {
                name: rt.cfg.name.clone(),
                state: rt.state,
                pid: rt.pid,
                restarts: rt.restarts,
                probe_ms: rt.probe_ms,
                probe_ok: rt.probe_ok,
                last_error: rt.last_error.clone(),
                exit_code: rt.last_exit,
                log: rt.log.clone(),
                kind: rt.cfg.kind,
                path: rt.cfg.path.clone(),
                args: rt.cfg.args.clone(),
                cwd: rt.cfg.cwd.clone(),
                strategy: rt.cfg.strategy,
                health_mode: rt.cfg.health.mode,
                health_target: rt.cfg.health.target.clone(),
                graceful_timeout: rt.cfg.graceful_timeout,
                deps: rt.cfg.deps.clone(),
                started_at_ms: rt.started_at_ms,
                backoff_until_ms: rt.backoff_until.map(|until| {
                    let remaining = until.saturating_duration_since(Instant::now());
                    now_ms() + remaining.as_millis() as u64
                }),
            })
            .collect();
        st.running_count = self.tasks.iter().filter(|t| t.state == TaskState::Running).count();
        st.stats = self.stats.clone();
    }
}

fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fast_clean_exit_under_always_counts_as_failure() {
        // 秒退的常驻脚本：正常退出也必须进熔断退避，不得原地循环重拉
        assert_eq!(clean_exit_action(Strategy::Always, Some(Duration::from_secs(2))), CleanAct::CountFailure);
        assert_eq!(clean_exit_action(Strategy::Always, Some(Duration::from_millis(5))), CleanAct::CountFailure);
    }

    #[test]
    fn stable_clean_exit_relaunches_and_others_stay_stopped() {
        assert_eq!(clean_exit_action(Strategy::Always, Some(MIN_STABLE_LIFETIME + Duration::from_secs(1))), CleanAct::Relaunch);
        assert_eq!(clean_exit_action(Strategy::OnFailure, Some(Duration::from_secs(1))), CleanAct::KeepStopped);
        assert_eq!(clean_exit_action(Strategy::Never, Some(Duration::from_secs(99))), CleanAct::KeepStopped);
        assert_eq!(clean_exit_action(Strategy::Always, None), CleanAct::KeepStopped);
    }

    #[test]
    fn emit_log_writes_ring_and_streams_event() {
        // 环缓冲与实时事件流必须同源：get_logs 拉取与 log-event 推送内容一致
        let log = logbuf::shared("t", 8);
        let (tx, rx) = channel_events();
        emit_log(&log, &tx, "t", "INFO", "hello".into());
        assert_eq!(log.lock().unwrap().len(), 1);
        match rx.recv().unwrap() {
            Event::Log { id, level, msg } => {
                assert_eq!(id, "t");
                assert_eq!(level, "INFO");
                assert_eq!(msg, "hello");
            }
            other => panic!("期望 Event::Log，收到 {other:?}"),
        }
    }

    #[test]
    fn stderr_llama_style_lines_are_not_all_red() {
        // 真实 llama.cpp stderr 样本：多数是信息/警告，不应整屏 ERR
        assert_eq!(classify_stderr("0.00.055.284 I cmn  common_param: verbosity = 3"), "INFO");
        assert_eq!(classify_stderr("0.00.070.374 I srv    load_model: loading model 'x.gguf'"), "INFO");
        assert_eq!(classify_stderr("0.08.411.211 I srv  llama_server: listening on http://127.0.0.1:8082"), "INFO");
        assert_eq!(classify_stderr("0.00.055.189 W cmn  postprocess_: Not enough set bits in CPU mask"), "WARN");
        assert_eq!(classify_stderr("0.00.055.166 W DEPRECATED: --mmap and --no-mmap are deprecated"), "WARN");
        assert_eq!(classify_stderr("0.00.929.306 W model has unused tensor blk.64.attn_q.weight -- ignoring"), "WARN");
    }

    #[test]
    fn stderr_real_errors_stay_red() {
        assert_eq!(classify_stderr("error: model file not found"), "ERR");
        assert_eq!(classify_stderr("0.00.123.456 E srv: failed to bind port"), "ERR");
        assert_eq!(classify_stderr("thread 'main' panicked at 'index out of bounds'"), "ERR");
        assert_eq!(classify_stderr("some unrecognized noise"), "WARN"); // 无线索保守为 WARN
    }
}
