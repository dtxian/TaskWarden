/* ------------------------------------------------------------------ */
/* Sparkline.cpp：见 Sparkline.h                                        */
/* ------------------------------------------------------------------ */

#include "Sparkline.h"

#include <QLinearGradient>
#include <QPainter>
#include <QPolygonF>

Sparkline::Sparkline(QWidget* parent)
    : QWidget(parent)
{
    setMinimumSize(80, 22);
}

void Sparkline::setValues(const QVector<float>& values)
{
    values_ = values;
    update();
}

void Sparkline::setColor(const QColor& color)
{
    color_ = color;
    update();
}

QSize Sparkline::sizeHint() const
{
    return QSize(120, 22);
}

void Sparkline::paintEvent(QPaintEvent*)
{
    QPainter p(this);
    p.setRenderHint(QPainter::Antialiasing);

    const QRectF r = rect().adjusted(2, 3, -2, -3);
    if (values_.size() < 2) {
        p.setPen(QColor(0x2a, 0x31, 0x3a));
        p.drawLine(QPointF(r.left(), r.center().y()), QPointF(r.right(), r.center().y()));
        return;
    }

    float minV = values_.first();
    float maxV = values_.first();
    for (float v : values_) {
        minV = qMin(minV, v);
        maxV = qMax(maxV, v);
    }
    if (maxV - minV < 0.01f) {
        maxV = minV + 1.0f;
    }

    QVector<QPointF> pts;
    pts.reserve(values_.size());
    for (int i = 0; i < values_.size(); ++i) {
        const float x = r.left() + float(i) / float(values_.size() - 1) * float(r.width());
        const float y = r.bottom() - (values_[i] - minV) / (maxV - minV) * float(r.height());
        pts.append(QPointF(x, y));
    }

    // 底部渐变填充
    QLinearGradient g(0, r.top(), 0, r.bottom());
    QColor c1 = color_;
    c1.setAlpha(46);
    QColor c2 = color_;
    c2.setAlpha(0);
    g.setColorAt(0, c1);
    g.setColorAt(1, c2);
    QPolygonF fill(pts);
    fill.append(QPointF(r.right(), r.bottom()));
    fill.append(QPointF(r.left(), r.bottom()));
    p.setBrush(g);
    p.setPen(Qt::NoPen);
    p.drawPolygon(fill);

    // 折线
    p.setPen(QPen(color_, 1.5));
    p.drawPolyline(pts.constData(), pts.size());
}
