/* ------------------------------------------------------------------ */
/* 站点静态内容：模块树 / 分层架构 / 工作流 / 托盘交互 / 性能 / 边界      */
/* ------------------------------------------------------------------ */

export const PROJECT_TREE = `taskwarden/
├─ src-tauri/
│  ├─ Cargo.toml              # tauri 2 · serde · toml · windows-rs · nvml-wrapper
│  ├─ icons/
│  │  └─ tray-icon.png        # 托盘专用图标（编译期内嵌 include_bytes!）
│  └─ src/
│     ├─ main.rs              # 入口：调用 lib::run()，无 GUI 主循环
│     ├─ lib.rs               # 装配：single-instance → plugin-log → dialog → backend
│     ├─ backend.rs           # 托盘 TrayIconBuilder + 快照/事件推送 + 15 条命令
│     ├─ core/                # ① 核心调度层
│     │  ├─ supervisor.rs     #    监督器：250ms 节拍、状态机、重启策略、reaper 回收
│     │  ├─ breaker.rs        #    滑动窗口熔断 + 指数退避（attempt.min(6)，64s 封顶）
│     │  ├─ scheduler.rs      #    DAG 拓扑：Kahn 分层，环并入末层、级联启停
│     │  ├─ health.rs         #    TCP / HTTP / 就绪等待 探针（std 同步 + 超时）
│     │  ├─ events.rs         #    跨层事件总线（std mpsc，零异步运行时）
│     │  └─ error.rs          #    统一错误类型
│     ├─ runtime/             # ③ 进程运行时层
│     │  ├─ process.rs        #    CREATE_NO_WINDOW 派生 + 按行泵读/UTF-8→OEM 解码
│     │  ├─ job.rs            #    Job Object：进程树绑定 & 一键终结
│     │  └─ killer.rs         #    优雅停止轮询 → 超时 taskkill /T /F 兜底
│     └─ infra/               # ④ 基础设施层
│        ├─ config.rs         #    <exe>\\data\\config.toml：原子落盘 + %APPDATA% 迁移
│        ├─ logbuf.rs         #    Ring Buffer(200 行) + BufWriter 500ms 节流落盘
│        └─ sysinfo.rs        #    GetSystemTimes + GlobalMemoryStatusEx + NVML
├─ src/                       # ② 表示层（React / WebView2）
│  ├─ App.tsx                 #    入口分流：Tauri 桌面版 / 浏览器介绍页
│  ├─ main.tsx                #    React 挂载点
│  ├─ components/
│  │  ├─ sim/                 #    SimulatorWindow · TaskCard · TaskModal · LogPanel
│  │  ├─ sections/            #    DesignSections · CodeSections
│  │  └─ ui.tsx               #    图标 / 特效 / CodeBlock 共用组件
│  ├─ data/                   #    content.ts · snippets.ts 静态文案
│  └─ sim/                    #    useSimulator.ts（前端数据源）
├─ index.html                 #  Vite 入口（根挂载 #root）
├─ package.json               #  依赖与脚本（vite / tsc / vitest / tauri）
└─ tsconfig.json              #  TS 严格模式配置`;

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
    en: "ui · React / WebView2",
    deps: "经 Tauri IPC 订阅快照/事件、下发命令，不碰进程句柄",
    color: "#FF7A29",
    modules: [
      { file: "SimulatorWindow.tsx", desc: "主窗口组件：任务卡片网格（状态+名称排序）、实时日志面板与全局状态栏；订阅后端 4Hz snapshot 与事件流驱动，闲时近乎零 CPU。" },
      { file: "TaskCard.tsx", desc: "单任务卡片：状态徽章（运行/熔断/退避）、重启次数、PID 与退避倒计时；点击选中并联动日志面板。" },
      { file: "LogPanel.tsx", desc: "实时日志面板：订阅后端 log-event 流，按 level 分级着色、默认自动滚动，支持清空内存环。" },
      { file: "TaskModal.tsx", desc: "任务编辑器：文件选择器 + 参数解析预览 + 校验 + DAG 依赖选择；删除二次确认弹窗。" },
    ],
  },
  {
    no: "②",
    name: "核心调度层",
    en: "core · supervisor / scheduler / breaker",
    deps: "向下经 mpsc 发送 Spawn/Kill 命令，向上回传事件与状态快照",
    color: "#F5B84B",
    modules: [
      { file: "supervisor.rs", desc: "单任务生命周期状态机：Stopped → Starting → Running → (Backoff ⇄) → Fused；独立引擎线程 250ms 节拍，按 always / on-failure / never 分发重启决策，reaper 线程回收进程树。" },
      { file: "scheduler.rs", desc: "Kahn 拓扑分层：依赖任务先启、同层并发；上游停止→级联联动停止下游；熔断→向下游依赖告警。" },
      { file: "breaker.rs", desc: "滑动窗口（默认 60s / 3 次，可配）计数失败；超限熔断并指数退避 2^n 秒（n 截至 6，封顶 64s）。" },
      { file: "health.rs", desc: "TCP connect、HTTP 状态码、就绪等待三种探针（std 同步 + 超时），短命线程回灌结果聚合为任务卡片上的健康度指示。" },
    ],
  },
  {
    no: "③",
    name: "进程运行时层",
    en: "runtime · process / job / killer",
    deps: "仅依赖 windows-rs 原生 API，对上层暴露 Child + ProcessTree 抽象",
    color: "#53C1DE",
    modules: [
      { file: "process.rs", desc: "exe 直接派生；.bat/.cmd 走 cmd /c；.ps1 走 powershell -ExecutionPolicy Bypass -File；一律附加 CREATE_NO_WINDOW，彻底无黑框；stdout/stderr 按行泵读，UTF-8 严格优先→OEM(CP936) 回退。" },
      { file: "job.rs", desc: "每个子进程绑定 Job Object（KILL_ON_JOB_CLOSE），进程树（含脚本派生的孙进程）一并纳管。" },
      { file: "killer.rs", desc: "停止=终结整棵进程树：exe 可配优雅等待窗口（默认 5s），轮询等待自然退出，超时后 taskkill /T /F 终结整棵进程树；主程序退出时随 Job Object 自动级联回收。" },
    ],
  },
  {
    no: "④",
    name: "基础设施层",
    en: "infra · config / logbuf / sysinfo",
    deps: "无业务依赖，可独立单测；全部 std + 轻量 crate",
    color: "#3ECF6E",
    modules: [
      { file: "config.rs", desc: "config.toml（<exe>\\data）经 serde 读写，先写临时文件再原子 rename，杜绝半截配置；首启从 %APPDATA% 一次性迁移。" },
      { file: "logbuf.rs", desc: "每任务一个定容 Ring Buffer（默认 200 行）供日志面板/文件双写，同时由 BufWriter 以 ≤500ms 节流追加写入 <exe>\\data\\logs\\<任务名>.log；内存恒定不暴涨。" },
      { file: "sysinfo.rs", desc: "CPU（GetSystemTimes 差值）、内存（GlobalMemoryStatusEx）采样，GPU 负载/显存/温度（nvml-wrapper）；CPU 温度接口已预留，当前返回 N/A。" },
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
    d: "原生 Win32 后端 + WebView2 前端：冷启动窗口就绪 ~50ms，Rust 引擎进程常驻约 53MB。",
    icon: "feather",
  },
];

export const TRAY_BEHAVIORS = [
  {
    t: "关闭 = 最小化到托盘",
    d: "点击右上角 × 并不退出：主窗口隐藏，TaskWarden 收缩为托盘图标继续守护，气泡提示「已转入后台」。",
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
  { t: "单实例保护", d: "tauri-plugin-single-instance 拦截：二次启动不进新进程，唤起已有主窗口并聚焦。" },
  { t: "启动失败高亮", d: "派生失败/意外退出 → 后端发 notice 事件 → 前端托盘位 toast 提示；对应任务卡片红框闪烁高亮，错误原因直写在卡片与日志中。" },
  { t: "优雅停止超时", d: "exe 任务可配优雅等待窗口（默认 5s）：轮询等待自然退出，超时再 taskkill /T /F 终结整棵进程树，兼顾体面与可靠。" },
  { t: "信息透明", d: "全局状态栏常驻显示 config.toml 路径、运行统计与上次错误，日志默认自动滚动、ERR 标红。" },
];

export const PERF_STATS = [
  { v: "≤100", u: "ms", t: "冷启动耗时", d: "无运行时预热，实测主窗口句柄就绪 45–65ms" },
  { v: "≈53", u: "MB", t: "引擎进程常驻", d: "Rust 主进程工作集（WebView2 渲染进程组另计）；日志 Ring Buffer 定容无膨胀" },
  { v: "4", u: "Hz", t: "指标刷新节拍", d: "事件驱动重绘，闲时 CPU ≈ 0%" },
  { v: "0", u: "", t: "异步运行时", d: "后端纯 std 线程 + mpsc，渲染走系统 WebView2" },
];

export const OUT_OF_SCOPE = [
  "配置文件热重载 —— 修改后需重启生效",
  "开机自启动 —— 交由任务计划程序处理",
  "日志文件轮转（Log Rotation）",
  "任务级资源使用曲线图",
  "网络流量监控",
];

export const STACK = [
  { name: "Rust 1.8x", role: "后端实现语言" },
  { name: "Tauri 2.11", role: "桌面壳 / IPC / 托盘" },
  { name: "React 19 + Vite", role: "界面" },
  { name: "WebView2", role: "渲染" },
  { name: "windows-rs", role: "Job Object / 系统信息 / OEM 解码" },
  { name: "nvml-wrapper", role: "GPU 负载 / 显存 / 温度" },
  { name: "serde + toml", role: "config.toml 持久化" },
];
