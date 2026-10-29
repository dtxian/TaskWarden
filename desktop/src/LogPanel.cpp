/* ------------------------------------------------------------------ */
/* LogPanel.cpp：见 LogPanel.h                                          */
/* ------------------------------------------------------------------ */

#include "LogPanel.h"

#include "Format.h"

#include <QApplication>
#include <QClipboard>
#include <QHBoxLayout>
#include <QJsonObject>
#include <QLabel>
#include <QPushButton>
#include <QScrollBar>
#include <QTextEdit>
#include <QVBoxLayout>

namespace {

QColor levelColor(const QString& level)
{
    if (level == QStringLiteral("ERR")) return QColor(0xff, 0x7b, 0x70);
    if (level == QStringLiteral("WARN")) return QColor(0xf5, 0xb8, 0x4b);
    if (level == QStringLiteral("SYS")) return QColor(0x7a, 0xd4, 0xe8);
    return QColor(0x8a, 0x94, 0x9e); // INFO
}

} // namespace

LogPanel::LogPanel(QWidget* parent)
    : QWidget(parent)
{
    auto* root = new QVBoxLayout(this);
    root->setContentsMargins(0, 0, 0, 0);
    root->setSpacing(0);

    // 头部
    auto* head = new QHBoxLayout();
    head->setContentsMargins(12, 8, 12, 8);
    head->setSpacing(8);

    title_ = new QLabel(QStringLiteral("实时日志"), this);
    title_->setStyleSheet(QStringLiteral("font-weight:bold;font-size:13.5px;color:#ff9557;"));
    taskBadge_ = new QLabel(this);
    taskBadge_->setStyleSheet(QStringLiteral(
        "color:#ff9557;border:1px solid rgba(255,122,41,0.4);background:rgba(255,122,41,0.1);"
        "border-radius:4px;padding:1px 6px;font-family:Consolas,monospace;font-size:12px;font-weight:600;"));
    pathLabel_ = new QLabel(this);
    pathLabel_->setStyleSheet(QStringLiteral("font-family:Consolas,monospace;font-size:11.5px;color:#8a949e;"));
    ringLabel_ = new QLabel(this);
    ringLabel_->setStyleSheet(QStringLiteral("font-family:Consolas,monospace;font-size:11.5px;color:#8a949e;"));

    const QString smallBtnStyle = QStringLiteral(
        "QPushButton{background:transparent;color:#8a949e;border:1px solid #2a313a;border-radius:5px;padding:3px 10px;font-size:12px;}"
        "QPushButton:hover{color:#c8d0d8;border-color:#4a5560;}"
        "QPushButton:disabled{color:#3a4148;border-color:#1c2228;}");

    autoScrollBtn_ = new QPushButton(QStringLiteral("● 自动滚动"), this);
    autoScrollBtn_->setCheckable(true);
    autoScrollBtn_->setChecked(true);
    autoScrollBtn_->setStyleSheet(smallBtnStyle);
    copyBtn_ = new QPushButton(QStringLiteral("复制"), this);
    copyBtn_->setStyleSheet(smallBtnStyle);
    clearBtn_ = new QPushButton(QStringLiteral("清空"), this);
    clearBtn_->setStyleSheet(smallBtnStyle);
    clearBtn_->setEnabled(false);

    head->addWidget(title_);
    head->addWidget(taskBadge_);
    head->addWidget(pathLabel_);
    head->addWidget(ringLabel_);
    head->addStretch(1);
    head->addWidget(autoScrollBtn_);
    head->addWidget(copyBtn_);
    head->addWidget(clearBtn_);
    root->addLayout(head);

    // 日志流
    editor_ = new QTextEdit(this);
    editor_->setReadOnly(true);
    editor_->setStyleSheet(QStringLiteral(
        "QTextEdit{background:#0f1418;border:none;color:#c8d0d8;font-family:Consolas,monospace;font-size:12.5px;padding:8px 10px;}"));
    root->addWidget(editor_, 1);

    setTask(QString());

    connect(autoScrollBtn_, &QPushButton::toggled, this, [this](bool on) {
        autoScroll_ = on;
        if (on) {
            editor_->verticalScrollBar()->setValue(editor_->verticalScrollBar()->maximum());
        }
    });
    connect(copyBtn_, &QPushButton::clicked, this, [this] {
        QApplication::clipboard()->setText(editor_->toPlainText());
    });
    connect(clearBtn_, &QPushButton::clicked, this, [this] {
        if (!taskId_.isEmpty()) {
            emit clearRequested(taskId_);
        }
    });
}

void LogPanel::setTask(const QString& taskId)
{
    taskId_ = taskId;
    lastSize_ = -1;
    lastTMs_ = 0;
    lastMsg_.clear();
    clearBtn_->setEnabled(!taskId.isEmpty());
    if (taskId.isEmpty()) {
        taskBadge_->setText(QStringLiteral("未选择任务"));
        taskBadge_->hide();
        pathLabel_->clear();
        editor_->setHtml(QStringLiteral(
            "<div style=\"color:#6c7887;font-family:Consolas,monospace;font-size:12.5px;\">点击上方任务卡片查看其日志</div>"));
    } else {
        taskBadge_->setText(taskId);
        taskBadge_->show();
        pathLabel_->setText(QStringLiteral("logs\\%1.log").arg(taskId));
        editor_->setHtml(QString());
    }
}

void LogPanel::setLines(const QJsonArray& lines)
{
    // diff：长度 + 末行时间戳 + 末行内容 均未变则跳过重建
    if (lines.size() == lastSize_) {
        if (lines.isEmpty()) {
            return;
        }
        const QJsonObject last = lines.last().toObject();
        const double t = last.value(QStringLiteral("tMs")).toDouble();
        const QString m = last.value(QStringLiteral("msg")).toString();
        if (qFuzzyCompare(t, lastTMs_) && m == lastMsg_) {
            return;
        }
    }
    lastSize_ = lines.size();
    if (!lines.isEmpty()) {
        const QJsonObject last = lines.last().toObject();
        lastTMs_ = last.value(QStringLiteral("tMs")).toDouble();
        lastMsg_ = last.value(QStringLiteral("msg")).toString();
    }
    ringLabel_->setText(QStringLiteral("Ring Buffer %1/200").arg(lines.size()));
    rebuild(lines);
}

void LogPanel::rebuild(const QJsonArray& lines)
{
    if (lines.isEmpty()) {
        if (!taskId_.isEmpty()) {
            editor_->setHtml(QStringLiteral(
                "<div style=\"color:#6c7887;font-family:Consolas,monospace;font-size:12.5px;\">暂无日志 —— 启动任务或触发操作后，输出将实时回放到此环状缓冲区</div>"));
        }
        if (autoScroll_) {
            editor_->verticalScrollBar()->setValue(editor_->verticalScrollBar()->maximum());
        }
        return;
    }

    QString html;
    html.reserve(lines.size() * 64);
    for (const auto& v : lines) {
        const QJsonObject l = v.toObject();
        const QString level = l.value(QStringLiteral("level")).toString();
        const QString msg = l.value(QStringLiteral("msg")).toString().toHtmlEscaped();
        const QString t = fmtClock(static_cast<qint64>(l.value(QStringLiteral("tMs")).toDouble()));
        const QString color = levelColor(level).name();
        const QString bg = (level == QStringLiteral("ERR"))
            ? QStringLiteral(" style=\"background-color:rgba(240,86,74,0.09);\"")
            : QString();
        html += QStringLiteral("<div style=\"color:%1;font-size:12.5px;\"%2><span style=\"color:#5a6672;\">%3</span> <b>[%4]</b> %5</div>")
                    .arg(color, bg, t.toHtmlEscaped(), level, msg);
    }
    editor_->setHtml(html);
    if (autoScroll_) {
        editor_->verticalScrollBar()->setValue(editor_->verticalScrollBar()->maximum());
    }
}
