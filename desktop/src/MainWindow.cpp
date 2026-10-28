/* ------------------------------------------------------------------ */
/* MainWindow.cpp：见 MainWindow.h                                      */
/* ------------------------------------------------------------------ */

#include "MainWindow.h"

#include "EngineClient.h"
#include "Format.h"
#include "LogPanel.h"
#include "Sparkline.h"
#include "TaskCard.h"
#include "TaskDialog.h"

#include <QAction>
#include <QApplication>
#include <QCloseEvent>
#include <QColor>
#include <QDateTime>
#include <QGridLayout>
#include <QHBoxLayout>
#include <QJsonObject>
#include <QLabel>
#include <QMessageBox>
#include <QPushButton>
#include <QResizeEvent>
#include <QScrollArea>
#include <QScrollBar>
#include <QSet>
#include <QSplitter>
#include <QStatusBar>
#include <QTimer>
#include <QToolBar>
#include <QVBoxLayout>

#include <algorithm>
#include <utility>

MainWindow::MainWindow(EngineClient* engine, QWidget* parent)
    : QMainWindow(parent)
    , engine_(engine)
{
    setWindowTitle(QStringLiteral("TaskWarden · 轻量级后台任务守护监督器"));
    resize(1080, 720);

    // 工具栏
    auto* tb = addToolBar(QStringLiteral("main"));
    tb->setMovable(false);
    tb->setObjectName(QStringLiteral("mainToolBar"));
    QAction* startAll = tb->addAction(QStringLiteral("启动全部"));
    QAction* stopAll = tb->addAction(QStringLiteral("停止全部"));
    QAction* addTask = tb->addAction(QStringLiteral("添加任务"));
    faultInjectAct_ = tb->addAction(QStringLiteral("故障注入"));
    faultInjectAct_->setCheckable(true);
    connect(startAll, &QAction::triggered, this, [this] { engine_->startAll(); });
    connect(stopAll, &QAction::triggered, this, [this] { engine_->stopAll(); });
    connect(addTask, &QAction::triggered, this, &MainWindow::openAddDialog);
    connect(faultInjectAct_, &QAction::toggled, this, [this](bool on) {
        if (on) {
            engine_->setFaultInject(true);
        }
    });

    // 中央区
    auto* central = new QWidget(this);
    auto* centralLayout = new QVBoxLayout(central);
    centralLayout->setContentsMargins(0, 0, 0, 0);
    centralLayout->setSpacing(0);
    setCentralWidget(central);

    buildResourceBar(central);
    centralLayout->addWidget(central->findChild<QWidget*>(QStringLiteral("resourceBar")));

    // 任务网格 + 日志面板（纵向分割）
    auto* splitter = new QSplitter(Qt::Vertical, central);
    taskScroll_ = new QScrollArea(splitter);
    taskScroll_->setWidgetResizable(true);
    taskScroll_->setHorizontalScrollBarPolicy(Qt::ScrollBarAlwaysOff);
    taskContainer_ = new QWidget();
    grid_ = new QGridLayout(taskContainer_);
    grid_->setContentsMargins(12, 12, 12, 12);
    grid_->setSpacing(12);
    grid_->setAlignment(Qt::AlignTop);
    taskScroll_->setWidget(taskContainer_);

    logPanel_ = new LogPanel(splitter);
    splitter->addWidget(taskScroll_);
    splitter->addWidget(logPanel_);
    splitter->setStretchFactor(0, 3);
    splitter->setStretchFactor(1, 1);
    splitter->setSizes({ 480, 200 });
    centralLayout->addWidget(splitter, 1);

    // 底部状态栏
    configPathLabel_ = new QLabel(this);
    statsLabel_ = new QLabel(this);
    lastErrorLabel_ = new QLabel(this);
    configPathLabel_->setStyleSheet(QStringLiteral("font-family:Consolas,monospace;font-size:10px;color:#8a949e;"));
    statsLabel_->setStyleSheet(QStringLiteral("font-family:Consolas,monospace;font-size:10px;color:#8a949e;"));
    lastErrorLabel_->setStyleSheet(QStringLiteral("font-family:Consolas,monospace;font-size:10px;color:#8a949e;"));
    statusBar()->addWidget(configPathLabel_);
    statusBar()->addWidget(statsLabel_);
    statusBar()->addWidget(lastErrorLabel_, 1);

    uptime_.start();

    connect(engine_, &EngineClient::snapshotUpdated, this, &MainWindow::onSnapshot);
    connect(engine_, &EngineClient::notice, this, [this](const QString& kind, const QString& text) {
        Q_UNUSED(kind)
        statusBar()->showMessage(text, 4000);
    });
    connect(logPanel_, &LogPanel::clearRequested, this, [this](const QString& id) {
        engine_->clearLogs(id);
    });

    // 1Hz 计时刷新（倒计时/uptime 只需秒级）
    auto* ticker = new QTimer(this);
    ticker->setInterval(1000);
    connect(ticker, &QTimer::timeout, this, &MainWindow::tick1s);
    ticker->start();

    // 初始选中第一个任务（有则）
    const QJsonArray tasks = engine_->snapshot().value(QStringLiteral("tasks")).toArray();
    if (!tasks.isEmpty()) {
        selectTask(tasks.first().toObject().value(QStringLiteral("name")).toString());
    }
}

void MainWindow::buildResourceBar(QWidget* parent)
{
    auto* bar = new QWidget(parent);
    bar->setObjectName(QStringLiteral("resourceBar"));
    bar->setStyleSheet(QStringLiteral("QWidget#resourceBar{background:#12161a;border-bottom:1px solid #1c2228;}"));

    auto* lay = new QHBoxLayout(bar);
    lay->setContentsMargins(12, 6, 12, 6);
    lay->setSpacing(14);

    const QString nameStyle = QStringLiteral("color:#8a949e;font-size:11px;");
    auto makeValue = [](const QColor& c) {
        auto* v = new QLabel(QStringLiteral("--"));
        v->setStyleSheet(QStringLiteral("font-family:Consolas,monospace;font-size:12px;font-weight:bold;color:%1;").arg(c.name()));
        return v;
    };

    // CPU（带 sparkline）
    auto* cpuName = new QLabel(QStringLiteral("CPU"), bar);
    cpuName->setStyleSheet(nameStyle);
    cpuValue_ = makeValue(QColor(0xff, 0x95, 0x57));
    cpuSpark_ = new Sparkline(bar);
    cpuSpark_->setColor(QColor(0xff, 0x95, 0x57));
    cpuSpark_->setFixedSize(90, 20);
    lay->addWidget(cpuName);
    lay->addWidget(cpuValue_);
    lay->addWidget(cpuSpark_);

    // 内存
    auto* memName = new QLabel(QStringLiteral("内存"), bar);
    memName->setStyleSheet(nameStyle);
    memValue_ = makeValue(QColor(0x7a, 0xd4, 0xe8));
    lay->addWidget(memName);
    lay->addWidget(memValue_);

    // GPU
    auto* gpuName = new QLabel(QStringLiteral("GPU"), bar);
    gpuName->setStyleSheet(nameStyle);
    gpuValue_ = makeValue(QColor(0x5b, 0xe3, 0x92));
    lay->addWidget(gpuName);
    lay->addWidget(gpuValue_);

    lay->addStretch(1);
    uptimeLabel_ = new QLabel(QStringLiteral("运行 00:00:00"), bar);
    uptimeLabel_->setStyleSheet(QStringLiteral("font-family:Consolas,monospace;font-size:10px;color:#8a949e;"));
    taskCountLabel_ = new QLabel(QStringLiteral("任务 0/0"), bar);
    taskCountLabel_->setStyleSheet(QStringLiteral("font-family:Consolas,monospace;font-size:10px;color:#8a949e;"));
    lay->addWidget(uptimeLabel_);
    lay->addWidget(taskCountLabel_);
}

void MainWindow::closeEvent(QCloseEvent* e)
{
    if (quitting_) {
        e->accept();
        return;
    }
    // 首次关闭询问一次：收起到托盘 or 退出；之后直接收起
    if (!closePromptShown_) {
        closePromptShown_ = true;
        QMessageBox box(this);
        box.setWindowTitle(QStringLiteral("TaskWarden"));
        box.setText(QStringLiteral("关闭窗口后，任务将继续在后台守护。"));
        box.setInformativeText(QStringLiteral("收起到系统托盘继续运行，还是停止全部任务并退出？"));
        QPushButton* trayBtn = box.addButton(QStringLiteral("收起到托盘"), QMessageBox::AcceptRole);
        QPushButton* quitBtn = box.addButton(QStringLiteral("退出程序"), QMessageBox::DestructiveRole);
        box.setDefaultButton(trayBtn);
        box.exec();
        if (box.clickedButton() == quitBtn) {
            e->accept();
            requestQuit();
            return;
        }
    }
    e->ignore();
    hide();
}

void MainWindow::resizeEvent(QResizeEvent* e)
{
    QMainWindow::resizeEvent(e);
    relayoutCards();
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

    // 资源栏
    cpuValue_->setText(QStringLiteral("%1%").arg(s.value(QStringLiteral("cpu")).toDouble(), 0, 'f', 0));
    memValue_->setText(QStringLiteral("%1%").arg(s.value(QStringLiteral("mem")).toDouble(), 0, 'f', 0));
    const double gpu = s.value(QStringLiteral("gpu")).toDouble();
    gpuValue_->setText(gpu > 0.0 ? QStringLiteral("%1%").arg(gpu, 0, 'f', 0) : QStringLiteral("N/A"));
    {
        QVector<float> hist;
        const QJsonArray a = s.value(QStringLiteral("cpuHist")).toArray();
        hist.reserve(a.size());
        for (const auto& v : a) hist.append(static_cast<float>(v.toDouble()));
        cpuSpark_->setValues(hist);
    }

    // 任务计数
    const QJsonArray tasks = s.value(QStringLiteral("tasks")).toArray();
    const int running = s.value(QStringLiteral("runningCount")).toInt();
    taskCountLabel_->setText(QStringLiteral("任务 %1/%2").arg(running).arg(tasks.size()));

    // 故障注入开关同步（一次性：引擎用后自动复位）
    const bool fi = s.value(QStringLiteral("faultInject")).toBool();
    if (faultInjectAct_->isChecked() != fi) {
        QSignalBlocker blocker(faultInjectAct_);
        faultInjectAct_->setChecked(fi);
    }

    // 状态栏
    configPathLabel_->setText(s.value(QStringLiteral("configPath")).toString());
    const QJsonObject stats = s.value(QStringLiteral("stats")).toObject();
    statsLabel_->setText(QStringLiteral("派生 %1 · 重启 %2")
                             .arg(stats.value(QStringLiteral("spawned")).toInt())
                             .arg(stats.value(QStringLiteral("restarts")).toInt()));
    const QString lastErr = stats.value(QStringLiteral("lastError")).toString();
    lastErrorLabel_->setText(lastErr.isEmpty()
                                 ? QStringLiteral("✓ 无异常")
                                 : QStringLiteral("上次错误：%1").arg(lastErr));
    lastErrorLabel_->setStyleSheet(lastErr.isEmpty()
                                       ? QStringLiteral("font-family:Consolas,monospace;font-size:10px;color:#3ecf6e;")
                                       : QStringLiteral("font-family:Consolas,monospace;font-size:10px;color:#ff7b70;"));

    // 任务卡 diff
    syncCards(tasks);

    // 选中任务日志
    pollSelectedLogs();
}

void MainWindow::tick1s()
{
    const qint64 now = QDateTime::currentMSecsSinceEpoch();
    for (TaskCard* c : std::as_const(cards_)) {
        c->tick(now);
    }
    uptimeLabel_->setText(QStringLiteral("运行 %1").arg(fmtDur(uptime_.elapsed())));
}

void MainWindow::selectTask(const QString& id)
{
    selectedId_ = id;
    for (TaskCard* c : std::as_const(cards_)) {
        c->setSelected(c->id() == id);
    }
    logPanel_->setTask(id);
    pollSelectedLogs();
}

void MainWindow::openAddDialog()
{
    const QJsonArray tasks = engine_->snapshot().value(QStringLiteral("tasks")).toArray();
    TaskDialog dlg(nullptr, tasks, this);
    if (dlg.exec() == QDialog::Accepted) {
        engine_->addTask(dlg.resultConfig());
    }
}

void MainWindow::openEditDialog(const QString& id)
{
    const QJsonArray tasks = engine_->snapshot().value(QStringLiteral("tasks")).toArray();
    for (const auto& v : tasks) {
        const QJsonObject t = v.toObject();
        if (t.value(QStringLiteral("name")).toString() == id) {
            TaskDialog dlg(&t, tasks, this);
            if (dlg.exec() == QDialog::Accepted) {
                engine_->updateTask(dlg.resultConfig());
            }
            return;
        }
    }
}

void MainWindow::confirmDelete(const QString& id)
{
    const auto ret = QMessageBox::question(
        this, QStringLiteral("删除任务"),
        QStringLiteral("确定删除任务「%1」？日志文件将一并删除。").arg(id),
        QMessageBox::Yes | QMessageBox::No, QMessageBox::No);
    if (ret == QMessageBox::Yes) {
        engine_->removeTask(id);
        if (selectedId_ == id) {
            selectedId_.clear();
            logPanel_->setTask(QString());
        }
    }
}

void MainWindow::connectCard(TaskCard* card)
{
    connect(card, &TaskCard::selectRequested, this, &MainWindow::selectTask);
    connect(card, &TaskCard::startRequested, this, [this](const QString& id) { engine_->start(id); });
    connect(card, &TaskCard::stopRequested, this, [this](const QString& id) { engine_->stop(id); });
    connect(card, &TaskCard::restartRequested, this, [this](const QString& id) { engine_->restart(id); });
    connect(card, &TaskCard::crashRequested, this, [this](const QString& id) { engine_->crash(id); });
    connect(card, &TaskCard::resetRequested, this, [this](const QString& id) { engine_->resetBreaker(id); });
    connect(card, &TaskCard::editRequested, this, &MainWindow::openEditDialog);
    connect(card, &TaskCard::deleteRequested, this, &MainWindow::confirmDelete);
}

void MainWindow::syncCards(const QJsonArray& tasks)
{
    const qint64 now = QDateTime::currentMSecsSinceEpoch();
    QSet<QString> seen;
    bool changed = false;

    for (const auto& v : tasks) {
        const QJsonObject t = v.toObject();
        const QString id = t.value(QStringLiteral("name")).toString();
        seen.insert(id);
        TaskCard* card = cards_.value(id);
        if (!card) {
            card = new TaskCard(id, taskContainer_);
            connectCard(card);
            cards_.insert(id, card);
            card->setTask(t, now);
            changed = true;
        } else if (card->taskJson() != t) {
            card->setTask(t, now);
            changed = true;
        }
    }

    // 删除消失的任务
    for (auto it = cards_.begin(); it != cards_.end();) {
        if (!seen.contains(it.key())) {
            TaskCard* c = it.value();
            grid_->removeWidget(c);
            c->deleteLater();
            it = cards_.erase(it);
            changed = true;
        } else {
            ++it;
        }
    }

    if (changed) {
        relayoutCards();
    }
}

void MainWindow::pollSelectedLogs()
{
    if (selectedId_.isEmpty()) {
        logPanel_->setLines(QJsonArray());
        return;
    }
    logPanel_->setLines(engine_->logs(selectedId_, 200));
}

void MainWindow::relayoutCards()
{
    const int cols = desiredColumns();

    QVector<TaskCard*> ordered;
    ordered.reserve(cards_.size());
    for (TaskCard* c : std::as_const(cards_)) {
        ordered.append(c);
    }
    std::sort(ordered.begin(), ordered.end(), [](TaskCard* a, TaskCard* b) {
        const int ra = stateRank(a->state());
        const int rb = stateRank(b->state());
        if (ra != rb) return ra < rb;
        return a->id() < b->id();
    });

    if (cols == currentCols_ && ordered == orderedCards_) {
        return;
    }
    currentCols_ = cols;
    orderedCards_ = ordered;

    while (grid_->count() > 0) {
        delete grid_->takeAt(0);
    }

    int row = 0;
    int col = 0;
    for (TaskCard* c : orderedCards_) {
        grid_->addWidget(c, row, col);
        if (++col >= cols) {
            col = 0;
            ++row;
        }
    }
    grid_->setRowStretch(row + 1, 1);
}

int MainWindow::desiredColumns() const
{
    const int w = taskScroll_->viewport()->width();
    if (w < 640) return 1;
    if (w < 1000) return 2;
    return 3;
}
