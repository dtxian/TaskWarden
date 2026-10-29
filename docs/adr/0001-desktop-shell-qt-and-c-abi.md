# ADR-0001 · 桌面壳改用 Qt 6 Widgets + Rust 静态库（C ABI）

- 状态：accepted
- 日期：2026-10-29
- 取代：早期「Tauri 2 + React/WebView2」形态（完整代码见 `legacy/tauri` 分支）

## 背景

`[事实]` 原形态是 Tauri 2 + React（WebView2 渲染）：单个应用进程的内存尚可，但整棵 WebView2 进程树可达 330–365MB；IPC 需要维护 DTO（camelCase/snake_case 漂移）、4Hz 全量推送、前后端双份语义（mock 与 live），且发布依赖 WebView2 运行时 + `WebView2Loader.dll`。

`[事实]` 真正的资产是引擎：`core/ runtime/ infra/` 共 3,432 行、24 个测试、10 条刻意的行为语义（Job Object 进程树管控、编码回退、熔断退避、DAG、原子落盘）。这部分**重写成本高、收益为零**。

目标因此收敛为：**单进程、无 WebView2、低内存低 CPU、界面能力不退步（托盘/日志框/表单/单实例）、引擎零重写**。安装包体积不是硬指标。

`[实测]` 环境已具备：Windows 侧 MSVC 2022（14.44）、CMake 4.4.3、Rust 1.98（MSVC target）、Qt 6.9.3（msvc2022_64）。

## 决策

1. 桌面壳用 **Qt 6 Widgets（C++20）**。
2. 引擎**原样保留 Rust**，编译为 `staticlib`，经 **C ABI** 链入同一进程。
3. **不做跨线程回调**：C++ 侧用 `QTimer` 主动轮询 JSON 快照（可见 500ms / 托盘 2000ms）。
4. 命令队列**有界**（256）+ `try_send`：满返回 `-2`、未就绪返回 `-1`，永不阻塞 UI。
5. Qt 采用 **LGPLv3 动态链接**（`windeployqt` 随包发 DLL），应用本体保持 MIT。
6. 不引入 ZSUI / Iced / egui，不用 vcpkg 装 Qt，不静态链接 Qt。

## 选项对比

| 选项 | UI 成本 | 内存 | 引擎 | 构建链 | 结论 |
|---|---|---|---|---|---|
| **Qt 6 + Rust 静态库** | 低（控件/托盘/表单全现成） | 中 | **零重写** | MSVC + CMake + Qt + Cargo | **采用** |
| Tauri 2（原形态） | 已有 | 高（进程树 330–365MB） | 复用 | 需 Node + WebView2 运行时 | 弃用（内存/发布形态） |
| 全 C++ 重写 | 低 | 中 | 重写 3,432 行 + 重跑语义 | 同 Qt 行 | 放弃（无收益、风险高） |
| ZSUI | 高（alpha，缺控件） | 低 | 复用 | Cargo | 放弃（成熟度、缺口多） |
| Iced | 中 | 中高 | 复用 | Cargo | 放弃（托盘/无障碍缺口） |
| egui / GPUI / Xilem / Slint | 中 | — | 复用 | Cargo | 放弃（即时模式不适配表单/日志；或过于早期） |

## 为什么是「静态库 + 轮询」而不是「子进程 + IPC」或「回调」

- **静态库**：单进程 ⇒ 无 IPC 序列化、无进程树、无端口/管道生命周期问题；崩溃边界靠 `catch_unwind` 在 FFI 入口兜住。
- **轮询而非回调**：Rust 线程若直接回调进 Qt 对象，就是跨线程碰 GUI（未定义行为的经典来源）。轮询把线程亲和性彻底划清——Rust 只写自己的共享状态，Qt 只在主线程读。4Hz/2Hz 的 JSON 开销实测可忽略（快照约 3KB）。
- **有界队列**：无界队列在 UI 卡顿或命令风暴时会无上限增长；有界 + `try_send` 让「满」变成显式的 `-2`，配合 `last_error` 让界面能提示，而不是静默堆积。
- **必须 `panic = "unwind"`**：`supervisor` 依赖 `catch_unwind` 保活引擎线程，`panic = "abort"` 会让单次异常杀掉整个进程。

## 后果

**正面**

- `[实测]` 单进程；收进托盘后工作集 **139MB → 9.2MB**（释放界面控件 + 修剪工作集）。
- `[实测]` 空闲 CPU **0.047%**（指标降为 1s 采样、轮询 500ms）。
- `[实测]` 引擎单独（无 Qt）WorkingSet 29.8MB / Private 20.8MB。
- 引擎零重写，`cargo test` 语义契约全部保留。
- 界面能力不退步：托盘、关闭/最小化收托盘、单实例、表单、日志着色、sparkline 全为 Qt 现成能力。

**负面**

- 两门语言（C++ + Rust），多一层 C ABI 需要维护（`ffi.rs` ↔ `twengine.h` 必须同步）。
- 分发目录带 Qt DLL（约 50MB 目录），不是单文件 exe。
- MSVC/CMake 工具链比纯 `cargo build` 重；`/utf-8`、`psapi` 之类的 Windows 细节需要显式处理。

**需要同步的文档**：`README.md`、`docs/architecture.md`、`THIRD_PARTY_NOTICES.md`（Qt LGPLv3）。

## 验证

- `[实测]` `cargo test --manifest-path engine/Cargo.toml` → **26 passed**（含 `ping` 解码 e2e）。
- `[实测]` `ffi_smoke`：5 个种子任务正确读出；`tw_start` → `running`（PID 实测）→ `tw_stop` → `stopped`。
- `[实测]` 单实例：二次启动进程数仍为 1，首实例窗口恢复。
- `[实测]` 关闭/最小化 → 托盘：`MainWindowHandle=0`、进程存活、工作集 9.2MB；`taskkill /F` 后子进程 0 残留（Job 级联回收）。
- `[实测]` 12 任务 + 7 个真实 `ping -t` 运行：Private 73MB 稳定不增长（2.5 分钟采样），CPU 0%。

## 复议条件

出现以下任一情况应重开讨论：

- Qt 必须改为静态链接（需 GPLv3 或商业授权）；
- 桌面端内存超过 150MB，或 4Hz 下 CPU 超过 5%；
- C ABI 出现无法隔离的崩溃/UB（`catch_unwind` 兜不住的内存错误）；
- Qt 6.9.x 出现影响发布的严重缺陷且无补丁版本；
- Windows 侧工具链（MSVC/CMake/Qt）不可用。
