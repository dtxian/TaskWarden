/* ------------------------------------------------------------------ */
/* config.toml：serde 读写，先写临时文件再原子替换落盘，杜绝半截配置       */
/* 便携化：所有状态跟随程序目录 —— <exe 所在目录>\data\config.toml        */
/*            首次运行自动从旧版 %APPDATA%\TaskWarden 迁移                */
/* ------------------------------------------------------------------ */

use std::fs;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::core::error::Error;

pub const DEFAULT_LOG_DIR: &str = "logs";
pub const DEFAULT_BREAKER_WINDOW_SEC: u64 = 60;
pub const DEFAULT_BREAKER_MAX_FAILS: u32 = 3;

/// 任务可执行类型：exe 直接派生，bat/cmd 走 cmd /c，ps1 走 powershell
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Kind {
    Exe,
    Bat,
    Ps1,
}

impl Kind {
    pub fn as_str(&self) -> &'static str {
        match self {
            Kind::Exe => "exe",
            Kind::Bat => "bat",
            Kind::Ps1 => "ps1",
        }
    }
}

/// 重启策略：always 无条件重启 / on-failure 仅失败重启 / never 不重启
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "kebab-case")]
pub enum Strategy {
    Always,
    #[default]
    OnFailure,
    Never,
}

impl Strategy {
    pub fn as_str(&self) -> &'static str {
        match self {
            Strategy::Always => "always",
            Strategy::OnFailure => "on-failure",
            Strategy::Never => "never",
        }
    }
}

/// 健康探针模式
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub enum HealthMode {
    #[default]
    None,
    Tcp,
    Http,
    Ready,
}

impl HealthMode {
    pub fn as_str(&self) -> &'static str {
        match self {
            HealthMode::None => "none",
            HealthMode::Tcp => "tcp",
            HealthMode::Http => "http",
            HealthMode::Ready => "ready",
        }
    }
}

/// 任务健康检查配置（对应 config.toml 中的 [tasks.health]）
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Health {
    #[serde(default)]
    pub mode: HealthMode,
    /// tcp: "127.0.0.1:11434"；http: "http://127.0.0.1:8080/health"；ready: stdout 关键字
    #[serde(default)]
    pub target: String,
}

impl Default for Health {
    fn default() -> Self {
        Self { mode: HealthMode::None, target: String::new() }
    }
}

/// 单个任务配置
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct TaskConfig {
    pub name: String,
    pub kind: Kind,
    pub path: String,
    #[serde(default)]
    pub args: Vec<String>,
    #[serde(default)]
    pub cwd: String,
    #[serde(default)]
    pub strategy: Strategy,
    /// 优雅停止窗口（秒，仅 exe 有意义），0 = 立即强杀
    #[serde(default = "default_graceful_timeout")]
    pub graceful_timeout: u64,
    #[serde(default)]
    pub deps: Vec<String>,
    #[serde(default)]
    pub health: Health,
    #[serde(default = "default_true")]
    pub enabled: bool,
}

fn default_graceful_timeout() -> u64 {
    5
}
fn default_true() -> bool {
    true
}

/// 全局设置
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Settings {
    #[serde(default = "default_log_dir")]
    pub log_dir: String,
    #[serde(default = "default_breaker_window")]
    pub breaker_window_sec: u64,
    #[serde(default = "default_breaker_max")]
    pub breaker_max_fails: u32,
    #[serde(default = "default_theme")]
    pub theme: String,
}

fn default_log_dir() -> String {
    DEFAULT_LOG_DIR.to_string()
}
fn default_breaker_window() -> u64 {
    DEFAULT_BREAKER_WINDOW_SEC
}
fn default_breaker_max() -> u32 {
    DEFAULT_BREAKER_MAX_FAILS
}
fn default_theme() -> String {
    "dark".to_string()
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            log_dir: default_log_dir(),
            breaker_window_sec: default_breaker_window(),
            breaker_max_fails: default_breaker_max(),
            theme: default_theme(),
        }
    }
}

/// 顶层配置：settings + 任务列表
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Default)]
pub struct Config {
    #[serde(default)]
    pub settings: Settings,
    #[serde(default)]
    pub tasks: Vec<TaskConfig>,
}

impl Config {
    /// 数据根目录：`<exe 所在目录>\data`（单文件便携：配置与日志跟随程序目录）
    pub fn data_dir() -> PathBuf {
        let exe_dir = std::env::current_exe()
            .ok()
            .and_then(|e| e.parent().map(|p| p.to_path_buf()))
            .unwrap_or_else(|| PathBuf::from("."));
        exe_dir.join("data")
    }

    /// `<exe 目录>\data\config.toml`
    pub fn default_path() -> PathBuf {
        Self::data_dir().join("config.toml")
    }

    /// 解析 settings.log_dir：绝对路径原样使用；相对路径挂在数据目录下
    /// （默认 "logs" → `<exe 目录>\data\logs`）
    pub fn resolve_log_dir(log_dir: &str) -> PathBuf {
        let p = Path::new(log_dir);
        if p.is_absolute() {
            p.to_path_buf()
        } else {
            Self::data_dir().join(p)
        }
    }

    /// 旧版数据目录 %APPDATA%\TaskWarden（存在才返回）
    fn legacy_dir() -> Option<PathBuf> {
        let dir = PathBuf::from(std::env::var("APPDATA").ok()?).join("TaskWarden");
        dir.exists().then_some(dir)
    }

    /// 一次性迁移：新配置不存在且旧 %APPDATA%\TaskWarden\config.toml 存在 → 复制过去。
    /// 保留旧文件不删，便于回退。
    pub fn migrate_from_appdata(new_cfg: &Path) {
        if new_cfg.exists() {
            return;
        }
        let Some(legacy) = Self::legacy_dir() else { return };
        let old_cfg = legacy.join("config.toml");
        if old_cfg.is_file() {
            if let Some(parent) = new_cfg.parent() {
                let _ = std::fs::create_dir_all(parent);
            }
            let _ = std::fs::copy(&old_cfg, new_cfg);
        }
    }

    /// 同步迁移旧版日志文件（已存在的不覆盖）
    pub fn migrate_logs_from_appdata(log_root: &Path) {
        let Some(legacy) = Self::legacy_dir() else { return };
        let old_logs = legacy.join("logs");
        if !old_logs.is_dir() || old_logs == log_root {
            return;
        }
        let Ok(entries) = std::fs::read_dir(&old_logs) else { return };
        let _ = std::fs::create_dir_all(log_root);
        for entry in entries.flatten() {
            let from = entry.path();
            if !from.is_file() {
                continue;
            }
            let to = log_root.join(from.file_name().unwrap_or_default());
            if !to.exists() {
                let _ = std::fs::copy(&from, &to);
            }
        }
    }

    pub fn load(path: &Path) -> Result<Self, Error> {
        if !path.exists() {
            return Ok(Config::default());
        }
        let raw = fs::read_to_string(path).map_err(|e| Error::Io { ctx: format!("读取配置 {}", path.display()), source: e })?;
        let cfg: Config = toml::from_str(&raw).map_err(|e| Error::Toml(format!("解析配置失败: {e}")))?;
        Ok(cfg)
    }

    /// 原子落盘：写临时文件 → 替换目标，杜绝半截配置
    pub fn save(&self, path: &Path) -> Result<(), Error> {
        let raw = toml::to_string_pretty(self).map_err(|e| Error::Toml(format!("序列化配置失败: {e}")))?;
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).map_err(|e| Error::Io { ctx: format!("创建目录 {}", parent.display()), source: e })?;
        }
        let tmp = path.with_extension("toml.tmp");
        fs::write(&tmp, raw).map_err(|e| Error::Io { ctx: format!("写入临时配置 {}", tmp.display()), source: e })?;
        // Windows 上 rename 到已存在目标会失败，先移除旧文件再 rename
        if path.exists() {
            fs::remove_file(path).map_err(|e| Error::Io { ctx: format!("移除旧配置 {}", path.display()), source: e })?;
        }
        fs::rename(&tmp, path).map_err(|e| Error::Io { ctx: format!("替换配置 {}", path.display()), source: e })?;
        Ok(())
    }

    /// 供 GUI 展示的 config.toml 文本
    pub fn render(&self) -> String {
        toml::to_string_pretty(self).unwrap_or_else(|e| format!("(序列化失败: {e})"))
    }
}

/// 首次启动时生成的示例种子任务（与原型页面对齐，便于开箱即用）
pub fn seed_config() -> Config {
    let mut cfg = Config::default();
    cfg.settings = Settings {
        log_dir: DEFAULT_LOG_DIR.to_string(),
        breaker_window_sec: DEFAULT_BREAKER_WINDOW_SEC,
        breaker_max_fails: DEFAULT_BREAKER_MAX_FAILS,
        theme: "dark".to_string(),
    };
    cfg.tasks = vec![
        TaskConfig {
            name: "ollama-serve".into(),
            kind: Kind::Exe,
            path: r"C:\tools\ollama\ollama.exe".into(),
            args: vec!["serve".into()],
            cwd: r"C:\tools\ollama".into(),
            strategy: Strategy::Always,
            graceful_timeout: 5,
            deps: vec![],
            health: Health { mode: HealthMode::Tcp, target: "127.0.0.1:11434".into() },
            enabled: true,
        },
        TaskConfig {
            name: "model-router".into(),
            kind: Kind::Exe,
            path: r"C:\srv\router\router.exe".into(),
            args: vec!["--port".into(), "8080".into(), "--upstream".into(), "11434".into()],
            cwd: r"C:\srv\router".into(),
            strategy: Strategy::OnFailure,
            graceful_timeout: 3,
            deps: vec!["ollama-serve".into()],
            health: Health { mode: HealthMode::Http, target: "http://127.0.0.1:8080/health".into() },
            enabled: true,
        },
        TaskConfig {
            name: "frpc-tunnel".into(),
            kind: Kind::Exe,
            path: r"C:\tools\frp\frpc.exe".into(),
            args: vec!["-c".into(), "frpc.toml".into()],
            cwd: r"C:\tools\frp".into(),
            strategy: Strategy::OnFailure,
            graceful_timeout: 3,
            deps: vec!["model-router".into()],
            health: Health { mode: HealthMode::Tcp, target: "127.0.0.1:7000".into() },
            enabled: true,
        },
        TaskConfig {
            name: "log-shipper".into(),
            kind: Kind::Ps1,
            path: r"C:\scripts\ship-logs.ps1".into(),
            args: vec!["-target".into(), "loki".into(), "-batch".into(), "500".into()],
            cwd: r"C:\scripts".into(),
            strategy: Strategy::Always,
            graceful_timeout: 0,
            deps: vec![],
            health: Health { mode: HealthMode::Ready, target: "ready".into() },
            enabled: true,
        },
        TaskConfig {
            name: "nightly-sync".into(),
            kind: Kind::Bat,
            path: r"C:\scripts\sync.bat".into(),
            args: vec!["--full".into(), "--compress".into()],
            cwd: r"C:\scripts".into(),
            strategy: Strategy::Never,
            graceful_timeout: 0,
            deps: vec![],
            health: Health::default(),
            enabled: true,
        },
    ];
    cfg
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn save_load_roundtrip_is_lossless() {
        // 原子落盘（临时文件 → rename）后完整读回：任务/健康/依赖/策略全部保持
        let cfg = seed_config();
        let dir = std::env::temp_dir().join(format!("taskwarden-cfg-test-{}", std::process::id()));
        let path = dir.join("config.toml");
        cfg.save(&path).expect("save");
        let back = Config::load(&path).expect("load");
        assert_eq!(back, cfg, "落盘往返必须无损");
        assert_eq!(back.tasks.len(), 5, "种子应与前端模拟端一致为 5 任务");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn load_missing_file_yields_default() {
        let dir = std::env::temp_dir().join("taskwarden-cfg-test-missing");
        let p = dir.join("nope.toml");
        let cfg = Config::load(&p).expect("missing file is not an error");
        assert!(cfg.tasks.is_empty());
    }

    #[test]
    fn data_dir_is_absolute_next_to_exe() {
        let dir = Config::data_dir();
        assert!(dir.is_absolute());
        assert_eq!(dir.file_name().unwrap(), "data");
        assert!(Config::default_path().ends_with(Path::new("data").join("config.toml")));
    }

    #[test]
    fn resolve_log_dir_relative_hangs_under_data_absolute_passes() {
        let rel = Config::resolve_log_dir("logs");
        assert!(rel.is_absolute());
        assert!(rel.starts_with(Config::data_dir()));
        let abs = Config::resolve_log_dir("D:\\somewhere\\mylogs");
        assert_eq!(abs, PathBuf::from("D:\\somewhere\\mylogs"));
    }
}
