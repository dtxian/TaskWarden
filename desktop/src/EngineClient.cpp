/* ------------------------------------------------------------------ */
/* EngineClient.cpp：见 EngineClient.h                                  */
/* ------------------------------------------------------------------ */

#include "EngineClient.h"

#include <QJsonDocument>
#include <QJsonParseError>

namespace {

QString takeString(char* p)
{
    if (!p) {
        return QString();
    }
    QString s = QString::fromUtf8(p);
    tw_free_string(p);
    return s;
}

} // namespace

EngineClient::EngineClient(const QString& dataDir, QObject* parent)
    : QObject(parent)
{
    QByteArray dir = dataDir.toUtf8();
    engine_ = tw_engine_new(dir.constData());
    if (!engine_) {
        return;
    }
    timer_ = new QTimer(this);
    timer_->setInterval(250);
    connect(timer_, &QTimer::timeout, this, &EngineClient::poll);
    timer_->start();
}

EngineClient::~EngineClient()
{
    if (engine_) {
        tw_shutdown(engine_);
        tw_engine_free(engine_);
        engine_ = nullptr;
    }
}

QString EngineClient::lastError() const
{
    if (!engine_) {
        return QStringLiteral("引擎未初始化");
    }
    const char* p = tw_last_error(engine_);
    return p ? QString::fromUtf8(p) : QString();
}

void EngineClient::poll()
{
    if (!engine_) {
        return;
    }
    // 快照
    {
        QString raw = takeString(tw_snapshot_json(engine_));
        QJsonParseError err{};
        QJsonDocument doc = QJsonDocument::fromJson(raw.toUtf8(), &err);
        if (err.error == QJsonParseError::NoError && doc.isObject()) {
            snapshot_ = doc.object();
        }
    }
    // 通知（取走并清空）
    {
        QString raw = takeString(tw_notices_json(engine_));
        QJsonParseError err{};
        QJsonDocument doc = QJsonDocument::fromJson(raw.toUtf8(), &err);
        if (err.error == QJsonParseError::NoError && doc.isArray()) {
            const QJsonArray arr = doc.array();
            for (const auto& v : arr) {
                const QJsonObject o = v.toObject();
                emit notice(o.value(QStringLiteral("kind")).toString(),
                            o.value(QStringLiteral("text")).toString());
            }
        }
    }
    emit snapshotUpdated();
}

QJsonArray EngineClient::logs(const QString& id, int limit) const
{
    if (!engine_) {
        return {};
    }
    QByteArray idb = id.toUtf8();
    QString raw = takeString(tw_logs_json(engine_, idb.constData(), static_cast<uint32_t>(limit)));
    QJsonParseError err{};
    QJsonDocument doc = QJsonDocument::fromJson(raw.toUtf8(), &err);
    if (err.error == QJsonParseError::NoError && doc.isArray()) {
        return doc.array();
    }
    return {};
}

int EngineClient::start(const QString& id)
{
    if (!engine_) return -1;
    QByteArray b = id.toUtf8();
    return tw_start(engine_, b.constData());
}

int EngineClient::stop(const QString& id)
{
    if (!engine_) return -1;
    QByteArray b = id.toUtf8();
    return tw_stop(engine_, b.constData());
}

int EngineClient::restart(const QString& id)
{
    if (!engine_) return -1;
    QByteArray b = id.toUtf8();
    return tw_restart(engine_, b.constData());
}

int EngineClient::startAll()
{
    return engine_ ? tw_start_all(engine_) : -1;
}

int EngineClient::stopAll()
{
    return engine_ ? tw_stop_all(engine_) : -1;
}

int EngineClient::crash(const QString& id)
{
    if (!engine_) return -1;
    QByteArray b = id.toUtf8();
    return tw_crash(engine_, b.constData());
}

int EngineClient::resetBreaker(const QString& id)
{
    if (!engine_) return -1;
    QByteArray b = id.toUtf8();
    return tw_reset_breaker(engine_, b.constData());
}

int EngineClient::addTask(const QJsonObject& cfg)
{
    if (!engine_) return -1;
    QByteArray j = QJsonDocument(cfg).toJson(QJsonDocument::Compact);
    return tw_add_task(engine_, j.constData());
}

int EngineClient::updateTask(const QJsonObject& cfg)
{
    if (!engine_) return -1;
    QByteArray j = QJsonDocument(cfg).toJson(QJsonDocument::Compact);
    return tw_update_task(engine_, j.constData());
}

int EngineClient::removeTask(const QString& id)
{
    if (!engine_) return -1;
    QByteArray b = id.toUtf8();
    return tw_remove_task(engine_, b.constData());
}

int EngineClient::setFaultInject(bool flag)
{
    return engine_ ? tw_set_fault_inject(engine_, flag ? 1 : 0) : -1;
}

int EngineClient::clearLogs(const QString& id)
{
    if (!engine_) return -1;
    QByteArray b = id.toUtf8();
    return tw_clear_logs(engine_, b.constData());
}

int EngineClient::shutdown()
{
    if (!engine_) return -1;
    return tw_shutdown(engine_);
}
