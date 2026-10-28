cmake_minimum_required(VERSION 3.24)
project(taskwarden LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_AUTOMOC ON)
set(CMAKE_AUTORCC ON)
set(CMAKE_AUTOUIC ON)

find_package(Qt6 REQUIRED COMPONENTS Core Gui Widgets)

add_executable(taskwarden WIN32
    src/main.cpp
)

target_link_libraries(taskwarden PRIVATE Qt6::Core Qt6::Gui Qt6::Widgets)
