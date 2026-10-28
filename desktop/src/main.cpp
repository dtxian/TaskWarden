/* ------------------------------------------------------------------ */
/* main.cpp：Qt 6 Widgets 入口 —— 单实例 → 引擎 → 主窗口 → 托盘           */
/* ------------------------------------------------------------------ */

#include <QApplication>
#include <QCoreApplication>
#include <QFile>
#include <QIcon>
#include <QMessageBox>

#include "EngineClient.h"
#include "MainWindow.h"
#include "SingleInstance.h"
#include "TrayController.h"

int main(int argc, char** argv)
{
    QApplication app(argc, argv);
    app.setApplicationName(QStringLiteral("TaskWarden"));
    app.setOrganizationName(QStringLiteral("TaskWarden"));
    app.setWindowIcon(QIcon(QStringLiteral(":/icons/app.ico")));
    // 关键：关窗（收进托盘）后应用继续常驻，不随最后一个窗口关闭退出
    QApplication::setQuitOnLastWindowClosed(false);

    // 深色主题
    QFile qss(QStringLiteral(":/dark.qss"));
    if (qss.open(QIODevice::ReadOnly | QIODevice::Text)) {
        app.setStyleSheet(QString::fromUtf8(qss.readAll()));
    }

    // 单实例：二次启动仅激活首实例窗口后退出
    SingleInstance si(QStringLiteral("TaskWarden.single.instance"));
    if (!si.isPrimary()) {
        return 0;
    }

    // 便携数据目录：<exe 目录>\data
    const QString dataDir = QCoreApplication::applicationDirPath() + QStringLiteral("/data");
    EngineClient engine(dataDir);
    if (!engine.valid()) {
        QMessageBox::critical(nullptr, QStringLiteral("TaskWarden"),
                              QStringLiteral("引擎初始化失败：") + engine.lastError());
        return 1;
    }

    MainWindow win(&engine);
    TrayController tray(&win, &engine);
    QObject::connect(&si, &SingleInstance::showRequested, &win, &MainWindow::showAndRaise);

    win.show();
    return app.exec();
}
