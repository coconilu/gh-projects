use std::ffi::OsStr;
use std::os::windows::ffi::OsStrExt;
use std::os::windows::io::{FromRawHandle, OwnedHandle};
use std::path::Path;
use std::ptr::null;
use windows_sys::Win32::System::Threading::{
    CreateProcessW, CREATE_NEW_CONSOLE, PROCESS_INFORMATION, STARTF_USESHOWWINDOW, STARTUPINFOW,
};

fn wide(value: &OsStr) -> Result<Vec<u16>, String> {
    let value: Vec<_> = value.encode_wide().chain(Some(0)).collect();
    if value[..value.len() - 1].contains(&0) {
        return Err("启动路径或参数包含空字符。".into());
    }
    Ok(value)
}

pub(super) fn spawn(executable: &Path, arguments: &str, cwd: &Path) -> Result<OwnedHandle, String> {
    create(executable, arguments, cwd, false)
}

#[cfg(test)]
pub(super) fn spawn_hidden(
    executable: &Path,
    arguments: &str,
    cwd: &Path,
) -> Result<OwnedHandle, String> {
    create(executable, arguments, cwd, true)
}

fn create(
    executable: &Path,
    arguments: &str,
    cwd: &Path,
    hidden: bool,
) -> Result<OwnedHandle, String> {
    let program = wide(executable.as_os_str())?;
    let directory = wide(cwd.as_os_str())?;
    // argv[0] 必须引用；arguments 仅来自内部固定参数，不接收项目路径或用户命令。
    let mut command_line = vec![b'"' as u16];
    command_line.extend(executable.as_os_str().encode_wide());
    command_line.extend("\" ".encode_utf16());
    command_line.extend(wide(OsStr::new(arguments))?);
    let startup = STARTUPINFOW {
        cb: std::mem::size_of::<STARTUPINFOW>() as u32,
        // 隐藏仅用于测试；不设置 STARTF_USESTDHANDLES，让新控制台创建自己的 stdio。
        dwFlags: if hidden { STARTF_USESHOWWINDOW } else { 0 },
        wShowWindow: 0,
        ..Default::default()
    };
    let mut process = PROCESS_INFORMATION::default();
    // SAFETY: 所有 UTF-16 缓冲区均以 NUL 结尾，生命周期覆盖同步调用；命令行可写。
    // 不继承父进程句柄，也不复用父进程的重定向 stdin/stdout/stderr。
    let success = unsafe {
        CreateProcessW(
            program.as_ptr(),
            command_line.as_mut_ptr(),
            null(),
            null(),
            0,
            CREATE_NEW_CONSOLE,
            null(),
            directory.as_ptr(),
            &startup,
            &mut process,
        )
    };
    if success == 0 {
        return Err(std::io::Error::last_os_error().to_string());
    }
    // SAFETY: 成功的 CreateProcessW 返回两个独立有效句柄，分别转交 RAII 关闭。
    unsafe {
        drop(OwnedHandle::from_raw_handle(process.hThread));
        Ok(OwnedHandle::from_raw_handle(process.hProcess))
    }
}
