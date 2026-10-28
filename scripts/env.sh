#!/usr/bin/env bash
# 统一环境：挂载 Windows 盘符、代理、工具路径。
# 用法：source scripts/env.sh
set -euo pipefail

mount_drive() {
    if ! grep -q " $2 " /proc/mounts; then
        sudo mount -t drvfs "$1" "$2"
    fi
}

mount_drive C: /mnt/c
mount_drive D: /mnt/d
mount_drive E: /mnt/e

export ROOT="/mnt/e/Tauri_Project/TaskWarden"
export QTDIR="/mnt/d/ProgramFiles/Qt/6.9.3/msvc2022_64"
export CMAKE="/mnt/d/ProgramFiles/CMake/bin/cmake.exe"
export CARGO="/mnt/c/Users/dtxian/.cargo/bin/cargo.exe"
export RUSTC="/mnt/c/Users/dtxian/.cargo/bin/rustc.exe"
export WIN32="/mnt/c/Windows/System32"

# 代理：取 WSL 默认网关（Windows 宿主机），端口 7897
GW="$(ip route | awk '/^default/{print $3; exit}')"
if [ -n "${GW:-}" ]; then
    export http_proxy="http://$GW:7897"
    export https_proxy="$http_proxy"
fi

echo "[env] ROOT=$ROOT"
echo "[env] Qt=$QTDIR"
echo "[env] proxy=${http_proxy:-none}"
