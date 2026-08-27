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
    code: `# %APPDATA%\\Sentinel\\config.toml
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
    note: "窗口时长与失败上限均可在 config.toml 配置。窗口内连续失败超限 → 熔断挂起；未超限则按 2^n 秒指数退避重试，成功运行后计数归零。",
    code: `use std::collections::VecDeque;
use std::time::{Duration, Instant};

pub enum Verdict {
    Backoff(Duration),   // 退避后重试
    Fused,               // 熔断：暂停自动重启
}

pub struct Breaker {
    window: Duration,            // 滑动窗口（默认 60s）
    max_fails: usize,            // 窗口内失败上限（默认 3）
    events: VecDeque<Instant>,   // 失败时间戳
    attempt: u32,
}

impl Breaker {
    pub fn record_failure(&mut self) -> Verdict {
        let now = Instant::now();
        // 滑出窗口外的旧失败不再计数
        self.events.retain(|t| now.duration_since(*t) < self.window);
        self.events.push_back(now);

        if self.events.len() >= self.max_fails {
            self.events.clear();
            Verdict::Fused
        } else {
            // 指数退避：2s → 4s → 8s … 封顶 60s
            let secs = (1u64 << self.attempt.min(5)).min(60);
            self.attempt += 1;
            Verdict::Backoff(Duration::from_secs(secs))
        }
    }

    /// 进程稳定运行后复位退避计数
    pub fn on_stable(&mut self) {
        self.attempt = 0;
    }
}`,
  },
  {
    id: "scheduler",
    file: "core/scheduler.rs",
    layer: "核心调度层",
    lang: "rust",
    title: "DAG 拓扑启动 / 级联停止",
    note: "Kahn 算法把任务切成若干「层」：同层任务并发派生，层与层之间串行等待；检测到环直接报错拒绝启动。停止按反拓扑序执行，天然支持级联。",
    code: `use std::collections::{HashMap, VecDeque};

use crate::core::Task;

/// Kahn 拓扑分层：第 0 层无依赖可并发，层序即启动序
pub fn topo_levels(tasks: &[Task]) -> Result<Vec<Vec<String>>, String> {
    let mut indeg: HashMap<&str, usize> = HashMap::new();
    let mut dependents: HashMap<&str, Vec<&str>> = HashMap::new();

    for t in tasks {
        indeg.entry(t.name.as_str()).or_insert(0);
        for dep in &t.deps {
            *indeg.entry(t.name.as_str()).or_insert(0) += 1;
            dependents.entry(dep.as_str()).or_default().push(&t.name);
        }
    }

    let mut queue: VecDeque<&str> = indeg
        .iter()
        .filter(|(_, &d)| d == 0)
        .map(|(&n, _)| n)
        .collect();

    let mut levels = Vec::new();
    while !queue.is_empty() {
        let level: Vec<String> = queue.iter().map(|s| s.to_string()).collect();
        let mut next = VecDeque::new();
        for n in &queue {
            if let Some(children) = dependents.get(*n) {
                for c in children {
                    let d = indeg.get_mut(*c).unwrap();
                    *d -= 1;
                    if *d == 0 { next.push_back(c); }
                }
            }
        }
        levels.push(level);
        queue = next;
    }

    let placed: usize = levels.iter().map(|l| l.len()).sum();
    if placed != tasks.len() {
        return Err("依赖存在环，拒绝启动".into());
    }
    Ok(levels)   // supervisor 逐层 spawn，层内 std::thread 并发
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
    note: "每任务一个定容环形缓冲（默认 200 行）：GUI 回看永远 O(1) 内存；同一份数据追加写入 logs/<任务名>.log 完成持久化。",
    code: `use std::fs::OpenOptions;
use std::io::Write;

#[derive(Clone)]
pub struct LogLine {
    pub ts: u64,          // unix millis
    pub level: u8,        // 0=INFO 1=WARN 2=ERR 3=SYS
    pub msg: String,
}

/// 定容环形缓冲：写满后覆盖最旧行，内存恒定
pub struct RingLog {
    buf: Vec<Option<LogLine>>,
    head: usize,          // 下一个写入槽位
    len: usize,
    file: std::fs::File,  // logs/<任务名>.log 追加句柄
}

impl RingLog {
    pub fn new(cap: usize, log_path: &str) -> std::io::Result<Self> {
        let file = OpenOptions::new().create(true).append(true)
            .open(log_path)?;
        Ok(Self { buf: (0..cap).map(|_| None).collect(),
                  head: 0, len: 0, file })
    }

    pub fn push(&mut self, line: LogLine) {
        // ① 落盘持久化
        let _ = writeln!(self.file, "[{}] {}", line.ts, line.msg);
        // ② 入环（满则覆盖最旧）
        self.buf[self.head] = Some(line);
        self.head = (self.head + 1) % self.buf.len();
        self.len = self.len.min(self.buf.len() - 1) + 1;
    }

    /// 按时间序迭代，供 egui 面板绘制
    pub fn iter(&self) -> impl Iterator<Item = &LogLine> {
        let cap = self.buf.len();
        let start = (self.head + cap - self.len) % cap;
        (0..self.len).filter_map(move |i| {
            self.buf[(start + i) % cap].as_ref()
        })
    }
}`,
  },
  {
    id: "main",
    file: "main.rs + tray.rs",
    layer: "入口 / 托盘",
    lang: "rust",
    title: "单实例入口 + 托盘生命周期",
    note: "CreateMutexW 全局互斥体防多开；关闭按钮仅隐藏视口，tray-icon 接管左键恢复与右键菜单，退出时先级联终止全部子进程再落盘配置。",
    code: `mod core; mod gui; mod infra; mod runtime; mod tray;

use eframe::egui;

fn main() -> eframe::Result<()> {
    // ── 单实例保护：CreateMutexW("Global\\SentinelGuard") ──
    let _guard = infra::single_instance::acquire()
        .expect("Sentinel 已在运行，请勿多开");

    let supervisor = core::supervisor::Supervisor::from_config(
        &infra::config::load()?,
    );

    let options = eframe::NativeOptions {
        viewport: egui::ViewportBuilder::default()
            .with_inner_size([1280.0, 820.0])
            .with_min_inner_size([960.0, 640.0])
            .with_title("Sentinel — 任务守护监督器"),
        ..Default::default()
    };

    eframe::run_native("sentinel", options, Box::new(move |cc| {
        // 关闭请求 → 隐藏窗口 + 托盘常驻（而非退出）
        cc.egui_ctx.options_mut(|o| {
            o.viewport.close_button = false;
        });
        let app = gui::app::SentinelApp::new(cc, supervisor);
        tray::install(&cc.egui_ctx, app.handle());
        Ok(Box::new(app))
    }))
}

/* tray.rs —— 左键恢复 / 右键菜单 / 气泡通知 */
pub fn install(ctx: &egui::Context, app: eframe::AppHandle) {
    let icon = include_bytes!("../assets/sentinel.ico");
    let tray = tray_icon::TrayIconBuilder::new()
        .with_icon(load_icon(icon))
        .with_tooltip("Sentinel · 3 个任务运行中")
        .with_menu(&Menu::with_items(&[
            &MenuItem::new("显示主窗口", true, None),
            &PredefinedMenuItem::separator(),
            &MenuItem::new("退出程序", true, None),   // Job 级联回收 + 落盘
        ]))
        .build().unwrap();

    tray.on_left_click   = move |_| app.emit(UserEvent::ToggleWindow);
    tray.on_menu_clicked = move |id| match id.as_str() {
        "show" => app.emit(UserEvent::Show),
        "quit" => app.emit(UserEvent::ShutdownAll),  // kill_tree 全部子进程
        _ => {}
    };
}`,
  },
];
