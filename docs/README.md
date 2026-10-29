# 文档索引

面向使用者的说明在根目录 [README](../README.md)；这里是面向**贡献者**的工程文档。

| 文档 | 内容 | 什么时候看 |
|---|---|---|
| [architecture.md](architecture.md) | 分层、线程模型、C ABI 边界、核心语义常量与不变式、Windows 实现要点、已知坑 | 动 `engine/` 或 `desktop/` 之前 |
| [migration.md](migration.md) | 从 Tauri 2 迁到 Qt 6 的过程、里程碑、实测数字、遗留项 | 想知道「为什么现在是这个形态」 |
| [adr/](adr/) | 架构决策记录（ADR） | 想改掉某个架构决定前，先看当初的理由与复议条件 |
| [../THIRD_PARTY_NOTICES.md](../THIRD_PARTY_NOTICES.md) | 第三方许可（Qt LGPLv3、Rust crates） | 分发/改许可前 |

## 约定

- 文档与被描述的代码**同一次提交**更新；不允许「代码改了文档没改」。
- 关键结论标注 `[实测]` / `[事实]` / `[推断]`，数字要能在源码或命令输出里复现。
- 决策变更走新的 ADR，不要直接改写已接受的 ADR（在其末尾追加「后续」链接）。
