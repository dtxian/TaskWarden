/* ------------------------------------------------------------------ */
/* job.rs：每个子进程绑定 Job Object（KILL_ON_JOB_CLOSE）                 */
/* 进程树（含脚本派生的孙进程）一并纳管；主程序退出时随 Job 自动级联回收     */
/* ------------------------------------------------------------------ */

use std::mem::size_of;
use std::os::raw::c_void;
use std::os::windows::io::AsRawHandle;
use std::process::Child;

use windows::core::PCWSTR;
use windows::Win32::Foundation::{CloseHandle, HANDLE};
use windows::Win32::System::JobObjects::{
    AssignProcessToJobObject, CreateJobObjectW, JobObjectExtendedLimitInformation,
    JOBOBJECT_EXTENDED_LIMIT_INFORMATION, JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
    SetInformationJobObject, TerminateJobObject,
};

/// Job Object 句柄：Drop 时 CloseHandle；若持有 KILL_ON_JOB_CLOSE，
/// 句柄关闭即终结其内所有进程（主程序退出的兜底回收）。
pub struct JobHandle {
    handle: HANDLE,
}

// HANDLE 是内核对象句柄，可跨线程使用（关闭由 Drop 单线程负责）
unsafe impl Send for JobHandle {}
unsafe impl Sync for JobHandle {}

impl JobHandle {
    pub fn new(name: &str) -> Result<Self, String> {
        let wide: Vec<u16> = name.encode_utf16().chain(Some(0)).collect();
        // 命名 Job（Global 前缀：跨会话可见），失败时退化为匿名
        let handle = unsafe { CreateJobObjectW(None, PCWSTR(wide.as_ptr())) }
            .map_err(|e| format!("CreateJobObjectW 失败: {e}"))?;
        let mut info = JOBOBJECT_EXTENDED_LIMIT_INFORMATION::default();
        info.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
        let r = unsafe {
            SetInformationJobObject(
                handle,
                JobObjectExtendedLimitInformation,
                &info as *const _ as *const _,
                size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
            )
        };
        if r.is_err() {
            unsafe {
                let _ = CloseHandle(handle);
            }
            return Err(format!("SetInformationJobObject 失败: {}", std::io::Error::last_os_error()));
        }
        Ok(Self { handle })
    }

    /// 将子进程纳入 Job（进程树随后一并纳管）
    pub fn assign(&self, child: &Child) -> Result<(), String> {
        let hproc = HANDLE(child.as_raw_handle() as *mut c_void);
        let r = unsafe { AssignProcessToJobObject(self.handle, hproc) };
        if r.is_ok() {
            Ok(())
        } else {
            Err(format!("AssignProcessToJobObject 失败: {}", std::io::Error::last_os_error()))
        }
    }

    /// 强制终结 Job 内全部进程
    pub fn terminate(&self, exit_code: u32) -> Result<(), String> {
        let r = unsafe { TerminateJobObject(self.handle, exit_code) };
        if r.is_ok() {
            Ok(())
        } else {
            Err(format!("TerminateJobObject 失败: {}", std::io::Error::last_os_error()))
        }
    }
}

impl Drop for JobHandle {
    fn drop(&mut self) {
        unsafe {
            let _ = CloseHandle(self.handle);
        }
    }
}
