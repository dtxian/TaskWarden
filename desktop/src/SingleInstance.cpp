/* ------------------------------------------------------------------ */
/* SingleInstance.cpp：见 SingleInstance.h                              */
/* ------------------------------------------------------------------ */

#include "SingleInstance.h"

#include <QLocalServer>
#include <QLocalSocket>

SingleInstance::SingleInstance(const QString& key, QObject* parent)
    : QObject(parent)
{
    // 先探测已有实例
    QLocalSocket probe;
    probe.connectToServer(key);
    if (probe.waitForConnected(300)) {
        probe.write("show");
        probe.flush();
        probe.waitForBytesWritten(300);
        primary_ = false;
        return;
    }
    // 清理陈旧 socket 后成为首实例
    QLocalServer::removeServer(key);
    server_ = new QLocalServer(this);
    if (server_->listen(key)) {
        primary_ = true;
        connect(server_, &QLocalServer::newConnection, this, &SingleInstance::onNewConnection);
    } else {
        // 监听失败不阻断启动（单实例是增强，不是硬约束）
        primary_ = true;
    }
}

void SingleInstance::onNewConnection()
{
    while (server_->hasPendingConnections()) {
        QLocalSocket* sock = server_->nextPendingConnection();
        sock->disconnectFromServer();
        sock->deleteLater();
        emit showRequested();
    }
}
