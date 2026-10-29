# 架构与不变式

> 面向贡献者。改动 `engine/` 或 `desktop/` 之前请通读「核心语义」与「已知坑」两节。
> 决策背景见 [migration.md](migration.md) 与 [ADR-0001](adr/0001-desktop-shell-qt-and-c-abi.md)。

---

## 1. 一句话形态

**单进程** Windows 桌面应用：Qt 6 Widgets（C++20）做外壳，Rust 引擎编译成静态库经 **C ABI** 链进同一进程。
没有 WebView2、没有 IPC 进程、没有异步运行时。

```
┌────────────────────── Qt 6 Widgets（C++20） ──────────────────────┐
│ MainWindow / TaskCard / LogPanel / TaskDialog / 托盘 / 单实例      │
│        │  EngineClient：QTimer 轮询（可见 500ms、托盘 2000ms）      │
│        ▼                                  ▲ 用户操作（0/-1/-2）    │
│  UTF-8 字符串 + JSON（QJsonDocument）                              │
└───────────────────────────────────────────┼───────────────────────┘
                                            │ extern "C"
┌──────────────────── Rust 静态库（staticlib）┼─────────────────────┐
│ ffi.rs：catch_unwind + last_error + try_send                      │
│   ├─ Command 有界队列(256) ──► supervisor（250ms tick，唯一状态机） │
│   ├─ Event 通道 ──► 通知队列（tw_notices_json 取走并清空）          │
│   └─ SharedState（读写锁）──► tw_snapshot_json                     │
│ core/（调度） runtime/（进程） infra/（配置·日志·采样）              │
└────────────────────────────────────────────────────────────────────┘
```

## 2. 分层（单向依赖，不可反向）

| 层 | 目录 | 职责 | 约束 |
|---|---|---|---|
| ① 表示层 | `desktop/` | 窗口、卡片、日志、表单、托盘 | 只经 `EngineClient` 访问引擎；不跨线程碰 Rust 数据 |
| ② 核心调度 | `engine/src/core/` | 状态机、DAG、熔断、健康探针、事件协议 | 不得反向依赖 ①；不得做阻塞 IO |
| ③ 进程运行时 | `engine/src/runtime/` | 静默派生 + 泵读解码、Job Object、停止回收 | 只依赖 ④ |
| ④ 基础设施 | `engine/src/infra/` | config.toml、Ring Buffer、CPU/GPU 采样 | 零业务依赖，可独立单测 |

`ffi.rs` 是 ①↔②③④ 的唯一通道。

## 3. 线程模型

**零异步运行时**：只用 `std::thread` + `std::sync::mpsc`（无 tokio）。新增并发请沿用。

| 线程 | 数量 | 节奏 / 触发 | 说明 |
|---|---|---|---|
| supervisor | 1 | **250ms 固定 tick**；`recv_timeout` + `try_recv` 排空命令 | 唯一状态机推进者；循环体整体套 `catch_unwind`，单次 panic 不杀线程 |
| events | 1 | 阻塞 `recv` | 把 `Event` 映射成通知（启动失败/熔断/意外退出）入队，等 C++ 拉取 |
| pump | 每子进程 ×2 | 逐字节读 `BufReader` | stdout/stderr 行缓冲，防止子进程写满管道被阻塞 |
| probe | 短命 ×N | tcp / http 探针 | 结果经 `Command::ProbeDone` **回灌引擎线程** |
| reaper | 短命 ×N | 停机回收 | graceful 轮询 → `taskkill /T /F` → `TerminateJobObject` → `Command::StopDone` |

> 历史 bug 的高发类别是**「在引擎线程里做阻塞操作」**。规则：任何毫秒级以上工作（网络、等待进程退出、taskkill）都必须丢给线程，或在 tick 内非阻塞推进，再用回灌命令把结果交还引擎。
> `ready` 探针就是据此从「线程版」改成「tick 内消费 stdout」的（见 `supervisor.rs::ReadyWait` 注释）。

指标采样（CPU/内存/GPU）挂在 supervisor 的 **每 4 tick = 1s**（`METRICS_EVERY_TICKS`），不与 4Hz 状态机同频——采样本身较贵。

## 4. C ABI 边界（`engine/src/ffi.rs` ↔ `desktop/src/twengine.h`）

- **只有 UTF-8 字符串与 JSON 跨边界**，不传结构体、不传回调；`char*` 由调用方 `tw_free_string`。
- 每个入口 `catch_unwind`：panic → 写 `last_error` → 返回 `-1`，**绝不让 panic 跨 FFI**（因此 release 必须保留 `panic = "unwind"`，不能用 `panic = "abort"`）。
- 命令用 `try_send`（有界队列 256）：队列满返回 `-2`、引擎未就绪返回 `-1`，**不阻塞 UI**。
- 出参 DTO 一律 **camelCase**（`#[serde(rename_all="camelCase")]`），与落地页 `src/sim/useSimulator.ts` 的字段同名；入参 `TaskConfig` 一律 **snake_case**。`ffi.rs::snapshot_serializes_camel_case` 测试专门拦这个漂移。
- 边界设计理由（为什么静态库/为什么轮询/为什么有界队列）见 [ADR-0001](adr/0001-desktop-shell-qt-and-c-abi.md)。

## 5. 核心语义常量（改值即改产品行为，务必同步文档）

| 常量 | 值 | 位置 |
|---|---|---|
| `TICK` | 250ms（状态机节奏） | `core/supervisor.rs` |
| `METRICS_EVERY_TICKS` | 4 tick = **1s**（CPU/内存/GPU 采样） | `core/supervisor.rs` |
| `PROBE_EVERY_TICKS` | 20 tick（≈5s 重探） | `core/supervisor.rs` |
| `READY_TIMEOUT` | 10s | `core/supervisor.rs` |
| `PROBE_TIMEOUT` | 2s（单次 tcp/http） | `core/supervisor.rs` |
| `MIN_STABLE_LIFETIME` | 5s | `core/supervisor.rs` |
| 熔断窗口 / 阈值 | 60s / 3 次 | `infra/config.rs` |
| 退避 | `2^min(attempt,6)` 秒 → 2,4,8,…,64s 封顶 | `core/breaker.rs` |
| `LOG_CAP` | 200 行/任务（内存环） | `infra/logbuf.rs` |
| `LOG_RETENTION_DAYS` | 3 天（启动 + 每小时清理） | `infra/logbuf.rs` |
| 落盘节流 | 500ms（ERR/WARN 即时刷，`BufWriter` 8KB） | `infra/logbuf.rs` |
| `CREATE_NO_WINDOW` | `0x0800_0000` | `runtime/process.rs` |
| 泵读分段 | 无换行超 64KB 强制切段 | `runtime/process.rs` |
| 命令队列容量 | 256（满则 `-2`） | `core/supervisor.rs` |
| Qt 轮询 | 可见 500ms / 托盘 2000ms | `desktop/src/EngineClient.cpp` |

状态机：`Stopped → Starting → Running → (Backoff ⇄) → Fused`，字符串化为 `stopped/starting/running/backoff/fused`（Qt 侧同名，见 `Format.h::stateRank`）。

## 6. 十条必须保持的行为语义

1. **`always` 策略下 code-0 且存活 < 5s** → 按「崩溃循环」计入熔断退避（`clean_exit_action`），杜绝「秒退秒拉」死循环。
2. 失败路径：`strategy==never` → 直接 Stopped 不计数；否则 `Breaker::record_failure` → `Backoff(2^n)` 或 `Trip`（Trip 清空计数、置 fused、需手动 `reset_breaker`）。
3. `Restart` = 有存活进程则先移交 reaper，收到 `StopDone` 后再启动（避免端口/文件竞争）；无存活进程则立即启动。
4. `StartAll` 用**拓扑分层**（同层并发），`StopAll` 用**反拓扑序**；`start()` 里若依赖未运行会先递归启动上游。
5. 上游 `Stopped` → 级联 `terminate` 下游；上游 `Fused` → 只向运行中的下游发 WARN 通告，**不**级联停止。
6. 首次派生**不计**「重启」（`has_spawned` 标志），与落地页 mock 端语义对齐。
7. 日志单一入口 `emit_log()`：环缓冲（含落盘）与 `Event::Log` **必须同源**，否则「日志面板」与「回看接口」内容分叉（有测试）。
8. `clear_logs` 只清内存环，`logs/<name>.log` 文件保留供审计。
9. `shutdown` 路径用**同步**终结（引擎线程随即退出，不能交给 reaper；Job Drop 只是最后兜底）。
10. 故障注入 `set_fault_inject(true)` 让**下一次** spawn 假失败，走完整反馈链（托盘通知 + 卡片红框 + 熔断/退避），一次性后自动复位。

## 7. Windows 实现要点（易踩）

- **启动器适配**：`exe` 直派生；`bat/.cmd` → `cmd /c`；`ps1` → `powershell -NoProfile -ExecutionPolicy Bypass -File`。
  `TaskView::command_line()`（Rust）、`Args.h::buildCommandText()`（Qt）、`buildCommand()`（TS）是同一逻辑的**三份**实现，改一处要改三处。
- **`%VAR%` 展开**：`expand_env` 支持 `%SystemRoot%` 之类；变量不存在则原样保留。裸命令名（无路径分隔符）走 PATH 搜索。
- **编码**：逐行解码——**严格 UTF-8 优先 → 失败回退 OEM 代码页（中文系统 CP936/GBK）→ 再 lossy**。行边界天然安全（GBK 尾字节 ≥0x40、UTF-8 续字节 ≥0x80，`\n` 不会落在多字节内部）。`ping` 的 e2e 测试是这条链路的契约。
- **stderr 分级启发** `classify_stderr`：错误关键字→ERR，warn/deprecated→WARN，`info/debug/listening/loading/started`→INFO，**无线索保守为 WARN**。有真实 llama.cpp 样本单测——不要把 stderr 一律标红。
- **Job Object**：命名 `Global\TaskWarden_<pid>`（失败退化匿名）+ `KILL_ON_JOB_CLOSE`；绑定失败只 WARN，不中断启动。主进程被 `taskkill /F` 时子进程随 Job 级联回收（[实测] 0 残留）。
- **taskkill 退出码非零属预期**（进程已不存在），不当错误处理。
- **原子落盘**：写 `config.toml.tmp` → `remove_file` → `rename`（Windows 上 rename 到已存在目标会失败，必须先删）。
- **便携目录**：`<exe 目录>\data\{config.toml, logs\<name>.log, logs\app.log}`，由 `current_exe` 决定；首启先尝试从 `%APPDATA%\TaskWarden` **一次性复制迁移**（复制不删，留回退），再不存在则写 5 任务种子。
- **日志文件名净化**：非法字符→`_`；含点的任务名（`Qwen3.8-server`）必须仍以 `.log` 结尾（有测试）。
- **exe 图标**：`desktop/resources/app.rc` 把 `icons/app.ico` 编进 exe（资源管理器/任务栏）；`app.ico` 由 `build/gen-icon.mjs` 生成（自封装 ICO 容器）。托盘用独立的 64px `tray.png`，不要复用带底板的窗口图标。
- **源码字符集**：CMake 必须带 `/utf-8`，否则 MSVC 按 GBK 读源码，中文文案会乱码（C4819 是征兆）。

## 8. 数据目录与日志保留

```
<exe 所在目录>\
├─ taskwarden.exe
└─ data\
   ├─ config.toml          # 任务与全局设置（原子落盘）
   └─ logs\
      ├─ <任务名>.log       # 每任务追加；仅保留最近 3 天
      └─ app.log            # 程序诊断日志
```

「保留 3 天」的实现：启动时 + 每小时（`LOG_PRUNE_EVERY_TICKS`）遍历 `logs\*.log`——最后修改早于 3 天的**整个文件删除**，其余文件**按行首 `[YYYY-MM-DD HH:MM:SS]` 剔除过期行**（含已删任务的孤儿日志）。

## 9. 构建与测试

```bash
# Rust 引擎
"$CARGO" build --release --manifest-path engine/Cargo.toml
"$CARGO" test  --manifest-path engine/Cargo.toml        # 26 个测试（含 ping 解码 e2e）

# Qt 桌面端
"$CMAKE" -S desktop -B desktop/build -G "Visual Studio 17 2022" -A x64 \
         -DCMAKE_PREFIX_PATH="D:/ProgramFiles/Qt/6.9.3/msvc2022_64"
"$CMAKE" --build desktop/build --config Release           # → desktop/build/Release/taskwarden.exe
windeployqt --release --no-translations desktop/build/Release/taskwarden.exe

# C ABI 冒烟（无需 Qt，直接验证引擎）
desktop/build/Release/ffi_smoke.exe <data_dir>

# 落地页 / 原型
npm run typecheck && npm test && npm run build
```

`cargo test` 的 `ping_pipe_decodes_without_mojibake` 会**真的派生 `ping`** 并断言输出无 U+FFFD——它是解码链路的 e2e 契约，不要删。

## 10. 已知坑（动手前先看）

1. **`persist_config()` 重建 `Settings`**：只保留熔断两项，`log_dir` 恒写 `"logs"`、`theme` 恒写 `"dark"`。用户自定义的 `settings.log_dir`（含绝对路径）会在**任何一次增删改任务后**被抹掉（当次运行仍生效，重启后换目录）。
2. **`enabled = false` 的任务会在下一次落盘时静默消失**：`Supervisor::new` 用 `filter(|t| t.enabled)` 加载，`persist_config` 只写回内存里的 `task_configs()`，`TaskView::to_cfg()` 还硬编码 `enabled: true`。要支持禁用任务，这三处得一起改。
3. **自依赖会 panic**：`topo_levels` 的 `indeg -= 1`。`direct_deps()` 过滤了自依赖，但 `dependents()` 没过滤——手改 `config.toml` 写出 `deps=["自身"]` 时 debug 构建整数下溢 panic（被 `catch_unwind` 吞掉，但会导致 `StartAll` 失效）。环依赖本身是安全的（残环追加末层，只以「不死锁」为契约）。
4. **`FailAct::Ok` / `Decision::Ok` 实际不可达**；事件里只有「启动失败 / 熔断 / 意外退出」三类会进通知队列，**界面一律以快照为准**，别以为有事件驱动的增量更新。
5. **`LICENSE` 是 Apache-2.0 全文，而 `Cargo.toml` 写 `license = "MIT"`、README 徽章写 MIT** —— 三者不一致，改许可前必须先跟作者确认（未决事项）。
6. **`src/` 里仍保留 `isTauri` 分支与 `@tauri-apps/api`、`@tauri-apps/plugin-dialog` 依赖**：浏览器演示只走 mock 路径，该分支在 Qt 形态下**已不会激活**。彻底清理需要重构 `useSimulator.ts` 的 live 管线，属独立任务。
7. `scheduler.rs::direct_deps` 注释说「未知依赖忽略并告警」，**实际没有告警**（只 filter）。

## 11. 一致性纪律

改行为 / 常量 / 命令数 / 路径时，**同一次提交**内更新：

- 本文档对应表格、`README.md`、相关文件的顶部框线注释头
- 落地页 `src/data/content.ts`、`src/data/snippets.ts`（模块树、分层、性能数字、代码片段都与实现一一对应）
- TS 与 Rust 的镜像实现与测试（DAG、熔断、`parseArgs`、种子 5 任务互为契约）

纯逻辑一律拆成可单测的函数（`clean_exit_action`、`classify_stderr`、`topo_levels`、`Breaker`、`parse_url`、`format_time`/`civil_from_days`、`decode_line`、`parseArgs`），并用中文注释写清它在防哪个 bug。
