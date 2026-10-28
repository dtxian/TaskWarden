---
status: draft
date: 2026-10-29
updated: 2026-10-29
owner: AI
related: [00-现状基线.md, 02-迁移方案.md, 03-风险与待决.md]
sources:
  - https://github.com/qiu7824/zsui (访问 2026-10-29)
  - https://crates.io/crates/zsui (访问 2026-10-29)
---

# 01 · ZSUI 框架评估

> 评估对象：`qiu7824/zsui`，评估时 crate 版本 **0.3.0-alpha.2**。
> ZSUI 处于 alpha，下列任何数字与能力都可能在下个版本改变；本文所有结论都带
> 数据来源与验证状态。

---

## 1. 项目画像（可核对事实）

`[事实]`

| 项目 | 数据 | 来源 |
|---|---|---|
| 仓库创建 | 2026-07-08 | GitHub API `/repos/qiu7824/zsui` |
| 最近推送 | 2026-10-28 | 同上 |
| 提交数 | 621 | GitHub API commits 分页末页 |
| Star / Fork / Open issues | 171 / 6 / 4 | GitHub API |
| 贡献者 | `qiu7824` 446、`github-actions[bot]` 165、`claude` 10 | GitHub API |
| 许可证 | **MPL-2.0** | `Cargo.toml`、`LICENSE` |
| crates.io 下载量 | **104**（累计） | crates.io API |
| 最新发布 | `0.3.0-alpha.2`，**2026-10-26** | crates.io API |
| 仓库规模 | 777 个文件，`docs/` 约 50 篇中英双语文档 | GitHub tree |
| 形态 | 单 crate（`src/` 下按模块分文件） | `Cargo.toml` |

`[推断]` 这是一个**单人主导、4 个月、极新、迭代极快**的项目。工程纪律看起来很强（CI 跑真实窗口截图、UIA/IME 验证、性能矩阵、cargo-semver-checks），但 bus factor = 1，且预发布版本不承诺兼容。

> 注意一处文档漂移：`docs/api-stability.md` 标题与正文仍写「0.2」，而 crate 已是 `0.3.0-alpha.2`；GitHub Releases 最新标签是 `v0.2.0-preview.7`（2026-08-08），crates.io 才有 0.3.0-alpha.2。说明**发布记录与文档并非每版同步**，依赖前要以源码为准。

---

## 2. 设计与运行模型

`[事实]`

```
State → view(&State) -> Element<Message> → 用户操作产生 Msg → update(&mut State, Msg)
                                      ↑
                  后台线程：InvalidationHandle::request_rebuild()
```

- **保留式（retained）原生控件**：ZSUI 自己绘制控件，但使用真实系统窗口（Win32 / AppKit / GTK4 / Linux Direct）。
- **强类型消息 + 稳定 WidgetId**：列表重排、跨组件操作需显式 ID。
- **零异步运行时**：后台线程只改应用状态，再请求重建；与 TaskWarden 现有 `std::thread + mpsc` 模型天然契合。
- **平台体验档案**：字体、间距、控件几何、图标由平台 profile 决定；应用代码不选 WinUI/AppKit 样式枚举。

`[事实]` Windows 后端：Win32 窗口 + 缓冲 GDI/GDI+ 绘制；文字可选 GDI / DirectWrite / 自带 Rust 文字引擎（cosmic-text + Harfrust/Swash），默认 `windows-rust-text`。系统集成覆盖 IME、UIA、剪贴板、文件面板、菜单、托盘。

`[事实]` 组件：47 个组件家族有运行实现，但成熟度分层（ready / first_pass / contract_only / not_started），且 `src/component_catalog.rs` 为每个组件列出明确缺口（如 virtual-list 缺可变行高与非 Windows 冒烟、toast 缺无障碍播报、navigation 缺自适应折叠等）。

---

## 3. API 稳定性：一定要看清「stable 面」有多小

`[事实]` `zsui::prelude` 只重导出 `zsui::stable`。`stable` 当前包含：

| 类别 | 内容 |
|---|---|
| 布局 | `column` / `row` / `spacer`，`Element` 的 padding/gap/width/height/flex/justify/align |
| 基础控件 | `text` / `button` / `textbox` / `toggle` |
| 稳定控件（`stable_controls.rs`） | `icon` / `icon_button` / `toolbar_button` / `navigation_view` / `navigation_item` / `split_panel` / `data_grid`（列定义、排序、列宽调整、行选择） |
| 窗口 | `window()` builder：size / min_size / resizable / **decorations(bool)** / **custom_title_bar(bool)**（需 `window-chrome`）/ always_on_top / transparent / icon_path / release_view_when_hidden / invalidation_handle / stateful |
| 对话框 | 文件、保存、目录、消息对话框的强类型 spec |
| 滚动 | `Element::auto_scroll_y()`（需 `scroll` feature） |

`[事实]` **不在 stable 面**、只能用 crate 根兼容接口（无 semver 承诺）的能力：

- 托盘 `TraySpec` / 菜单（feature `tray` / `menu`）
- 主题 `ZsuiTheme` 与 dark / high-contrast
- `toast` / `info_bar` / `flyout` / `context_menu` / `tooltip`
- `list` / `virtual-list` / `tree` / `grid_view`
- `canvas`（自绘 sparkline / 彩色日志）
- 本地化（Fluent）
- 热键、剪贴板、设置页

`[推断]` 对 TaskWarden 这种「托盘 + 深色主题 + 日志列表 + sparkline」的应用，**必然要踩非 stable 面**。这意味着 0.x 期间的升级适配不可避免，不能把「stable 承诺」当作护城河。

---

## 4. 逐项能力对照（针对 TaskWarden 的真实需求）

| # | TaskWarden 需求 | ZSUI 对应 | 结论 | 依据 |
|---|---|---|---|---|
| 1 | 无黑框派生 / Job Object / 泵读 / 探针 / 熔断 / DAG | 纯 Rust，原样复用 | ✅ 零改动 | 现有 `core/` `runtime/` `infra/` 无 Tauri 依赖 |
| 2 | 250ms 引擎 tick + 4Hz 状态刷新 | 引擎线程 + `InvalidationHandle::request_rebuild()` | ✅ 模型契合 | `stable.rs` `InvalidationHandle` |
| 3 | 系统托盘（左键恢复、右键菜单、退出） | `tray` feature + `TraySpec` + 菜单 | ⚠️ 非 stable API | `src/tray.rs` |
| 4 | 自绘无边框标题栏、拖动、最小化/最大化/关闭 | `decorations(false)` + `custom_title_bar(true)` | ⚠️ 需实测拖动/命中区/DPI | `stable.rs` WindowBuilder |
| 5 | 深色 + 橙色品牌视觉 | `ZsuiTheme` 颜色 token（surface/text/accent/success/warning/danger） | ⚠️ 只能换 token，不能任意 CSS/渐变/阴影 | `src/style.rs` |
| 6 | 任务卡片网格、状态色条、脉冲动画、错误闪框 | 基础布局 + Canvas 自绘；无卡片/动画组件 | ⚠️ 视觉降级或高成本自绘 | 组件目录无 card/动画 |
| 7 | Sparkline（CPU/GPU 历史） | `ZsCanvasPrimitive`（fill_rect / round_fill / text / glyph） | ✅ 可自绘 | `src/canvas.rs` |
| 8 | 200 行日志、分级着色、自动滚动、复制/清空 | `Canvas` 的 `colored_text` / `text_run`，或 `virtual-list` | ⚠️ 非 stable；可变行高是已知缺口 | `canvas.rs`、catalog gaps |
| 9 | 拖拽调整日志高度 + 持久化 | `split_panel` + `on_resize` | ✅ | `stable_controls.rs` |
| 10 | 任务表单、数值、下拉、复选框、依赖成环禁用 | `textbox` / `number-box` / `combo` / `checkbox` 等（非 stable 部分） | ✅ 但校验逻辑要自己写 | feature 列表 |
| 11 | 确认对话框 / 关闭询问 | `dialog` + `DialogButtons` | ✅ stable | `stable.rs` |
| 12 | Toast 通知 | `toast` feature | ⚠️ 非 stable；缺多队列/无障碍播报（已知缺口） | catalog gaps |
| 13 | 单实例（二次启动激活已有窗口） | **无内置** | ⚠️ 自写 Win32 命名互斥体 + 广播消息 | 全仓库无 single-instance |
| 14 | 中文日志 / IME / 等宽对齐 | Rust 文字引擎支持 CJK/IME；平台契约中定义了 Monospace 字体角色（具体 API 需实机确认） | ⚠️ 必须本机实测 | `docs/platform-design-contracts.md` |
| 15 | 高 DPI（125% / 150%） | Win32 用物理像素 + 窗口 DPI | ⚠️ 需实测 | `docs/app-effects.md` |
| 16 | 无障碍 | UIA / AppKit / AccessKit 桥接 | ✅（Windows 为主） | `docs/ai/reference.md` |
| 17 | 浏览器落地页 / GitHub Pages 演示 | **不支持**：ZSUI 只产原生窗口 | ❌ 必须拆分保留 React | README「真实系统窗口」 |
| 18 | 单文件 exe、无外部 DLL | MSVC 静态链接；无 WebView2 | ✅（需验证 gnu 交叉产物） | `docs/distribution.md` |
| 19 | 代码签名 / 自动更新 | 文档给出 updater 协议与 Inno Setup 模板，但**不内置** | ⚠️ 需自建或不做 | `docs/distribution.md` |
| 20 | 本机 WSL 交叉编译 | 文档只承诺目标平台本地 MSVC 构建 | ⚠️ **高风险未知项** | README「构建环境」 |

---

## 5. 性能数据（厂商自测，非本机实测）

`[事实]` 以下数字来自 ZSUI 官方 `docs/ui-performance-matrix.md` 与 `docs/invoice-tool-comparison.md`，测量环境：Windows NT 10.0.26200、16 逻辑处理器、Rust 1.94、release 构建；启动 5 次取中位数，内存预热 3s 后采样 6 次，Tauri 含 WebView2 子进程。

| 档位 | 框架 | 二进制 | 暖启动首帧 | 页面 RSS | 峰值 RSS | 重绘 CPU |
|---|---|---:|---:|---:|---:|---:|
| Minimal | ZSUI | 0.65 MiB | 52 ms | 11.98 MiB | 14.68 MiB | 0.34% |
| Minimal | Tauri 2 / WebView2 | 2.65 MiB* | 447 ms | 335.74 MiB | 351.35 MiB | 1.01% |
| Common | ZSUI | 0.74 MiB | 80 ms | 12.13 MiB | 17.24 MiB | 1.68% |
| Common | Tauri 2 / WebView2 | 2.65 MiB* | 758 ms | 344.54 MiB | 361.13 MiB | 1.42% |
| Full Native | ZSUI | 1.27 MiB | 65 ms | 18.23 MiB | 18.38 MiB | 0.03% |
| Full Native | Tauri 2 / WebView2 | 2.65 MiB* | 421 ms | 347.27 MiB | 363.90 MiB | 0.97% |

`*` Tauri 二进制不含系统 WebView2 运行时；内存含完整 WebView2 进程树。

`[事实]` 同页「发票工具」对照（同一界面五种实现）：ZSUI 93 行应用代码 / 94 个 Cargo 包 / 12.24 MiB 工作集；Tauri 149 行 / 427 包 / 359.92 MiB 工作集。

`[推断]` 量级差异是真实的（WebView2 进程树无法只在应用进程内优化掉），但**不能直接套到 TaskWarden**：

1. 我们的引擎自身已有约 53MB RSS，ZSUI 只能省掉 WebView2 那部分；
2. 我们的日志（12 任务 × 200 行）比 Minimal/Common 档重得多，4Hz 重建成本未知；
3. 官方文档自己标注部分表格是「候选基线」，未按当前提交重测。

→ 因此 `04-验证清单.md` 把「本机实测」列为硬门禁。

---

## 6. 优点（相对当前 Tauri 2 + React）

1. **单语言单进程**：删掉 IPC、DTO、mock/live 双份语义、`sameTask` memo、`capabilities` 权限文件。
2. **真正单文件**：MSVC 静态链接，无 WebView2 依赖，天然便携。
3. **内存/启动显著更优**：量级差异，且与「轻量级守护器」定位一致。
4. **线程模型同构**：`InvalidationHandle` + 应用自持状态，与现有 supervisor/事件线程几乎一一对应。
5. **工程纪律可参照**：真实窗口 CI、性能矩阵、API 稳定性检查，说明不是玩具。
6. **许可证友好**：MPL-2.0，文件级 copyleft，MIT 应用可直接链接（修改其文件才需公开）。

---

## 7. 风险（相对当前 Tauri 2 + React）

| 风险 | 说明 | 严重度 |
|---|---|---|
| **alpha 兼容性** | 0.3.0-alpha.2 发布于 3 天前；0.x 无兼容承诺；`stable` 面覆盖不到托盘/主题/列表 | 高 |
| **bus factor = 1** | 446/621 提交来自同一人；`claude` 占 10 次；社区仅 171 star、104 下载 | 高 |
| **视觉降级** | 原生语义控件 + 主题 token，无法复刻现有渐变/阴影/脉冲/卡片质感 | 高 |
| **落地页消失** | ZSUI 不能跑浏览器，「同一份前端代码两种身份」叙事结束 | 中 |
| **4Hz 重建成本未知** | 保留式 UI 每 tick 重建 Element 树；日志/卡片密集场景未验证 | 高 |
| **构建链未知** | 官方只承诺目标平台本地构建；WSL Docker + mingw 未验证 | 高 |
| **缺失件要自己写** | 单实例、更新器、部分集合控件编辑/虚拟化 | 中 |
| **MPL 义务** | 若 fork 修补 ZSUI 文件，需公开这些文件的修改 | 低 |
| **生态空白** | 出问题只能读源码/提 issue，没有 StackOverflow 答案 | 中 |

---

## 8. 与其他候选框架的简短对照

> 完整横向对比（含独立实测、硬过滤、评分矩阵、Plan B）见 `05-框架候选对比.md`。下表只保留结论。

| 框架 | 语言/模型 | 成熟度 | 内存量级 | 许可证 | 对本项目的判断 |
|---|---|---|---|---|---|
| **ZSUI** | Rust 保留式原生控件 | 0.3 alpha，4 个月 | ~12–20 MiB | MPL-2.0 | 性能与形态最贴合，但风险最高 |
| egui / eframe | Rust 立即模式 | 成熟（0.3x） | ~100 MiB | MIT/Apache | 快，但 CJK/IME/无障碍弱，内存不比 WebView 好多少 |
| Iced | Rust Elm 式 | 较成熟 | ~20 MiB | MIT | 可行，控件与文本能力需再评估 |
| Slint | `.slint` 声明式 | 成熟 1.x | ~20–25 MiB | GPL/商业（静态链接有法务摩擦） | 体验好，但许可证对 MIT 项目不友好 |
| Tauri 2（现状） | Web + Rust | 成熟 | 330–365 MiB 全树 | MIT/Apache | 视觉/生态最强，重量最大 |

`[推断]` 若目标是「保留自定义视觉 + 网页 demo」，留在 Tauri 是理性的；若目标是「真正的轻量单文件 Windows 工具」，ZSUI 是目前最贴合的候选，但必须用 Spike 换确定性。

---

## 9. 结论

`[推断]`

1. **值得试，但不值得立刻全量迁移。**
2. 先用 2 周时间盒 Spike 验证 10 个硬门禁（见 `04`），其中「交叉编译」「4Hz 重建」「托盘+自定义标题栏」「中文日志」「体积/进程数」任一失败，即判定 No-Go。
3. Go 之后采用「`crates/core` 原样复用 + `crates/app` 新 UI + `web/` 保留落地页」的结构，而不是在现有仓库里原地改。
4. 无论 Go/No-Go，都建议先把落地页拆成独立 `web/`，这一步对两种结局都有收益。

---

## 10. 针对本项目的具体坑（源码核对，2026-10-29）

> 这一节只列**会真的咬到 TaskWarden** 的坑，均已对照 ZSUI 源码/文档；
> 标 `[待验证]` 的必须进 Spike。结论：功能能做出来，但「原样搬」不行。

| # | 坑 | 证据 | 后果 | 绕法 / 代价 |
|---|---|---|---|---|
| K1 | 托盘/窗口图标只能从**磁盘文件路径**加载 | `WindowsWin32OwnedIcon::from_icon_path` → `LoadImageW(..., LR_LOADFROMFILE)`；`TraySpec.icon_path: Option<String>` | 单文件 exe 没有图标可加载，托盘空白 | 启动时把 `include_bytes!` 的图标写到 `data/` 或 `%TEMP%` 再传路径；或改 ZSUI（MPL 义务） |
| K2 | **关闭到托盘 / 拦截关闭**不在 stable 面 | `on_close_requested()` 只在 legacy `NativeWindowBuilder`；`stable::WindowBuilder` 无此方法 | 点 × 直接退出，守护中断 | 用 non-stable builder；并接受 0.x 升级适配 |
| K3 | **隐藏/显示窗口**不在 stable 面 | `try_window_command(Show/Hide)` 在 `AppCx`（crate root），`stable::UpdateContext` 只有 `quit()` 和对话框 | 最小化到托盘无法实现 | 同上：走 non-stable `window_chrome` |
| K4 | **单实例没有内置**，且没有公开 HWND | 全仓库无 single-instance；没有 `hwnd()`/`raw_window_handle` 公共 API | 二次启动会开第二个窗口 | 自建：命名互斥体 + 消息专用窗口/命名管道；再用 `FindWindowW`（按 ZSUI 窗口类名+标题）或自定义消息让首实例 `Show` |
| K5 | **stable 的 `text()` 没有颜色/字体/字号 API** | `stable::Element` 只有 id/padding/gap/size/flex/align/on_click/... | 日志 ERR/WARN/INFO 三色、等宽对齐做不了 | 用 Canvas `colored_text` / `text_run`（有 `TextRole::Monospace`、`TextWrap::Word`、显式颜色/字号）；代价：不可选中、无读屏 |
| K6 | **没有卡片/徽章/状态条/动画组件** | 组件目录无 card/badge；无动画 API | 现有卡片质感、脉冲点、错误闪框、hover lift 全部消失 | Canvas 自绘（V2/V3）；或接受原生质感（V1） |
| K7 | **主题只有 token**，不能任意 CSS | `ZsuiTheme` 只有 surface/text/accent/success/warning/danger 等语义色 | 深色+橙色可做，渐变/阴影/圆角/毛玻璃不行 | 接受「原生+品牌色」；或 Canvas 画底 |
| K8 | 高对比度模式会覆盖显式颜色 | `TextRun.color` 在 high-contrast 下回退 `style.color` | 日志三色在系统高对比度下失效 | 可接受；或提供非颜色标记（前缀/图标） |
| K9 | **4Hz 全量重建成本未知** | `view(&State)` 每次重建整棵 Element 树；官方只测 60Hz 小页面 | 12 卡 + 200 行日志可能 CPU 偏高/输入顿 | 引擎 4Hz、UI 降到 1–2Hz；日志按 generation 只重建选中任务；`[待验证]` |
| K10 | 字体/密度走平台度量（WinUI 风格） | 平台体验档案决定字体、间距、控件几何 | 当前 9–13px 紧凑排版会被拉大 | 显式 Dp/Canvas；或接受更「原生」的密度 |
| K11 | 没有 UI 级测试框架 | ZSUI 只有框架内部的 native smoke/screenshot proof | 现有 9 个 TS 测试里的交互/4Hz 行为测试作废 | 纯逻辑抽到 Rust 单测；UI 靠手工冒烟 + 截图对比 |
| K12 | 文档漂移 + non-stable 面大 | `docs/api-stability.md` 仍写 0.2，crate 是 0.3.0-alpha.2；托盘/主题/Canvas/Toast/List/Localization 全在 crate root | 升级即可能编译失败 | 锁 `=0.3.0-alpha.2`；所有调用收敛到 `ui_facade.rs`；升级单独排期 |
| K13 | 官方只保证目标平台 MSVC 构建 | README「构建环境」；无 `x86_64-pc-windows-gnu` 承诺 | WSL 交叉构建可能失败 | Spike G1；退路 Windows runner / 本机 MSVC |
| K14 | 体积/`panic` 约束 | Rust 文字 +1.6MiB；`panic="abort"` 会破坏 supervisor 的 `catch_unwind` | 体积或可靠性二选一 | 12MiB 预算内用 `opt-level=3`；保留 `panic=unwind` |
| K15 | 中文/IME/DPI 需实机验证 | 官方称 CJK/IME 已覆盖，但候选窗/读屏仍需人工检查 | 乱码/候选窗错位/125% 模糊 | Spike G5/G4；保留现有 `decode_line` |

**一句话**：ZSUI 能做出这个产品，但托盘图标、关闭拦截、单实例、彩色日志、卡片动效这五件事都得我们自己补或让步；这五项也正是 Spike 要盯死的部分。
