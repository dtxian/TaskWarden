/* ------------------------------------------------------------------ */
/* events.rs：跨层事件总线（std mpsc，零异步运行时）                      */
/* GUI ← 事件；supervisor 是唯一生产者                                    */
/* ------------------------------------------------------------------ */

use std::sync::mpsc::{Receiver, Sender, channel};

use crate::infra::config::TaskConfig;

/// 任务生命周期状态
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum TaskState {
    #[default]
    Stopped,
    Starting,
    Running,
    Backoff,
    Fused,
}

impl TaskState {
    pub fn as_str(&self) -> &'static str {
        match self {
            TaskState::Stopped => "stopped",
            TaskState::Starting => "starting",
            TaskState::Running => "running",
            TaskState::Backoff => "backoff",
            TaskState::Fused => "fused",
        }
    }
}

/// 跨层事件：supervisor → GUI / 托盘
#[derive(Debug, Clone)]
pub enum Event {
    /// 状态机迁移
    StateChanged { id: String, state: TaskState },
    /// 进程已派生
    Spawned { id: String, pid: u32 },
    /// 进程退出（意外或正常）
    Exited { id: String, code: i32 },
    /// 日志行
    Log { id: String, level: &'static str, msg: String },
    /// 健康探针结果（ms 为探针耗时；Err 为失败原因）
    Probe { id: String, ok: bool, ms: u128, detail: String },
    /// 熔断触发
    BreakerTripped { id: String, window_sec: u64, max_fails: u32 },
    /// 熔断手动重置
    BreakerReset { id: String },
    /// 启动失败反馈链路
    SpawnFailed { id: String, error: String },
    /// 指标采样节拍（4Hz）
    MetricsTick,
    /// 全局统计
    Stats { spawned: u64, restarts: u64, last_error: Option<String> },
    /// 配置已变更
    ConfigChanged { config: Vec<TaskConfig> },
    /// 任务新增/删除（供 GUI 刷新列表）
    TasksChanged,
}

/// 事件通道对
pub type EventSender = Sender<Event>;
pub type EventReceiver = Receiver<Event>;

pub fn channel_events() -> (EventSender, EventReceiver) {
    channel()
}
