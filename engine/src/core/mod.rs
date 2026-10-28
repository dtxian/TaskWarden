/* ------------------------------------------------------------------ */
/* ② 核心调度层 —— supervisor / scheduler / breaker / health / events    */
/* 向下经 mpsc 发送 Spawn/Kill 命令，向上回传事件与状态快照               */
/* ------------------------------------------------------------------ */

pub mod breaker;
pub mod error;
pub mod events;
pub mod health;
pub mod scheduler;
pub mod supervisor;
