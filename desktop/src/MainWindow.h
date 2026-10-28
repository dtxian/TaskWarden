/* ------------------------------------------------------------------ */
/* MainWindow：主窗口 —— 资源栏 + 任务卡网格(1/2/3 列) + 日志面板          */
/* 4Hz 快照经字段级 diff 只更新变化卡片（与 Tauri 版 sameTask 语义对齐）    */
/* ------------------------------------------------------------------ */

#pragma once

#include <QElapsedTimer>
#include <QHash>
#include <QJsonArray>
#include <QJsonObject>
#include <QMainWindow>
#include <QVector>

class QAction;
class QGridLayout;
class QLabel;
class QScrollArea;
class EngineClient;
class LogPanel;
class Sparkline;
class TaskCard;

class MainWindow : public QMainWindow {
    Q_OBJECT
public:
    explicit MainWindow(EngineClient* engine, QWidget* parent = nullptr);

    void requestQuit();

public slots:
    void showAndRaise();

protected:
    void closeEvent(QCloseEvent* e) override;
    void resizeEvent(QResizeEvent* e) override;

private slots:
    void onSnapshot();
    void tick1s();
    void selectTask(const QString& id);
    void openAddDialog();
    void openEditDialog(const QString& id);
    void confirmDelete(const QString& id);

private:
    void buildUi();
    void buildResourceBar(QWidget* parent);
    void syncCards(const QJsonArray& tasks);
    void connectCard(TaskCard* card);
    void pollSelectedLogs();
    void relayoutCards();
    int desiredColumns() const;

    EngineClient* engine_ = nullptr;

    // 资源栏
    Sparkline* cpuSpark_ = nullptr;
    QLabel* cpuValue_ = nullptr;
    QLabel* memValue_ = nullptr;
    QLabel* gpuValue_ = nullptr;
    QLabel* uptimeLabel_ = nullptr;
    QLabel* taskCountLabel_ = nullptr;
    QAction* faultInjectAct_ = nullptr;

    // 任务网格
    QScrollArea* taskScroll_ = nullptr;
    QWidget* taskContainer_ = nullptr;
    QGridLayout* grid_ = nullptr;
    QHash<QString, TaskCard*> cards_;
    QVector<TaskCard*> orderedCards_;
    int currentCols_ = 0;

    // 日志
    LogPanel* logPanel_ = nullptr;
    QString selectedId_;

    // 状态栏
    QLabel* configPathLabel_ = nullptr;
    QLabel* statsLabel_ = nullptr;
    QLabel* lastErrorLabel_ = nullptr;

    QElapsedTimer uptime_;
    bool quitting_ = false;
    bool closePromptShown_ = false;
};
