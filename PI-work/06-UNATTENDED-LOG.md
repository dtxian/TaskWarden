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
