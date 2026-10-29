# 迁移记录：Tauri 2 → Qt 6

> 决策理由见 [ADR-0001](adr/0001-desktop-shell-qt-and-c-abi.md)。
> 原 Tauri 版完整代码保留在 `legacy/tauri` 分支（`7bd3286`），可随时切回。

## 里程碑与实测

| 里程碑 | 内容 | 验收结果 | 实测 |
|---|---|---|---|
| M0 | 骨架：Rust 空 staticlib + Qt 空窗口 | staticlib 产出、exe 可启动 | WS 37.9MB / Private 7.4MB |
| M1 | 引擎搬迁：`core/ runtime/ infra/` 原样复制，去 tauri 依赖 | 零路径改动；测试全绿 | 22 测试 |
| M2 | C ABI（`ffi.rs`）+ `ffi_smoke` 冒烟 | 5 种子正确；`start→running`、`stop→stopped` | 引擎单独 WS 29.8MB / Private 20.8MB |
| M3 | Qt 外壳：主窗口、状态栏、托盘、单实例、关闭到托盘 | 二次启动进程数=1；关窗后进程存活、窗口隐藏 | WS 133MB / Private 64MB；CPU 0.08% |
| M4 | 任务卡网格 + 日志面板 + 4Hz 字段级 diff | 12 任务反馈链正确；假路径任务走熔断/退避 | Private 73MB 稳定；CPU 0% |
| M5 | 表单与弹窗：增删改、`parseArgs`、成环禁用、删除确认 | 三端镜像 `parseArgs` 一致 | — |
| M6 | 打包与文档：`windeployqt`、NOTICES、README/AGENTS | exe + Qt DLL 目录可拷走 | WS 139.5MB / Private 69MB |
| 第二轮 | 用户反馈 7 项（对齐、列宽、图标、最小化、日志保留、采样降频、托盘释放界面） | 全部修复 | 托盘态 WS **9.2MB**；CPU **0.047%** |
| 第三轮 | 状态徽章压字、全局字号 | 离线几何校验无重叠（377px 最小宽） | — |

`cargo test` 从 22 → **26**（新增 3 个日志保留测试 + 2 个 ffi DTO 序列化测试，随 `backend.rs` 迁移而来）。

## 迁移中发现的两个环境事实（值得记住）

1. **Rust 1.98 的 `mpsc::Sender` 已没有 `try_send`**，只有有界 `sync_channel` 的 `SyncSender` 才有。
   因此引擎命令通道改为 `sync_channel(256)`——恰好符合「队列满返回 `-2`」的 ABI 契约。
2. **MSVC 默认按 GBK(936) 读源码**，UTF-8 中文注释/字面量会被误编译（警告 C4819）。
   CMake 必须带 `/utf-8`，否则 UI 中文文案乱码；Windows 上 `rc.exe` 编译 `.rc` 同理。

## 与 Tauri 版的形态差异

| 维度 | Tauri 2（`legacy/tauri`） | Qt 6（当前 `main`） |
|---|---|---|
| 进程 / 渲染 | 应用进程 + WebView2 进程树（330–365MB） | **单进程**，无 WebView2 |
| 前后端通信 | `invoke` 命令 + 事件推送（IPC 序列化） | 同进程 C ABI + JSON（可见 500ms 轮询） |
| 发布形态 | 单 exe（+ 依赖系统 WebView2） | exe + Qt DLL 目录（约 50MB，可整目录拷走） |
| 界面技术 | React + Tailwind（Web） | Qt Widgets + QSS/QPalette |
| 托盘 / 单实例 | `tauri-plugin-*` | `QSystemTrayIcon` / `QLocalServer` |
| 引擎 | 原样 | **原样（0 行重写）** |

## 遗留项

- `[已完成]` 落地页同步为 Qt 形态：模块树、四层架构、性能数字（冷启动 0.65s / 私有内存 68MB / 托盘 9MB / 空闲 CPU 0.05%）、托盘与单实例文案、代码片段（C ABI、Qt 轮询、静默派生）；新增 C++ 语法高亮。
- `[待办]` `src/` 仍保留不会激活的 `isTauri` 分支与 `@tauri-apps/*` 依赖（浏览器演示走 mock），彻底清理属独立重构。
- `[待办]` 30 分钟长跑内存验证未正式执行；已证 2.5 分钟 Private 稳定，且数据结构无无限增长项（环形缓冲封顶 200 行）。
- `[待办]` 许可不一致：`LICENSE` 为 Apache-2.0 全文，而 `Cargo.toml`/README 写 MIT —— 需作者拍板后统一。
- `[已知]` UI 需在真实桌面会话肉眼验收（无人值守环境的截图在 RDP 断开时不可靠）。
