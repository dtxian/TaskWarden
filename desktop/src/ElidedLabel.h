/* ------------------------------------------------------------------ */
/* ElidedLabel：按可用宽度省略显示的 QLabel                              */
/* 用于任务卡名称/命令行——长文本不再撑宽卡片，也不会压到旁边的徽章         */
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
        // 水平方向可伸展：sizeHint 很小 → 布局把剩余空间给它，省略号按实际宽度计算
        setSizePolicy(QSizePolicy::Expanding, QSizePolicy::Preferred);
        setMinimumWidth(0);
    }

    void setFullText(const QString& text)
    {
        full_ = text;
        setToolTip(text);
        applyElide();
    }

    QString fullText() const { return full_; }

    QSize sizeHint() const override
    {
        return QSize(60, QLabel::sizeHint().height());
    }

protected:
    void resizeEvent(QResizeEvent* e) override
    {
        QLabel::resizeEvent(e);
        applyElide();
    }

    QSize minimumSizeHint() const override
    {
        // 最小宽度不随文本增长，避免把单元格/相邻控件挤走
        return QSize(24, QLabel::minimumSizeHint().height());
    }

private:
    void applyElide()
    {
        QLabel::setText(fontMetrics().elidedText(full_, Qt::ElideMiddle, qMax(0, width())));
    }

    QString full_;
};
