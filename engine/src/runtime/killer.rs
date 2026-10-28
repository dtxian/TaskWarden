/* ------------------------------------------------------------------ */
/* killer.rs：优雅停止超时 → taskkill /T /F 兜底                          */
/* 停止 = 终结整棵进程树；exe 可配优雅关闭窗口，超时后强杀                 */
/* ------------------------------------------------------------------ */

use std::process::{Child, Command};
use std::time::{Duration, Instant};

/// 优雅停止：在 grace 窗口内等待进程自然退出。
/// 返回 true = 进程已退出；false = 超时，需强制兜底。
pub fn graceful_stop(child: &mut Child, grace: Duration) -> bool {
    let deadline = Instant::now() + grace;
    loop {
        match child.try_wait() {
            Ok(Some(_)) => return true,
            Ok(None) => {}
            Err(_) => return false,
        }
        if Instant::now() >= deadline {
            return false;
        }
        std::thread::sleep(Duration::from_millis(50));
    }
}

/// taskkill /T /F /PID —— 终结整棵进程树（含孙进程）。
/// 进程不存在时 taskkill 返回非零，属预期，不视为错误。
pub fn force_kill_tree(pid: u32) -> std::io::Result<()> {
    Command::new("taskkill")
        .args(["/T", "/F", "/PID", &pid.to_string()])
        .status()?;
    Ok(())
}
