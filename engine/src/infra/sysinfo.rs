/* ------------------------------------------------------------------ */
/* sysinfo.rs：CPU/内存（Win32 原生）· GPU/显存/温度（nvml-wrapper，容错） */
/* CPU 温度接口已预留，当前返回 None（N/A）                               */
/* ------------------------------------------------------------------ */

use std::sync::{Mutex, OnceLock};
use std::time::Instant;

use windows::Win32::Foundation::FILETIME;
use windows::Win32::System::SystemInformation::{GlobalMemoryStatusEx, MEMORYSTATUSEX};

/// 单次采样快照
#[derive(Debug, Clone, Default)]
pub struct Sample {
    pub cpu_pct: f32,
    pub mem_pct: f32,
    pub mem_used_mb: u64,
    pub mem_total_mb: u64,
    pub gpu_pct: Option<f32>,
    pub vram_used_mb: Option<u64>,
    pub vram_total_mb: Option<u64>,
    pub gpu_temp_c: Option<f32>,
    /// 预留：CPU 温度，当前恒为 None
    pub cpu_temp_c: Option<f32>,
}

pub struct Sampler {
    prev_idle: u64,
    prev_kernel: u64,
    prev_user: u64,
    prev_t: Instant,
}

impl Default for Sampler {
    fn default() -> Self {
        let (idle, kernel, user) = cpu_times();
        Self { prev_idle: idle, prev_kernel: kernel, prev_user: user, prev_t: Instant::now() }
    }
}

impl Sampler {
    pub fn new() -> Self {
        Self::default()
    }

    /// 4Hz 节拍下调用
    pub fn sample(&mut self) -> Sample {
        let cpu_pct = self.sample_cpu();
        let (mem_pct, mem_used_mb, mem_total_mb) = memory();
        let gpu = gpu_stats();
        Sample {
            cpu_pct,
            mem_pct,
            mem_used_mb,
            mem_total_mb,
            gpu_pct: gpu.as_ref().map(|g| g.gpu_pct),
            vram_used_mb: gpu.as_ref().map(|g| g.vram_used_mb),
            vram_total_mb: gpu.as_ref().map(|g| g.vram_total_mb),
            gpu_temp_c: gpu.as_ref().map(|g| g.temp_c),
            cpu_temp_c: None,
        }
    }

    fn sample_cpu(&mut self) -> f32 {
        let (idle, kernel, user) = cpu_times();
        let now = Instant::now();
        let total = (kernel + user) as i128 - (self.prev_kernel + self.prev_user) as i128;
        let idle_d = idle as i128 - self.prev_idle as i128;
        let dt = now.duration_since(self.prev_t).as_secs_f64();
        self.prev_idle = idle;
        self.prev_kernel = kernel;
        self.prev_user = user;
        self.prev_t = now;
        if total <= 0 || dt <= 0.0 {
            return 0.0;
        }
        // total 包含 idle（kernel 含 idle），使用率 = 1 - idle/total
        let busy = 1.0 - idle_d as f64 / total as f64;
        (busy * 100.0).clamp(0.0, 100.0) as f32
    }
}

/// (idle, kernel, user) 单位 100ns，来自 GetSystemTimes（kernel 含 idle）
fn cpu_times() -> (u64, u64, u64) {
    use windows::Win32::Foundation::FILETIME;
    use windows::Win32::System::Threading::GetSystemTimes;
    let mut idle = FILETIME::default();
    let mut kernel = FILETIME::default();
    let mut user = FILETIME::default();
    let r = unsafe { GetSystemTimes(Some(&mut idle), Some(&mut kernel), Some(&mut user)) };
    if r.is_ok() {
        (ft_u64(idle), ft_u64(kernel), ft_u64(user))
    } else {
        (0, 0, 0)
    }
}

fn ft_u64(ft: FILETIME) -> u64 {
    (u64::from(ft.dwHighDateTime) << 32) | u64::from(ft.dwLowDateTime)
}

/// (占用百分比, 已用 MB, 总量 MB)
fn memory() -> (f32, u64, u64) {
    let mut st = MEMORYSTATUSEX {
        dwLength: std::mem::size_of::<MEMORYSTATUSEX>() as u32,
        ..Default::default()
    };
    if unsafe { GlobalMemoryStatusEx(&mut st) }.is_ok() && st.ullTotalPhys > 0 {
        let used = st.ullTotalPhys - st.ullAvailPhys;
        let pct = used as f64 / st.ullTotalPhys as f64 * 100.0;
        (pct as f32, used / 1048576, st.ullTotalPhys / 1048576)
    } else {
        (0.0, 0, 0)
    }
}

/* ---------------- GPU：NVML（容错，无 GPU 时全 None） ---------------- */

struct GpuStats {
    gpu_pct: f32,
    vram_used_mb: u64,
    vram_total_mb: u64,
    temp_c: f32,
}

static NVML: OnceLock<Mutex<nvml_wrapper::Nvml>> = OnceLock::new();

fn gpu_stats() -> Option<GpuStats> {
    let nvml = match NVML.get() {
        Some(m) => m,
        None => {
            let ok = nvml_wrapper::Nvml::init();
            match ok {
                Ok(n) => {
                    let _ = NVML.set(Mutex::new(n));
                    NVML.get()?
                }
                Err(_) => return None,
            }
        }
    };
    let nvml = nvml.lock().ok()?;
    let dev = nvml.device_by_index(0).ok()?;
    let util = dev.utilization_rates().ok()?;
    let temp = dev.temperature(nvml_wrapper::enum_wrappers::device::TemperatureSensor::Gpu).ok()?;
    let mem = dev.memory_info().ok()?;
    Some(GpuStats {
        gpu_pct: util.gpu as f32,
        vram_used_mb: mem.used / 1048576,
        vram_total_mb: mem.total / 1048576,
        temp_c: temp as f32,
    })
}
