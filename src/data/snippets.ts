/* ------------------------------------------------------------------ */
/* 关键实现代码片段（Rust / TOML）——与右侧标签页一一对应                  */
/* ------------------------------------------------------------------ */

export interface Snippet {
  id: string;
  file: string;
  layer: string;
  lang: "rust" | "toml";
  title: string;
  note: string;
  code: string;
}

export const SNIPPETS: Snippet[] = [
  {
    id: "config",
    file: "config.toml",
    layer: "基础设施层",
    lang: "toml",
    title: "任务配置持久化",
    note: "全部任务收敛到一份 config.toml：per-task 重启策略、熔断窗口、健康探针与依赖声明。写入采用「临时文件 + 原子 rename」，杜绝半截配置。",
    code: `# <exe目录>\\data\\config.toml（便携；首启从 %APPDATA% 迁移）
[settings]
log_dir            = "logs"        # 每任务一个日志文件
breaker_window_sec = 60            # 熔断滑动窗口
breaker_max_fails  = 3             # 窗口内失败上限
theme              = "dark"        # dark / light

[[tasks]]
name = "ollama-serve"
kind = "exe"                       # exe | bat | ps1
path = "C:\\\\tools\\\\ollama\\\\ollama.exe"
args = ["serve"]
cwd  = "C:\\\\tools\\\\ollama"
strategy          = "always"       # always | on-failure | never
graceful_timeout  = 5              # 优雅停止窗口（秒，仅 exe）
deps = []

[tasks.health]
mode   = "tcp"                     # tcp | http | ready | none
target = "127.0.0.1:11434"

[[tasks]]
name = "model-router"
kind = "exe"
path = "C:\\\\srv\\\\router\\\\router.exe"
args = ["--port", "8080", "--upstream", "11434"]
strategy = "on-failure"
deps = ["ollama-serve"]            # DAG：依赖先启，熔断级联通知

[tasks.health]
mode   = "http"
target = "http://127.0.0.1:8080/health"   # 2xx/3xx 视为健康

[[tasks]]
name = "log-shipper"
kind = "ps1"                       # → powershell -ExecutionPolicy Bypass -File
path = "C:\\\\scripts\\\\ship-logs.ps1"
args = ["-target", "loki"]
strategy = "always"

[tasks.health]
mode   = "ready"                   # 等待 stdout 就绪关键字
target = "ready"`,
  },
  {
    id: "process",
    file: "runtime/process.rs",
    layer: "进程运行时层",
    lang: "rust",
    title: "静默派生 · CREATE_NO_WINDOW",
    note: "按扩展名适配三种启动器，统一附加 CREATE_NO_WINDOW（0x0800_0000）标志；stdout/stderr 重定向为管道，喂给 Ring Buffer 与日志文件。",
    code: `use std::io;
use std::os::windows::process::CommandExt;
use std::process::{Child, Command, Stdio};

use crate::core::Task;

/// CREATE_NO_WINDOW —— 彻底杜绝控制台黑框
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

/// 按任务类型派生子进程：exe 直启 / bat 走 cmd /c / ps1 走 Bypass
pub fn spawn_silent(task: &Task) -> io::Result<Child> {
    let mut cmd = match task.kind.as_str() {
        "exe" => Command::new(&task.path),
        "bat" | "cmd" => {
            let mut c = Command::new("cmd");
            c.arg("/c").arg(&task.path);
            c
        }
        "ps1" => {
            let mut c = Command::new("powershell");
            c.args(["-ExecutionPolicy", "Bypass", "-File"])
             .arg(&task.path);
            c
        }
        other => return Err(io::Error::other(format!("未知类型: {other}"))),
    };

    cmd.args(&task.args)
        .current_dir(&task.cwd)
        .stdout(Stdio::piped())      // → Ring Buffer + logs/<name>.log
        .stderr(Stdio::piped())
        .creation_flags(CREATE_NO_WINDOW);

    cmd.spawn()
}`,
  },
  {
    id: "job",
    file: "runtime/job.rs",
    layer: "进程运行时层",
    lang: "rust",
    title: "Job Object · 进程树级联终结",
    note: "子进程派生后立即绑定 Job Object。脚本衍生的孙进程自动继承成员身份；KILL_ON_JOB_CLOSE 保证主程序退出时整棵树被系统级回收。",
    code: `use std::process::Child;
use windows::Win32::Foundation::HANDLE;
use windows::Win32::System::JobObjects::*;
use windows::Win32::System::Threading::*;

/// 绑定进程树：停止 = 终结整个 Job，而非单个 PID
pub struct ProcessTree {
    job: HANDLE,
}

impl ProcessTree {
    pub fn attach(child: &Child) -> windows::Result<Self> {
        unsafe {
            let job = CreateJobObjectW(None, None)?;

            // 主程序退出 → 系统自动终结 Job 内全部进程
            let mut info = JOBOBJECT_EXTENDED_LIMIT_INFORMATION::default();
            info.BasicLimitInformation.LimitFlags =
                JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
            SetInformationJobObject(
                job,
                JobObjectExtendedLimitInformation,
                &info as *const _ as _,
                size_of_val(&info) as u32,
            )?;

            let h = OpenProcess(
                PROCESS_TERMINATE | PROCESS_SET_QUOTA,
                false,
                child.id(),
            )?;
            AssignProcessToJobObject(job, h)?;
            Ok(Self { job })
        }
    }

    /// 等价语义：taskkill /F /T /PID <pid>
    pub fn kill_tree(&self) -> windows::Result<()> {
        unsafe { TerminateJobObject(self.job, 1) }
    }
}`,
  },
  {
    id: "breaker",
    file: "core/breaker.rs",
    layer: "核心调度层",
    lang: "rust",
    title: "滑动窗口熔断 + 指数退避",
    note: "窗口时长与失败上限均可在 config.toml 配置。窗口内失败次数超限 → 熔断挂起；未超限则按 2^n 秒指数退避重试（n 截至 6，封顶 64s），进程稳定后计数归零。",
    code: `use std::collections::VecDeque;
use std::time::{Duration, Instant};

pub enum Decision {
    Ok,                                   // 正常计数，未触发
    Trip,                                 // 熔断：暂停自动重启
    Backoff(Duration),                    // 退避 delay 秒后重试
}

pub struct Breaker {
    window: Duration,                     // 滑动窗口（默认 60s）
    max_fails: u32,                       // 窗口内失败上限（默认 3）
    failures: VecDeque<Instant>,          // 失败时间戳
    backoff_attempt: u32,
    backoff_until: Option<Instant>,
    fused: bool,
}

impl Breaker {
    pub fn record_failure(&mut self, now: Instant) -> Decision {
        self.trim(now);                       // 滑出窗口外的旧失败不再计数
        self.failures.push_back(now);
        self.backoff_attempt += 1;
        if self.failures.len() as u32 >= self.max_fails {
            self.failures.clear();
            Decision::Trip                    // 熔断：暂停自动重启，等待手动干预
        } else {
            Decision::Backoff(self.backoff_delay(self.backoff_attempt))
        }
    }

    /// 指数退避：2^n 秒，封顶 64s
    pub fn backoff_delay(&self, attempt: u32) -> Duration {
        let exp = attempt.min(6) as u32;      // 2^6 = 64s 封顶
        Duration::from_secs(1 << exp)
    }

    /// 手动重置（用户干预后）
    pub fn reset(&mut self) {
        self.failures.clear();
        self.backoff_attempt = 0;
        self.backoff_until = None;
        self.fused = false;
    }

    fn trim(&mut self, now: Instant) {
        while let Some(&f) = self.failures.front() {
            if now.duration_since(f) > self.window {
                self.failures.pop_front();
            } else {
                break;
            }
        }
    }
}`,
  },
  {
    id: "scheduler",
    file: "core/scheduler.rs",
    layer: "核心调度层",
    lang: "rust",
    title: "DAG 拓扑启动 / 级联停止",
    note: "Kahn 算法把任务切成若干「层」：同层任务并发派生，层与层之间串行等待；存在环时把剩余任务并入最后一层继续执行，不报错。停止按反拓扑序执行，天然支持级联。",
    code: `use std::collections::{HashMap, HashSet};

use crate::infra::config::TaskConfig;

/// Kahn 拓扑分层：第 0 层无依赖可并发，层序即启动序。
/// 存在环或未知依赖导致未排入的任务，追加为最后一层继续执行（不报错）。
pub fn topo_levels(tasks: &[TaskConfig]) -> Vec<Vec<String>> {
    let deps = direct_deps(tasks);
    let mut indeg: HashMap<String, usize> = deps.iter().map(|(k, v)| (k.clone(), v.len())).collect();
    let depend = dependents(tasks);

    let mut levels: Vec<Vec<String>> = Vec::new();
    let mut frontier: Vec<String> = indeg
        .iter()
        .filter(|(_, &d)| d == 0)
        .map(|(k, _)| k.clone())
        .collect();
    while !frontier.is_empty() {
        levels.push(frontier.clone());
        let mut next: Vec<String> = Vec::new();
        for node in &frontier {
            if let Some(children) = depend.get(node) {
                for c in children {
                    if let Some(d) = indeg.get_mut(c) {
                        *d -= 1;
                        if *d == 0 {
                            next.push(c.clone());
                        }
                    }
                }
            }
        }
        frontier = next;
    }
    // 未排入的任务（成环 / 未知依赖）并入最后一层，继续执行而非报错
    let scheduled: HashSet<String> = levels.iter().flatten().cloned().collect();
    let leftovers: Vec<String> = indeg.keys().filter(|k| !scheduled.contains(*k)).cloned().collect();
    if !leftovers.is_empty() {
        levels.push(leftovers);
    }
    levels   // supervisor 逐层 spawn，层内 std::thread 并发
}`,
  },
  {
    id: "health",
    file: "core/health.rs",
    layer: "核心调度层",
    lang: "rust",
    title: "健康检查 · TCP / HTTP / 就绪",
    note: "三种探针 per-task 可选；全部基于 std::net 同步超时实现，不引入异步运行时。探测结果聚合为卡片上的健康度徽章。",
    code: `use std::net::TcpStream;
use std::time::Duration;

pub enum HealthMode { Tcp, Http, Ready(String), None }
pub enum Health { Up(Duration), Down(String), Pending }

pub fn probe(mode: &HealthMode, target: &str, timeout: Duration) -> Health {
    let t0 = std::time::Instant::now();
    match mode {
        // 端口可连接即健康
        HealthMode::Tcp => match TcpStream::connect_timeout(
            &target.parse().unwrap(), timeout,
        ) {
            Ok(_) => Health::Up(t0.elapsed()),
            Err(e) => Health::Down(e.to_string()),
        },

        // 状态码 2xx / 3xx 即健康（最小 HTTP/1.1 客户端，无三方依赖）
        HealthMode::Http => match tiny_http_status(target, timeout) {
            Ok(code) if (200..400).contains(&code) => Health::Up(t0.elapsed()),
            Ok(code) => Health::Down(format!("HTTP {code}")),
            Err(e) => Health::Down(e.to_string()),
        },

        // 就绪等待：启动后 N 秒内捕获 stdout 关键字
        HealthMode::Ready(keyword) => {
            // supervisor 在日志流中匹配关键字，超时记为失败
            Health::Pending
        }
        HealthMode::None => Health::Up(Duration::ZERO),
    }
}`,
  },
  {
    id: "logbuf",
    file: "infra/logbuf.rs",
    layer: "基础设施层",
    lang: "rust",
    title: "Ring Buffer 实时日志",
    note: "每任务一个定容环形缓冲（默认 200 行）：供日志面板/文件双写；同一份数据由 BufWriter 以 ≤500ms 节流追加写入 <exe目录>\\data\\logs\\<任务名>.log，内存恒定不暴涨。",
    code: `use std::collections::VecDeque;
use std::fs::OpenOptions;
use std::io::{BufWriter, Write};

pub const LOG_CAP: usize = 200;            // Ring Buffer 默认 200 行
const FLUSH_INTERVAL_MS: u64 = 500;        // INFO 行 ≤500ms 落一次盘

#[derive(Clone)]
pub struct LogLine {
    pub t_ms: u64,          // unix 毫秒
    pub level: &'static str,// INFO / WARN / ERR / SYS
    pub msg: String,
}

/// 定容环形缓冲：写满后覆盖最旧行，内存恒定；同一份数据写入日志文件
pub struct LogBuf {
    lines: VecDeque<LogLine>,
    cap: usize,
    file: Option<BufWriter<std::fs::File>>, // <data>/logs/<任务名>.log 追加句柄
    last_flush_ms: u64,
}

impl LogBuf {
    pub fn push(&mut self, t_ms: u64, level: &'static str, msg: String) {
        let line = LogLine { t_ms, level, msg };
        if let Some(w) = self.file.as_mut() {
            let _ = writeln!(w, "[{}] {:<5} {}", format_time(t_ms), level, line.msg);
            // 关键行或超出节流窗口才落盘；普通 INFO 攒在 8KB 缓冲里
            if level != "INFO" || t_ms.saturating_sub(self.last_flush_ms) >= FLUSH_INTERVAL_MS {
                let _ = w.flush();
                self.last_flush_ms = t_ms;
            }
        }
        if self.lines.len() == self.cap {
            self.lines.pop_front();           // 写满覆盖最旧，内存恒定
            if let Some(w) = self.file.as_mut() { let _ = w.flush(); }
        }
        self.lines.push_back(line);
    }

    /// 按时间序迭代，供日志面板/文件双写
    pub fn iter(&self) -> impl Iterator<Item = &LogLine> {
        self.lines.iter()
    }
}`,
  },
  {
    id: "main",
    file: "lib.rs + backend.rs",
    layer: "入口 / 托盘",
    lang: "rust",
    title: "Tauri 装配入口 + 托盘",
    note: "Tauri 2 单实例插件拦截二次启动并唤起已有窗口；托盘 TrayIconBuilder 内嵌 tray-icon.png，菜单为「显示主窗口 / 退出程序」，退出先级联终结全部子进程再落盘配置。",
    code: `/* ============ src-tauri/src/lib.rs —— Tauri 装配入口（节选） ============ */
mod backend; mod core; mod infra; mod runtime;

use infra::config::Config;
use tauri::Manager;

pub fn run() {
    // 诊断日志：stdout（开发）+ <exe 目录>\\data\\logs\\app.log（便携持久）
    let app_log = tauri_plugin_log::Target::new(tauri_plugin_log::TargetKind::Folder {
        path: Config::data_dir().join("logs"),
        file_name: Some("app".into()),
    });
    tauri::Builder::default()
        .plugin(
            tauri_plugin_log::Builder::default()
                .level(log::LevelFilter::Info)
                .targets([
                    tauri_plugin_log::Target::new(tauri_plugin_log::TargetKind::Stdout),
                    app_log,
                ])
                .build(),
        )
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            // 二次启动：激活已有主窗口
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.show();
                let _ = w.set_focus();
            }
        }))
        .setup(|app| { backend::init(app.handle())?; Ok(()) })
        .invoke_handler(tauri::generate_handler![
            backend::list_snapshot, backend::start, backend::stop, backend::restart,
            backend::start_all, backend::stop_all, backend::crash, backend::reset_breaker,
            backend::add_task, backend::update_task, backend::remove_task,
            backend::set_fault_inject, backend::shutdown, backend::get_logs, backend::clear_logs,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

/* ============ src-tauri/src/backend.rs —— 托盘构建（节选） ============ */
use tauri::menu::{MenuBuilder, MenuItemBuilder};
use tauri::tray::TrayIconBuilder;

fn build_tray(app: &AppHandle) -> tauri::Result<()> {
    let show = MenuItemBuilder::with_id("show", "显示主窗口").build(app)?;
    let quit = MenuItemBuilder::with_id("quit", "退出程序").build(app)?;
    let menu = MenuBuilder::new(app).items(&[&show, &quit]).build()?;
    // 托盘专用图标（编译期内嵌）：无底板、图形撑满画布，16~24px 依然清晰
    let tray_icon = tauri::image::Image::from_bytes(include_bytes!("../icons/tray-icon.png"))
        .unwrap_or_else(|_| app.default_window_icon().cloned().expect("内嵌了默认窗口图标"));
    TrayIconBuilder::new()
        .icon(tray_icon)
        .icon_as_template(false)
        .menu(&menu)
        .tooltip("TaskWarden · 轻量级后台任务守护监督器")
        .on_menu_event(|app, ev| match ev.id().as_ref() {
            "show" => { /* show + set_focus 主窗口 */ }
            "quit" => app.exit(0),
            _ => {}
        })
        .build(app)?;
    Ok(())
}`,
  },
];
