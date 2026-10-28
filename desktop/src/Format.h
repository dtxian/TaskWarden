/* ------------------------------------------------------------------ */
/* Format.h：纯展示格式化工具（时长 / 时钟 / 状态排序权重）                */
/* ------------------------------------------------------------------ */

#pragma once

#include <QDateTime>
#include <QString>

/// 时长 "3.2s" / "1m05s" / "2h03m"
inline QString fmtDur(qint64 ms)
{
    if (ms < 0) ms = 0;
    const qint64 s = ms / 1000;
    if (s < 60) {
        return QStringLiteral("%1s").arg(s);
    }
    const qint64 m = s / 60;
    if (m < 60) {
        return QStringLiteral("%1m%2s").arg(m).arg(s % 60, 2, 10, QLatin1Char('0'));
    }
    const qint64 h = m / 60;
    return QStringLiteral("%1h%2m").arg(h).arg(m % 60, 2, 10, QLatin1Char('0'));
}

/// 本地时钟 "HH:mm:ss"（unix 毫秒）
inline QString fmtClock(qint64 ms)
{
    return QDateTime::fromMSecsSinceEpoch(ms).toString(QStringLiteral("HH:mm:ss"));
}

/// 状态排序权重：running<starting<backoff<fused<stopped（与 Tauri 版 ORDER 一致）
inline int stateRank(const QString& state)
{
    if (state == QStringLiteral("running")) return 0;
    if (state == QStringLiteral("starting")) return 1;
    if (state == QStringLiteral("backoff")) return 2;
    if (state == QStringLiteral("fused")) return 3;
    return 4; // stopped 及未知
}
