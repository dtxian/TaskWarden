/* ------------------------------------------------------------------ */
/* TaskCard：任务卡（egui 风）—— 状态色条/状态徽章/命令行/PID/依赖/操作     */
/* setTask 全量更新（快照字段 diff 后调用），tick 只刷时间相关文案（1Hz）   */
/* ------------------------------------------------------------------ */

#pragma once

#include <QFrame>
#include <QJsonObject>
#include <QString>

class QLabel;
class QPushButton;
class QToolButton;
class QVBoxLayout;

class TaskCard : public QFrame {
    Q_OBJECT
public:
    explicit TaskCard(const QString& id, QWidget* parent = nullptr);

    QString id() const { return id_; }
    QString state() const { return state_; }
    const QJsonObject& taskJson() const { return task_; }

    void setSelected(bool selected);
    bool isSelected() const { return selected_; }

    /// 全量更新（任务字段变化时调用）
    void setTask(const QJsonObject& task, qint64 nowMs);
    /// 1Hz 刷新（uptime / 退避倒计时）
    void tick(qint64 nowMs);

signals:
    void selectRequested(const QString& id);
    void startRequested(const QString& id);
    void stopRequested(const QString& id);
    void restartRequested(const QString& id);
    void crashRequested(const QString& id);
    void resetRequested(const QString& id);
    void editRequested(const QString& id);
    void deleteRequested(const QString& id);

protected:
    void mousePressEvent(QMouseEvent* e) override;

private:
    void buildUi();
    void updateTimers(qint64 nowMs);

    QString id_;
    QString state_;
    QJsonObject task_;
    bool selected_ = false;

    QWidget* colorBar_ = nullptr;
    QLabel* dot_ = nullptr;
    QLabel* name_ = nullptr;
    QLabel* badge_ = nullptr;
    QLabel* health_ = nullptr;
    QLabel* kind_ = nullptr;
    QLabel* cmd_ = nullptr;
    QLabel* pid_ = nullptr;
    QLabel* uptime_ = nullptr;
    QLabel* restarts_ = nullptr;
    QLabel* exitCode_ = nullptr;
    QLabel* error_ = nullptr;
    QWidget* depsRow_ = nullptr;
    QVBoxLayout* depsLayout_ = nullptr;
    QPushButton* startBtn_ = nullptr;
    QPushButton* restartBtn_ = nullptr;
    QPushButton* stopBtn_ = nullptr;
    QPushButton* resetBtn_ = nullptr;
    QPushButton* crashBtn_ = nullptr;
    QToolButton* editBtn_ = nullptr;
    QToolButton* deleteBtn_ = nullptr;
};
