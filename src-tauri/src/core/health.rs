/* ------------------------------------------------------------------ */
/* health.rs：TCP / HTTP 同步探针（由监督器交给短命线程执行，不占引擎线程） */
/* 就绪等待(ready)不在此列：改由 supervisor tick 内消费 stdout 推进，      */
/* 见 supervisor.rs::ReadyWait —— 旧线程版会吞掉 stdout 通道导致          */
/* 子进程管道写阻塞与日志丢失。                                             */
/* 全部基于 std，超时严格可控；结果聚合为任务卡片上的健康度指示             */
/* ------------------------------------------------------------------ */

use std::io::{Read, Write};
use std::net::{TcpStream, ToSocketAddrs};
use std::time::{Duration, Instant};

/// 探针结果
#[derive(Debug, Clone)]
pub struct ProbeReport {
    pub ok: bool,
    pub ms: u128,
    pub detail: String,
}

impl ProbeReport {
    pub fn ok(ms: u128, detail: impl Into<String>) -> Self {
        Self { ok: true, ms, detail: detail.into() }
    }
    pub fn fail(ms: u128, detail: impl Into<String>) -> Self {
        Self { ok: false, ms, detail: detail.into() }
    }
}

/// TCP connect 探针：target 形如 "127.0.0.1:11434"
pub fn probe_tcp(target: &str, timeout: Duration) -> ProbeReport {
    let t0 = Instant::now();
    let addr = match target.to_socket_addrs() {
        Ok(mut it) => match it.next() {
            Some(a) => a,
            None => return ProbeReport::fail(elapsed(t0), format!("无法解析地址: {target}")),
        },
        Err(e) => return ProbeReport::fail(elapsed(t0), format!("地址解析失败: {e}")),
    };
    match TcpStream::connect_timeout(&addr, timeout) {
        Ok(_) => ProbeReport::ok(elapsed(t0), format!("TCP {target} 连接成功")),
        Err(e) => ProbeReport::fail(elapsed(t0), format!("TCP {target} 连接失败: {e}")),
    }
}

/// HTTP GET 探针：target 形如 "http://127.0.0.1:8080/health"
/// 手写最小 HTTP/1.1 客户端（无第三方依赖），解析状态码
pub fn probe_http(target: &str, timeout: Duration) -> ProbeReport {
    let t0 = Instant::now();
    let (host, port, path) = match parse_url(target) {
        Some(v) => v,
        None => return ProbeReport::fail(elapsed(t0), format!("URL 解析失败: {target}")),
    };
    let addr = match (host.as_str(), port).to_socket_addrs().ok().and_then(|mut it| it.next()) {
        Some(a) => a,
        None => return ProbeReport::fail(elapsed(t0), format!("无法解析地址: {host}:{port}")),
    };
    let mut stream = match TcpStream::connect_timeout(&addr, timeout) {
        Ok(s) => s,
        Err(e) => return ProbeReport::fail(elapsed(t0), format!("连接 {host}:{port} 失败: {e}")),
    };
    let _ = stream.set_read_timeout(Some(timeout));
    let req = format!("GET {path} HTTP/1.1\r\nHost: {host}\r\nConnection: close\r\n\r\n");
    if stream.write_all(req.as_bytes()).is_err() {
        return ProbeReport::fail(elapsed(t0), "发送 HTTP 请求失败");
    }
    let mut buf = [0u8; 64];
    let mut got = 0usize;
    loop {
        match stream.read(&mut buf[got..]) {
            Ok(0) => break,
            Ok(n) => {
                got += n;
                if got >= buf.len() {
                    break;
                }
            }
            Err(e) => return ProbeReport::fail(elapsed(t0), format!("读取响应失败: {e}")),
        }
    }
    let head = String::from_utf8_lossy(&buf[..got]);
    let status = head.split_whitespace().nth(1).unwrap_or("000");
    if status.starts_with('2') || status.starts_with('3') {
        ProbeReport::ok(elapsed(t0), format!("HTTP GET {path} → {status}"))
    } else {
        ProbeReport::fail(elapsed(t0), format!("HTTP GET {path} → {status}"))
    }
}

fn elapsed(t0: Instant) -> u128 {
    t0.elapsed().as_millis()
}

/// 解析 "http://host[:port]/path"
fn parse_url(url: &str) -> Option<(String, u16, String)> {
    let rest = url.strip_prefix("http://")?;
    let (hostport, path) = match rest.find('/') {
        Some(i) => (&rest[..i], &rest[i..]),
        None => (rest, "/"),
    };
    let (host, port) = match hostport.rfind(':') {
        Some(i) => (&hostport[..i], hostport[i + 1..].parse::<u16>().ok()?),
        None => (hostport, 80),
    };
    if host.is_empty() {
        return None;
    }
    Some((host.to_string(), port, path.to_string()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn url_parsing() {
        assert_eq!(parse_url("http://127.0.0.1:8080/health"), Some(("127.0.0.1".into(), 8080, "/health".into())));
        assert_eq!(parse_url("http://localhost/"), Some(("localhost".into(), 80, "/".into())));
        assert_eq!(parse_url("https://x"), None);
    }
}
