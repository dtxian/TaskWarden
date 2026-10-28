/* ------------------------------------------------------------------ */
/* twengine.h：TaskWarden 引擎 C ABI 声明（与 engine/src/ffi.rs 对齐）   */
/* 所有字符串 UTF-8；返回的 char* 由调用方 tw_free_string 释放。          */
/* 命令返回 0 成功 / -1 失败(见 tw_last_error) / -2 队列满。              */
/* ------------------------------------------------------------------ */

#pragma once

#include <cstdint>

#ifdef __cplusplus
extern "C" {
#endif

typedef struct TwEngine TwEngine;

/* 生命周期 */
TwEngine*   tw_engine_new(const char* data_dir_utf8); /* 失败返回 NULL */
void        tw_engine_free(TwEngine*);                /* 同步 shutdown */
const char* tw_last_error(TwEngine*);                 /* 线程内有效 */

/* 命令 */
int32_t tw_start(TwEngine*, const char* id);
int32_t tw_stop(TwEngine*, const char* id);
int32_t tw_restart(TwEngine*, const char* id);
int32_t tw_start_all(TwEngine*);
int32_t tw_stop_all(TwEngine*);
int32_t tw_crash(TwEngine*, const char* id);
int32_t tw_reset_breaker(TwEngine*, const char* id);
int32_t tw_add_task(TwEngine*, const char* cfg_json);    /* snake_case TaskConfig */
int32_t tw_update_task(TwEngine*, const char* cfg_json);
int32_t tw_remove_task(TwEngine*, const char* id);
int32_t tw_set_fault_inject(TwEngine*, int32_t flag);
int32_t tw_clear_logs(TwEngine*, const char* id);
int32_t tw_shutdown(TwEngine*);

/* 查询 */
char*  tw_snapshot_json(TwEngine*);                       /* 调用方 tw_free_string */
char*  tw_logs_json(TwEngine*, const char* id, uint32_t limit);
char*  tw_notices_json(TwEngine*);                        /* 取走并清空 */
void   tw_free_string(char*);

#ifdef __cplusplus
}
#endif
