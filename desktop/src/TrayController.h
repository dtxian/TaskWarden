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

private:
    QSystemTrayIcon* tray_ = nullptr;
    QMenu* menu_ = nullptr;
};
