cmake_minimum_required(VERSION 3.24)
project(taskwarden LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_AUTOMOC ON)
set(CMAKE_AUTORCC ON)
set(CMAKE_AUTOUIC ON)

# MSVC 默认按 GBK(936) 读源码，会把 UTF-8 中文注释/字符串字面量误编译；
# /utf-8 让源码与执行字符集都按 UTF-8，UI 中文文案才能正确渲染。
if(MSVC)
    add_compile_options(/utf-8)
endif()

find_package(Qt6 REQUIRED COMPONENTS Core Gui Widgets)

# ---- Rust 引擎静态库 ----
# 原生系统库来自：cargo rustc --release -- --print native-static-libs
set(RUST_LIB "" CACHE FILEPATH "taskwarden_engine.lib 路径")
if(NOT RUST_LIB)
    set(RUST_LIB "${CMAKE_SOURCE_DIR}/../engine/target/release/taskwarden_engine.lib")
endif()
set(RUST_NATIVE_LIBS kernel32 ntdll userenv ws2_32 dbghelp)

# ---- 主 GUI（M2 阶段仍为空窗口，M3 起接入引擎） ----
add_executable(taskwarden WIN32
    src/main.cpp
)
target_link_libraries(taskwarden PRIVATE
    Qt6::Core Qt6::Gui Qt6::Widgets
    ${RUST_LIB} ${RUST_NATIVE_LIBS}
)

# ---- ffi_smoke 控制台冒烟（不依赖 Qt） ----
add_executable(ffi_smoke
    smoke/ffi_smoke.cpp
)
target_link_libraries(ffi_smoke PRIVATE ${RUST_LIB} ${RUST_NATIVE_LIBS})
