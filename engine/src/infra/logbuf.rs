/* ------------------------------------------------------------------ */
/* logbuf.rs：每任务一个定容 Ring Buffer（默认 200 行）供 GUI 实时回看，   */
/* 同时追加写入 logs/<任务名>.log；内存恒定不暴涨                          */
/* ------------------------------------------------------------------ */

use std::collections::VecDeque;
use std::fs::OpenOptions;
use std::io::{BufWriter, Write};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

pub const LOG_CAP: usize = 200;
/// 文件日志惰性刷盘窗口：INFO 行最多 500ms 落一次盘（高频输出下省 IO），
/// ERR/WARN 与环溢出立即刷，进程退出（Drop）兜底刷
const FLUSH_INTERVAL_MS: u64 = 500;
pub const LEVEL_INFO: &str = "INFO";
pub const LEVEL_WARN: &str = "WARN";
pub const LEVEL_ERR: &str = "ERR";
pub const LEVEL_SYS: &str = "SYS";

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LogLine {
    /// unix 毫秒
    pub t_ms: u64,
    pub level: &'static str,
    pub msg: String,
}

/// 定容日志缓冲，跨线程共享（Arc<Mutex<>>）
#[derive(Debug)]
pub struct LogBuf {
    lines: VecDeque<LogLine>,
    cap: usize,
    /// 文件追加句柄（<log根>/<任务名>.log，带缓冲），None = 未打开
    file: Option<BufWriter<std::fs::File>>,
    last_flush_ms: u64,
    file_path: PathBuf,
    name: String,
}

impl LogBuf {
    pub fn new(name: &str, cap: usize) -> Self {
        Self {
            lines: VecDeque::with_capacity(cap.min(64)),
            cap,
            file: None,
            last_flush_ms: 0,
            file_path: PathBuf::new(),
            name: name.to_string(),
        }
    }

    /// 打开日志文件（<log 根>\<任务名>.log，追加模式）。失败不阻塞内存日志。
    /// 任务名净化非法字符；含点的名字（如 "Qwen3.8-server"）不再被误判扩展名。
    pub fn attach_file(&mut self, log_dir: &Path) {
        let safe: String = self
            .name
            .chars()
            .map(|c| match c {
                '\\' | '/' | ':' | '*' | '?' | '"' | '<' | '>' | '|' => '_',
                c => c,
            })
            .collect();
        let fname = if safe.to_ascii_lowercase().ends_with(".log") { safe } else { safe + ".log" };
        self.file_path = log_dir.join(fname);
        if let Some(parent) = self.file_path.parent() {
            let _ = std::fs::create_dir_all(parent);
        }
        self.file = OpenOptions::new()
            .create(true)
            .append(true)
            .open(&self.file_path)
            .map(|f| BufWriter::with_capacity(8 * 1024, f))
            .ok();
    }

    pub fn push(&mut self, t_ms: u64, level: &'static str, msg: String) {
        let line = LogLine { t_ms, level, msg };
        if let Some(w) = self.file.as_mut() {
            let _ = writeln!(w, "[{}] {:<5} {}", format_time(t_ms), level, line.msg);
            // 关键行或超出节流窗口才落盘；普通 INFO 攒在 8KB 缓冲里
            if level != LEVEL_INFO || t_ms.saturating_sub(self.last_flush_ms) >= FLUSH_INTERVAL_MS {
                let _ = w.flush();
                self.last_flush_ms = t_ms;
            }
        }
        if self.lines.len() == self.cap {
            self.lines.pop_front();
            if let Some(w) = self.file.as_mut() {
                let _ = w.flush(); // 环即将滚动，保证文件可完整回看
            }
        }
        self.lines.push_back(line);
    }

    pub fn clear(&mut self) {
        self.lines.clear();
    }

    pub fn iter(&self) -> impl Iterator<Item = &LogLine> {
        self.lines.iter()
    }

    pub fn len(&self) -> usize {
        self.lines.len()
    }

    pub fn is_empty(&self) -> bool {
        self.lines.is_empty()
    }

    pub fn name(&self) -> &str {
        &self.name
    }
}

/// 释放时刷出缓冲，确保退出前的尾行不丢
impl Drop for LogBuf {
    fn drop(&mut self) {
        if let Some(w) = self.file.as_mut() {
            let _ = w.flush();
        }
    }
}

/// 共享日志缓冲
pub type SharedLog = Arc<Mutex<LogBuf>>;

pub fn shared(name: &str, cap: usize) -> SharedLog {
    Arc::new(Mutex::new(LogBuf::new(name, cap)))
}

pub fn push_shared(log: &SharedLog, t_ms: u64, level: &'static str, msg: impl Into<String>) {
    if let Ok(mut g) = log.lock() {
        g.push(t_ms, level, msg.into());
    }
}

/* ---------------- 时间格式化（纯 std，UTC） ---------------- */

/// 由 unix 毫秒格式化 "YYYY-MM-DD HH:MM:SS"（UTC）
pub fn format_time(t_ms: u64) -> String {
    let secs = t_ms / 1000;
    let days = (secs / 86400) as i64;
    let rem = secs % 86400;
    let hh = rem / 3600;
    let mm = (rem % 3600) / 60;
    let ss = rem % 60;
    let (y, mo, d) = civil_from_days(days);
    format!("{y:04}-{mo:02}-{d:02} {hh:02}:{mm:02}:{ss:02}")
}

/// Howard Hinnant 的 civil_from_days：天数 → (年, 月, 日)
fn civil_from_days(z: i64) -> (i64, u32, u32) {
    let z = z + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = (z - era * 146_097) as u64;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe as i64 + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = (doy - (153 * mp + 2) / 5 + 1) as u32;
    let m = if mp < 10 { mp + 3 } else { mp - 9 } as u32;
    (if m <= 2 { y + 1 } else { y }, m, d)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ring_buffer_caps() {
        let mut b = LogBuf::new("t", 4);
        for i in 0..10 {
            b.push(i, LEVEL_INFO, format!("msg {i}"));
        }
        assert_eq!(b.len(), 4);
        assert_eq!(b.iter().next().unwrap().msg, "msg 6");
    }

    #[test]
    fn time_formatting() {
        // 2024-01-01 00:00:00 UTC = 1704067200 秒
        assert_eq!(format_time(1_704_067_200_000), "2024-01-01 00:00:00");
        // 1970-01-01 00:00:00
        assert_eq!(format_time(0), "1970-01-01 00:00:00");
    }

    #[test]
    fn attach_file_always_ends_with_log_and_sanitizes() {
        // 任务名含点不再被误判扩展名；非法字符替换为下划线
        let dir = std::env::temp_dir().join(format!("taskwarden-logbuf-{}", std::process::id()));
        let mut b = LogBuf::new("Qwen3.8-server", 4);
        b.attach_file(&dir);
        b.push(1_704_067_200_000, LEVEL_INFO, "model loaded".into());
        drop(b);
        let content = std::fs::read_to_string(dir.join("Qwen3.8-server.log")).expect("必须带 .log 后缀");
        assert!(content.contains("model loaded"));
        assert!(content.contains("INFO"));

        let mut c = LogBuf::new("bad<>|name", 4);
        c.attach_file(&dir);
        assert_eq!(c.file_path.file_name().unwrap().to_str().unwrap(), "bad___name.log");

        let _ = std::fs::remove_dir_all(&dir);
    }
}
