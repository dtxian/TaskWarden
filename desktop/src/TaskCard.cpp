/* ------------------------------------------------------------------ */
/* TaskCard.cpp：见 TaskCard.h                                          */
/* ------------------------------------------------------------------ */

#include "TaskCard.h"

#include "Args.h"
#include "ElidedLabel.h"
#include "Format.h"

#include <QHBoxLayout>
#include <QJsonArray>
#include <QLabel>
#include <QMouseEvent>
#include <QPushButton>
#include <QStyle>
#include <QToolButton>
#include <QVBoxLayout>

namespace {

struct StateMeta {
    QString label;
    QColor color;
};

StateMeta stateMetaOf(const QString& state)
{
    if (state == QStringLiteral("running")) return { QStringLiteral("运行中"), QColor(0x3e, 0xcf, 0x6e) };
    if (state == QStringLiteral("starting")) return { QStringLiteral("启动中"), QColor(0xf5, 0xb8, 0x4b) };
    if (state == QStringLiteral("backoff")) return { QStringLiteral("退避中"), QColor(0xf5, 0xb8, 0x4b) };
    if (state == QStringLiteral("fused")) return { QStringLiteral("已熔断"), QColor(0xf0, 0x56, 0x4a) };
    return { QStringLiteral("已停止"), QColor(0x6c, 0x78, 0x87) };
}

struct KindMeta {
    QString label;
    QColor color;
};

KindMeta kindMetaOf(const QString& kind)
{
    if (kind == QStringLiteral("exe")) return { QStringLiteral("EXE"), QColor(0x7a, 0xd4, 0xe8) };
    if (kind == QStringLiteral("bat")) return { QStringLiteral("BAT"), QColor(0xff, 0xc8, 0x6b) };
    return { QStringLiteral("PS1"), QColor(0xc7, 0x92, 0xea) };
}

QString chipStyle(const QColor& c)
{
    return QStringLiteral("color:%1;border:1px solid rgba(%2,%3,%4,0.33);background:rgba(%2,%3,%4,0.08);border-radius:3px;padding:0 5px;")
        .arg(c.name())
        .arg(c.red())
        .arg(c.green())
        .arg(c.blue());
}

QPushButton* makeBtn(const QString& text, const QColor& c, QWidget* parent)
{
    auto* b = new QPushButton(text, parent);
    b->setCursor(Qt::PointingHandCursor);
    b->setStyleSheet(
        QStringLiteral("QPushButton{background:transparent;color:%1;border:1px solid rgba(%2,%3,%4,0.4);border-radius:5px;padding:3px 9px;font-size:12px;}"
                       "QPushButton:hover{background:rgba(%2,%3,%4,0.12);}"
                       "QPushButton:disabled{color:#4a5560;border-color:#2a313a;}")
            .arg(c.name())
            .arg(c.red())
            .arg(c.green())
            .arg(c.blue()));
    return b;
}

QToolButton* makeIconBtn(const QString& text, QWidget* parent)
{
    auto* b = new QToolButton(parent);
    b->setText(text);
    b->setCursor(Qt::PointingHandCursor);
    b->setStyleSheet(QStringLiteral(
        "QToolButton{background:transparent;color:#8a949e;border:1px solid #2a313a;border-radius:5px;padding:3px 9px;font-size:12px;}"
        "QToolButton:hover{color:#c8d0d8;border-color:#4a5560;}"));
    return b;
}

} // namespace

TaskCard::TaskCard(const QString& id, QWidget* parent)
    : QFrame(parent)
    , id_(id)
{
    buildUi();
}

void TaskCard::buildUi()
{
    setObjectName(QStringLiteral("taskCard"));
    // 水平方向填满网格列（列等分窗口时卡片随之拉伸）
    setSizePolicy(QSizePolicy::Expanding, QSizePolicy::Preferred);
    setStyleSheet(QStringLiteral(
        "QFrame#taskCard{background:#14191e;border:1px solid #2a313a;border-radius:8px;}"
        "QFrame#taskCard[selected=\"true\"]{border:1px solid #ff7a29;}"));

    auto* root = new QHBoxLayout(this);
    root->setContentsMargins(0, 0, 0, 0);
    root->setSpacing(0);

    colorBar_ = new QWidget(this);
    colorBar_->setFixedWidth(3);
    root->addWidget(colorBar_);

    auto* body = new QVBoxLayout();
    body->setContentsMargins(12, 10, 12, 10);
    body->setSpacing(7);
    root->addLayout(body);

    // 头部：名称吃剩余宽度（省略），徽章/健康度固定宽度，绝不会压字
    auto* head = new QHBoxLayout();
    head->setSpacing(8);
    dot_ = new QLabel(this);
    dot_->setFixedSize(9, 9);
    dot_->setSizePolicy(QSizePolicy::Fixed, QSizePolicy::Fixed);
    name_ = new ElidedLabel(this);
    name_->setStyleSheet(QStringLiteral("font-family:Consolas,monospace;font-weight:bold;font-size:15px;color:#e6edf3;"));
    name_->setMinimumWidth(48);
    badge_ = new QLabel(this);
    badge_->setStyleSheet(QStringLiteral("font-weight:600;font-size:12px;"));
    badge_->setSizePolicy(QSizePolicy::Fixed, QSizePolicy::Fixed);
    health_ = new QLabel(this);
    health_->setStyleSheet(QStringLiteral("font-family:Consolas,monospace;font-size:11.5px;color:#8a949e;"));
    health_->setSizePolicy(QSizePolicy::Fixed, QSizePolicy::Fixed);
    head->addWidget(dot_);
    head->addWidget(name_, 1);
    head->addWidget(badge_);
    head->addWidget(health_);
    body->addLayout(head);

    // 类型 + 命令行
    auto* cmdRow = new QHBoxLayout();
    cmdRow->setSpacing(8);
    kind_ = new QLabel(this);
    kind_->setStyleSheet(QStringLiteral("font-family:Consolas,monospace;font-weight:bold;font-size:11px;"));
    kind_->setSizePolicy(QSizePolicy::Fixed, QSizePolicy::Fixed);
    cmd_ = new ElidedLabel(this);
    cmd_->setStyleSheet(QStringLiteral("font-family:Consolas,monospace;font-size:12px;color:#8a949e;"));
    cmdRow->addWidget(kind_);
    cmdRow->addWidget(cmd_, 1);
    body->addLayout(cmdRow);

    // 运行信息
    auto* info = new QHBoxLayout();
    info->setSpacing(14);
    pid_ = new QLabel(this);
    uptime_ = new QLabel(this);
    restarts_ = new QLabel(this);
    const QString mono = QStringLiteral("font-family:Consolas,monospace;font-size:12px;color:#8a949e;");
    pid_->setStyleSheet(mono);
    uptime_->setStyleSheet(mono);
    restarts_->setStyleSheet(mono);
    info->addWidget(pid_);
    info->addWidget(uptime_);
    info->addWidget(restarts_);
    info->addStretch(1);
    body->addLayout(info);

    // 退出码（可选）
    exitCode_ = new QLabel(this);
    exitCode_->setStyleSheet(mono);
    exitCode_->hide();
    body->addWidget(exitCode_);

    // 错误（可选）
    error_ = new QLabel(this);
    error_->setWordWrap(true);
    error_->setStyleSheet(QStringLiteral(
        "color:#ff7b70;border:1px solid rgba(240,86,74,0.35);background:rgba(240,86,74,0.08);"
        "border-radius:5px;padding:5px 8px;font-size:12px;"));
    error_->hide();
    body->addWidget(error_);

    // 依赖（可选）
    depsRow_ = new QWidget(this);
    depsLayout_ = new QVBoxLayout(depsRow_);
    depsLayout_->setContentsMargins(0, 0, 0, 0);
    depsLayout_->setSpacing(4);
    depsRow_->hide();
    body->addWidget(depsRow_);

    // 操作区
    auto* actions = new QHBoxLayout();
    actions->setSpacing(6);
    startBtn_ = makeBtn(QStringLiteral("启动"), QColor(0x3e, 0xcf, 0x6e), this);
    restartBtn_ = makeBtn(QStringLiteral("重启"), QColor(0xf5, 0xb8, 0x4b), this);
    stopBtn_ = makeBtn(QStringLiteral("停止"), QColor(0xf0, 0x56, 0x4a), this);
    resetBtn_ = makeBtn(QStringLiteral("重置熔断"), QColor(0xf0, 0x56, 0x4a), this);
    crashBtn_ = makeBtn(QStringLiteral("崩溃"), QColor(0xf5, 0xb8, 0x4b), this);
    editBtn_ = makeIconBtn(QStringLiteral("编辑"), this);
    deleteBtn_ = makeIconBtn(QStringLiteral("删除"), this);
    actions->addWidget(startBtn_);
    actions->addWidget(restartBtn_);
    actions->addWidget(stopBtn_);
    actions->addWidget(crashBtn_);
    actions->addStretch(1);
    actions->addWidget(resetBtn_);
    actions->addWidget(editBtn_);
    actions->addWidget(deleteBtn_);
    body->addLayout(actions);

    connect(startBtn_, &QPushButton::clicked, this, [this] { emit startRequested(id_); });
    connect(restartBtn_, &QPushButton::clicked, this, [this] { emit restartRequested(id_); });
    connect(stopBtn_, &QPushButton::clicked, this, [this] { emit stopRequested(id_); });
    connect(crashBtn_, &QPushButton::clicked, this, [this] { emit crashRequested(id_); });
    connect(resetBtn_, &QPushButton::clicked, this, [this] { emit resetRequested(id_); });
    connect(editBtn_, &QToolButton::clicked, this, [this] { emit editRequested(id_); });
    connect(deleteBtn_, &QToolButton::clicked, this, [this] { emit deleteRequested(id_); });
}

void TaskCard::setSelected(bool selected)
{
    if (selected_ == selected) return;
    selected_ = selected;
    setProperty("selected", selected);
    style()->unpolish(this);
    style()->polish(this);
    update();
}

void TaskCard::mousePressEvent(QMouseEvent* e)
{
    if (e->button() == Qt::LeftButton) {
        emit selectRequested(id_);
    }
    QFrame::mousePressEvent(e);
}

void TaskCard::setTask(const QJsonObject& task, qint64 nowMs)
{
    task_ = task;
    state_ = task.value(QStringLiteral("state")).toString();
    const StateMeta sm = stateMetaOf(state_);
    const KindMeta km = kindMetaOf(task.value(QStringLiteral("kind")).toString());

    // 色条 / 圆点
    colorBar_->setStyleSheet(QStringLiteral("background:%1;border-radius:2px;").arg(sm.color.name()));
    dot_->setStyleSheet(QStringLiteral("background:%1;border-radius:4px;").arg(sm.color.name()));

    name_->setFullText(task.value(QStringLiteral("name")).toString());
    badge_->setStyleSheet(chipStyle(sm.color) + QStringLiteral("font-weight:600;font-size:12px;"));
    kind_->setStyleSheet(chipStyle(km.color) + QStringLiteral("font-family:Consolas,monospace;font-weight:bold;font-size:11px;"));
    kind_->setText(km.label);

    // 命令行（省略过长）
    QStringList argList;
    const QJsonArray argsArr = task.value(QStringLiteral("args")).toArray();
    for (const auto& a : argsArr) {
        argList << a.toString();
    }
    const QString full = buildCommandText(task.value(QStringLiteral("kind")).toString(),
                                          task.value(QStringLiteral("path")).toString(), argList);
    cmd_->setFullText(full);

    pid_->setText(QStringLiteral("PID %1").arg(task.value(QStringLiteral("pid")).toVariant().isNull()
                                                   ? QStringLiteral("—")
                                                   : QString::number(task.value(QStringLiteral("pid")).toInt())));
    restarts_->setText(QStringLiteral("重启 %1 次").arg(task.value(QStringLiteral("restarts")).toInt()));

    // 退出码
    const QJsonValue ec = task.value(QStringLiteral("exitCode"));
    const bool active = state_ == QStringLiteral("running") || state_ == QStringLiteral("starting");
    if (!ec.isNull() && !active) {
        exitCode_->setText(QStringLiteral("退出码 %1").arg(ec.toInt()));
        exitCode_->show();
    } else {
        exitCode_->hide();
    }

    // 错误
    const QString err = task.value(QStringLiteral("lastError")).toString();
    if (!err.isEmpty()) {
        error_->setText(err);
        error_->show();
    } else {
        error_->hide();
    }

    // 依赖
    const QJsonArray deps = task.value(QStringLiteral("deps")).toArray();
    while (QLayoutItem* item = depsLayout_->takeAt(0)) {
        if (item->widget()) item->widget()->deleteLater();
        delete item;
    }
    if (!deps.isEmpty()) {
        for (const auto& d : deps) {
            auto* chip = new QLabel(QStringLiteral("← %1").arg(d.toString()), depsRow_);
            chip->setStyleSheet(QStringLiteral(
                "color:#8a949e;border:1px solid #2a313a;background:#0f1418;border-radius:4px;padding:1px 6px;font-family:Consolas,monospace;font-size:11px;"));
            depsLayout_->addWidget(chip);
        }
        depsRow_->show();
    } else {
        depsRow_->hide();
    }

    // 按钮可用性（与 Tauri 版一致）
    startBtn_->setEnabled(state_ != QStringLiteral("running") && state_ != QStringLiteral("starting"));
    restartBtn_->setEnabled(state_ == QStringLiteral("running"));
    stopBtn_->setEnabled(state_ != QStringLiteral("stopped"));
    crashBtn_->setEnabled(state_ == QStringLiteral("running"));
    resetBtn_->setVisible(state_ == QStringLiteral("fused"));

    updateTimers(nowMs);
}

void TaskCard::tick(qint64 nowMs)
{
    updateTimers(nowMs);
}

void TaskCard::updateTimers(qint64 nowMs)
{
    const StateMeta sm = stateMetaOf(state_);
    const bool active = state_ == QStringLiteral("running") || state_ == QStringLiteral("starting");

    // 徽章：退避显示倒计时
    if (state_ == QStringLiteral("backoff")) {
        const qint64 until = task_.value(QStringLiteral("backoffUntilMs")).toVariant().toLongLong();
        const qint64 left = until > 0 ? qMax<qint64>(0, (until - nowMs + 999) / 1000) : 0;
        badge_->setText(QStringLiteral("退避 %1s").arg(left));
    } else {
        badge_->setText(sm.label);
    }

    // 时长
    const QJsonValue started = task_.value(QStringLiteral("startedAtMs"));
    if (!started.isNull() && active) {
        uptime_->setText(QStringLiteral("时长 %1").arg(fmtDur(nowMs - started.toVariant().toLongLong())));
    } else {
        uptime_->setText(QStringLiteral("时长 —"));
    }

    // 健康指示
    const QJsonValue probeMs = task_.value(QStringLiteral("probeMs"));
    if (state_ == QStringLiteral("running")) {
        if (!probeMs.isNull()) {
            health_->setText(QStringLiteral("● 健康 %1ms").arg(probeMs.toInt()));
            health_->setStyleSheet(QStringLiteral("font-family:Consolas,monospace;font-size:11.5px;color:#3ecf6e;"));
        } else {
            health_->setText(QStringLiteral("● 探测中"));
            health_->setStyleSheet(QStringLiteral("font-family:Consolas,monospace;font-size:11.5px;color:#f5b84b;"));
        }
    } else if (state_ == QStringLiteral("starting")) {
        health_->setText(QStringLiteral("● 探测中"));
        health_->setStyleSheet(QStringLiteral("font-family:Consolas,monospace;font-size:11.5px;color:#f5b84b;"));
    } else {
        health_->setText(QStringLiteral("✕ 离线"));
        health_->setStyleSheet(QStringLiteral("font-family:Consolas,monospace;font-size:11.5px;color:#6c7887;"));
    }
}
