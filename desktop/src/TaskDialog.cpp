/* ------------------------------------------------------------------ */
/* TaskDialog.cpp：见 TaskDialog.h                                      */
/* ------------------------------------------------------------------ */

#include "TaskDialog.h"

#include "Args.h"

#include <QComboBox>
#include <QFileDialog>
#include <QGridLayout>
#include <QHBoxLayout>
#include <QJsonArray>
#include <QLabel>
#include <QLineEdit>
#include <QPlainTextEdit>
#include <QPushButton>
#include <QRegularExpression>
#include <QSpinBox>
#include <QVBoxLayout>

namespace {

const QString inputStyle = QStringLiteral(
    "QLineEdit,QPlainTextEdit,QComboBox,QSpinBox{background:#0f1418;color:#c8d0d8;border:1px solid #2a313a;"
    "border-radius:6px;padding:6px 9px;font-family:Consolas,monospace;font-size:13.5px;}"
    "QLineEdit:focus,QPlainTextEdit:focus,QComboBox:focus,QSpinBox:focus{border-color:#ff7a29;}");

const QString labelStyle = QStringLiteral("color:#8a949e;font-size:12.5px;font-weight:600;");
const QString errStyle = QStringLiteral("color:#ff7b70;font-size:11.5px;");

QString joinArgsForEdit(const QJsonArray& args)
{
    QStringList out;
    for (const auto& a : args) {
        QString s = a.toString();
        if (s.contains(QLatin1Char(' '))) {
            out << QStringLiteral("\"%1\"").arg(s);
        } else {
            out << s;
        }
    }
    return out.join(QLatin1Char(' '));
}

QJsonObject taskDtoToConfig(const QJsonObject& d)
{
    QJsonObject health;
    health.insert(QStringLiteral("mode"), d.value(QStringLiteral("healthMode")).toString());
    health.insert(QStringLiteral("target"), d.value(QStringLiteral("healthTarget")).toString());
    QJsonObject cfg;
    cfg.insert(QStringLiteral("name"), d.value(QStringLiteral("name")).toString());
    cfg.insert(QStringLiteral("kind"), d.value(QStringLiteral("kind")).toString());
    cfg.insert(QStringLiteral("path"), d.value(QStringLiteral("path")).toString());
    cfg.insert(QStringLiteral("args"), d.value(QStringLiteral("args")).toArray());
    cfg.insert(QStringLiteral("cwd"), d.value(QStringLiteral("cwd")).toString());
    cfg.insert(QStringLiteral("strategy"), d.value(QStringLiteral("strategy")).toString());
    cfg.insert(QStringLiteral("graceful_timeout"), d.value(QStringLiteral("gracefulTimeout")).toInt());
    cfg.insert(QStringLiteral("deps"), d.value(QStringLiteral("deps")).toArray());
    cfg.insert(QStringLiteral("health"), health);
    cfg.insert(QStringLiteral("enabled"), true);
    return cfg;
}

} // namespace

TaskDialog::TaskDialog(const QJsonObject* initial, const QJsonArray& allTasks, QWidget* parent)
    : QDialog(parent)
    , allTasks_(allTasks)
{
    if (initial) {
        initial_ = *initial;
    }
    setWindowTitle(initial ? QStringLiteral("编辑任务 · %1").arg(initial_.value(QStringLiteral("name")).toString())
                           : QStringLiteral("添加任务"));
    setMinimumWidth(680);
    setStyleSheet(QStringLiteral("QDialog{background:#14191e;}"));

    buildUi();
    rebuildDeps();
    refreshPreview();
}

void TaskDialog::buildUi()
{
    auto* root = new QVBoxLayout(this);
    root->setContentsMargins(16, 14, 16, 14);
    root->setSpacing(10);

    auto section = [](QLabel*& l, const QString& text) {
        l = new QLabel(text);
        l->setStyleSheet(labelStyle);
    };

    // 名称 + 类型（同一行：标签对齐、输入框对齐、错误行单独占位）
    auto* row1 = new QGridLayout();
    row1->setHorizontalSpacing(10);
    row1->setVerticalSpacing(4);
    QLabel* nameLbl;
    section(nameLbl, QStringLiteral("任务名称"));
    name_ = new QLineEdit();
    name_->setStyleSheet(inputStyle);
    name_->setPlaceholderText(QStringLiteral("ollama-serve"));
    nameErr_ = new QLabel();
    nameErr_->setStyleSheet(errStyle);
    nameErr_->hide();
    QLabel* kindLbl;
    section(kindLbl, QStringLiteral("类型"));
    kind_ = new QComboBox();
    kind_->setStyleSheet(inputStyle);
    kind_->setSizePolicy(QSizePolicy::Expanding, QSizePolicy::Fixed);
    kind_->addItem(QStringLiteral("exe 直启"), QStringLiteral("exe"));
    kind_->addItem(QStringLiteral("bat · cmd /c"), QStringLiteral("bat"));
    kind_->addItem(QStringLiteral("ps1 · Bypass"), QStringLiteral("ps1"));
    row1->addWidget(nameLbl, 0, 0);
    row1->addWidget(kindLbl, 0, 1);
    row1->addWidget(name_, 1, 0);
    row1->addWidget(kind_, 1, 1);
    row1->addWidget(nameErr_, 2, 0);
    row1->setColumnStretch(0, 3);
    row1->setColumnStretch(1, 1);
    root->addLayout(row1);

    // 路径 + 浏览
    QLabel* pathLbl;
    section(pathLbl, QStringLiteral("程序路径"));
    auto* pathRow = new QHBoxLayout();
    path_ = new QLineEdit();
    path_->setStyleSheet(inputStyle);
    path_->setPlaceholderText(QStringLiteral("C:\\tools\\app.exe"));
    auto* browse = new QPushButton(QStringLiteral("浏览…"));
    browse->setStyleSheet(QStringLiteral(
        "QPushButton{background:#1a2026;color:#c8d0d8;border:1px solid #2a313a;border-radius:6px;padding:6px 13px;font-size:12.5px;}"
        "QPushButton:hover{border-color:#ff7a29;color:#ff9557;}"));
    pathRow->addWidget(path_, 1);
    pathRow->addWidget(browse);
    root->addWidget(pathLbl);
    root->addLayout(pathRow);
    pathErr_ = new QLabel();
    pathErr_->setStyleSheet(errStyle);
    root->addWidget(pathErr_);

    // 启动参数
    QLabel* argsLbl;
    section(argsLbl, QStringLiteral("启动参数（多行 · 空格/换行切分，引号包裹带空格参数）"));
    args_ = new QPlainTextEdit();
    args_->setStyleSheet(inputStyle);
    args_->setMinimumHeight(72);
    args_->setPlaceholderText(QStringLiteral("--port 8080\n--log-dir \"C:\\logs my app\"\n--workers 4"));
    argsPreview_ = new QLabel();
    argsPreview_->setStyleSheet(QStringLiteral("color:#7ad4e8;font-family:Consolas,monospace;font-size:12px;"));
    argsPreview_->setWordWrap(true);
    argsErr_ = new QLabel();
    argsErr_->setStyleSheet(errStyle);
    root->addWidget(argsLbl);
    root->addWidget(args_);
    root->addWidget(argsPreview_);
    root->addWidget(argsErr_);

    // 工作目录
    QLabel* cwdLbl;
    section(cwdLbl, QStringLiteral("工作目录（可选）"));
    auto* cwdRow = new QHBoxLayout();
    cwd_ = new QLineEdit();
    cwd_->setStyleSheet(inputStyle);
    cwd_->setPlaceholderText(QStringLiteral("C:\\tools"));
    auto* cwdBrowse = new QPushButton(QStringLiteral("选目录…"));
    cwdBrowse->setStyleSheet(browse->styleSheet());
    cwdRow->addWidget(cwd_, 1);
    cwdRow->addWidget(cwdBrowse);
    root->addWidget(cwdLbl);
    root->addLayout(cwdRow);

    // 策略 + 优雅超时
    auto* row2 = new QHBoxLayout();
    auto* stratBox = new QVBoxLayout();
    QLabel* stratLbl;
    section(stratLbl, QStringLiteral("重启策略"));
    strategy_ = new QComboBox();
    strategy_->setStyleSheet(inputStyle);
    strategy_->addItem(QStringLiteral("always · 总是重启"), QStringLiteral("always"));
    strategy_->addItem(QStringLiteral("on-failure · 失败时重启"), QStringLiteral("on-failure"));
    strategy_->addItem(QStringLiteral("never · 从不重启"), QStringLiteral("never"));
    stratBox->addWidget(stratLbl);
    stratBox->addWidget(strategy_);
    auto* graceBox = new QVBoxLayout();
    QLabel* graceLbl;
    section(graceLbl, QStringLiteral("优雅停止超时（秒，仅 exe）"));
    graceful_ = new QSpinBox();
    graceful_->setStyleSheet(inputStyle);
    graceful_->setRange(0, 120);
    graceful_->setValue(5);
    graceBox->addWidget(graceLbl);
    graceBox->addWidget(graceful_);
    row2->addLayout(stratBox, 1);
    row2->addLayout(graceBox, 1);
    root->addLayout(row2);

    // 健康检查
    auto* healthRow = new QHBoxLayout();
    auto* healthBox = new QVBoxLayout();
    QLabel* healthLbl;
    section(healthLbl, QStringLiteral("健康检查"));
    health_ = new QComboBox();
    health_->setStyleSheet(inputStyle);
    health_->addItem(QStringLiteral("无"), QStringLiteral("none"));
    health_->addItem(QStringLiteral("TCP 端口"), QStringLiteral("tcp"));
    health_->addItem(QStringLiteral("HTTP 状态码"), QStringLiteral("http"));
    health_->addItem(QStringLiteral("就绪等待"), QStringLiteral("ready"));
    healthBox->addWidget(healthLbl);
    healthBox->addWidget(health_);
    auto* healthTargetBox = new QVBoxLayout();
    healthTargetLabel_ = new QLabel(QStringLiteral("host:port"));
    healthTargetLabel_->setStyleSheet(labelStyle);
    healthTarget_ = new QLineEdit();
    healthTarget_->setStyleSheet(inputStyle);
    healthTarget_->setPlaceholderText(QStringLiteral("127.0.0.1:8080"));
    healthTargetBox->addWidget(healthTargetLabel_);
    healthTargetBox->addWidget(healthTarget_);
    healthRow->addLayout(healthBox, 1);
    healthRow->addLayout(healthTargetBox, 2);
    root->addLayout(healthRow);
    healthErr_ = new QLabel();
    healthErr_->setStyleSheet(errStyle);
    root->addWidget(healthErr_);

    // 依赖
    QLabel* depsLbl;
    section(depsLbl, QStringLiteral("依赖任务（DAG · 上游先启）"));
    depsContainer_ = new QWidget();
    depsLayout_ = new QVBoxLayout(depsContainer_);
    depsLayout_->setContentsMargins(0, 0, 0, 0);
    depsLayout_->setSpacing(4);
    root->addWidget(depsLbl);
    root->addWidget(depsContainer_);

    // 命令预览
    cmdPreview_ = new QLabel();
    cmdPreview_->setWordWrap(true);
    cmdPreview_->setStyleSheet(QStringLiteral(
        "color:#ff9557;border:1px solid rgba(255,122,41,0.3);background:rgba(255,122,41,0.06);"
        "border-radius:7px;padding:9px;font-family:Consolas,monospace;font-size:12.5px;"));
    root->addWidget(cmdPreview_);

    // 按钮
    auto* btns = new QHBoxLayout();
    btns->addStretch(1);
    auto* cancel = new QPushButton(QStringLiteral("取消"));
    cancel->setStyleSheet(QStringLiteral(
        "QPushButton{background:transparent;color:#8a949e;border:1px solid #2a313a;border-radius:6px;padding:7px 18px;font-size:12.5px;}"
        "QPushButton:hover{color:#c8d0d8;}"));
    auto* ok = new QPushButton(initial_.isEmpty() ? QStringLiteral("创建任务") : QStringLiteral("保存配置"));
    ok->setStyleSheet(QStringLiteral(
        "QPushButton{background:#ff7a29;color:#1a0d04;border:none;border-radius:6px;padding:7px 18px;font-size:12.5px;font-weight:bold;}"
        "QPushButton:hover{background:#ff9557;}"));
    btns->addWidget(cancel);
    btns->addWidget(ok);
    root->addLayout(btns);

    // 预填（编辑模式）
    if (!initial_.isEmpty()) {
        name_->setText(initial_.value(QStringLiteral("name")).toString());
        const QString kind = initial_.value(QStringLiteral("kind")).toString();
        const int ki = kind_->findData(kind);
        if (ki >= 0) kind_->setCurrentIndex(ki);
        path_->setText(initial_.value(QStringLiteral("path")).toString());
        args_->setPlainText(joinArgsForEdit(initial_.value(QStringLiteral("args")).toArray()));
        cwd_->setText(initial_.value(QStringLiteral("cwd")).toString());
        const int si = strategy_->findData(initial_.value(QStringLiteral("strategy")).toString());
        if (si >= 0) strategy_->setCurrentIndex(si);
        graceful_->setValue(initial_.value(QStringLiteral("gracefulTimeout")).toInt());
        const QString hm = initial_.value(QStringLiteral("healthMode")).toString();
        const int hi = health_->findData(hm);
        if (hi >= 0) health_->setCurrentIndex(hi);
        healthTarget_->setText(initial_.value(QStringLiteral("healthTarget")).toString());
        const QJsonArray deps = initial_.value(QStringLiteral("deps")).toArray();
        for (const auto& d : deps) {
            selectedDeps_.insert(d.toString());
        }
        name_->setEnabled(false); // 任务名不可改（update 以 name 定位）
    }

    connect(browse, &QPushButton::clicked, this, &TaskDialog::onBrowsePath);
    connect(cwdBrowse, &QPushButton::clicked, this, &TaskDialog::onBrowseCwd);
    connect(path_, &QLineEdit::textChanged, this, &TaskDialog::onPathChanged);
    connect(kind_, &QComboBox::currentIndexChanged, this, &TaskDialog::onKindChanged);
    connect(health_, &QComboBox::currentIndexChanged, this, &TaskDialog::onHealthChanged);
    connect(args_, &QPlainTextEdit::textChanged, this, &TaskDialog::onArgsChanged);
    connect(cancel, &QPushButton::clicked, this, &QDialog::reject);
    connect(ok, &QPushButton::clicked, this, &TaskDialog::onSubmit);

    onKindChanged();
    onHealthChanged();
    onArgsChanged();
}

void TaskDialog::onBrowsePath()
{
    const QString sel = QFileDialog::getOpenFileName(
        this, QStringLiteral("选择程序"), QString(),
        QStringLiteral("程序 (*.exe *.bat *.cmd *.ps1);;所有文件 (*.*)"));
    if (!sel.isEmpty()) {
        path_->setText(sel);
    }
}

void TaskDialog::onBrowseCwd()
{
    const QString sel = QFileDialog::getExistingDirectory(this, QStringLiteral("选择工作目录"));
    if (!sel.isEmpty()) {
        cwd_->setText(sel);
    }
}

void TaskDialog::onPathChanged(const QString& path)
{
    const QString k = kindFromExt(path);
    if (!k.isEmpty()) {
        const int idx = kind_->findData(k);
        if (idx >= 0) kind_->setCurrentIndex(idx);
    }
    if (name_->text().isEmpty()) {
        // 从路径推断默认任务名
        const QString base = path.section(QLatin1Char('\\'), -1).section(QLatin1Char('/'), -1);
        const int dot = base.lastIndexOf(QLatin1Char('.'));
        if (dot > 0) {
            name_->setText(base.left(dot));
        }
    }
    refreshPreview();
}

void TaskDialog::onKindChanged()
{
    const QString kind = kind_->currentData().toString();
    graceful_->setEnabled(kind == QStringLiteral("exe"));
    if (kind != QStringLiteral("exe")) {
        graceful_->setValue(0);
    }
    refreshPreview();
}

void TaskDialog::onHealthChanged()
{
    const QString h = health_->currentData().toString();
    const bool show = h != QStringLiteral("none");
    healthTargetLabel_->setVisible(show);
    healthTarget_->setVisible(show);
    healthErr_->clear();
    if (h == QStringLiteral("tcp")) {
        healthTargetLabel_->setText(QStringLiteral("host:port"));
        healthTarget_->setPlaceholderText(QStringLiteral("127.0.0.1:8080"));
    } else if (h == QStringLiteral("http")) {
        healthTargetLabel_->setText(QStringLiteral("URL"));
        healthTarget_->setPlaceholderText(QStringLiteral("http://127.0.0.1:8080/health"));
    } else if (h == QStringLiteral("ready")) {
        healthTargetLabel_->setText(QStringLiteral("stdout 关键字"));
        healthTarget_->setPlaceholderText(QStringLiteral("ready"));
    }
}

void TaskDialog::onArgsChanged()
{
    const ParsedArgs p = parseArgs(args_->toPlainText());
    if (!p.error.isEmpty()) {
        argsPreview_->clear();
        argsErr_->setText(p.error);
    } else if (!p.args.isEmpty()) {
        QStringList chips;
        for (const QString& a : p.args) {
            chips << a;
        }
        argsPreview_->setText(QStringLiteral("解析预览 argv → %1（%2 个参数）").arg(chips.join(QStringLiteral(" │ "))).arg(p.args.size()));
        argsErr_->clear();
    } else {
        argsPreview_->clear();
        argsErr_->clear();
    }
    refreshPreview();
}

void TaskDialog::refreshPreview()
{
    const QString kind = kind_->currentData().toString();
    const QString path = path_->text().trimmed();
    const ParsedArgs p = parseArgs(args_->toPlainText());
    if (path.isEmpty()) {
        cmdPreview_->setText(QStringLiteral("— 选择程序后自动生成 —"));
    } else {
        cmdPreview_->setText(buildCommandText(kind, path, p.args));
    }
}

QSet<QString> TaskDialog::forbiddenSet() const
{
    // 环检测：编辑任务 X 时，候选依赖若（传递地）依赖 X 则禁用
    QSet<QString> bad;
    if (initial_.isEmpty()) {
        return bad;
    }
    const QString self = initial_.value(QStringLiteral("name")).toString();
    QStringList stack;
    stack << self;
    while (!stack.isEmpty()) {
        const QString id = stack.takeLast();
        for (const auto& v : allTasks_) {
            const QJsonObject t = v.toObject();
            const QJsonArray deps = t.value(QStringLiteral("deps")).toArray();
            for (const auto& d : deps) {
                if (d.toString() == id) {
                    const QString tn = t.value(QStringLiteral("name")).toString();
                    if (!bad.contains(tn)) {
                        bad.insert(tn);
                        stack << tn;
                    }
                }
            }
        }
    }
    bad.remove(self);
    return bad;
}

void TaskDialog::rebuildDeps()
{
    while (QLayoutItem* item = depsLayout_->takeAt(0)) {
        if (item->widget()) item->widget()->deleteLater();
        delete item;
    }

    const QString self = initial_.isEmpty() ? QString() : initial_.value(QStringLiteral("name")).toString();
    const QSet<QString> forbidden = forbiddenSet();

    bool any = false;
    auto* flow = new QHBoxLayout();
    flow->setSpacing(6);
    for (const auto& v : allTasks_) {
        const QString tn = v.toObject().value(QStringLiteral("name")).toString();
        if (tn == self) continue;
        any = true;
        auto* chip = new QPushButton(depsContainer_);
        chip->setCheckable(true);
        const bool on = selectedDeps_.contains(tn);
        const bool blocked = forbidden.contains(tn);
        chip->setChecked(on);
        chip->setEnabled(!blocked);
        chip->setToolTip(blocked ? QStringLiteral("会形成依赖环，已禁用") : QString());
        chip->setText((on ? QStringLiteral("✓ ") : QString()) + tn);
        chip->setStyleSheet(QStringLiteral(
            "QPushButton{background:transparent;color:%1;border:1px solid %2;border-radius:5px;padding:4px 10px;font-family:Consolas,monospace;font-size:12px;}"
            "QPushButton:hover{border-color:#ff9557;}"
            "QPushButton:checked{background:rgba(255,122,41,0.14);border-color:#ff7a29;color:#ff9557;}"
            "QPushButton:disabled{color:#3a4148;border-color:#1c2228;}")
            .arg(on ? QStringLiteral("#ff9557") : QStringLiteral("#8a949e"))
            .arg(on ? QStringLiteral("#ff7a29") : QStringLiteral("#2a313a")));
        connect(chip, &QPushButton::toggled, this, [this, tn](bool checked) {
            if (checked) {
                selectedDeps_.insert(tn);
            } else {
                selectedDeps_.remove(tn);
            }
        });
        flow->addWidget(chip);
    }
    flow->addStretch(1);
    if (any) {
        depsLayout_->addLayout(flow);
    } else {
        auto* empty = new QLabel(QStringLiteral("暂无其他任务"), depsContainer_);
        empty->setStyleSheet(QStringLiteral("color:#8a949e;font-size:12px;"));
        depsLayout_->addWidget(empty);
    }
}

void TaskDialog::setErr(QLabel* label, const QString& msg)
{
    label->setText(msg);
    label->setVisible(!msg.isEmpty());
}

void TaskDialog::onSubmit()
{
    bool ok = true;

    const QString name = name_->text().trimmed();
    if (name.isEmpty()) {
        setErr(nameErr_, QStringLiteral("任务名不能为空"));
        ok = false;
    } else {
        setErr(nameErr_, QString());
    }

    const QString path = path_->text().trimmed();
    if (path.isEmpty()) {
        setErr(pathErr_, QStringLiteral("路径不能为空"));
        ok = false;
    } else {
        setErr(pathErr_, QString());
    }

    const ParsedArgs p = parseArgs(args_->toPlainText());
    if (!p.error.isEmpty()) {
        setErr(argsErr_, p.error);
        ok = false;
    } else {
        setErr(argsErr_, QString());
    }

    const QString h = health_->currentData().toString();
    const QString ht = healthTarget_->text().trimmed();
    if (h == QStringLiteral("tcp")) {
        static const QRegularExpression re(QStringLiteral("^[\\w.:-]+:\\d+$"));
        if (!re.match(ht).hasMatch()) {
            setErr(healthErr_, QStringLiteral("TCP 目标格式：host:port"));
            ok = false;
        } else {
            setErr(healthErr_, QString());
        }
    } else if (h == QStringLiteral("http")) {
        static const QRegularExpression re(QStringLiteral("^https?://.+"));
        if (!re.match(ht).hasMatch()) {
            setErr(healthErr_, QStringLiteral("HTTP 目标需以 http(s):// 开头"));
            ok = false;
        } else {
            setErr(healthErr_, QString());
        }
    } else if (h == QStringLiteral("ready")) {
        if (ht.isEmpty()) {
            setErr(healthErr_, QStringLiteral("请填写就绪关键字"));
            ok = false;
        } else {
            setErr(healthErr_, QString());
        }
    } else {
        setErr(healthErr_, QString());
    }

    if (!ok) {
        return;
    }

    // 构建 snake_case TaskConfig
    QJsonArray argsArr;
    for (const QString& a : p.args) {
        argsArr.append(a);
    }
    QJsonArray depsArr;
    for (const QString& d : selectedDeps_) {
        depsArr.append(d);
    }
    QJsonObject health;
    health.insert(QStringLiteral("mode"), h);
    health.insert(QStringLiteral("target"), ht);

    result_.insert(QStringLiteral("name"), name);
    result_.insert(QStringLiteral("kind"), kind_->currentData().toString());
    result_.insert(QStringLiteral("path"), path);
    result_.insert(QStringLiteral("args"), argsArr);
    result_.insert(QStringLiteral("cwd"), cwd_->text().trimmed());
    result_.insert(QStringLiteral("strategy"), strategy_->currentData().toString());
    result_.insert(QStringLiteral("graceful_timeout"), graceful_->value());
    result_.insert(QStringLiteral("deps"), depsArr);
    result_.insert(QStringLiteral("health"), health);
    result_.insert(QStringLiteral("enabled"), true);

    accept();
}
