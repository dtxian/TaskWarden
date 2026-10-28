/* ------------------------------------------------------------------ */
/* SingleInstance：QLocalServer 单实例 —— 二次启动仅激活首实例窗口        */
/* ------------------------------------------------------------------ */

#pragma once

#include <QObject>

class QLocalServer;

class SingleInstance : public QObject {
    Q_OBJECT
public:
    explicit SingleInstance(const QString& key, QObject* parent = nullptr);

    /// false = 已有实例在运行（本进程应退出）
    bool isPrimary() const { return primary_; }

signals:
    void showRequested();

private:
    void onNewConnection();

    QLocalServer* server_ = nullptr;
    bool primary_ = false;
};
