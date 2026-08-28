/* ------------------------------------------------------------------ */
/* breaker.rs：滑动窗口熔断 + 指数退避                                    */
/* 窗口内失败次数 ≥ max_fails → 熔断；退避 2^n 秒，封顶 64s                */
/* 纯逻辑、无 IO，可独立单测                                              */
/* ------------------------------------------------------------------ */

use std::collections::VecDeque;
use std::time::{Duration, Instant};

/// 熔断决策
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Decision {
    /// 正常计数，未触发
    Ok,
    /// 触发熔断：暂停自动重启，等待手动干预
    Trip,
    /// 进入退避：backoff 秒后重试
    Backoff(Duration),
}

pub struct Breaker {
    window: Duration,
    max_fails: u32,
    failures: VecDeque<Instant>,
    backoff_attempt: u32,
    backoff_until: Option<Instant>,
    /// 熔断标志：Trip 后置位，reset 清除
    fused: bool,
}

impl Breaker {
    pub fn new(window: Duration, max_fails: u32) -> Self {
        Self { window, max_fails: max_fails.max(1), failures: VecDeque::new(), backoff_attempt: 0, backoff_until: None, fused: false }
    }

    /// 记录一次失败（启动失败或运行崩溃），返回决策
    pub fn record_failure(&mut self, now: Instant) -> Decision {
        self.trim(now);
        self.failures.push_back(now);
        self.backoff_attempt += 1;
        if self.failures.len() as u32 >= self.max_fails {
            // 熔断：清空计数，等待手动重置
            self.failures.clear();
            self.backoff_until = None;
            self.fused = true;
            Decision::Trip
        } else {
            Decision::Backoff(self.backoff_delay(self.backoff_attempt))
        }
    }

    /// 手动重置（用户干预后）
    pub fn reset(&mut self) {
        self.failures.clear();
        self.backoff_attempt = 0;
        self.backoff_until = None;
        self.fused = false;
    }

    /// 退避是否到期（到期返回 true，可重试）
    pub fn backoff_ready(&mut self, now: Instant) -> bool {
        if let Some(until) = self.backoff_until {
            if now >= until {
                self.backoff_until = None;
                return true;
            }
            return false;
        }
        true
    }

    pub fn set_backoff(&mut self, until: Instant) {
        self.backoff_until = Some(until);
    }

    pub fn is_fused(&self) -> bool {
        self.fused
    }

    pub fn backoff_attempt(&self) -> u32 {
        self.backoff_attempt
    }

    /// 指数退避：2^n 秒，封顶 64s（与设计文档一致）
    pub fn backoff_delay(&self, attempt: u32) -> Duration {
        let exp = attempt.min(6) as u32; // 2^6 = 64s 封顶
        Duration::from_secs(1 << exp)
    }

    fn trim(&mut self, now: Instant) {
        while let Some(&f) = self.failures.front() {
            if now.duration_since(f) > self.window {
                self.failures.pop_front();
            } else {
                break;
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn trips_after_max_fails() {
        let mut b = Breaker::new(Duration::from_secs(60), 3);
        let t0 = Instant::now();
        assert_eq!(b.record_failure(t0), Decision::Backoff(Duration::from_secs(2)));
        assert_eq!(b.record_failure(t0), Decision::Backoff(Duration::from_secs(4)));
        assert_eq!(b.record_failure(t0), Decision::Trip);
        assert!(b.is_fused());
        b.reset();
        assert!(!b.is_fused());
    }

    #[test]
    fn backoff_caps_at_64s() {
        let b = Breaker::new(Duration::from_secs(60), 3);
        assert_eq!(b.backoff_delay(5), Duration::from_secs(32));
        assert_eq!(b.backoff_delay(9), Duration::from_secs(64));
    }

    #[test]
    fn window_slides() {
        let mut b = Breaker::new(Duration::from_secs(60), 2);
        let now = Instant::now();
        // 窗口外失败：滑动窗口丢弃，不计入
        b.record_failure(now - Duration::from_secs(120));
        b.record_failure(now);
        assert!(!b.is_fused(), "窗口外的失败应被滑动丢弃，不触发熔断");
        // 窗口内再补一次 → 触发熔断
        b.record_failure(now);
        assert!(b.is_fused());
    }
}
