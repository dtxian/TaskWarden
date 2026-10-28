/* ------------------------------------------------------------------ */
/* Sparkline：自定义 paintEvent 折线 + 底部渐变（CPU/GPU 历史）           */
/* ------------------------------------------------------------------ */

#pragma once

#include <QColor>
#include <QVector>
#include <QWidget>

class Sparkline : public QWidget {
    Q_OBJECT
public:
    explicit Sparkline(QWidget* parent = nullptr);

    void setValues(const QVector<float>& values);
    void setColor(const QColor& color);

    QSize sizeHint() const override;

protected:
    void paintEvent(QPaintEvent* e) override;

private:
    QVector<float> values_;
    QColor color_ = QColor(0xe8, 0x87, 0x3a);
};
