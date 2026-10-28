/* ------------------------------------------------------------------ */
/* LogPanel：实时日志 —— 三色分级 / 等宽 / 自动滚动 / 清空 / 复制          */
/* setLines 按「长度 + 末行」判等，避免 4Hz 下重建整个控件                  */
/* ------------------------------------------------------------------ */

#pragma once

#include <QJsonArray>
#include <QString>
#include <QWidget>

class QLabel;
class QPushButton;
class QTextEdit;

class LogPanel : public QWidget {
    Q_OBJECT
public:
    explicit LogPanel(QWidget* parent = nullptr);

    void setTask(const QString& taskId);
    void setLines(const QJsonArray& lines);

signals:
    void clearRequested(const QString& taskId);

private:
    void rebuild(const QJsonArray& lines);

    QLabel* title_ = nullptr;
    QLabel* taskBadge_ = nullptr;
    QLabel* pathLabel_ = nullptr;
    QLabel* ringLabel_ = nullptr;
    QPushButton* autoScrollBtn_ = nullptr;
    QPushButton* copyBtn_ = nullptr;
    QPushButton* clearBtn_ = nullptr;
    QTextEdit* editor_ = nullptr;

    QString taskId_;
    bool autoScroll_ = true;
    int lastSize_ = -1;
    double lastTMs_ = 0;
    QString lastMsg_;
};
