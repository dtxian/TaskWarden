/* ------------------------------------------------------------------ */
/* 站点静态内容：模块树 / 分层架构 / 工作流 / 托盘交互 / 性能 / 边界      */
/* 与实现对齐的硬约束：这里的每个数字都能在仓库里复现（见 docs/）           */
/* ------------------------------------------------------------------ */

export const PROJECT_TREE = `taskwarden/
├─ desktop/                      # ① 表示层：Qt 6 Widgets（C++20）
│  ├─ CMakeLists.txt             #   MSVC 2022 + Qt 6.9 · /utf-8（否则中文乱码）
│  ├─ src/
│  │  ├─ main.cpp                #   入口：单实例 → 引擎 → 主窗口 → 托盘
│  │  ├─ EngineClient.{h,cpp}    #   C ABI 包装 + QTimer 轮询 + QJsonDocument 解析
│  │  ├─ MainWindow.{h,cpp}      #   资源栏 + 任务卡网格 + 日志面板 + 状态栏
│  │  ├─ TaskCard.{h,cpp}        #   任务卡：状态色 / 健康度 / 依赖 / 操作
│  │  ├─ LogPanel.{h,cpp}        #   实时日志：三色分级 + 自动滚动 + 清空/复制
│  │  ├─ TaskDialog.{h,cpp}      #   添加/编辑表单（校验 + 依赖成环禁用）
│  │  ├─ TrayController.{h,cpp}  #   托盘图标 + 菜单（显示 / 退出）
│  │  ├─ SingleInstance.{h,cpp}  #   QLocalServer 单实例
│  │  ├─ Sparkline · ElidedLabel #   自绘曲线 / 省略号标签
│  │  ├─ Args.h · Format.h       #   parseArgs / 时长格式化（与 Rust·TS 三端镜像）
│  │  └─ twengine.h              #   C ABI 声明（与 engine/src/ffi.rs 对齐）
│  ├─ resources/                 #   qrc 图标 + dark.qss + app.rc（exe 图标）
│  └─ smoke/ffi_smoke.cpp        #   C ABI 冒烟（不依赖 Qt）
├─ engine/                       # 引擎：Rust 静态库（crate-type = staticlib）
│  ├─ Cargo.toml                 #   serde · toml · thiserror · log · windows · nvml-wrapper
│  └─ src/
│     ├─ ffi.rs                  #   C ABI 边界：catch_unwind + try_send + JSON
│     ├─ core/                   # ② 核心调度层
│     │  ├─ supervisor.rs        #    监督器：250ms 节拍、状态机、重启策略、reaper
│     │  ├─ breaker.rs           #    滑动窗口熔断 + 指数退避（attempt.min(6)，64s 封顶）
│     │  ├─ scheduler.rs         #    DAG 拓扑：Kahn 分层，环并入末层、级联启停
│     │  ├─ health.rs            #    TCP / HTTP / 就绪等待 探针（std 同步 + 超时）
│     │  ├─ events.rs            #    跨层事件总线（std mpsc，零异步运行时）
│     │  └─ error.rs             #    统一错误类型
│     ├─ runtime/                # ③ 进程运行时层
│     │  ├─ process.rs           #    CREATE_NO_WINDOW 派生 + 按行泵读/UTF-8→OEM 解码
│     │  ├─ job.rs               #    Job Object：进程树绑定 & 一键终结
│     │  └─ killer.rs            #    优雅停止轮询 → 超时 taskkill /T /F 兜底
│     └─ infra/                  # ④ 基础设施层
│        ├─ config.rs            #    <exe>\\\\data\\\\config.toml：原子落盘 + %APPDATA% 迁移
│        ├─ logbuf.rs            #    Ring Buffer(200 行) + 500ms 节流 + 仅保留最近 3 天
│        └─ sysinfo.rs           #    GetSystemTimes + GlobalMemoryStatusEx + NVML
├─ src/                          # 落地页 / 交互原型（React + Vite → GitHub Pages）
├─ build/                        # 图标矢量源 + gen-icon / gen-tray（产出 desktop/resources）
├─ scripts/                      # env.sh · build-all.sh · screenshot.ps1
└─ docs/                         # 架构与不变式 · ADR · 迁移记录`;

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
    en: "ui · Qt 6 Widgets / C++20",
    deps: "经 EngineClient 轮询快照 JSON、下发命令；不碰进程句柄，不跨线程碰引擎",
    color: "#FF7A29",
    modules: [
      { file: "MainWindow.cpp", desc: "主窗口：资源栏（CPU 曲线/内存/GPU/运行时长/任务数）+ 任务卡网格（最多 3 列等分，窄窗自动降列）+ QSplitter 日志面板 + 全局状态栏；4Hz 快照按字段 diff 只更新变化的卡片。" },
      { file: "EngineClient.cpp", desc: "C ABI 唯一通道：QTimer 轮询（可见 500ms / 托盘 2000ms）拉取快照 JSON 并解析，命令返回 0 / -1 / -2 透传给界面。" },
      { file: "TaskCard.cpp", desc: "单任务卡片：状态色条与徽章（运行/启动/退避/熔断/停止）、健康度、PID 与倒计时、依赖链、启动/重启/停止/崩溃/重置熔断/编辑/删除。" },
      { file: "LogPanel.cpp", desc: "实时日志面板：按 level 分级着色（INFO/WARN/ERR/SYS）、默认自动滚动，支持复制与清空内存环。" },
      { file: "TaskDialog.cpp", desc: "任务编辑器：文件选择 + 参数解析预览 + 校验 + DAG 依赖选择（成环选项禁用）；删除二次确认。" },
    ],
  },
  {
    no: "②",
    name: "核心调度层",
    en: "core · supervisor / scheduler / breaker",
    deps: "向下经 mpsc 发送命令，向上回传事件与状态快照",
    color: "#F5B84B",
    modules: [
      { file: "supervisor.rs", desc: "单任务生命周期状态机：Stopped → Starting → Running → (Backoff ⇄) → Fused；独立引擎线程 250ms 节拍，按 always / on-failure / never 分发重启决策；指标采样降为 1s，reaper 线程回收进程树。" },
      { file: "scheduler.rs", desc: "Kahn 拓扑分层：依赖任务先启、同层并发；上游停止→级联联动停止下游；熔断→向下游依赖告警。" },
      { file: "breaker.rs", desc: "滑动窗口（默认 60s / 3 次，可配）计数失败；超限熔断并指数退避 2^n 秒（n 截至 6，封顶 64s）。" },
      { file: "health.rs", desc: "TCP connect、HTTP 状态码、就绪等待三种探针（std 同步 + 超时），短命线程执行后经回灌命令把结果交还引擎线程，绝不在引擎线程做网络 IO。" },
    ],
  },
  {
    no: "③",
    name: "进程运行时层",
    en: "runtime · process / job / killer",
    deps: "仅依赖 windows-rs 原生 API，对上层暴露 Child + 进程树抽象",
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
      { file: "logbuf.rs", desc: "每任务一个定容 Ring Buffer（默认 200 行）供面板/文件双写，BufWriter 以 ≤500ms 节流追加写入 <exe>\\data\\logs\\<任务名>.log；启动与每小时清理，仅保留最近 3 天。" },
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
    d: "全部任务配置收敛到一份 config.toml，日志按任务分文件且只保留最近 3 天，路径清晰可见。",
    icon: "stack",
  },
  {
    t: "极致轻量",
    d: "原生 Win32 引擎 + Qt Widgets 外壳（无 WebView2）：单进程，进程私有内存约 68MB；收进托盘后工作集降到约 9MB，空闲 CPU ≈0.05%。",
    icon: "feather",
  },
];

export const TRAY_BEHAVIORS = [
  {
    t: "关闭 / 最小化 = 收进托盘",
    d: "点右上角 × 或最小化都不退出：主窗口隐藏并释放界面控件，工作集从约 140MB 降到约 9MB，TaskWarden 收缩为托盘图标继续守护（首次会气泡提示）。",
    keys: ["点击 × 或最小化", "释放界面", "托盘常驻"],
    icon: "minimize",
  },
  {
    t: "左键 · 显示 / 恢复",
    d: "单击托盘图标即刻唤回主窗口并按最新快照重建任务卡；再次单击则收起。",
    keys: ["单击", "Show / Hide"],
    icon: "restore",
  },
  {
    t: "右键 · 操作菜单",
    d: "呼出原生菜单：显示主窗口 / 退出程序。选择退出时，引擎同步终结所有子进程（Job Object 级联）并落盘 config.toml。",
    keys: ["右键", "显示主窗口", "退出程序"],
    icon: "menu",
  },
];

export const ROBUSTNESS = [
  { t: "单实例保护", d: "QLocalServer 拦截：二次启动不进新进程，向已有实例发信号并唤起、聚焦主窗口。" },
  { t: "启动失败高亮", d: "派生失败/意外退出 → 引擎通知队列 → 状态栏提示；对应任务卡片红框闪烁高亮，错误原因直写在卡片与日志中。" },
  { t: "优雅停止超时", d: "exe 任务可配优雅等待窗口（默认 5s）：轮询等待自然退出，超时再 taskkill /T /F 终结整棵进程树，兼顾体面与可靠。" },
  { t: "信息透明", d: "全局状态栏常驻显示 config.toml 路径、派生/重启统计与上次错误，日志默认自动滚动、ERR 标红。" },
];

export const PERF_STATS = [
  { v: "0.65", u: "s", t: "冷启动到可交互", d: "含引擎初始化与配置加载；三次实测 644–652ms" },
  { v: "≈68", u: "MB", t: "进程私有内存", d: "工作集约 139MB（含 Qt DLL 共享页）；收进托盘后工作集降至约 9MB" },
  { v: "1", u: "s", t: "指标采样节拍", d: "CPU/内存/GPU 后台 1s 采样，界面 500ms 拉快照；空闲 CPU ≈0.05%" },
  { v: "0", u: "", t: "异步运行时", d: "纯 std 线程 + mpsc，无 tokio；单进程，无 WebView2" },
];

export const OUT_OF_SCOPE = [
  "配置文件热重载 —— 修改后需重启生效",
  "开机自启动 —— 交由任务计划程序处理",
  "自定义无边框标题栏 —— 当前使用系统边框",
  "任务级资源使用曲线图",
  "网络流量监控",
];

export const STACK = [
  { name: "Rust 1.98 (MSVC)", role: "引擎（静态库）" },
  { name: "Qt 6.9 Widgets · C++20", role: "桌面壳 / 托盘 / 窗口" },
  { name: "MSVC 2022 + CMake 4.4", role: "构建与部署" },
  { name: "windows-rs", role: "Job Object / 系统信息 / OEM 解码" },
  { name: "nvml-wrapper", role: "GPU 负载 / 显存 / 温度" },
  { name: "serde + toml", role: "config.toml 持久化" },
  { name: "React + Vite", role: "本落地页 / 交互原型" },
];
