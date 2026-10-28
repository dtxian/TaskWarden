# THIRD_PARTY_NOTICES

TaskWarden Qt 桌面版（`desktop/`）与 Rust 引擎（`engine/`）使用的第三方组件及其许可。

---

## Qt 6（LGPLv3 / GPLv3 / 商业授权三选一）

- 组件：Qt 6.9.3（QtCore / QtGui / QtWidgets / QtNetwork）
- 用途：桌面端用户界面（窗口、托盘、控件、本地套接字）
- 许可：GNU Lesser General Public License v3（LGPLv3）
- 链接方式：**动态链接**（`windeployqt` 部署 Qt DLL 随包分发，未静态链接，履行 LGPL 义务）
- 源码获取：https://www.qt.io/download-open-source

TaskWarden 应用自身保持 MIT 许可；Qt 库按 LGPLv3 分发。用户可替换 Qt DLL（如自行编译或升级），满足 LGPL 的再链接要求。

---

## Rust 生态（Rust 引擎 `engine/`）

| 组件 | 版本 | 用途 | 许可 |
|---|---|---|---|
| serde | 1.x | 序列化框架 | MIT / Apache-2.0 |
| serde_json | 1.x | JSON 解析/生成 | MIT / Apache-2.0 |
| toml | 1.x | config.toml 解析 | MIT / Apache-2.0 |
| thiserror | 2.x | 错误类型派生 | MIT / Apache-2.0 |
| log | 0.4 | 日志门面 | MIT / Apache-2.0 |
| windows | 0.62 | Win32 原生 API 绑定 | MIT / Apache-2.0 |
| nvml-wrapper | 0.12 | NVIDIA GPU 采样 | MIT |

完整依赖树与精确版本见 `engine/Cargo.lock`。上述 crate 均为 MIT 或 MIT/Apache-2.0 双许可。

---

## 构建工具链（不随包分发）

- MSVC 2022（编译 C++/Rust）
- CMake 4.4（构建系统）
- Rust 1.98（引擎编译）

---

## 图标

- `desktop/resources/icons/app.ico`、`tray.png`：TaskWarden 项目自有图标（来源 `src-tauri/icons/`），随项目 MIT 许可分发。
