/* ------------------------------------------------------------------ */
/* 站点静态内容：模块树 / 分层架构 / 工作流 / 托盘交互 / 性能 / 边界      */
/* ------------------------------------------------------------------ */

export const PROJECT_TREE = `sentinel/
├─ Cargo.toml                # egui · eframe · serde · toml · windows · nvml
└─ src/
   ├─ main.rs                # 入口：单实例互斥体 → eframe::run_native
   ├─ tray.rs                # tray-icon：左键恢复 / 右键菜单 / 气泡通知
   ├─ gui/                   # ① 表示层（egui / eframe）
   │  ├─ app.rs              #    eframe::App 主循环：状态栏 + 任务网格 + 日志面板
   │  ├─ theme.rs            #    深/浅主题、圆角、状态徽章色板
   │  ├─ widgets/            #    sparkline.rs · meter.rs · badge.rs · toast.rs
   │  └─ dialogs/            #    task_editor.rs（文件选择+参数预览）· confirm.rs
   ├─ core/                  # ② 核心调度层
   │  ├─ supervisor.rs       #    监督器：生命周期状态机、重启策略分发
   │  ├─ scheduler.rs        #    DAG 拓扑：Kahn 分层，同层并发、级联启停
   │  ├─ health.rs           #    TCP / HTTP / 就绪等待 探针
   │  ├─ breaker.rs          #    滑动窗口熔断 + 指数退避
   │  └─ events.rs           #    跨层事件总线（std mpsc，零异步运行时）
   ├─ runtime/               # ③ 进程运行时层
   │  ├─ process.rs          #    CREATE_NO_WINDOW 静默派生（exe/bat/ps1 适配）
   │  ├─ job.rs              #    Job Object：进程树绑定 & 一键终结
   │  └─ killer.rs           #    优雅停止超时 → taskkill /T /F 兜底
   └─ infra/                 # ④ 基础设施层
      ├─ config.rs           #    config.toml：serde 读写，原子替换落盘
      ├─ logbuf.rs           #    Ring Buffer 内存日志 + 按任务分文件追加
      └─ sysinfo.rs          #    CPU/内存(PDH) · GPU/显存/温度(NVML) · 温度预留口`;

export interface Layer {
  no: string;
  name: string;
  en: string;
  deps: string;
  color: string;
  modules: { file: string; desc: string }[];
}

export const LAYERS: Layer[] = [
  {
    no: "①",
    name: "表示层",
    en: "gui · egui / eframe",
    deps: "依赖 core::events 的状态快照，只发命令、不碰进程句柄",
    color: "#FF7A29",
    modules: [
      { file: "app.rs", desc: "eframe::App 实现：顶部资源栏、任务卡片网格（状态+名称排序）、实时日志面板与全局状态栏；事件驱动重绘 + 4Hz 指标节拍，闲时近乎零 CPU。" },
      { file: "theme.rs", desc: "深/浅主题一键切换；统一圆角、间距与状态徽章（运行/熔断/退避）色板。" },
      { file: "widgets/", desc: "sparkline、meter、badge、toast 等自绘控件，全部 immediate-mode，无额外分配。" },
      { file: "dialogs/", desc: "任务编辑器：文件选择器 + 参数解析预览 + 校验；删除二次确认弹窗。" },
    ],
  },
  {
    no: "②",
    name: "核心调度层",
    en: "core · supervisor / scheduler / breaker",
    deps: "向下经 mpsc 发送 Spawn/Kill 命令，向上回传事件与状态快照",
    color: "#F5B84B",
    modules: [
      { file: "supervisor.rs", desc: "单任务生命周期状态机：Stopped → Starting → Running → (Backoff ⇄) → Fused；按 always / on-failure / never 分发重启决策。" },
      { file: "scheduler.rs", desc: "Kahn 拓扑分层：依赖任务先启、同层并发；上游熔断时通知下游，可配级联重启/级联停止。" },
      { file: "breaker.rs", desc: "滑动窗口（默认 60s / 3 次，可配）计数失败；超限熔断并指数退避 2s→4s→8s…封顶。" },
      { file: "health.rs", desc: "TCP connect、HTTP 状态码、就绪等待三种探针，结果聚合为任务卡片上的健康度指示。" },
    ],
  },
  {
    no: "③",
    name: "进程运行时层",
    en: "runtime · process / job / killer",
    deps: "仅依赖 windows-rs 原生 API，对上层暴露 Child + ProcessTree 抽象",
    color: "#53C1DE",
    modules: [
      { file: "process.rs", desc: "exe 直接派生；.bat/.cmd 走 cmd /c；.ps1 走 powershell -ExecutionPolicy Bypass -File；一律附加 CREATE_NO_WINDOW，彻底无黑框。" },
      { file: "job.rs", desc: "每个子进程绑定 Job Object（KILL_ON_JOB_CLOSE），进程树（含脚本派生的孙进程）一并纳管。" },
      { file: "killer.rs", desc: "停止=终结整棵进程树：exe 可配优雅关闭窗口，超时后 taskkill /T /F 强制兜底；主程序退出时随 Job 自动级联回收。" },
    ],
  },
  {
    no: "④",
    name: "基础设施层",
    en: "infra · config / logbuf / sysinfo",
    deps: "无业务依赖，可独立单测；全部 std + 轻量 crate",
    color: "#3ECF6E",
    modules: [
      { file: "config.rs", desc: "config.toml 经 serde 读写，先写临时文件再原子 rename，杜绝半截配置。" },
      { file: "logbuf.rs", desc: "每任务一个定容 Ring Buffer（默认 200 行）供 GUI 实时回看，同时追加写入 logs/<任务名>.log；内存恒定不暴涨。" },
      { file: "sysinfo.rs", desc: "CPU/内存采样（PDH），GPU 负载/显存/温度（nvml-wrapper）；CPU 温度接口已预留，当前返回 N/A。" },
    ],
  },
];

export const WORKFLOW = [
  { k: "01", t: "点选添加", d: "文件选择器挑 .exe / .bat / .ps1，免记任何命令" },
  { k: "02", t: "填参数", d: "参数解析预览 + 即时校验，启动命令所见即所得" },
  { k: "03", t: "静默启动", d: "CREATE_NO_WINDOW 派生，全程无黑框弹出" },
  { k: "04", t: "监控状态", d: "健康探针 + Ring Buffer 实时日志 + 熔断守护" },
  { k: "05", t: "一键停止", d: "Job Object 终结整棵进程树，退出自动级联回收" },
];

export const PROMISES = [
  {
    t: "不记命令",
    d: "exe / bat / ps1 的启动差异由运行时层吞掉，GUI 只暴露「选文件、填参数」。",
    icon: "cursor",
  },
  {
    t: "无黑框",
    d: "所有子进程附加 CREATE_NO_WINDOW 标志，脚本派生的孙进程同样静默。",
    icon: "ghost",
  },
  {
    t: "统一管理",
    d: "全部任务配置收敛到一份 config.toml，日志按任务分文件，路径清晰可见。",
    icon: "stack",
  },
  {
    t: "极致轻量",
    d: "原生 Win32 API + immediate-mode GUI：冷启动 ≤200ms，常驻内存 18–30MB。",
    icon: "feather",
  },
];

export const TRAY_BEHAVIORS = [
  {
    t: "关闭 = 最小化到托盘",
    d: "点击右上角 × 并不退出：主窗口隐藏，Sentinel 收缩为托盘图标继续守护，气泡提示「已转入后台」。",
    keys: ["点击 ×", "窗口隐藏", "托盘常驻"],
    icon: "minimize",
  },
  {
    t: "左键 · 显示 / 恢复",
    d: "单击托盘图标即刻唤回主窗口，位置与主题状态原样保留；再次单击则收起。",
    keys: ["单击", "Show / Hide"],
    icon: "restore",
  },
  {
    t: "右键 · 操作菜单",
    d: "呼出原生菜单：显示主窗口 / 退出程序。选择退出时，Job Object 级联终止所有子进程并落盘 config.toml。",
    keys: ["右键", "显示主窗口", "退出程序"],
    icon: "menu",
  },
];

export const ROBUSTNESS = [
  { t: "单实例保护", d: "CreateMutexW(\"Global\\\\SentinelGuard\")：多开时第二实例立即退出并提示，避免配置与进程树冲突。" },
  { t: "启动失败高亮", d: "派生失败触发托盘气泡通知，对应任务卡片红框闪烁高亮，错误原因直写在卡片与日志中。" },
  { t: "优雅停止超时", d: "exe 任务可配优雅窗口（默认 5s）：先发关闭信号，超时再 taskkill /T /F，兼顾体面与可靠。" },
  { t: "信息透明", d: "全局状态栏常驻显示 config.toml 路径、运行统计与上次错误，日志默认自动滚动、ERR 标红。" },
];

export const PERF_STATS = [
  { v: "≤200", u: "ms", t: "冷启动耗时", d: "无运行时预热，main → 首帧直出" },
  { v: "18–30", u: "MB", t: "常驻内存", d: "日志 Ring Buffer 定容，无缓存膨胀" },
  { v: "4", u: "Hz", t: "指标刷新节拍", d: "事件驱动重绘，闲时 CPU ≈ 0%" },
  { v: "0", u: "依赖", t: "WebView / 异步运行时", d: "std 线程 + mpsc，纯原生渲染" },
];

export const OUT_OF_SCOPE = [
  "配置文件热重载 —— 修改后需重启生效",
  "开机自启动 —— 交由任务计划程序处理",
  "日志文件轮转（Log Rotation）",
  "任务级资源使用曲线图",
  "网络流量监控",
];

export const STACK = [
  { name: "Rust 1.8x", role: "全栈实现语言" },
  { name: "egui 0.3x", role: "immediate-mode GUI" },
  { name: "eframe", role: "原生窗口 / 视口" },
  { name: "tray-icon", role: "系统托盘" },
  { name: "windows-rs", role: "Job Object / Mutex / PDH" },
  { name: "nvml-wrapper", role: "GPU 负载 / 显存 / 温度" },
  { name: "serde + toml", role: "config.toml 持久化" },
];
