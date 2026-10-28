/* ------------------------------------------------------------------ */
/* main.cpp：Qt 6 Widgets 入口 —— 单实例 → 引擎 → 主窗口 → 托盘           */
/* ------------------------------------------------------------------ */

#include <QApplication>
#include <QColor>
#include <QCoreApplication>
#include <QFile>
#include <QFont>
#include <QIcon>
#include <QMessageBox>
#include <QPalette>

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

    // 深色主题：用 QPalette 全局着色（避免 QSS 通用 QWidget 选择器对每个控件
    // 都启用样式表引擎的昂贵开销）；QSS 仅作用于菜单/滚动条等有限控件。
    QPalette pal;
    pal.setColor(QPalette::Window, QColor(0x0b, 0x0d, 0x0f));
    pal.setColor(QPalette::WindowText, QColor(0xc8, 0xd0, 0xd8));
    pal.setColor(QPalette::Base, QColor(0x0f, 0x14, 0x18));
    pal.setColor(QPalette::AlternateBase, QColor(0x14, 0x19, 0x1e));
    pal.setColor(QPalette::Text, QColor(0xc8, 0xd0, 0xd8));
    pal.setColor(QPalette::Button, QColor(0x1a, 0x20, 0x26));
    pal.setColor(QPalette::ButtonText, QColor(0xc8, 0xd0, 0xd8));
    pal.setColor(QPalette::Highlight, QColor(0xe8, 0x87, 0x3a));
    pal.setColor(QPalette::HighlightedText, QColor(0x1a, 0x0d, 0x04));
    pal.setColor(QPalette::ToolTipBase, QColor(0x14, 0x19, 0x1e));
    pal.setColor(QPalette::ToolTipText, QColor(0xc8, 0xd0, 0xd8));
    pal.setColor(QPalette::PlaceholderText, QColor(0x6c, 0x78, 0x87));
    app.setPalette(pal);
    app.setFont(QFont(QStringLiteral("Segoe UI"), 9));

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

    // 测试钩子：--autostart 启动后自动「启动全部」（验收/压测用）
    if (app.arguments().contains(QStringLiteral("--autostart"))) {
        engine.startAll();
    }

    win.show();
    return app.exec();
}
