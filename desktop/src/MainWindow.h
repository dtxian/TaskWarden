/* ------------------------------------------------------------------ */
/* MainWindow：主窗口 —— 工具栏(启动/停止全部) + 状态栏 + 关闭到托盘        */
/* M4 将在中央区域加入任务卡网格与日志面板                                  */
/* ------------------------------------------------------------------ */

#pragma once

#include <QElapsedTimer>
#include <QMainWindow>

class QLabel;
class EngineClient;

class MainWindow : public QMainWindow {
    Q_OBJECT
public:
    explicit MainWindow(EngineClient* engine, QWidget* parent = nullptr);

    /// 真正退出（托盘菜单「退出程序」用）
    void requestQuit();

public slots:
    void showAndRaise();

protected:
    void closeEvent(QCloseEvent* e) override;

private slots:
    void onSnapshot();

private:
    EngineClient* engine_ = nullptr;
    QLabel* cpuLabel_ = nullptr;
    QLabel* memLabel_ = nullptr;
    QLabel* gpuLabel_ = nullptr;
    QLabel* taskLabel_ = nullptr;
    QLabel* uptimeLabel_ = nullptr;
    QElapsedTimer uptime_;
    bool quitting_ = false;
};
