/* ------------------------------------------------------------------ */
/* ElidedLabel：按可用宽度省略显示的 QLabel                              */
/* 用于任务卡名称/命令行——长文本不再撑宽卡片，保证网格列等分窗口           */
/* ------------------------------------------------------------------ */

#pragma once

#include <QLabel>
#include <QResizeEvent>
#include <QString>

class ElidedLabel : public QLabel {
public:
    explicit ElidedLabel(QWidget* parent = nullptr)
        : QLabel(parent)
    {
        // 横向忽略 sizeHint：卡片宽度由网格决定，而非文本长度
        setSizePolicy(QSizePolicy::Ignored, QSizePolicy::Preferred);
        setMinimumWidth(0);
    }

    void setFullText(const QString& text)
    {
        full_ = text;
        setToolTip(text);
        applyElide();
    }

    QString fullText() const { return full_; }

protected:
    void resizeEvent(QResizeEvent* e) override
    {
        QLabel::resizeEvent(e);
        applyElide();
    }

    QSize minimumSizeHint() const override
    {
        // 最小宽度不随文本增长，避免把单元格撑宽
        return QSize(0, QLabel::minimumSizeHint().height());
    }

private:
    void applyElide()
    {
        QLabel::setText(fontMetrics().elidedText(full_, Qt::ElideMiddle, qMax(0, width())));
    }

    QString full_;
};
