#!/usr/bin/env bash
# 一键构建：Rust 静态库 + Qt 桌面端。
# 用法：bash scripts/build-all.sh
set -euo pipefail

DIR="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=/dev/null
source "$DIR/env.sh"

cd "$ROOT"

echo "==> cargo build"
"$CARGO" build --release --manifest-path engine/Cargo.toml

echo "==> cmake configure"
"$CMAKE" \
    -S "E:/Tauri_Project/TaskWarden/desktop" \
    -B "E:/Tauri_Project/TaskWarden/desktop/build" \
    -G "Visual Studio 17 2022" -A x64 \
    -DCMAKE_PREFIX_PATH="D:/ProgramFiles/Qt/6.9.3/msvc2022_64" \
    -DRUST_LIB="E:/Tauri_Project/TaskWarden/engine/target/release/taskwarden_engine.lib"

echo "==> cmake build"
"$CMAKE" --build "E:/Tauri_Project/TaskWarden/desktop/build" --config Release

echo "==> done"
