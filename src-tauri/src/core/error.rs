/* ------------------------------------------------------------------ */
/* 统一错误类型                                                          */
/* ------------------------------------------------------------------ */

use std::io;

#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error("{ctx}：{source}")]
    Io { ctx: String, source: io::Error },
    #[error("{0}")]
    Toml(String),
    #[error("{0}")]
    Other(String),
}

impl Error {
    pub fn other(msg: impl Into<String>) -> Self {
        Error::Other(msg.into())
    }
}

pub type Result<T> = std::result::Result<T, Error>;
