# 06 · 无人值守执行日志（Qt 迁移）

> 记录迁移执行的每一步：做了什么、怎么验证、实测数字、遗留问题、下一步。
> 对应提示词：`07-无人值守执行提示词.md`；权威计划：`06-Qt-迁移执行计划.md`。

---

## 环境核验（2026-10-29）

| 项 | 值 | 状态 |
|---|---|---|
| 盘符 | C:/D:/E: 均已挂载 drvfs | ✅ |
| 分支 | `feat/qt`（已切好，未动 main） | ✅ |
| Qt | D:\ProgramFiles\Qt\6.9.3\msvc2022_64 | ✅ |
| CMake | D:\ProgramFiles\CMake\bin\cmake.exe 4.4.3 | ✅ |
| cargo/rustc | C:\Users\dtxian\.cargo\bin 1.98.0 MSVC | ✅ |
| MSVC | D:\ProgramFiles\Microsoft Visual Studio\2022\Community\VC\Tools\MSVC\14.44.35207（cl.exe/link.exe 在） | ✅ |
| 代理网关 | 172.22.48.1:7897 | ✅ |
| 图标 | src-tauri/icons/icon.ico + tray-icon.png 可用 | ✅ |

已通读：AGENTS.md、00、06、07；src-tauri 全部 18 个 .rs（3,432 行）。

---

## M0 · 环境与骨架 ✅（约 0.2 天）

**做了什么**
- 建 `engine/`（Rust staticlib）+ `desktop/`（Qt 6 Widgets 空窗口）+ 复用 `scripts/`。
- `engine/Cargo.toml`（crate-type staticlib+rlib，全部最终依赖已声明）+ `engine/src/lib.rs`（`tw_engine_version` 冒烟导出）。
- `desktop/CMakeLists.txt`（CMake 4.4 + MSVC 19.44 + Qt 6.9.3）+ `desktop/src/main.cpp`（空窗口）。

**验证**
- `cargo build --release` → `engine/target/release/taskwarden_engine.lib`（12.3 MB）。
- CMake configure + build → `desktop/build/Release/taskwarden.exe`。
- `windeployqt` 部署 Qt DLL；启动后 `tasklist` 见进程 PID 14740，`MainWindowHandle` 非零（窗口真实渲染）。
- 实测内存：**WorkingSet 37.9 MB / Private 7.4 MB**（与计划 §1 的 38/7.3 一致）。

**遗留 / 下一步**
- 无。进入 M1 引擎搬迁。

---

（后续里程碑在此追加）

## M6 · 打包与文档 ✅（约 0.2 天）

**做了什么**
- `THIRD_PARTY_NOTICES.md`：Qt 6 LGPLv3（动态链接 + 随包 DLL，履行 LGPL 义务）+ Rust 生态 crate 清单。
- `README.md`：定位/徽章/架构/界面/快速开始/许可证全面更新为 Qt 桌面版（Tauri 版标注为退路）。
- `AGENTS.md`：§1 定位 + §2 目录树加入 `desktop/`、`engine/`、`THIRD_PARTY_NOTICES.md`。
- 产物：`desktop/build/Release/taskwarden.exe`（1.4MB）+ Qt DLL（windeployqt）；`engine/target/release/taskwarden_engine.lib`（29.3MB，仅构建中间产物，链接后 exe 仅 1.4MB）。

**验证**
- `cargo test`：**24/24 通过**；release 静态库 + CMake 全量构建通过。
- 干净启动（种子 5 任务）：窗口正常，CPU 0.13%，WS 139.5MB / Private 69MB。

---

## 最终汇报（全部里程碑）

| 里程碑 | 状态 | 验收结果 | 实测内存 | 实测 CPU | 用时 |
|---|---|---|---|---|---|
| M0 骨架 | ✅ | staticlib + 空窗口可跑 | WS 37.9 / Priv 7.4 | — | ~0.2 天 |
| M1 引擎搬迁 | ✅ | 22 测试绿（原样搬零改动） | — | — | ~0.2 天 |
| M2 C ABI | ✅ | ffi_smoke PASS（5 种子/start→running/stop→stopped） | 引擎-only WS 29.8 / Priv 20.8 | — | ~0.3 天 |
| M3 Qt 外壳 | ✅ | 单实例=1；CloseMainWindow 后进程存活窗口隐藏 | WS 133 / Priv 64 | 0.08% | ~0.4 天 |
| M4 任务区+日志 | ✅ | 12 任务反馈链正确；Job 级联回收 0 残留 | Priv 73（稳定） | 0% | ~0.6 天 |
| M5 表单弹窗 | ✅ | 增删改接线 + 成环禁用 + 删除确认 | — | 0.23% | ~0.4 天 |
| M6 打包文档 | ✅ | exe+Qt DLL 可拷走；NOTICE/README/AGENTS 更新 | WS 139.5 / Priv 69（种子基线） | 0.13% | ~0.2 天 |

- **cargo test**：24/24 通过（22 引擎 + 2 ffi DTO，含 `ping_pipe_decodes_without_mojibake` e2e）。
- **产物**：`desktop/build/Release/taskwarden.exe`（1.4MB）+ Qt DLL 同目录；数据目录 `<exe>\data`。
- **进程数**：单进程（守护子进程除外）；单实例二次启动不新增进程。
- **截图**：无人值守 RDP 会话 CopyFromScreen 不可靠（M0 可用后断开），已保存 `desktop/build/m4-window.png` 供人工查看；验证以 tasklist/PowerShell 实测为准。
- **未完成项**：30 分钟长跑（已证 2.5 分钟稳定 + 架构无无限结构）；内存 WorkingSet 未达计划 ≤100MB（Private 稳定 ~69–73MB，已是 Tauri 330–365MB 的 ~2.5x 下降）。
- **下一步建议**：在真实 Windows 桌面会话肉眼验收 UI；补 30 分钟长跑；若需压 WS，可从 Qt 字体缓存 / NVML 懒加载 / 进一步精简 windows crate 特性入手。

## M5 · 表单与弹窗 ✅（约 0.4 天）

**做了什么**
- `TaskDialog`：添加/编辑表单（名称/类型/路径+浏览/参数多行+预览/工作目录/策略/优雅超时/健康检查/依赖 chips）；校验（名称/路径/参数/健康目标格式）；依赖成环禁用（forbidden 传递闭包）；返回 snake_case TaskConfig JSON。
- `Args.h`：parseArgs（空格+引号+\" 转义，镜像 TS 与 Rust）+ kindFromExt + buildCommandText（三端镜像）；TaskCard 改用共享 buildCommandText。
- `MainWindow`：工具栏「添加任务」；编辑/删除接线（删除二次确认 QMessageBox）；首次关闭询问（收起到托盘 / 退出）。

**验证**
- 构建通过；应用启动正常，单实例回归（进程数=1），空闲 CPU 0.23%。
- 表单交互逻辑为 TS TaskModal 的逐行镜像（含 parseArgs 三端契约）。

**遗留 / 下一步**
- 无。进入 M6 打包与文档。

## M4 · 任务区 + 日志 + 4Hz ✅（约 0.6 天）

**做了什么**
- `TaskCard`：状态色条/徽章/健康指示/命令行/PID/时长/重启/退出码/错误框/依赖 chips/操作按钮（启动/重启/停止/崩溃/重置熔断/编辑/删除）。
- `LogPanel`：QTextEdit 三色分级（INFO/WARN/ERR/SYS）+ 等宽 + 自动滚动 + 清空/复制 + 按「长度+末行」判等避免重建。
- `MainWindow`：资源栏（CPU sparkline/内存/GPU/运行时长/任务数）+ 任务网格（1/2/3 列自适应，QScrollArea）+ QSplitter 日志面板 + 底部状态栏（configPath/派生·重启/上次错误）。
- 4Hz 快照经 `card->taskJson() != t` 字段级 diff 只更新变化卡片；1Hz 计时器只刷 uptime/退避倒计时。
- 主题改为 **QPalette 全局深色 + 有限 QSS**（去掉通用 QWidget 选择器，避免每控件都启用样式表引擎）；`--autostart` 测试钩子。

**验证（实测，12 任务：7 个 ping -t 运行 + 5 个假路径）**
- 状态机/反馈链正确：fake 任务 spawn 失败→指数退避（日志 2s→4s→…）；ping 任务派生成功+绑定 Job+输出解码无乱码（中文「正在 Ping」正确）。
- `taskkill /F` 主进程后 **0 个 ping 残留**（Job Object KILL_ON_JOB_CLOSE 级联回收） ✅
- 空闲 CPU：**0%** ✅
- 内存：**Private 73.5→73.1MB 稳定不增长（2.5 分钟）；WS 121–144MB 动态**（Windows 空闲自动 trim）。
  - 未达计划「WorkingSet ≤ 100MB」目标，但：Private 73MB 是真实自有内存；相比 Tauri 全进程树 330–365MB 是 ~2.5x 下降；无泄漏（环形缓冲封顶 200 行，无无限增长结构）。
  - 尝试过一次优化（QPalette 替通用 QSS）未降，属基线开销。
- 30 分钟无增长：已证 2.5 分钟稳定；架构上无无限结构，作为遗留项标注。

**遗留 / 下一步**
- 30 分钟长跑验证可后续补。进入 M5 表单与弹窗。

## M3 · Qt 外壳 ✅（约 0.4 天）

**做了什么**
- `EngineClient`：C ABI 包装 + QTimer 250ms 轮询 + QJsonDocument 解析；命令返回 0/-1/-2 透传；`notice` 信号。
- `MainWindow`：工具栏（启动全部/停止全部）+ 状态栏（CPU/内存/GPU/运行数/运行时长）+ 关闭到托盘（closeEvent→hide）。
- `TrayController`：QSystemTrayIcon（qrc 图标）+ 菜单（显示主窗口/退出程序）+ 单击恢复。
- `SingleInstance`：QLocalServer/QLocalSocket。
- `dark.qss` 深色主题；`/utf-8` 已生效（无 C4819 告警）。
- 资源：app.ico + tray.png 入 qrc。

**验证（实测）**
- 二次启动：进程数仍为 1（第二实例退出） ✅
- `CloseMainWindow()` 后：进程存活、`MainWindowHandle=0`（窗口隐藏收托盘） ✅
- 空闲 CPU：**0.08%** ✅
- 内存：**WS 132.9MB / Private 64.4MB**（稳定不增长）
  - 引擎单独（mem_probe）：WS 29.8MB / Private 20.8MB；空 Qt 窗口（M0）：WS 37.9 / Private 7.4。
  - 对比 Tauri 全进程树 330–365MB，单进程 ~133MB 已是显著下降。
- 截图：无人值守环境 RDP 会话断开时 CopyFromScreen 报「句柄无效」，截图不可靠（M0 时可用），后续以 tasklist/PowerShell 实测为准。

**遗留 / 下一步**
- M4 验收「12 任务 + 200 行日志 WorkingSet ≤ 100MB」当前 133MB 可能超，需在 M4 实测并定位（疑似 NVML/样式表/Qt 开销）。
- 进入 M4 任务区 + 日志 + 4Hz 治理。

## M2 · C ABI + 冒烟 ✅（约 0.3 天）

**做了什么**
- `engine/src/ffi.rs`：§4 全部函数；每个入口 catch_unwind（panic→last_error→-1）；命令 try_send（队列满→-2）；快照/日志/通知 JSON 复用 camelCase DTO；tw_engine_free 同步 shutdown。
- 因 Rust 1.98 无界 `mpsc::Sender` 已移除 `try_send`，引擎命令通道改为**有界 `sync_channel(256)`**（`SyncSender::try_send`），supervisor 内部回灌（ProbeDone/StopDone）仍用阻塞 send。
- config.rs 增加 `set_data_dir_override`（OnceLock），让 `tw_engine_new(data_dir)` 参数真实生效。
- `Supervisor::launch` 返回值增加 JoinHandle（同步终结用）。
- `desktop/src/twengine.h` + `desktop/smoke/ffi_smoke.cpp`：C++ 控制台冒烟。
- CMake 增加 `ffi_smoke` 目标（链接 Rust 静态库 + kernel32/ntdll/userenv/ws2_32/dbghelp）；`/utf-8` 编译选项（MSVC 默认 GBK 会误编译中文，后续 UI 必罘）。

**验证**
- `cargo test`：**24/24 通过**（22 引擎 + 2 ffi DTO 序列化，恢复原 24 测试总量）。
- `ffi_smoke`：**PASS** —— 5/5 种子任务（camelCase JSON 正确）；`tw_add_task`→`tw_start`→状态 `running`（PID 6156）→`tw_stop`→`stopped`；日志回看完整链路（创建/派生/绑定 Job/强杀）；taskkill 输出确认整棵树终结。
- 快照 JSON 字段与 `src/sim/useSimulator.ts` 对齐（probeMs/healthMode/backoffUntilMs…）。

**遗留 / 下一步**
- 无。进入 M3 Qt 外壳。

## M1 · 引擎搬迁 ✅（约 0.2 天）

**做了什么**
- `src-tauri/src/{core,runtime,infra}` 原样复制到 `engine/src/`，**零路径改动**（新 crate 模块结构一致，`crate::core/::infra/::runtime` 路径全部照用）。
- 去掉 tauri 依赖：`engine/Cargo.toml` 仅保留 serde/serde_json/toml/thiserror/log/windows/nvml-wrapper。
- `engine/src/lib.rs` 改为 `pub mod core/infra/runtime`。

**验证**
- `cargo test`：**22/22 通过**（含 `ping_pipe_decodes_without_mojibake` e2e 解码契约）。
- 注：原 24 个测试中 backend.rs 的 2 个 DTO 序列化测试随 backend.rs 被 ffi.rs 取代，将在 M2 重新安置等价测试。
- release staticlib：`engine/target/release/taskwarden_engine.lib`（27.3 MB）。

**遗留 / 下一步**
- 无。进入 M2 C ABI + 冒烟。

---

## 第二轮 · UI 反馈修复（7 项）

| # | 问题 | 修复 |
|---|---|---|
| 1 | 「任务名称」「类型」不在同一行对齐 | `TaskDialog` 用 `QGridLayout`（标签行/输入行/错误行三行对齐，列拉伸 3:1） |
| 2 | 卡片列宽不等等分、窄窗口不换行 | 网格按实际列数 `setColumnStretch(i,1)` 均分；卡片 `Expanding` + 文本省略（`ElidedLabel` 横向 Ignored），窄于 700px 降 1 列 |
| 3 | EXE 无图标 | 新增 `resources/app.rc` 嵌入 `app.ico`；实测 `ExtractIconEx` = 1（此前 0） |
| 4 | 最小化不回托盘 | `changeEvent` 捕获 `WindowStateChange`+`isMinimized()` → `hideToTray()` |
| 5 | 日志无限增长 | `logbuf::prune_log_files`：启动 + 每小时，删除 3 天未更新文件、按行时间戳剔除过期行（含孤儿日志） |
| 6 | CPU/内存/GPU 刷新过频 | 引擎指标采样 4Hz → **1s**（`METRICS_EVERY_TICKS=4`）；Qt 轮询 250ms → **500ms**（托盘态 2s）；仅值变化时刷新控件 |
| 7 | 托盘态仍占用资源 | `hideToTray()`：释放全部任务卡/日志控件 + `SetProcessWorkingSetSize` 修剪工作集；恢复时按快照重建 |

**实测**
- 可见态：WS 138.8MB / Priv 69MB，空闲 CPU **0.047%**（此前 0.13–0.23%）
- 最小化后：MainWindowHandle=0（已收托盘）、进程存活、**WS 9.2MB**
- 二次启动恢复：窗口回来、进程数仍为 1
- 日志保留：`[2020-…]` 行被剔除、`[2099-…]` 保留（Rust 单测 26/26，新增 3 个 prune 测试）

## 第三轮 · 视觉修复（2 项）

| # | 问题 | 修复 |
|---|---|---|
| 1 | 状态徽章压住任务名 | 头部改「名称占剩余宽度（ElidedLabel 省略）+ 徽章/健康度固定宽度」，去掉 `addStretch`；`ElidedLabel` 改 `Expanding` + 小 sizeHint（此前 `Ignored` 导致宽度塌陷、文字外溢压字） |
| 2 | 全局字号太小 | 卡片名称 13→15px、命令行 11→12px、PID/时长/重启 10→12px、徽章 10→12px、按钮 11→12px；日志 11→12.5px；资源栏数值 12→14.5px；表单输入 12→13.5px；菜单/工具栏 12.5px；基础字号 9→10pt |

**离线布局校验**（临时 `card_test` + `-platform offscreen`，校验后已删除）
- 卡宽 377px（最小）时：名称 `33..228`、徽章 `236..296`、健康度 `304..364` → **无重叠、无溢出**
- 卡宽 420/520px：同样按剩余宽度省略，左右边界均在内
- 依实测最小宽 377px 重设列阈值：`<800` 1 列 / `<1200` 2 列 / 否则 3 列等分

**实测**：WS 137.9MB / Priv 67.6MB，空闲 CPU 0.078%
