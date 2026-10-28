# AGENTS.md — TaskWarden 项目知识

> 本文件由通读仓库（源码 / 文档 / CI / 部署脚本 / git 历史）后整理，供后续 AI 与人类协作者快速建立上下文。
> 语言约定：项目文档、代码注释、日志文案一律中文；标识符/命令英文。

---

## 1. 项目定位（一句话）

**TaskWarden = 轻量级后台任务守护监督器，Windows 专用，Rust 引擎 + Qt 6 Widgets 桌面壳（旧 Tauri 2 壳 + React 界面保留为退路），单进程 + 便携数据目录。**
它常驻系统托盘，负责「静默拉起 / 看着 / 收掉」常驻进程：`CREATE_NO_WINDOW` 无黑框派生、Job Object 进程树管控、滑动窗口熔断 + 指数退避、DAG 依赖级联、健康探针、实时日志。

> **2026-10-29 Qt 迁移（feat/qt 分支）**：桌面壳已从 Tauri 2 + WebView2 迁至 **Qt 6 Widgets（C++20）+ Rust 静态库（C ABI）**，单进程、无 WebView2、实测内存 ~2.5x 下降。
> 详见 `PI-work/06-Qt-迁移执行计划.md`、`PI-work/06-UNATTENDED-LOG.md`；引擎 `core/ runtime/ infra/` 原样复用，`backend.rs` 被 `engine/src/ffi.rs` 取代。

桌面壳有两种身份：

| 运行环境 | 入口 | 数据源 | 界面 |
|---|---|---|---|
| 浏览器 / GitHub Pages | `LandingApp` | `useSimulatorMock()`（本地模拟引擎，不启动任何真实进程） | 产品介绍页 + 可交互高保真原型 |
| Qt 桌面版（新） | `desktop/` | `EngineClient`（C ABI + 250ms 轮询快照） | 软件本体窗口（任务卡/日志/表单/托盘） |
| Tauri 桌面版（退路） | `SoftwareApp` | `useSimulatorLive()`（`invoke` + `listen`） | 只有软件本体窗口 |

落地页同时是「工程设计文档」：`src/data/content.ts`（模块树/分层/承诺/性能/边界文案）与 `src/data/snippets.ts`（8 段实现代码展示）。

---

## 2. 目录与关键文件

```
desktop/                 Qt 6 Widgets 桌面壳（新，主桌面端；CMake + MSVC）
├─ src/EngineClient.*    C ABI 包装 + QTimer 250ms 轮询 + QJsonDocument 解析
├─ src/MainWindow.*      资源栏 + 任务卡网格(1/2/3 列) + 日志面板 + 状态栏
├─ src/TaskCard.* LogPanel.* TaskDialog.* TrayController.* SingleInstance.* Sparkline.*
├─ src/Args.h            parseArgs/kindFromExt/buildCommandText（与 TS/Rust 三端镜像）
├─ src/Format.h          时长/时钟/状态排序权重
├─ src/twengine.h        C ABI 声明（与 engine/src/ffi.rs 对齐）
├─ resources/            qrc 图标 + dark.qss
└─ smoke/ffi_smoke.cpp   C ABI 冒烟（无 Qt）

engine/                  Rust 引擎静态库（crate-type = staticlib + rlib）
├─ Cargo.toml            仅 serde/serde_json/toml/thiserror/log/windows/nvml-wrapper
└─ src/                  ffi.rs（C ABI，替代 backend.rs）+ core/ runtime/ infra/（原样复用）

src/                     React 前端（WebView2 内渲染，落地页 + 原型）
├─ App.tsx               入口分流 isTauri → SoftwareApp / LandingApp
├─ index.css             Tailwind v4 @theme 令牌(ink/fog/rust/ok/err/cyanx) + .egui/.eg-light 的 --eg-* 变量
├─ sim/useSimulator.ts   ★ 数据层核心：类型定义、mock 引擎、live 管线、DTO 映射、parseArgs/topoLevels
├─ components/sim/       SimulatorWindow · TaskCard · TaskModal · LogPanel
├─ components/sections/  DesignSections（开篇/承诺/工作流/分层）· CodeSections（代码/托盘/性能）
├─ components/ui.tsx     内联 SVG 图标集 + Scramble/Reveal/CodeBlock/Sparkline
└─ data/                 content.ts · snippets.ts（落地页文案与代码展示）

src-tauri/               Rust 后端（Tauri 2，退路保留）
├─ src/lib.rs            装配：plugin-log → dialog → single-instance → backend::init → 15 条命令注册
├─ src/backend.rs        对接层：DTO 序列化 + snapshot/log-event/notice 推送 + 托盘 + #[tauri::command]
├─ src/core/             supervisor.rs(1297行,状态机/引擎) · scheduler.rs(DAG) · breaker.rs · health.rs · events.rs · error.rs
├─ src/runtime/          process.rs(派生+泵读+解码) · job.rs(Job Object) · killer.rs(graceful/taskkill)
├─ src/infra/            config.rs(TOML/便携/迁移) · logbuf.rs(Ring Buffer+落盘) · sysinfo.rs(CPU/Mem/NVML)
├─ tauri.conf.json       bundle.active=false（只要单 exe）· decorations=false · devUrl=:1400
├─ capabilities/default.json  窗口控制/对话框权限（自绘标题栏必需）
└─ Cargo.toml            windows 0.62 · nvml-wrapper · tauri 2.11 · toml 1

build/                   app-icon.svg / tray-icon.svg + gen-icon.mjs / gen-tray.mjs（sharp）
deploy/                  本机(WSL)部署适配：serve.mjs · cross-build-win.mjs · Dockerfile.win · DEPLOY.md
PI-work/                 ★ 方案工作区（调研/迁移方案/ADR/验证清单），见 PI-work/README.md
.github/workflows/       ci.yml（frontend Linux + backend Windows）· deploy.yml（Pages）
```

---

## 3. 常用命令

```bash
npm install
npm run dev              # vite @ :1400（strictPort，host 0.0.0.0）→ 浏览器看 mock 原型
npm run typecheck        # tsc --noEmit
npm test                 # vitest（当前 9 passed）
npm run build            # vite build，base=/TaskWarden/（Pages）
npm run build:web        # vite build --base=/（本地服务/Tauri 内嵌资源根）
npm run serve            # node deploy/serve.mjs → http://0.0.0.0:1400/
npm run icons            # gen-icon → tauri icon → gen-tray（需 devDep sharp）

npm run tauri dev        # 桌面开发（需 Windows + Rust；内部会先跑 npm run dev）
npm run tauri build      # → src-tauri/target/release/taskwarden.exe（无安装程序）
cargo test --manifest-path src-tauri/Cargo.toml   # 24 个 Rust 测试，**仅 Windows 可跑**
npm run build:win        # WSL/Linux 下用 Docker 交叉编译 Windows exe（见 §9）
```

**当前 WSL 环境事实**：node v22、docker 可用；**无 cargo / Rust 工具链**，且 `src-tauri` 代码无条件用 Win32 API（无 `#[cfg(windows)]` 分支），因此本机不能原生编译或 `cargo test` Rust——验证 Rust 只能靠 `npm run build:win` 交叉编译或推 CI 的 `windows-latest`。
`deploy/serve.mjs` 通常已后台常驻（`ps aux | grep serve.mjs`），日志 `/tmp/taskwarden-web.log`。

**Rust 改动前必读**：`cargo test` 的 `ping_pipe_decodes_without_mojibake` 会真的派生 `ping` 并断言无 U+FFFD——它是解码链路的 e2e 契约，别删。

---

## 4. 分层与线程模型（架构不变式）

依赖单向向下：**① 表示层(React) → ② 核心调度(core) → ③ 进程运行时(runtime) → ④ 基础设施(infra)**；**命令向下、事件向上**。
`core/*` 不得 `use crate::runtime::` 之外的上层反向依赖，`infra/*` 零业务依赖。

**零异步运行时**：后端只用 `std::thread` + `std::sync::mpsc`（无 tokio）。新增并发请沿用此模型。

线程与职责：

| 线程 | 数量 | 节奏/触发 | 说明 |
|---|---|---|---|
| supervisor（守护引擎） | 1 | **250ms 固定 tick**；`recv_timeout` + `try_recv` 排空命令 | 唯一状态机推进者；整个循环体包在 `catch_unwind` 里（单次 panic 不杀线程） |
| events | 1 | 阻塞 `recv` | `Event` → 前端 `notice` / `log-event` |
| snapshot | 1 | 250ms | 全量 `SnapshotDto` 推 `snapshot`；**窗口 `is_visible()==false` 时跳过省 IPC** |
| pump | 每进程 ×2 | 逐字节读 `BufReader` | stdout/stderr 行缓冲，防管道写满阻塞子进程 |
| probe | 短命 ×N | tcp/http 探针 | 结果经 `Command::ProbeDone` **回灌引擎**，绝不在引擎线程做网络 IO |
| reaper | 短命 ×N | 停机回收 | graceful 轮询 → `taskkill /T /F` → `TerminateJobObject` → `Command::StopDone` |

> 反复出现的历史 bug 类别＝**「在引擎线程里做阻塞操作」**。规则：任何 > 毫秒级的工作（网络、等待退出、taskkill）都必须丢给线程/在 tick 内非阻塞推进，并用回灌命令（`ProbeDone`/`StopDone`）把结果交还引擎。`ready` 探针就是为此从线程版改成 tick 消费 stdout 的（见 `ReadyWait` 注释）。

---

## 5. IPC 协议（改一处要同步三处）

- 命令名 **snake_case**：`list_snapshot, start, stop, restart, start_all, stop_all, crash, reset_breaker, add_task, update_task, remove_task, set_fault_inject, shutdown, get_logs, clear_logs`（15 条，与 `content.ts` 的「15 条命令」文案绑定）。
- 参数：`{ id }`（任务名）、`{ cfg }`（**TaskConfig 用 snake_case JSON**，见 `draftToCfg`：`graceful_timeout` / `health:{mode,target}`）、`{ flag }`。
- 事件名：`snapshot`（4Hz）、`log-event`（`{task,line}`）、`notice`（`{kind,text}`）。
- **出参 DTO 是 camelCase**（`#[serde(rename_all="camelCase")]`）；**入参 TaskConfig 是 snake_case**。`backend.rs::snapshot_serializes_camel_case` 测试专门拦截这个漂移。
- `LogLineDto.t_ms` 用 **f64**（u64 过 JSON 的历史妥协）；`backoffUntilMs` 是**绝对 unix 毫秒**，前端可直接与 `Date.now()` 比较（不要改成剩余时长）。
- 新增一条命令需同时改：`backend.rs` 的 `#[tauri::command]` + `lib.rs` 的 `generate_handler!` + `useSimulator.ts` 的 live 方法（如需 mock 还要在 `useSimulatorMock` 里对齐语义）。涉及新的窗口/对话框 API 时补 `capabilities/default.json`。

---

## 6. 核心语义常量（改动即改变产品行为，务必同步文档）

| 常量 | 值 | 位置 |
|---|---|---|
| `TICK` | 250ms（=4Hz） | supervisor.rs |
| `PROBE_EVERY_TICKS` | 20 tick（≈5s）重探 | supervisor.rs |
| `READY_TIMEOUT` | 10s | supervisor.rs |
| `PROBE_TIMEOUT` | 2s（单次 tcp/http） | supervisor.rs |
| `MIN_STABLE_LIFETIME` | 5s | supervisor.rs |
| 熔断窗口 / 阈值 | `settings.breaker_window_sec`=60s / `breaker_max_fails`=3 | config.rs |
| 退避 | `2^min(attempt,6)` 秒 → **2,4,8,…,64s 封顶** | breaker.rs |
| `LOG_CAP` | 200 行/任务（内存环） | logbuf.rs |
| 落盘节流 | 500ms（ERR/WARN 即时刷；`BufWriter` 8KB） | logbuf.rs |
| `CREATE_NO_WINDOW` | `0x0800_0000` | process.rs |
| 泵读分段 | 无换行超 64KB 强制切段 | process.rs |

状态机：`Stopped → Starting → Running → (Backoff ⇄) → Fused`（`events.rs::TaskState`，字符串化后为 `stopped/starting/running/backoff/fused`，前端同名 union）。

必须保持的行为语义（都有测试或注释背书）：

1. **`always` 下 code-0 且存活 < 5s** → 按「崩溃循环」计入熔断退避（`clean_exit_action`），杜绝秒退秒拉死循环。**mock 引擎不还原这条**（无真实生命周期）——已知且刻意的前后端差异。
2. 失败路径：`strategy==never` → 直接 Stopped 不计数；否则 `Breaker::record_failure` → `Backoff(2^n)` 或 `Trip`（Trip 清空计数、置 fused、需手动 `reset_breaker`）。
3. `Restart` = 有存活进程则先移交 reaper，收到 `StopDone` 后再启动（避免端口/文件竞争）；无存活进程立即启动。
4. `StopAll` 用**反拓扑序**；`StartAll` 用**拓扑分层**，同层并发；`start()` 里若依赖未运行会先递归启动上游。
5. 上游 `Stopped` → 级联 `terminate` 下游；上游 `Fused` → 只向运行中的下游发 WARN 通告，不级联停止。
6. 首次派生不计「重启」（`has_spawned` 标志），与 mock 端 `wasRestart` 语义对齐。
7. 日志单一入口 `emit_log()`：环缓冲(含落盘) + `Event::Log` **必须同源**，否则 `get_logs` 与实时流内容分叉（有测试）。
8. `clear_logs` 只清内存环，`logs/<name>.log` 文件保留供审计。
9. `shutdown` 路径用**同步**终结（引擎线程随即退出，不能交给 reaper；Job Drop 只是最后兜底）。
10. 故障注入 `set_fault_inject(true)` 让**下一次** spawn 假失败，走完整反馈链（托盘 notice + 卡片红框 + 熔断/退避），一次性后自动复位——演示与截图依赖它。

---

## 7. Windows 侧实现要点（易踩）

- **启动器适配**：`exe` 直派生；`bat/.cmd` → `cmd /c`；`ps1` → `powershell -NoProfile -ExecutionPolicy Bypass -File`。`TaskView::command_line()`（Rust）与 `buildCommand()`（TS）是同一逻辑的两份实现，改一处要改两处。
- **`%VAR%` 展开**：`expand_env` 支持 `%SystemRoot%` 之类；变量不存在则原样保留。裸命令名（无路径分隔符）走 PATH 搜索。
- **编码**：逐行解码——**严格 UTF-8 优先，失败回退 OEM 代码页（中文系统 CP936/GBK），再 lossy**。行边界天然安全（GBK 尾字节 ≥0x40、UTF-8 续字节 ≥0x80，`\n` 不会落在多字节内部）。
- **stderr 分级启发 `classify_stderr`**：错误关键字→ERR，warn/deprecated→WARN，`info/debug/listening/loading/started`→INFO，**无线索保守为 WARN**。存在真实 llama.cpp 样本单测——不要把 stderr 一律标红。
- **Job Object**：命名 `Global\TaskWarden_<pid>`（失败退化匿名）+ `KILL_ON_JOB_CLOSE`；绑定失败只 WARN 不中断启动。
- **taskkill 退出码非零属预期**（进程已不存在），不当错误处理。
- **原子落盘**：写 `config.toml.tmp` → `remove_file` → `rename`（Windows 上 rename 到已存在目标会失败，必须先删）。
- **便携目录**：`<exe 目录>\data\{config.toml, logs\<name>.log, logs\app.log}`；`current_exe` 决定根，**`tauri dev` 时落在 `src-tauri/target/debug/data`**。首启若无配置：先尝试从 `%APPDATA%\TaskWarden` 一次性迁移（**复制不删，留回退**），再不存在则写 5 任务种子。
- 日志文件名净化：非法字符→`_`；**含点的任务名（`Qwen3.8-server`）必须仍以 `.log` 结尾**（有测试）。
- 托盘图标：`include_bytes!("../icons/tray-icon.png")` 编译期内嵌，是**独立撑满画布**的 64px 专用图，不要复用带底板的窗口图标。
- 自绘无边框窗口（`decorations:false`）+ `data-tauri-drag-region` + `winControl()`；关窗 × 在桌面版弹询问（收起到托盘 / `invoke("shutdown")` + `close()`）。
- 单实例：`tauri-plugin-single-instance`，二次启动仅 `show()+set_focus()`。

---

## 8. 前端约定

- 类型单一来源在 `useSimulator.ts`（`SimTask/TaskDraft/Metrics/Toast/Simulator`）。`Simulator = ReturnType<typeof useSimulator>`，mock 与 live 两个 hook **必须返回同构对象**，否则组件层要写分支。
- **4Hz 重渲染治理**（这是本项目的性能契约，勿破坏）：
  - `mapTask` 后过 `sameTask` 字段级比较，未变化的任务**沿用上帧引用**，让 `TaskCard` 的 `memo` 生效。
  - 给 `SimTask` 加字段时：若该字段会随快照变化，**必须同时加进 `sameTask`**，否则卡片不更新。`crashTimes`/`backoffAttempt` 是 mock 专用（live 恒空/0），故意排除。
  - `TaskCard` 自定义 comparator 把 `now` **按秒量化**（倒计时/uptime 只需 1Hz）；`LogPanel` 按「长度 + 末行 id」判等。函数 props 是内联闭包，故意忽略其引用。
- `TaskModal` 校验：非 Tauri 才做路径/后缀校验（`pathExists` 在 Tauri 下恒 true，真实校验交给后端 spawn 失败）；`parseArgs` 空格+引号感知、`\"` 转义、引号不闭合报错；依赖选择用 `forbidden` 传递闭包**禁掉会成环的选项**。
- 任务排序：`ORDER = running<starting<backoff<fused<stopped`，再按名字。状态色在 `TaskCard` 的 `STATE_META`。
- 日志面板高度用 `localStorage`（`taskwarden-log-height-v1`）持久化，拖拽把手 + 双击复位。
- `src/` 里图标全部是 `ui.tsx` 手写 SVG；**未使用** `lucide-react`（见 §10）。

---

## 9. 部署与 CI

- **CI**（`.github/workflows/ci.yml`）：`frontend`（ubuntu：`npm ci` → typecheck → vitest）+ `backend`（**windows-latest**：先 `npm run build` 产出 `dist`，因为 `generate_context!` 编译期校验并内嵌 `frontendDist`，再 `cargo test`）。
- **Pages**（`deploy.yml`）：`npm run build` → `dist`。`vite.config.js` 用 `process.env.TAURI_ENV_PLATFORM` 切 `base`：桌面 `/`、Pages `/TaskWarden/`。**这条改错了就是桌面端白屏**（内嵌资源 404）。
- **本机（WSL）交叉编译**（`deploy/DEPLOY.md` 是唯一权威说明）：`npm run build:win` → Docker `rust:1.89-bookworm` + mingw-w64 → `x86_64-pc-windows-gnu`，产物 `deploy/out/taskwarden.exe`（~26MB）+ **同级必需的 `WebView2Loader.dll`**（gnu 工具链只能动态链，MSVC/上游 CI 是静态链单文件）。首建 ~9min，增量 ~18s。
  - 容器统一 `--network=host` + 透传宿主代理（`127.0.0.1:7897`）；容器内用 `bash -c`（`-l` 登录 shell 会重置 PATH 丢 cargo）。
  - **每次 `touch src-tauri/build.rs`**：`generate_context!` 不把 `dist/` 变更记入 dep-info，否则会把上一次的前端产物内嵌进去。
  - 缓存：registry → 命名卷 `taskwarden-win-cargo`；target → `deploy/.target-win/`（已 gitignore，当前 1.3GB）。
  - 产物属 root（容器 bind mount 写入），脚本会 `cat > tmp && mv` 归一化归属，避免宿主 sudo。
- **不做 Linux 原生桌面版**：`runtime/` 与 `infra/sysinfo.rs` 全是 Windows 语义，移植属重写，超出范围。

---

## 10. 已知坑 / 文档-代码漂移（动手前先看这里）

1. **`persist_config()` 重建 `Settings`**（supervisor.rs）：只保留 breaker 两项，`log_dir` 恒写 `"logs"`、`theme` 恒写 `"dark"`。**用户自定义的 `settings.log_dir`（含绝对路径）会在任何一次增删改任务后被抹掉**（本会话仍有效，下次启动换目录）。
2. **`enabled = false` 的任务会在下一次落盘时静默消失**：`Supervisor::new` 用 `filter(|t| t.enabled)` 加载，`persist_config` 只写回内存里的 `task_configs()`；`TaskView::to_cfg()` 还硬编码 `enabled: true`。要支持禁用任务，这三处得一起改。
3. **自依赖会 panic**：`topo_levels` 的 `indeg -= 1`。`direct_deps()` 过滤了自依赖和未知依赖，但 `dependents()` **没过滤**，手改 `config.toml` 写出 `deps=["自身"]` 时 debug 构建整数下溢 panic（被 `catch_unwind` 吞掉但 `StartAll` 失效）。环依赖本身是安全的（Rust 把残环追加末层；TS 版返回 `[]`，两端只以「不死锁」为契约，见镜像测试注释）。
4. **`FailAct::Ok` / `Decision::Ok` 实际不可达**（`record_failure` 只会 `Backoff` 或 `Trip`），`events.rs` 里 `MetricsTick/ConfigChanged/TasksChanged/Stats/StateChanged/Spawned/Probe/BreakerReset` 生产了但 backend 只转发 4 类——GUI 靠 4Hz 快照，别误以为有事件驱动增量更新。
5. **`LICENSE` 是 Apache-2.0 全文，而 `Cargo.toml` `license="MIT"`、README 徽章与「📄 许可证 [MIT]」都写 MIT** —— 三者不一致，改许可前先向作者确认。
6. **`content.ts` 写「React 19 + Vite」，实际 `package.json` 是 React 18.3.1**；`LAYERS` 编号把表示层叫 ①（与 Rust 注释里 core=②/runtime=③/infra=④ 的编号方式不同，别按编号去找文件）。
7. **`package.json` 是模板遗留**：`name: "sandbox-workspace"`；`@supabase/supabase-js`、`@dnd-kit/*`、`canvas-confetti`、`date-fns`、`recharts`、`react-router-dom`、`uuid`、`lucide-react`、`framer-motion` 在 `src/` 中**均无引用**。清理前先跑 typecheck。
8. **`dist/` 被 gitignore 但编译必需**（`generate_context!`）；仓库现在完全没有已提交的 `dist`，任何 Rust 构建前都要先 `npm run build`。
9. **`deploy/` 整个目录、`package.json`、`package-lock.json`、`.gitignore` 的改动目前**未提交**（`git status` 有 4 项）；`package-lock.json` 只是被当前 npm 10.9.7 去掉了冗余 `"libc":["glibc"]` 字段。`src-tauri/target-win/` 是 Docker bind-mount 遗留的空 root 属主目录，未被 ignore 但 git 不跟空目录。
10. `src-tauri/.gitignore` 里 `/gen/schemas` 被忽略但目录里有生成文件；`build/*` 只放行两个 svg 和两个 mjs（PNG 产物不入库）。
11. `scheduler.rs::direct_deps` 注释说「未知依赖忽略并告警」，**实际没有告警**（只 filter）。

---

## 11. 提交与文案纪律（本项目的强约束）

git 历史显示这个项目的**文档与实现严格对齐**是刻意维护的：`7ca781e` 一次 commit 就做过「落地页 32 处 finding 审计」，把 egui/eframe 时代的旧宣称、PDH、`CreateMutexW`、60s 上限、`%APPDATA%` 路径等全部改成实测事实，性能数字改成实测（引擎 RSS ≈53MB、窗口就绪 45–65ms）。`7bd3286` 只为一句托盘操作提示的措辞单独提交。

因此：

- 改了行为/常量/命令数/路径 → **同一改动里更新 README.md、`src/data/content.ts`、`src/data/snippets.ts`、代码注释头**。
- 落地页/README 的每句宣称都要能在源码里指到实现；不确定就删掉宣称或标「接口已预留，当前返回 N/A」（如 CPU 温度）。
- 每个模块文件顶部的 `/* */` 框线注释头是该项目的固定风格（一行「文件：职责」+ 若干行设计说明），改逻辑时**同步改注释头**，尤其保留解释「为什么这么改」的历史教训段。
- 纯逻辑一律拆成可单测的函数（`clean_exit_action`、`classify_stderr`、`topo_levels`、`Breaker`、`parse_url`、`format_time`/`civil_from_days`、`decode_line`），并写中文注释说明它在防哪个 bug。
- TS 与 Rust 的镜像测试（DAG、熔断退避、参数解析、种子 5 任务）互为契约，改一端要检查另一端。
- Commit message 用 `feat:/fix:/docs:/perf:` + 中文要点列表（见 `git log`）。

---

## 12. 方案工作区（PI-work/）

`PI-work/` 存放**尚未进入代码**的调研与决策材料：`00-现状基线.md`（可核对事实）、`01-zsui-评估.md`、`02-迁移方案.md`、`03-风险与待决.md`、`04-验证清单.md`、`adr/`。

- 入口与文档规范见 `PI-work/README.md`；结论以文档头 `status` 为准，`accepted` 前**不要据此改代码**。
- 文档里的关键结论必须标 `[事实]` / `[实测]` / `[推断]` / `[待验证]`；外部数据带链接与访问日期。
- 决策落定后要把结论**回写**到 README / `src/data/content.ts` / 本文件，避免方案与实现漂移。

---

## 13. 一分钟自检清单（PR 前）

- [ ] `npm run typecheck && npm test`（9）在本机 WSL 通过
- [ ] Rust 侧改动要么在 CI 的 `backend`（Windows）job 上验证，要么 `npm run build:win` 出包后在 Windows 实测；**不要在 Linux 上 `cargo test`**
- [ ] 新字段是否进了 `sameTask`？DTO 是否 camelCase？入参是否 snake_case？
- [ ] 有没有把阻塞操作放回引擎线程？（→ 用线程 + 回灌 `Command`）
- [ ] 常量/语义变了的话：README、`content.ts`、`snippets.ts`、注释头、`OUT_OF_SCOPE` 是否同步？
- [ ] 是否误改了 `LICENSE`/`README` 的许可宣称（已知不一致，但别扩大）？
- [ ] 便携路径 `%APPDATA%` 迁移、原子落盘、日志文件名净化三条不变式是否仍成立？
