/* ------------------------------------------------------------------ */
/* MainWindow.cpp：见 MainWindow.h                                      */
/* ------------------------------------------------------------------ */

#include "MainWindow.h"

#include "EngineClient.h"

#include <QApplication>
#include <QCloseEvent>
#include <QJsonArray>
#include <QJsonObject>
#include <QLabel>
#include <QStatusBar>
#include <QToolBar>

namespace {

QString formatDuration(qint64 secs)
{
    const qint64 h = secs / 3600;
    const qint64 m = (secs % 3600) / 60;
    const qint64 s = secs % 60;
    return QStringLiteral("%1:%2:%3")
        .arg(h, 2, 10, QLatin1Char('0'))
        .arg(m, 2, 10, QLatin1Char('0'))
        .arg(s, 2, 10, QLatin1Char('0'));
}

} // namespace

MainWindow::MainWindow(EngineClient* engine, QWidget* parent)
    : QMainWindow(parent)
    , engine_(engine)
{
    setWindowTitle(QStringLiteral("TaskWarden · 轻量级后台任务守护监督器"));
    resize(960, 640);

    auto* tb = addToolBar(QStringLiteral("main"));
    tb->setMovable(false);
    tb->setObjectName(QStringLiteral("mainToolBar"));
    QAction* startAll = tb->addAction(QStringLiteral("启动全部"));
    QAction* stopAll = tb->addAction(QStringLiteral("停止全部"));
    connect(startAll, &QAction::triggered, this, [this] { engine_->startAll(); });
    connect(stopAll, &QAction::triggered, this, [this] { engine_->stopAll(); });

    auto* central = new QLabel(QStringLiteral("任务区将在 M4 实现"), this);
    central->setAlignment(Qt::AlignCenter);
    central->setObjectName(QStringLiteral("placeholder"));
    setCentralWidget(central);

    cpuLabel_ = new QLabel(QStringLiteral("CPU --"));
    memLabel_ = new QLabel(QStringLiteral("内存 --"));
    gpuLabel_ = new QLabel(QStringLiteral("GPU --"));
    taskLabel_ = new QLabel(QStringLiteral("运行 0/0"));
    uptimeLabel_ = new QLabel(QStringLiteral("运行 00:00:00"));
    statusBar()->addPermanentWidget(cpuLabel_);
    statusBar()->addPermanentWidget(memLabel_);
    statusBar()->addPermanentWidget(gpuLabel_);
    statusBar()->addPermanentWidget(taskLabel_);
    statusBar()->addPermanentWidget(uptimeLabel_);

    uptime_.start();

    connect(engine_, &EngineClient::snapshotUpdated, this, &MainWindow::onSnapshot);
    connect(engine_, &EngineClient::notice, this, [this](const QString& kind, const QString& text) {
        Q_UNUSED(kind)
        statusBar()->showMessage(text, 4000);
    });
}

void MainWindow::closeEvent(QCloseEvent* e)
{
    if (quitting_) {
        e->accept();
        return;
    }
    // 关闭到托盘：隐藏窗口，进程常驻
    e->ignore();
    hide();
}

void MainWindow::showAndRaise()
{
    show();
    raise();
    activateWindow();
}

void MainWindow::requestQuit()
{
    quitting_ = true;
    engine_->shutdown();
    QApplication::quit();
}

void MainWindow::onSnapshot()
{
    const QJsonObject s = engine_->snapshot();
    const double cpu = s.value(QStringLiteral("cpu")).toDouble();
    const double mem = s.value(QStringLiteral("mem")).toDouble();
    const double gpu = s.value(QStringLiteral("gpu")).toDouble();
    const int running = s.value(QStringLiteral("runningCount")).toInt();
    const QJsonArray tasks = s.value(QStringLiteral("tasks")).toArray();

    cpuLabel_->setText(QStringLiteral("CPU %1%").arg(cpu, 0, 'f', 1));
    memLabel_->setText(QStringLiteral("内存 %1%").arg(mem, 0, 'f', 1));
    gpuLabel_->setText(gpu > 0.0 ? QStringLiteral("GPU %1%").arg(gpu, 0, 'f', 1)
                                 : QStringLiteral("GPU N/A"));
    taskLabel_->setText(QStringLiteral("运行 %1/%2").arg(running).arg(tasks.size()));
    uptimeLabel_->setText(QStringLiteral("运行 %1").arg(formatDuration(uptime_.elapsed() / 1000)));
}
