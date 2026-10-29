# AGENTS.md

> 给在本仓库工作的 AI 代理与人类协作者的**最小上下文**。详细内容在 `docs/`，不要在这里重复。
> 语言约定：文档、注释、日志文案一律中文；标识符/命令英文。

## 项目是什么

**TaskWarden** = Windows 专用轻量级后台任务守护监督器。常驻托盘，负责「静默拉起 / 看着 / 收掉」常驻进程：
`CREATE_NO_WINDOW` 无黑框派生、Job Object 进程树管控、滑动窗口熔断 + 指数退避、DAG 依赖级联、健康探针、实时日志。

形态：**单进程 Qt 6 Widgets（C++20）外壳 + Rust 引擎静态库（C ABI）**，无 WebView2，便携数据目录 `<exe>\data`。

## 文档地图

| 想了解 | 去哪 |
|---|---|
| 分层、线程模型、C ABI、语义常量、**10 条不变式**、Windows 要点、**已知坑** | `docs/architecture.md` |
| 为什么从 Tauri 迁到 Qt、里程碑与实测数字、遗留项 | `docs/migration.md`、`docs/adr/0001-*.md` |
| 用户向介绍与构建步骤 | `README.md` |
| 第三方许可（Qt LGPLv3 等） | `THIRD_PARTY_NOTICES.md` |
| 旧 Tauri 2 版（已归档） | `legacy/tauri` 分支 |

## 硬约束（违反会引入回归）

1. **引擎不做阻塞 IO**：网络探针、等待进程退出、`taskkill` 必须丢线程，用 `Command::ProbeDone` / `StopDone` 回灌引擎线程。
2. **FFI 边界**：每个入口 `catch_unwind`；panic → `last_error` → 返回 `-1`。**release 必须保留 `panic = "unwind"`**。
   出参 DTO **camelCase**，入参 `TaskConfig` **snake_case**（`ffi.rs::snapshot_serializes_camel_case` 拦漂移）。
3. **Qt 侧不跨线程碰引擎**：只用 `EngineClient` 轮询；不在 Rust 线程里操作 Qt 对象。
4. **日志单一入口** `emit_log()`：内存环与事件流必须同源。`clear_logs` 只清内存环，文件保留供审计。
5. **便携语义**：`%APPDATA%` 一次性复制迁移、`config.toml` 原子落盘（tmp → 删旧 → rename）、日志文件名净化，三条都不能破。
6. **`ping` e2e 测试不许删**：`ping_pipe_decodes_without_mojibake` 是「UTF-8 优先 → OEM 回退」解码链路的契约。
7. **CMake 必须带 `/utf-8`**：否则 MSVC 按 GBK 读源码，中文文案乱码。

## 常用命令

```bash
# Rust 引擎
"$CARGO" build --release --manifest-path engine/Cargo.toml
"$CARGO" test  --manifest-path engine/Cargo.toml          # 26 个测试

# Qt 桌面端（构建 + 部署 + 运行）
"$CMAKE" -S desktop -B desktop/build -G "Visual Studio 17 2022" -A x64 \
         -DCMAKE_PREFIX_PATH="D:/ProgramFiles/Qt/6.9.3/msvc2022_64"
"$CMAKE" --build desktop/build --config Release            # → desktop/build/Release/taskwarden.exe
windeployqt --release --no-translations desktop/build/Release/taskwarden.exe

# 引擎冒烟（不需要 Qt）
desktop/build/Release/ffi_smoke.exe <data_dir>

# 落地页 / 原型
npm run typecheck && npm test && npm run build
npm run icons                                             # 重生成 desktop/resources/icons/*
```

工具路径与盘符挂载见 `scripts/env.sh`（WSL automount 关闭，新会话先挂载 C/D/E）。

## 提交与文案纪律

- 改行为 / 常量 / 命令数 / 路径 → **同一次提交**更新 `docs/architecture.md` 对应表格、`README.md`、文件顶部框线注释头。
- 落地页 `src/data/content.ts` / `snippets.ts` 的每句宣称都要能在源码里指到实现（数字均来自实测，见 `docs/migration.md`）。
- 纯逻辑拆成可单测函数，并用中文注释写清「在防哪个 bug」。
- TS 与 Rust 的镜像实现/测试互为契约，改一端要检查另一端。
- Commit message：`feat:/fix:/docs:/perf:/chore:` + 中文要点列表。
- 已知未决：`LICENSE`（Apache-2.0 全文）与 `Cargo.toml`/README（MIT）**不一致**，改许可前先问作者。
