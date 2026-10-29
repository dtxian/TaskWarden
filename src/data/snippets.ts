/* ------------------------------------------------------------------ */
/* 关键实现代码片段（Rust / TOML / C++）——与右侧标签页一一对应                  */
/* ------------------------------------------------------------------ */

export interface Snippet {
  id: string;
  file: string;
  layer: string;
  lang: "rust" | "toml" | "cpp";
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
    code: `use std::os::windows::process::CommandExt;
use std::process::{Command, Stdio};

use crate::infra::config::{Kind, TaskConfig};

/// CREATE_NO_WINDOW —— 彻底杜绝控制台黑框
pub const CREATE_NO_WINDOW: u32 = 0x0800_0000;

/// 按任务类型适配启动器；stdout/stderr 均接管道
fn build_command(cfg: &TaskConfig) -> Command {
    let path = expand_env(&cfg.path);          // 支持 %SystemRoot% 之类
    match cfg.kind {
        Kind::Exe => {
            let mut c = Command::new(&path);
            c.args(&cfg.args);
            c
        }
        Kind::Bat => {
            let mut c = Command::new("cmd");
            c.arg("/c").arg(&path).args(&cfg.args);
            c
        }
        Kind::Ps1 => {
            let mut c = Command::new("powershell");
            c.args(["-NoProfile", "-ExecutionPolicy", "Bypass", "-File"])
             .arg(&path)
             .args(&cfg.args);
            c
        }
    }
}

/// 静默派生：失败返回人类可读错误（含 CreateProcessW 语义）
pub fn spawn_task(cfg: &TaskConfig) -> Result<ProcessHandle, String> {
    let mut cmd = build_command(cfg);
    cmd.stdin(Stdio::null())
        .stdout(Stdio::piped())      // → Ring Buffer + logs/<name>.log
        .stderr(Stdio::piped())
        .creation_flags(CREATE_NO_WINDOW);
    if !cfg.cwd.is_empty() {
        cmd.current_dir(&cfg.cwd);
    }
    let mut child = cmd.spawn().map_err(|e| format!("CreateProcessW 失败: {e}"))?;
    let pid = child.id();
    // stdout/stderr 各起一条线程按行泵读（详见 pump），
    // 行边界天然安全：GBK 尾字节 >=0x40、UTF-8 续字节 >=0x80
    let stdout = child.stdout.take().map(|st| { let (tx, rx) = channel(); std::thread::spawn(move || pump(st, tx)); rx });
    let stderr = child.stderr.take().map(|st| { let (tx, rx) = channel(); std::thread::spawn(move || pump(st, tx)); rx });
    Ok(ProcessHandle { child, pid, stdout, stderr })
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
    id: "ffi",
    file: "engine/src/ffi.rs",
    layer: "C ABI 边界",
    lang: "rust",
    title: "C ABI · 不阻塞 UI 的命令投递",
    note: "Qt 与引擎之间只有 UTF-8 字符串与 JSON：不传结构体、不传回调。命令经有界队列 try_send（满返回 -2），每个入口 catch_unwind —— panic 绝不跨 FFI，因此 release 必须保留 panic = \"unwind\"。",
    code: `use std::sync::mpsc::{SyncSender, TrySendError};

/// 有界命令队列：满 → -2，引擎未就绪 → -1，绝不阻塞 UI 线程
fn send_cmd(e: &TwEngine, cmd: Command) -> i32 {
    match e.cmd_tx.try_send(cmd) {
        Ok(_) => 0,
        Err(TrySendError::Full(_)) => { set_error(e, "命令队列已满"); -2 }
        Err(TrySendError::Disconnected(_)) => { set_error(e, "守护引擎未就绪"); -1 }
    }
}

/// 入口护栏：panic → 写 last_error → 返回 -1（不让 panic 跨 FFI）
unsafe fn guarded(e: *mut TwEngine, f: impl FnOnce(&TwEngine) -> i32) -> i32 {
    if e.is_null() { return -1; }
    let eng = &*e;
    match std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| f(eng))) {
        Ok(v) => v,
        Err(p) => { set_error(eng, panic_msg(p)); -1 }
    }
}

/// 出参 DTO 一律 camelCase，界面按同名字段直接读取
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskDto {
    pub name: String,
    pub state: String,
    pub pid: Option<u32>,
    pub restarts: u64,
    pub probe_ms: Option<u128>,
    pub backoff_until_ms: Option<u64>,
    // …
}`,
  },
  {
    id: "engineclient",
    file: "desktop/src/EngineClient.cpp",
    layer: "表示层（Qt）",
    lang: "cpp",
    title: "Qt 侧 · 轮询快照（不跨线程回调）",
    note: "Rust 线程不回调进 Qt：由主线程的 QTimer 主动拉快照，线程亲和性彻底划清。可见时 500ms、收进托盘后 2000ms，每次开销只是一次 JSON 解析。",
    code: `EngineClient::EngineClient(const QString& dataDir, QObject* parent)
    : QObject(parent)
{
    QByteArray dir = dataDir.toUtf8();
    engine_ = tw_engine_new(dir.constData());   // C ABI：创建引擎
    if (!engine_) return;

    timer_ = new QTimer(this);
    timer_->setInterval(500);                  // 可见态；托盘态调成 2000ms
    connect(timer_, &QTimer::timeout, this, &EngineClient::poll);
    timer_->start();
}

void EngineClient::poll()
{
    // 1) 快照：引擎序列化 → 主线程解析（跨线程数据只走字符串）
    QString raw = takeString(tw_snapshot_json(engine_));
    QJsonDocument doc = QJsonDocument::fromJson(raw.toUtf8());
    if (doc.isObject()) snapshot_ = doc.object();

    // 2) 通知：取走并清空（启动失败 / 熔断 / 意外退出）
    QString nraw = takeString(tw_notices_json(engine_));
    const QJsonArray arr = QJsonDocument::fromJson(nraw.toUtf8()).array();
    for (const auto& v : arr) {
        const QJsonObject o = v.toObject();
        emit notice(o.value("kind").toString(), o.value("text").toString());
    }

    emit snapshotUpdated();                    // 界面按字段 diff 刷新
}

int EngineClient::start(const QString& id)
{
    QByteArray b = id.toUtf8();                // 只在调用期间持有
    return tw_start(engine_, b.constData());   // 0 / -1 / -2 透传
}`,
  },
];
