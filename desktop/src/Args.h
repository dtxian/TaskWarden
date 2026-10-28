/* ------------------------------------------------------------------ */
/* Args.h：参数解析 / 类型推断 / 命令预览（与 TS parseArgs/kindFromExt/    */
/* buildCommand 及 Rust process.rs::build_command 镜像，改一处改三处）     */
/* ------------------------------------------------------------------ */

#pragma once

#include <QString>
#include <QStringList>

struct ParsedArgs {
    QStringList args;
    QString error; // 空 = 成功
};

/// 空格 + 引号感知的参数解析：支持成对 " / '，支持 \" 转义；引号不闭合报错。
inline ParsedArgs parseArgs(const QString& input)
{
    QStringList args;
    QString cur;
    bool inSingle = false;
    bool inDouble = false;
    bool hasToken = false;
    for (int i = 0; i < input.size(); ++i) {
        const QChar c = input[i];
        if (c == QLatin1Char('\\') && i + 1 < input.size() && input[i + 1] == QLatin1Char('"')) {
            cur += QLatin1Char('"');
            ++i;
            hasToken = true;
            continue;
        }
        if (c == QLatin1Char('"') && !inSingle) {
            inDouble = !inDouble;
            hasToken = true;
            continue;
        }
        if (c == QLatin1Char('\'') && !inDouble) {
            inSingle = !inSingle;
            hasToken = true;
            continue;
        }
        if ((c == QLatin1Char(' ') || c == QLatin1Char('\t') || c == QLatin1Char('\n') || c == QLatin1Char('\r'))
            && !inSingle && !inDouble) {
            if (hasToken) {
                args << cur;
                cur.clear();
                hasToken = false;
            }
            continue;
        }
        cur += c;
        hasToken = true;
    }
    if (inSingle || inDouble) {
        return { {}, QStringLiteral("引号未闭合：参数解析失败，请检查 \" 或 ' 是否成对") };
    }
    if (hasToken) {
        args << cur;
    }
    return { args, QString() };
}

/// 由扩展名推断任务类型；不匹配返回空串。
inline QString kindFromExt(const QString& path)
{
    const QString ext = path.section(QLatin1Char('.'), -1).toLower();
    if (ext == QStringLiteral("exe")) return QStringLiteral("exe");
    if (ext == QStringLiteral("bat") || ext == QStringLiteral("cmd")) return QStringLiteral("bat");
    if (ext == QStringLiteral("ps1")) return QStringLiteral("ps1");
    return QString();
}

/// 完整启动命令文本（所见即所得，与 Rust TaskView::command_line 镜像）。
inline QString buildCommandText(const QString& kind, const QString& path, const QStringList& args)
{
    auto quote = [](const QString& s) -> QString {
        if (s.isEmpty()) return s;
        if (s.contains(QLatin1Char(' ')) && !(s.startsWith(QLatin1Char('"')) && s.endsWith(QLatin1Char('"')))) {
            return QStringLiteral("\"%1\"").arg(s);
        }
        return s;
    };
    QStringList parts;
    if (kind == QStringLiteral("exe")) {
        parts << quote(path);
    } else if (kind == QStringLiteral("bat")) {
        parts << QStringLiteral("cmd") << QStringLiteral("/c") << quote(path);
    } else {
        parts << QStringLiteral("powershell") << QStringLiteral("-ExecutionPolicy") << QStringLiteral("Bypass")
              << QStringLiteral("-File") << quote(path);
    }
    for (const QString& a : args) {
        parts << quote(a);
    }
    return parts.join(QLatin1Char(' '));
}
