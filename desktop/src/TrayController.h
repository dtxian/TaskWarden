/* ------------------------------------------------------------------ */
/* TrayController：系统托盘 —— 图标来自 qrc，菜单（显示/退出），点击恢复    */
/* ------------------------------------------------------------------ */

#pragma once

#include <QObject>

class QMenu;
class QSystemTrayIcon;
class MainWindow;
class EngineClient;

class TrayController : public QObject {
    Q_OBJECT
public:
    explicit TrayController(MainWindow* win, EngineClient* engine, QObject* parent = nullptr);

    /// 托盘气泡提示（首次收进托盘时提示一次）
    void notifyOnce(const QString& title, const QString& msg);

private:
    QSystemTrayIcon* tray_ = nullptr;
    QMenu* menu_ = nullptr;
    bool notified_ = false;
};
