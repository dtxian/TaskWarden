/* ------------------------------------------------------------------ */
/* TaskDialog：任务编辑器（新增/编辑）—— 表单 + 校验 + 依赖成环禁用         */
/* resultConfig() 返回 snake_case TaskConfig JSON（供 EngineClient 用）   */
/* ------------------------------------------------------------------ */

#pragma once

#include <QDialog>
#include <QJsonArray>
#include <QJsonObject>
#include <QSet>
#include <QStringList>

class QComboBox;
class QLabel;
class QLineEdit;
class QPlainTextEdit;
class QSpinBox;
class QVBoxLayout;

class TaskDialog : public QDialog {
    Q_OBJECT
public:
    /// initial：nullptr = 添加；否则编辑（camelCase TaskDto）
    TaskDialog(const QJsonObject* initial, const QJsonArray& allTasks, QWidget* parent = nullptr);

    QJsonObject resultConfig() const { return result_; }

private slots:
    void onPathChanged(const QString& path);
    void onBrowsePath();
    void onBrowseCwd();
    void onKindChanged();
    void onHealthChanged();
    void onArgsChanged();
    void onSubmit();

private:
    void buildUi();
    void rebuildDeps();
    QSet<QString> forbiddenSet() const;
    void refreshPreview();
    static void setErr(QLabel* label, const QString& msg);

    QJsonObject initial_;
    QJsonArray allTasks_;
    QJsonObject result_;
    QSet<QString> selectedDeps_;

    QLineEdit* name_ = nullptr;
    QComboBox* kind_ = nullptr;
    QLineEdit* path_ = nullptr;
    QPlainTextEdit* args_ = nullptr;
    QLabel* argsPreview_ = nullptr;
    QLineEdit* cwd_ = nullptr;
    QComboBox* strategy_ = nullptr;
    QSpinBox* graceful_ = nullptr;
    QComboBox* health_ = nullptr;
    QLineEdit* healthTarget_ = nullptr;
    QLabel* healthTargetLabel_ = nullptr;
    QWidget* depsContainer_ = nullptr;
    QVBoxLayout* depsLayout_ = nullptr;
    QLabel* cmdPreview_ = nullptr;

    QLabel* nameErr_ = nullptr;
    QLabel* pathErr_ = nullptr;
    QLabel* argsErr_ = nullptr;
    QLabel* healthErr_ = nullptr;
};
