/* ------------------------------------------------------------------ */
/* main.cpp：Qt 6 Widgets 入口（M0 骨架：空窗口冒烟）                    */
/* ------------------------------------------------------------------ */

#include <QApplication>
#include <QLabel>
#include <QMainWindow>

int main(int argc, char** argv)
{
    QApplication app(argc, argv);
    app.setApplicationName(QStringLiteral("TaskWarden"));
    app.setOrganizationName(QStringLiteral("TaskWarden"));

    QMainWindow window;
    window.setWindowTitle(QStringLiteral("TaskWarden · M0 骨架"));
    auto* label = new QLabel(QStringLiteral("TaskWarden Qt 骨架 · M0"), &window);
    label->setAlignment(Qt::AlignCenter);
    window.resize(640, 360);
    window.show();

    return app.exec();
}
