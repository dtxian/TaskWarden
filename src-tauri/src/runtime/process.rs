/* ------------------------------------------------------------------ */
/* process.rs：CREATE_NO_WINDOW 静默派生（exe/bat/ps1 适配）              */
/* exe 直接派生；.bat/.cmd 走 cmd /c；.ps1 走 powershell Bypass -File      */
/* stdout/stderr 均接管道：供日志采集与就绪探针使用，全程无黑框             */
/* 输出按行读取并解码：UTF-8 严格优先，回退 OEM 代码页（中文系统 GBK），     */
/* 修复 ping 等系统命令的 GBK 乱码                                          */
/* ------------------------------------------------------------------ */

use std::io::Read;
use std::os::windows::process::CommandExt;
use std::process::{Child, Command, Stdio};
use std::sync::mpsc::{channel, Receiver, Sender};

use crate::infra::config::{Kind, TaskConfig};

/// 0x08000000：CREATE_NO_WINDOW
pub const CREATE_NO_WINDOW: u32 = 0x0800_0000;

/// 派生后的进程句柄：持有 child + stdout/stderr 的接收端。
/// 管道由「后台读取线程」按行持续读入 channel，引擎用非阻塞 try_recv 取，绝不因子进程静默而阻塞。
pub struct ProcessHandle {
    pub child: Child,
    pub pid: u32,
    pub stdout: Option<Receiver<String>>,
    pub stderr: Option<Receiver<String>>,
}

impl ProcessHandle {
    /// 非阻塞查询退出状态
    pub fn try_wait(&mut self) -> std::io::Result<Option<std::process::ExitStatus>> {
        self.child.try_wait()
    }

    /// 非阻塞：取出 stderr 中积累的输出（一次取空）
    pub fn drain_stderr(&mut self) -> Option<String> {
        drain(&mut self.stderr)
    }

    /// 非阻塞：取出 stdout 中积累的输出（一次取空）
    pub fn drain_stdout(&mut self) -> Option<String> {
        drain(&mut self.stdout)
    }
}

fn drain(rx: &mut Option<Receiver<String>>) -> Option<String> {
    let rx = rx.as_ref()?;
    let mut out = String::new();
    while let Ok(s) = rx.try_recv() {
        out.push_str(&s);
        out.push('\n');
    }
    if out.is_empty() {
        None
    } else {
        Some(out)
    }
}

/// 后台读取线程：`Read` 在管道上会阻塞——放独立线程持续读。
/// 以 '\n' 为界逐行交付：GBK 尾字节恒 ≥0x40、UTF-8 续字节恒 ≥0x80，
/// 换行符不会出现在多字节字符内部 → 行边界天然不切碎字符，可安全解码。
/// 超长无换行输出按 64KB 分段，防止内存膨胀。
fn pump(mut stream: impl Read + Send + 'static, tx: Sender<String>) {
    let mut reader = std::io::BufReader::new(&mut stream);
    let mut buf: Vec<u8> = Vec::with_capacity(1024);
    let mut byte = [0u8; 1];
    loop {
        match reader.read(&mut byte) {
            Ok(0) => break, // EOF：把残留（无换行的尾行）冲刷出去
            Ok(_) => {}
            Err(ref e) if e.kind() == std::io::ErrorKind::Interrupted => continue,
            Err(_) => break,
        }
        if byte[0] == b'\n' {
            if !flush_line(&buf, &tx) {
                return;
            }
            buf.clear();
        } else {
            buf.push(byte[0]);
            if buf.len() >= 65536 {
                if !flush_line(&buf, &tx) {
                    return;
                }
                buf.clear();
            }
        }
    }
    let _ = flush_line(&buf, &tx);
}

fn flush_line(bytes: &[u8], tx: &Sender<String>) -> bool {
    let trimmed = if bytes.last() == Some(&b'\r') { &bytes[..bytes.len() - 1] } else { bytes };
    if !trimmed.is_empty() {
        return tx.send(decode_line(trimmed)).is_ok();
    }
    true
}

/// 单行解码：严格 UTF-8 优先（llama.cpp 等现代工具），失败回退 OEM 代码页
/// （中文 Windows 的 ping/ipconfig 等为 GBK/CP936）；两者都失败按 lossy 兜底。
fn decode_line(bytes: &[u8]) -> String {
    if let Ok(s) = std::str::from_utf8(bytes) {
        return s.to_string();
    }
    unsafe {
        use windows::Win32::Globalization::{GetOEMCP, MultiByteToWideChar, MULTI_BYTE_TO_WIDE_CHAR_FLAGS};
        let cp = GetOEMCP();
        let flags = MULTI_BYTE_TO_WIDE_CHAR_FLAGS(0);
        let cch = MultiByteToWideChar(cp, flags, bytes, None);
        if cch > 0 {
            let mut wide = vec![0u16; cch as usize];
            let written = MultiByteToWideChar(cp, flags, bytes, Some(&mut wide));
            if written > 0 {
                return String::from_utf16_lossy(&wide[..written as usize]);
            }
        }
    }
    String::from_utf8_lossy(bytes).into_owned()
}

/// 静默派生任务进程。失败返回人类可读错误（含 CreateProcessW 语义）。
pub fn spawn_task(cfg: &TaskConfig) -> Result<ProcessHandle, String> {
    let mut cmd = build_command(cfg);
    cmd.stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .creation_flags(CREATE_NO_WINDOW);
    if !cfg.cwd.is_empty() {
        cmd.current_dir(&cfg.cwd);
    }
    let mut child = cmd.spawn().map_err(|e| format!("CreateProcessW 失败: {e}"))?;
    let pid = child.id();
    let stdout = child.stdout.take().map(|stream| {
        let (tx, rx) = channel();
        std::thread::spawn(move || pump(stream, tx));
        rx
    });
    let stderr = child.stderr.take().map(|stream| {
        let (tx, rx) = channel();
        std::thread::spawn(move || pump(stream, tx));
        rx
    });
    Ok(ProcessHandle { child, pid, stdout, stderr })
}

/// 展开 Windows 环境变量（如 %SystemRoot%），供系统变量路径与常用命令使用。
/// 若无 %VAR% 或变量不存在，原样返回（不含路径分隔符的命令名由 Command 走 PATH 搜索）。
fn expand_env(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut rest = s;
    while let Some(start) = rest.find('%') {
        out.push_str(&rest[..start]);
        let after = &rest[start + 1..];
        if let Some(end) = after.find('%') {
            let var = &after[..end];
            if !var.is_empty() {
                match std::env::var(var) {
                    Ok(v) => out.push_str(&v),
                    Err(_) => {
                        out.push('%');
                        out.push_str(var);
                        out.push('%');
                    }
                }
            }
            rest = &after[end + 1..];
        } else {
            out.push_str(&rest[start..]);
            rest = "";
            break;
        }
    }
    out.push_str(rest);
    out
}

fn build_command(cfg: &TaskConfig) -> Command {
    let path = expand_env(&cfg.path);
    match cfg.kind {
        Kind::Exe => {
            let mut c = Command::new(&path);
            c.args(&cfg.args);
            c
        }
        Kind::Bat => {
            let mut c = Command::new("cmd");
            c.arg("/c").arg(&path).args(&cfg.args);
            c
        }
        Kind::Ps1 => {
            let mut c = Command::new("powershell");
            c.args(["-NoProfile", "-ExecutionPolicy", "Bypass", "-File"])
                .arg(&path)
                .args(&cfg.args);
            c
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{decode_line, spawn_task};

    #[test]
    fn utf8_and_ascii_pass_through() {
        assert_eq!(decode_line(b"model loaded"), "model loaded");
        assert_eq!(decode_line("加载模型 ✓".as_bytes()), "加载模型 ✓");
    }

    #[test]
    fn gbk_decodes_on_chinese_locale() {
        // "请求超时。" 的 CP936 编码 —— ping 等系统命令的经典输出
        let gbk: &[u8] = &[0xc7, 0xeb, 0xc7, 0xf3, 0xb3, 0xac, 0xca, 0xb1, 0xa1, 0xa3];
        let out = decode_line(gbk);
        unsafe {
            use windows::Win32::Globalization::GetOEMCP;
            if GetOEMCP() == 936 {
                assert_eq!(out, "请求超时。");
            } else {
                // 非中文 OEM 代码页环境：只要求不 panic、非 lossy 空串
                assert!(!out.is_empty());
            }
        }
    }

    #[test]
    fn ping_pipe_decodes_without_mojibake() {
        // 端到端：真实 ping（中文系统输出 GBK）走 spawn_task → pump 行缓冲 → decode 全链路
        use crate::infra::config::{Health, Kind, Strategy, TaskConfig};
        use std::thread::sleep;
        use std::time::{Duration, Instant};
        let cfg = TaskConfig {
            name: "ping-e2e".into(),
            kind: Kind::Exe,
            path: "ping".into(),
            args: vec!["-n".into(), "2".into(), "127.0.0.1".into()],
            cwd: String::new(),
            strategy: Strategy::Never,
            graceful_timeout: 0,
            deps: vec![],
            health: Health::default(),
            enabled: true,
        };
        let mut h = spawn_task(&cfg).expect("ping 派生失败");
        let deadline = Instant::now() + Duration::from_secs(15);
        let mut out = String::new();
        loop {
            if let Some(f) = h.drain_stdout() {
                out.push_str(&f);
            }
            if h.try_wait().ok().flatten().is_some() {
                sleep(Duration::from_millis(250)); // 等 pump 冲刷管道尾部
                if let Some(f) = h.drain_stdout() {
                    out.push_str(&f);
                }
                break;
            }
            assert!(Instant::now() < deadline, "ping 未在期限内退出");
            sleep(Duration::from_millis(150));
        }
        assert!(!out.trim().is_empty(), "未捕获到 ping 输出");
        // U+FFFD 替换符出现 = 字节被按错误编码切坏
        assert!(!out.contains('\u{FFFD}'), "存在解码失败的乱码行：{out}");
        assert!(out.contains("127.0.0.1"), "输出不像 ping 结果：{out}");
    }
}
