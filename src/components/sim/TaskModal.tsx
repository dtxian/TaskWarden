import { useMemo, useRef, useState } from "react";
import type { Kind, SimTask, TaskDraft } from "../../sim/useSimulator";
import { buildCommand, kindFromExt, parseArgs, pathExists } from "../../sim/useSimulator";
import { IconCheck, IconCopy, IconFile, IconFolder, IconX } from "../ui";

/* ------------------------------------------------------------------ */
/* 任务编辑器（新增 / 编辑）+ 删除二次确认                                */
/* ------------------------------------------------------------------ */

const inputCls =
  "w-full rounded-[6px] border border-[var(--eg-line)] bg-[var(--eg-inset)] px-2.5 py-1.5 font-mono text-[12px] text-[var(--eg-text)] outline-none transition-colors focus:border-[#FF7A29] placeholder:text-[var(--eg-muted)]/60";
const labelCls = "mb-1 block text-[11px] font-semibold text-[var(--eg-muted)]";

function emptyDraft(): TaskDraft {
  return { name: "", kind: "exe", path: "", args: "", cwd: "", strategy: "always", health: "none", healthTarget: "", gracefulTimeout: 5, deps: [] };
}

interface Props {
  initial: SimTask | null;
  allTasks: SimTask[];
  onClose: () => void;
  onSubmit: (d: TaskDraft) => boolean;
}

export default function TaskModal({ initial, allTasks, onClose, onSubmit }: Props) {
  const [d, setD] = useState<TaskDraft>(() =>
    initial
      ? { name: initial.name, kind: initial.kind, path: initial.path, args: initial.args, cwd: initial.cwd, strategy: initial.strategy, health: initial.health, healthTarget: initial.healthTarget, gracefulTimeout: initial.gracefulTimeout, deps: [...initial.deps] }
      : emptyDraft(),
  );
  const [errs, setErrs] = useState<Record<string, string>>({});
  const [copiedPath, setCopiedPath] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const dirRef = useRef<HTMLInputElement>(null);
  const editing = initial !== null;
  const parsed = parseArgs(d.args);

  const copyPath = async () => {
    try {
      await navigator.clipboard.writeText("%APPDATA%\\Sentinel\\config.toml");
      setCopiedPath(true);
      window.setTimeout(() => setCopiedPath(false), 1500);
    } catch { /* 剪贴板不可用时静默 */ }
  };

  // 环检测：候选依赖若（传递地）依赖本任务则禁用
  const forbidden = useMemo(() => {
    if (!initial) return new Set<string>();
    const bad = new Set<string>();
    const walk = (id: string) => {
      allTasks
        .filter((t) => t.deps.includes(id))
        .forEach((t) => {
          if (!bad.has(t.id)) {
            bad.add(t.id);
            walk(t.id);
          }
        });
    };
    walk(initial.id);
    return bad;
  }, [allTasks, initial]);

  const setPath = (path: string) => {
    const k = kindFromExt(path);
    setD((p) => ({ ...p, path, kind: k ?? p.kind, name: p.name || path.split(/[\\/]/).pop()?.replace(/\.[^.]+$/, "") || "" }));
  };

  const validate = (): boolean => {
    const e: Record<string, string> = {};
    if (!d.name.trim()) e.name = "任务名不能为空";
    if (!d.path.trim()) e.path = "路径不能为空";
    else if (!/\.(exe|bat|cmd|ps1)$/i.test(d.path)) e.path = "仅支持 .exe / .bat / .cmd / .ps1";
    else if (!pathExists(d.path, allTasks.map((t) => t.path)))
      e.path = "路径不存在（Sentinel 启动前校验失败）—— 请用「浏览…」选择文件，或核对路径";
    if (parsed.error) e.args = parsed.error;
    if (d.health === "tcp" && !/^[\w.:-]+:\d+$/.test(d.healthTarget)) e.health = "TCP 目标格式：host:port";
    if (d.health === "http" && !/^https?:\/\/.+/.test(d.healthTarget)) e.health = "HTTP 目标需以 http(s):// 开头";
    if (d.health === "ready" && !d.healthTarget.trim()) e.health = "请填写就绪关键字";
    setErrs(e);
    return Object.keys(e).length === 0;
  };

  const submit = () => {
    if (!validate()) return;
    if (onSubmit({ ...d, name: d.name.trim() })) onClose();
  };

  return (
    <div className="absolute inset-0 z-30 flex items-center justify-center bg-black/55 p-4 backdrop-blur-[2px]" onClick={onClose}>
      <div
        className="toast-in w-full max-w-[620px] overflow-hidden rounded-xl border border-[var(--eg-line)] bg-[var(--eg-panel)] shadow-[0_30px_80px_-20px_rgba(0,0,0,0.7)]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-[var(--eg-line)] px-4 py-2.5">
          <span className="font-display text-[13px] font-bold text-[var(--eg-text)]">
            {editing ? `编辑任务 · ${initial.name}` : "添加任务 · 文件选择 → 参数 → 静默启动"}
          </span>
          <button onClick={onClose} className="rounded p-1 text-[var(--eg-muted)] transition-colors hover:bg-[var(--eg-inset)] hover:text-[var(--eg-text)]">
            <IconX size={14} />
          </button>
        </div>

        <div className="max-h-[62vh] space-y-3 overflow-y-auto px-4 py-3.5">
          {/* 名称 + 类型 */}
          <div className="grid grid-cols-[1fr_110px] gap-3">
            <div>
              <label className={labelCls}>任务名称</label>
              <input className={inputCls} value={d.name} onChange={(e) => setD({ ...d, name: e.target.value })} placeholder="ollama-serve" />
              {errs.name && <p className="mt-1 text-[10.5px] text-[#FF7B70]">{errs.name}</p>}
            </div>
            <div>
              <label className={labelCls}>类型</label>
              <select className={inputCls} value={d.kind} onChange={(e) => setD({ ...d, kind: e.target.value as Kind })}>
                <option value="exe">exe 直启</option>
                <option value="bat">bat · cmd /c</option>
                <option value="ps1">ps1 · Bypass</option>
              </select>
            </div>
          </div>

          {/* 路径 */}
          <div>
            <label className={labelCls}>程序路径（文件选择器）</label>
            <div className="flex gap-2">
              <input className={inputCls} value={d.path} onChange={(e) => setPath(e.target.value)} placeholder="C:\tools\app.exe" />
              <button
                onClick={() => fileRef.current?.click()}
                className="flex shrink-0 items-center gap-1.5 rounded-[6px] border border-[var(--eg-line)] bg-[var(--eg-inset)] px-3 text-[11.5px] font-medium text-[var(--eg-text)] transition-colors hover:border-[#FF7A29] hover:text-[#FF9557]"
              >
                <IconFolder size={13} /> 浏览…
              </button>
              <input
                ref={fileRef}
                type="file"
                accept=".exe,.bat,.cmd,.ps1"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) setPath(`C:\\Users\\demo\\${f.name}`);
                  e.target.value = "";
                }}
              />
            </div>
            {errs.path ? (
              <p className="mt-1 text-[10.5px] text-[#FF7B70]">{errs.path}</p>
            ) : (
              <p className="mt-1 font-mono text-[9.5px] text-[var(--eg-muted)]/70">
                启动前校验 · 模拟文件系统：「浏览…」选择的文件恒可用，亦可尝试 C:\Windows\System32\ping.exe
              </p>
            )}
          </div>

          {/* 启动参数（多行大文本框） */}
          <div>
            <label className={labelCls}>
              启动参数（多行 · 空格/换行切分，引号包裹带空格参数）
              <span className="ml-2 font-mono text-[9px] font-normal text-[var(--eg-muted)]/70">可拖拽右下角扩展</span>
            </label>
            <textarea
              className={`${inputCls} min-h-[104px] resize-y leading-[1.8]`}
              rows={4}
              value={d.args}
              onChange={(e) => setD({ ...d, args: e.target.value })}
              placeholder={'--port 8080\n--log-dir "C:\\logs my app"\n--workers 4'}
              spellCheck={false}
            />
            {errs.args ? (
              <p className="mt-1 text-[10.5px] text-[#FF7B70]">{errs.args}</p>
            ) : parsed.args.length > 0 ? (
              <div className="mt-1.5 flex flex-wrap items-center gap-1 rounded-[7px] border border-[var(--eg-line-soft)] bg-[var(--eg-inset)] px-2.5 py-1.5">
                <span className="font-mono text-[9.5px] font-semibold tracking-wider text-[var(--eg-muted)]">解析预览 argv →</span>
                {parsed.args.map((a, i) => (
                  <span
                    key={`${i}-${a}`}
                    className="rounded-[4px] border border-[rgba(122,212,232,0.35)] bg-[rgba(122,212,232,0.08)] px-1.5 py-px font-mono text-[10px] text-[#7AD4E8]"
                  >
                    {a}
                  </span>
                ))}
                <span className="ml-auto font-mono text-[9px] text-[var(--eg-muted)]/70">{parsed.args.length} 个参数</span>
              </div>
            ) : null}
          </div>

          {/* 工作目录（带目录浏览） */}
          <div>
            <label className={labelCls}>工作目录（可选）</label>
            <div className="flex gap-2">
              <input className={inputCls} value={d.cwd} onChange={(e) => setD({ ...d, cwd: e.target.value })} placeholder="C:\tools" />
              <button
                type="button"
                onClick={() => dirRef.current?.click()}
                className="flex shrink-0 items-center gap-1.5 rounded-[6px] border border-[var(--eg-line)] bg-[var(--eg-inset)] px-3 text-[11.5px] font-medium text-[var(--eg-text)] transition-colors hover:border-[#FF7A29] hover:text-[#FF9557]"
              >
                <IconFolder size={13} /> 选目录…
              </button>
              <input
                ref={dirRef}
                type="file"
                className="hidden"
                {...({ webkitdirectory: "" } as Record<string, string>)}
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) {
                    const top = f.webkitRelativePath.split("/")[0];
                    setD({ ...d, cwd: `C:\\Users\\demo\\${top}` });
                  }
                  e.currentTarget.value = "";
                }}
              />
            </div>
          </div>

          {/* 策略 + 优雅超时 */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>重启策略（per-task）</label>
              <select className={inputCls} value={d.strategy} onChange={(e) => setD({ ...d, strategy: e.target.value as TaskDraft["strategy"] })}>
                <option value="always">always · 总是重启</option>
                <option value="on-failure">on-failure · 失败时重启</option>
                <option value="never">never · 从不重启</option>
              </select>
            </div>
            <div>
              <label className={labelCls}>优雅停止超时（秒，仅 exe）</label>
              <input
                type="number"
                min={0}
                max={120}
                className={inputCls}
                value={d.gracefulTimeout}
                onChange={(e) => setD({ ...d, gracefulTimeout: Math.max(0, Number(e.target.value) || 0) })}
                disabled={d.kind !== "exe"}
              />
            </div>
          </div>

          {/* 健康检查 */}
          <div className="grid grid-cols-[130px_1fr] gap-3">
            <div>
              <label className={labelCls}>健康检查</label>
              <select className={inputCls} value={d.health} onChange={(e) => setD({ ...d, health: e.target.value as TaskDraft["health"] })}>
                <option value="none">无</option>
                <option value="tcp">TCP 端口</option>
                <option value="http">HTTP 状态码</option>
                <option value="ready">就绪等待</option>
              </select>
            </div>
            {d.health !== "none" && (
              <div>
                <label className={labelCls}>{d.health === "tcp" ? "host:port" : d.health === "http" ? "URL" : "stdout 关键字"}</label>
                <input
                  className={inputCls}
                  value={d.healthTarget}
                  onChange={(e) => setD({ ...d, healthTarget: e.target.value })}
                  placeholder={d.health === "tcp" ? "127.0.0.1:8080" : d.health === "http" ? "http://127.0.0.1:8080/health" : "ready"}
                />
              </div>
            )}
          </div>
          {errs.health && <p className="-mt-1 text-[10.5px] text-[#FF7B70]">{errs.health}</p>}

          {/* 依赖 */}
          <div>
            <label className={labelCls}>依赖任务（DAG · 上游先启）</label>
            <div className="flex flex-wrap gap-1.5">
              {allTasks.filter((t) => t.id !== initial?.id).length === 0 && (
                <span className="text-[11px] text-[var(--eg-muted)]">暂无其他任务</span>
              )}
              {allTasks
                .filter((t) => t.id !== initial?.id)
                .map((t) => {
                  const on = d.deps.includes(t.id);
                  const blocked = forbidden.has(t.id);
                  return (
                    <button
                      key={t.id}
                      type="button"
                      disabled={blocked}
                      title={blocked ? "会形成依赖环，已禁用" : undefined}
                      onClick={() => setD({ ...d, deps: on ? d.deps.filter((x) => x !== t.id) : [...d.deps, t.id] })}
                      className={`rounded-[5px] border px-2 py-1 font-mono text-[11px] transition-colors disabled:opacity-30 ${
                        on
                          ? "border-[#FF7A29] bg-[rgba(255,122,41,0.14)] text-[#FF9557]"
                          : "border-[var(--eg-line)] text-[var(--eg-muted)] hover:border-[var(--eg-muted)]"
                      }`}
                    >
                      {on ? "✓ " : ""}{t.name}
                    </button>
                  );
                })}
            </div>
          </div>

          {/* 启动命令预览 */}
          <div className="rounded-[8px] border border-[rgba(255,122,41,0.3)] bg-[rgba(255,122,41,0.06)] px-3 py-2">
            <div className="mb-1 text-[10px] font-semibold tracking-wider text-[#FF9557]">启动命令预览 · 附加 CREATE_NO_WINDOW</div>
            <code className="block break-all font-mono text-[11.5px] leading-relaxed text-[var(--eg-text)]">
              {d.path ? buildCommand(d.kind, d.path, d.args) : "— 选择程序后自动生成 —"}
            </code>
          </div>

          {/* 配置文件位置 */}
          <div className="flex items-center gap-2.5 rounded-[8px] border border-[var(--eg-line-soft)] bg-[var(--eg-inset)] px-3 py-2">
            <IconFile size={13} className="shrink-0 text-[#FF9557]" />
            <div className="min-w-0 flex-1">
              <div className="truncate font-mono text-[11px] font-semibold text-[var(--eg-text)]">%APPDATA%\Sentinel\config.toml</div>
              <div className="text-[9.5px] text-[var(--eg-muted)]">配置文件位置 · 原子写入（临时文件 + rename）· 可直接复制备份</div>
            </div>
            <button
              type="button"
              onClick={copyPath}
              className="flex shrink-0 items-center gap-1 rounded-[5px] border border-[var(--eg-line)] px-2 py-1 font-mono text-[10px] text-[var(--eg-muted)] transition-colors hover:border-[#FF9557] hover:text-[#FF9557]"
            >
              {copiedPath ? <IconCheck size={10} className="text-[#3ECF6E]" /> : <IconCopy size={10} />}
              {copiedPath ? "已复制" : "复制路径"}
            </button>
          </div>
        </div>

        <div className="flex justify-end gap-2 border-t border-[var(--eg-line)] px-4 py-3">
          <button onClick={onClose} className="rounded-[6px] border border-[var(--eg-line)] px-4 py-1.5 text-[12px] text-[var(--eg-muted)] transition-colors hover:text-[var(--eg-text)]">
            取消
          </button>
          <button
            onClick={submit}
            className="rounded-[6px] bg-[#FF7A29] px-4 py-1.5 text-[12px] font-bold text-[#1a0d04] transition-all hover:bg-[#FF9557] active:scale-[0.97]"
          >
            {editing ? "保存配置" : "创建任务"}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ---------------- 删除二次确认 ---------------- */

export function ConfirmDialog({ title, desc, confirmText, onCancel, onConfirm }: {
  title: string;
  desc: string;
  confirmText: string;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div className="absolute inset-0 z-40 flex items-center justify-center bg-black/55 p-4 backdrop-blur-[2px]" onClick={onCancel}>
      <div className="toast-in w-full max-w-[400px] rounded-xl border border-[rgba(240,86,74,0.4)] bg-[var(--eg-panel)] p-5 shadow-[0_30px_80px_-20px_rgba(0,0,0,0.7)]" onClick={(e) => e.stopPropagation()}>
        <div className="font-display text-[14px] font-bold text-[var(--eg-text)]">{title}</div>
        <p className="mt-2 text-[12px] leading-relaxed text-[var(--eg-muted)]">{desc}</p>
        <div className="mt-4 flex justify-end gap-2">
          <button onClick={onCancel} className="rounded-[6px] border border-[var(--eg-line)] px-4 py-1.5 text-[12px] text-[var(--eg-muted)] transition-colors hover:text-[var(--eg-text)]">
            取消
          </button>
          <button onClick={onConfirm} className="rounded-[6px] bg-[#F0564A] px-4 py-1.5 text-[12px] font-bold text-white transition-all hover:bg-[#FF7B70] active:scale-[0.97]">
            {confirmText}
          </button>
        </div>
      </div>
    </div>
  );
}
