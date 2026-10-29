# TaskWarden

> 轻量级后台任务守护监督器 · Windows 专用 · **Rust 引擎 + Qt 6 Widgets 桌面壳**（旧 Tauri 版保留为退路）

常驻系统托盘守护后台任务：**静默启动、进程树管控、熔断重试、DAG 依赖级联、健康探针、实时日志**。
纯 std 线程 + mpsc 的 Rust 监督内核，配 Qt 6 原生桌面界面（无 WebView2），**单进程、便携数据目录**。

<p align="center">
  <a href="https://dtxian.github.io/TaskWarden/"><img src="https://img.shields.io/badge/在线演示-GitHub%20Pages-blue?logo=github" alt="在线演示"></a>
  <img src="https://img.shields.io/badge/platform-Windows-0078d6?logo=windows" alt="Windows">
  <img src="https://img.shields.io/badge/backend-Rust-orange?logo=rust" alt="Rust">
  <img src="https://img.shields.io/badge/desktop-Qt%206%20Widgets-41cd52?logo=qt" alt="Qt">
  <img src="https://img.shields.io/badge/license-MIT-green" alt="MIT">
</p>

---

## ✨ 在线演示

[**点击体验在线交互原型**](https://dtxian.github.io/TaskWarden/) —— 页面即产品介绍：
产品概览、可交互的界面原型（在线演练启动 / 停止 / 熔断 / DAG 级联）、四层架构、核心代码、托盘交互、性能指标。

> 浏览器中的原型跑**本地模拟数据**（不启动真实进程），仅演示交互；真正拉起并守护进程的是 Tauri 桌面版。
> 两端共用同一套界面组件，仅数据源不同（见「架构」）。

---

## 🚀 特性

- **静默派生**：`CREATE_NO_WINDOW` 无黑框；exe / bat / ps1 三种启动器统一适配
- **进程树管控**：子进程绑定 Job Object（`KILL_ON_JOB_CLOSE`），脚本派生的孙进程一并纳管，退出级联回收
- **优雅停机**：轮询等待自然退出 → 超时 `taskkill /T /F /PID` 终结整棵进程树（回收线程兜底，绝不卡引擎）
- **熔断重试**：滑动窗口熔断（默认 60s 窗口 / 3 次）+ 指数退避（`2^n` 秒，封顶 64s）
- **崩溃循环识别**：`always` 策略下存活 < 5s 的 code-0 快速正常退出按崩溃计入熔断，杜绝"秒退秒拉"死循环
- **DAG 依赖**：Kahn 拓扑分层启动，依赖先启、同层并发；上游停止联动下游，成环时并入末层不中断
- **健康探针**：TCP 端口 / HTTP 就绪 / 日志关键字（ready）三模式，在引擎 tick 内异步推进，聚合为卡片健康度
- **实时日志**：stdout/stderr 后台线程按行泵读，**UTF-8 严格优先、失败回退 OEM(CP936)** 解码（ping 等中文命令不乱码）；stderr 按内容启发分级 ERR/WARN/INFO（llama.cpp 等不再整屏标红）
- **日志保留 3 天**：启动与每小时按行时间戳剔除过期行，并删除 3 天未更新的日志文件
- **低占用**：指标（CPU/内存/GPU）1s 采样；**最小化/关闭直接收进托盘并释放界面**（工作集 139MB → ~9MB）
- **单文件 + 便携**：不产出安装程序；配置与日志落在 exe 同级的 `data\` 目录，整个文件夹拷走即用

---

## 🏗 架构

**桌面壳（Qt 6 Widgets，C++20）与引擎（Rust 静态库，C ABI）解耦，经 UTF-8 字符串 + JSON 交互。**

```
├─ desktop/                  # Qt 6 Widgets 桌面壳（新，主桌面端）
│  ├─ src/EngineClient.*     #   C ABI 包装 + QTimer 250ms 轮询 + QJsonDocument 解析
│  ├─ src/MainWindow.*       #   资源栏 + 任务卡网格(1/2/3 列) + 日志面板 + 状态栏
│  ├─ src/TaskCard.*         #   任务卡（状态色/健康/依赖/操作）
│  ├─ src/LogPanel.*         #   实时日志（三色分级/自动滚动）
│  ├─ src/TaskDialog.*       #   添加/编辑表单（校验 + 依赖成环禁用）
│  ├─ src/TrayController.*   #   系统托盘；SingleInstance.* 单实例
│  └─ resources/             #   qrc 图标 + dark.qss
│
├─ engine/                   # Rust 引擎静态库（crate-type = staticlib）
│  └─ src/                   # ffi.rs（C ABI） + core/ runtime/ infra/（原样复用）
│
├─ src/                      # Web 落地页 + 交互原型（浏览器 / GitHub Pages，React + Vite）
├─ build/                    # 图标矢量源（app-icon.svg / tray-icon.svg）+ 生成脚本
└─ scripts/                  # env.sh / build-all.sh / screenshot.ps1
```

> 原 **Tauri 2 桌面版**已归档到 `legacy/tauri` 分支（`main` 不再包含 `src-tauri/`），需要时
> `git switch legacy/tauri` 即可取回。
>
> 贡献者文档（分层/线程模型/C ABI/语义不变式/已知坑/决策记录）见 [`docs/`](docs/README.md)。

依赖单向向下：**表示层（Qt/React）→ 核心调度（core）→ 进程运行时（runtime）→ 基础设施（infra）**；命令向下、事件向上。

**线程模型**：单一“监督引擎”线程（250ms 定节奏 tick，非阻塞 `try_recv` 批处理命令）+ 事件线程 + 每子进程两条泵读线程 + 回收线程。**零异步运行时**（纯 std `thread` + `mpsc`）。Qt 侧每 250ms 主动拉取快照（4Hz），按字段级 diff 只更新变化卡片。

---

## 📁 数据目录（便携）

```
<exe 所在目录>\
├─ taskwarden.exe
└─ data\
   ├─ config.toml           # 任务与全局设置（原子落盘：临时文件 → rename）
   └─ logs\
      ├─ <任务名>.log        # 每任务追加日志（500ms 节流，ERR/WARN 即时刷；仅保留最近 3 天）
      └─ app.log             # 程序自身诊断日志（engine AppLogger）
```

> 首启若 `data\config.toml` 不存在，会自动从旧版 `%APPDATA%\TaskWarden\config.toml` 一次性迁移（保留旧文件可回退）。
> `logs\` 目录名可在 `config.toml` 的 `settings.log_dir` 覆写（支持绝对路径）。

---

## 🖥 界面

Qt 桌面版为深色主题（QPalette + 有限 QSS）：顶部资源栏（CPU 迷你曲线 / 内存 / GPU / 运行时长 / 任务数）、状态徽章任务卡片网格（最多 3 列等分窗口，窄窗口自动降为 2/1 列换行）、QSplitter 实时日志面板、底部全局状态栏。
**点关闭或最小化都直接收进系统托盘**（独立撑满的托盘图标），并释放界面控件 + 修剪工作集（见下方性能）；托盘右键显示 / 退出；二次启动仅激活已有窗口（单实例）。

---

## 🛠 快速开始

### Qt 桌面版（新，主桌面端）

```bash
# 环境：Windows + Qt 6.9.3(msvc2022_64) + CMake 4.4 + MSVC 2022 + Rust 1.98(MSVC)
source scripts/env.sh              # WSL 下：挂载盘符 + 代理 + 工具路径

"$CARGO" build --release --manifest-path engine/Cargo.toml        # Rust 静态库
"$CMAKE" -S desktop -B desktop/build -G "Visual Studio 17 2022" -A x64 \
         -DCMAKE_PREFIX_PATH="D:/ProgramFiles/Qt/6.9.3/msvc2022_64"
"$CMAKE" --build desktop/build --config Release                   # taskwarden.exe
windeployqt --release --no-translations desktop/build/Release/taskwarden.exe

"$CARGO" test --manifest-path engine/Cargo.toml                   # 24 个 Rust 测试（含 ping 解码 e2e）
```

产物：`desktop/build/Release/` 下的 `taskwarden.exe` + Qt DLL（整个文件夹拷走即用，单进程无 WebView2）。

> 官方发布包（GitHub Releases）由 tag 触发 CI 自动构建：`Taskwarden-<tag>-win64.zip`
> 内含 `taskwarden.exe` + Qt DLL + `THIRD_PARTY_NOTICES.md`。若目标机器缺 VC++ 运行库，
> 包内附 `vc_redist.x64.exe`，双击安装后即可运行。

### 落地页 / 交互原型（浏览器）

```bash
npm ci && npm run dev      # 交互原型（mock 数据，端口 1400）
npm run build              # 产出 dist/（GitHub Pages 用）
```

> 旧 Tauri 2 桌面版见 `legacy/tauri` 分支。

首次运行会在 `data\config.toml` 写入 5 个示例任务的种子配置。把任务路径改为本机真实存在的程序后点「启动」，
即可真实拉起进程、绑定 Job Object、跑健康探针、崩溃自动重启 / 熔断。

---

## 🎨 图标资源

应用图标由矢量源生成（需 `npm i -D sharp`，已在 devDependencies）：

```bash
npm run icons      # = gen-icon.mjs + gen-tray.mjs
#   build/app-icon.svg   → desktop/resources/icons/app.ico（256² PNG 负载）
#   build/tray-icon.svg  → desktop/resources/icons/tray.png（64²，托盘/QIcon 用）
```

改图标只需编辑 `build/*.svg` → `npm run icons` → 重新构建桌面端（`.ico` 经 `app.rc` 嵌入 exe）。

> 若资源管理器里 exe 图标看着是旧的，那是 Windows 图标缓存 —— 复制到其他路径或重启 explorer 即显示新图。

---

## 🌐 持续集成 / 部署

- **CI**（`.github/workflows/ci.yml`）：`frontend`（Linux：typecheck + vitest）+ `engine`（Windows：`cargo test --manifest-path engine/Cargo.toml`）。
- **Pages**（`.github/workflows/deploy.yml`）：纯浏览器交互原型部署到 GitHub Pages；
  `vite.config.js` 据 `TAURI_ENV_PLATFORM` 切换 `base`——桌面构建用 `/`（内嵌资源根路径），Pages 用 `/TaskWarden/`（子路径）。

---

## 📄 许可证

- 应用本体：[MIT](LICENSE)
- Qt 6 库：LGPLv3（动态链接，随包发 DLL）—— 见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)
