/* ------------------------------------------------------------------ */
/* lib.rs：TaskWarden 守护引擎（Rust 静态库，经 C ABI 供 Qt 壳调用）      */
/* 分层单向向下：core(调度) → runtime(进程) → infra(基础设施)              */
/* 命令向下、事件向上；零异步运行时（std::thread + std::sync::mpsc）       */
/* 详见 ffi.rs（C ABI 入口，替代 Tauri 版 backend.rs）。                  */
/* ------------------------------------------------------------------ */

// 跨层事件协议 / 配置模型含若干为扩展预留的字段与变体，统一放行 dead_code
#![allow(dead_code)]

pub mod core;
pub mod ffi;
pub mod infra;
pub mod runtime;

/// 引擎版本号（冒烟：验证 staticlib 能被 MSVC 链接）
#[no_mangle]
pub extern "C" fn tw_engine_version() -> i32 {
    1
}
