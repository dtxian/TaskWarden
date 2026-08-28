/* ------------------------------------------------------------------ */
/* lib.rs：Tauri 应用入口 —— 单实例 → 后端初始化 → 托盘 → 命令注册          */
/* ------------------------------------------------------------------ */

// 跨层事件协议 / 配置模型含若干为扩展预留的字段与变体，统一放行 dead_code
#![allow(dead_code)]

mod backend;
mod core;
mod infra;
mod runtime;

use infra::config::Config;
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // 应用诊断日志：stdout（开发）+ <exe 目录>\data\logs\app.log（便携持久）
    let app_log = tauri_plugin_log::Target::new(tauri_plugin_log::TargetKind::Folder {
        path: Config::data_dir().join("logs"),
        file_name: Some("app".into()),
    });
    tauri::Builder::default()
        .plugin(
            tauri_plugin_log::Builder::default()
                .level(log::LevelFilter::Info)
                .targets([
                    tauri_plugin_log::Target::new(tauri_plugin_log::TargetKind::Stdout),
                    app_log,
                ])
                .build(),
        )
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            // 第二实例：激活已有主窗口
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.show();
                let _ = w.set_focus();
            }
        }))
        .setup(|app| {
            backend::init(app.handle())?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            backend::list_snapshot,
            backend::start,
            backend::stop,
            backend::restart,
            backend::start_all,
            backend::stop_all,
            backend::crash,
            backend::reset_breaker,
            backend::add_task,
            backend::update_task,
            backend::remove_task,
            backend::set_fault_inject,
            backend::shutdown,
            backend::get_logs,
            backend::clear_logs,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
