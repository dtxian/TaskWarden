/* ------------------------------------------------------------------ */
/* ffi_smoke.cpp：C ABI 冒烟 —— 打印 5 种子任务，验证 start/stop 状态流转  */
/* 用法：ffi_smoke.exe [data_dir_utf8]                                  */
/* ------------------------------------------------------------------ */

#include "../src/twengine.h"

#include <chrono>
#include <cstdio>
#include <string>
#include <thread>

static std::string grab(char* p)
{
    if (!p) {
        return {};
    }
    std::string s(p);
    tw_free_string(p);
    return s;
}

static bool contains(const std::string& hay, const std::string& needle)
{
    return hay.find(needle) != std::string::npos;
}

int main(int argc, char** argv)
{
    const char* data_dir = (argc > 1) ? argv[1] : nullptr;
    std::printf("== ffi_smoke ==\n");

    TwEngine* e = tw_engine_new(data_dir);
    if (!e) {
        std::printf("FAIL: tw_engine_new 返回 NULL\n");
        return 1;
    }
    std::printf("engine created\n");

    /* 1) 快照：5 个种子任务 */
    std::string snap = grab(tw_snapshot_json(e));
    std::printf("--- snapshot (种子) ---\n%.1600s\n", snap.c_str());
    const char* seeds[] = {"ollama-serve", "model-router", "frpc-tunnel", "log-shipper", "nightly-sync"};
    int seed_ok = 0;
    for (const char* s : seeds) {
        if (contains(snap, std::string("\"name\":\"") + s + "\"")) {
            seed_ok++;
        } else {
            std::printf("FAIL: 缺种子任务 %s\n", s);
        }
    }
    std::printf("种子任务命中 %d/5\n", seed_ok);

    /* 2) 添加一个真实可跑任务：ping -t 127.0.0.1（长驻，便于验证停止） */
    const char* cfg = "{\"name\":\"smoke-ping\",\"kind\":\"exe\",\"path\":\"ping\","
                      "\"args\":[\"-t\",\"127.0.0.1\"],\"cwd\":\"\",\"strategy\":\"never\","
                      "\"graceful_timeout\":0,\"deps\":[],\"health\":{\"mode\":\"none\",\"target\":\"\"},"
                      "\"enabled\":true}";
    int rc = tw_add_task(e, cfg);
    std::printf("tw_add_task rc=%d\n", rc);

    /* 3) 启动 → 轮询 running */
    rc = tw_start(e, "smoke-ping");
    std::printf("tw_start rc=%d\n", rc);
    bool running = false;
    for (int i = 0; i < 50 && !running; i++) {
        std::this_thread::sleep_for(std::chrono::milliseconds(100));
        std::string s = grab(tw_snapshot_json(e));
        if (contains(s, "\"name\":\"smoke-ping\",\"state\":\"running\"")) {
            running = true;
        }
    }
    std::printf("state running: %s\n", running ? "YES" : "NO");
    if (running) {
        std::string s = grab(tw_snapshot_json(e));
        size_t p = s.find("smoke-ping");
        if (p != std::string::npos) {
            std::printf("--- running 片段 ---\n%.400s\n", s.c_str() + p);
        }
    }

    /* 4) 停止 → 轮询 stopped */
    rc = tw_stop(e, "smoke-ping");
    std::printf("tw_stop rc=%d\n", rc);
    bool stopped = false;
    for (int i = 0; i < 50 && !stopped; i++) {
        std::this_thread::sleep_for(std::chrono::milliseconds(100));
        std::string s = grab(tw_snapshot_json(e));
        if (contains(s, "\"name\":\"smoke-ping\",\"state\":\"stopped\"")) {
            stopped = true;
        }
    }
    std::printf("state stopped: %s\n", stopped ? "YES" : "NO");

    /* 5) 日志回看（应有派生/停止记录） */
    std::string logs = grab(tw_logs_json(e, "smoke-ping", 20));
    std::printf("--- logs ---\n%.1200s\n", logs.c_str());

    /* 6) 收尾 */
    tw_shutdown(e);
    tw_engine_free(e);

    bool pass = (seed_ok == 5 && running && stopped);
    std::printf("== %s ==\n", pass ? "PASS" : "FAIL");
    return pass ? 0 : 1;
}
