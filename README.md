# TaskWarden

> 轻量级后台任务守护监督器 · Windows 专用 · **Rust 引擎 + Tauri 2 壳 + React 界面**

常驻系统托盘守护后台任务：**静默启动、进程树管控、熔断重试、DAG 依赖级联、健康探针、实时日志**。
纯 std 线程 + mpsc 的 Rust 监督内核，配高保真 React（WebView2 渲染）界面，**单文件 exe、便携数据目录**。

<p align="center">
  <a href="https://dtxian.github.io/TaskWarden/"><img src="https://img.shields.io/badge/在线演示-GitHub%20Pages-blue?logo=github" alt="在线演示"></a>
  <img src="https://img.shields.io/badge/platform-Windows-0078d6?logo=windows" alt="Windows">
  <img src="https://img.shields.io/badge/backend-Rust%20%7C%20Tauri%202-orange?logo=rust" alt="Rust/Tauri">
  <img src="https://img.shields.io/badge/frontend-React%20%7C%20Vite-61dafb?logo=react" alt="React/Vite">
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
- **单文件 + 便携**：不产出安装程序；配置与日志落在 exe 同级的 `data\` 目录，整个文件夹拷走即用

---

## 🏗 架构

**前端（React）与后端（Rust）解耦，经 Tauri IPC（`invoke` 命令 + 事件流）通信。**

```
├─ src/                      # Web 前端（React + Vite + Tailwind，跑在 WebView2）
│  ├─ sim/useSimulator.ts    #   数据层双路径：Tauri 下 invoke+listen，浏览器下本地 mock（语义对齐后端）
│  └─ components/sim/        #   主窗口 / 任务卡片 / 日志面板 / 编辑弹窗
│
└─ src-tauri/                # Rust 后端（Tauri 2，含系统托盘）
   ├─ src/backend.rs         #   对接层：Tauri command + snapshot/log-event/notice 推送 + 托盘
   ├─ src/core/              #   核心调度：监督器状态机 / DAG / 熔断 / 健康探针 / 事件协议
   ├─ src/runtime/           #   进程运行时：静默派生 + 编码解码 / Job Object / 停止回收
   └─ src/infra/             #   基础设施：便携 config.toml / 定容 Ring Buffer + 落盘 / NVML 采样
```

依赖单向向下：**表示层 → 核心调度 → 进程运行时 → 基础设施**；命令向下、事件向上。

**线程模型**：单一"监督引擎"线程（250ms 定节奏 tick，非阻塞 `try_recv` 批处理命令）+ 事件线程 + 快照线程（4Hz，窗口隐藏时跳过）+ 每子进程两条泵读线程 + 回收线程。**零异步运行时**（纯 std `thread` + `mpsc`）。

---

## 📁 数据目录（便携）

```
<exe 所在目录>\
├─ taskwarden.exe
└─ data\
   ├─ config.toml           # 任务与全局设置（原子落盘：临时文件 → rename）
   └─ logs\
      ├─ <任务名>.log        # 每任务追加日志（BufWriter 500ms 节流，ERR/WARN 即时刷）
      └─ app.log             # 程序自身诊断日志（tauri-plugin-log）
```

> 首启若 `data\config.toml` 不存在，会自动从旧版 `%APPDATA%\TaskWarden\config.toml` 一次性迁移（保留旧文件可回退）。
> `logs\` 目录名可在 `config.toml` 的 `settings.log_dir` 覆写（支持绝对路径）。

---

## 🖥 界面

桌面版无系统标题栏（自绘深色极客风窗口）：顶部资源栏（CPU / 内存 / GPU 迷你曲线）、状态徽章任务卡片网格、
可拖拽调高的实时日志面板、右下角全局状态栏；关窗最小化到系统托盘（**独立撑满的托盘图标**，小尺寸下清晰），托盘右键显示 / 退出。

---

## 🛠 快速开始

```bash
# 1) 安装依赖
npm install

# 2) 开发模式（桌面窗口：起 vite + 增量编译 Rust）
npm run tauri dev

# 3) 打包（仅产出单文件 exe，无安装程序）
npm run tauri build
#    → src-tauri/target/release/taskwarden.exe

# 4) 纯浏览器预览交互原型（端口 1400，跑 mock 数据）
npm run dev

# 5) 测试与类型检查
npm test          # 前端纯函数单测（vitest）
cargo test --manifest-path src-tauri/Cargo.toml   # 后端（含真进程 ping 解码 e2e）
npm run typecheck
```

首次运行会在 `data\config.toml` 写入 5 个示例任务的种子配置。把任务路径改为本机真实存在的程序后点「启动」，
即可真实拉起进程、绑定 Job Object、跑健康探针、崩溃自动重启 / 熔断。

---

## 🎨 图标资源

应用图标由矢量源生成（需 `npm i -D sharp`，已在 devDependencies）：

```bash
node build/gen-icon.mjs          # build/app-icon.svg → 1024² PNG
npx tauri icon build/app-icon.png # 生成 src-tauri/icons 全套（.ico/.png/.icns/…）
node build/gen-tray.mjs          # build/tray-icon.svg → 撑满画布的托盘专用 PNG
```

改图标只需编辑 `build/*.svg` 后重跑上述命令并重新 `tauri build`。

> 若资源管理器里 exe 图标看着是旧的，那是 Windows 图标缓存 —— 复制到其他路径或重启 explorer 即显示新图。

---

## 🌐 持续集成 / 部署

- **CI**（`.github/workflows/ci.yml`）：`frontend`（Linux：typecheck + vitest）+ `backend`（Windows：`npm run build` 产出 dist 供 `generate_context!` 内嵌，再 `cargo test`）。
- **Pages**（`.github/workflows/deploy.yml`）：纯浏览器交互原型部署到 GitHub Pages；
  `vite.config.js` 据 `TAURI_ENV_PLATFORM` 切换 `base`——桌面构建用 `/`（内嵌资源根路径），Pages 用 `/TaskWarden/`（子路径）。

---

## 📄 许可证

[MIT](LICENSE)
