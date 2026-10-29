/* ------------------------------------------------------------------ */
/* TrayController.cpp：见 TrayController.h                              */
/* ------------------------------------------------------------------ */

#include "TrayController.h"

#include "MainWindow.h"

#include <QIcon>
#include <QMenu>
#include <QSystemTrayIcon>

TrayController::TrayController(MainWindow* win, EngineClient* engine, QObject* parent)
    : QObject(parent)
{
    Q_UNUSED(engine)
    tray_ = new QSystemTrayIcon(QIcon(QStringLiteral(":/icons/tray.png")), this);
    tray_->setToolTip(QStringLiteral("TaskWarden · 轻量级后台任务守护监督器"));

    menu_ = new QMenu(win);
    QAction* showAct = menu_->addAction(QStringLiteral("显示主窗口"));
    menu_->addSeparator();
    QAction* quitAct = menu_->addAction(QStringLiteral("退出程序"));
    tray_->setContextMenu(menu_);

    connect(showAct, &QAction::triggered, win, &MainWindow::showAndRaise);
    connect(quitAct, &QAction::triggered, win, &MainWindow::requestQuit);
    connect(tray_, &QSystemTrayIcon::activated, this, [win](QSystemTrayIcon::ActivationReason reason) {
        if (reason == QSystemTrayIcon::Trigger) {
            win->showAndRaise();
        }
    });

    tray_->show();
}

void TrayController::notifyOnce(const QString& title, const QString& msg)
{
    if (notified_ || !tray_) {
        return;
    }
    notified_ = true;
    tray_->showMessage(title, msg, QSystemTrayIcon::Information, 3000);
}
