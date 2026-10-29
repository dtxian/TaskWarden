/* ------------------------------------------------------------------ */
/* EngineClient：C ABI 包装 —— 只碰 UTF-8 字符串，QTimer 250ms 轮询      */
/* 快照/日志/通知均经 QJsonDocument 解析；命令返回 0/-1/-2 透传           */
/* ------------------------------------------------------------------ */

#pragma once

#include <QJsonArray>
#include <QJsonObject>
#include <QObject>
#include <QString>
#include <QTimer>

#include "twengine.h"

class EngineClient : public QObject {
    Q_OBJECT
public:
    explicit EngineClient(const QString& dataDir, QObject* parent = nullptr);
    ~EngineClient() override;

    bool valid() const { return engine_ != nullptr; }
    QString lastError() const;

    QJsonObject snapshot() const { return snapshot_; }
    QJsonArray logs(const QString& id, int limit) const;

    /// 调节轮询节拍（ms）：窗口可见时较快，收进托盘时放慢以省资源。
    void setPollInterval(int ms);

    int start(const QString& id);
    int stop(const QString& id);
    int restart(const QString& id);
    int startAll();
    int stopAll();
    int crash(const QString& id);
    int resetBreaker(const QString& id);
    int addTask(const QJsonObject& cfg);
    int updateTask(const QJsonObject& cfg);
    int removeTask(const QString& id);
    int setFaultInject(bool flag);
    int clearLogs(const QString& id);
    int shutdown();

signals:
    void snapshotUpdated();
    void notice(const QString& kind, const QString& text);

private:
    void poll();

    TwEngine* engine_ = nullptr;
    QTimer* timer_ = nullptr;
    QJsonObject snapshot_;
};
