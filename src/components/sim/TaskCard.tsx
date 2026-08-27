import type { SimTask, TaskState } from "../../sim/useSimulator";
import { buildCommand, fmtDur } from "../../sim/useSimulator";
import { IconBolt, IconEdit, IconFuse, IconLink, IconPlay, IconRestart, IconStop, IconX } from "../ui";

/* ------------------------------------------------------------------ */
/* 任务卡片（egui 风格，主题变量作用域内渲染）                             */
/* ------------------------------------------------------------------ */

const STATE_META: Record<TaskState, { label: string; c: string }> = {
  running: { label: "运行中", c: "#3ECF6E" },
  starting: { label: "启动中", c: "#F5B84B" },
  backoff: { label: "退避中", c: "#F5B84B" },
  fused: { label: "已熔断", c: "#F0564A" },
  stopped: { label: "已停止", c: "#6C7887" },
};

const KIND_META = {
  exe: { c: "#7AD4E8", t: "EXE" },
  bat: { c: "#FFC86B", t: "BAT" },
  ps1: { c: "#C792EA", t: "PS1" },
} as const;

interface Props {
  task: SimTask;
  now: number;
  selected: boolean;
  depNames: string[];
  onSelect: () => void;
  onStart: () => void;
  onStop: () => void;
  onRestart: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onCrash: () => void;
  onReset: () => void;
}

const btn =
  "inline-flex items-center gap-1 rounded-[5px] border px-2 py-[3px] text-[11px] font-medium transition-all duration-150 disabled:opacity-35 disabled:cursor-not-allowed active:scale-[0.96]";

export default function TaskCard(p: Props) {
  const { task: t, now } = p;
  const meta = STATE_META[t.state];
  const kind = KIND_META[t.kind];
  const err = t.state === "fused" || (t.lastError !== null && t.state !== "running");
  const countdown = t.state === "backoff" && t.backoffUntil ? Math.max(0, Math.ceil((t.backoffUntil - now) / 1000)) : 0;
  const active = t.state === "running" || t.state === "starting";

  return (
    <div
      onClick={p.onSelect}
      className={`relative cursor-pointer rounded-lg border bg-[var(--eg-card)] p-3 hover-lift text-left
        ${err ? "card-err-flash border-transparent" : ""}
        ${p.selected ? "border-[#FF7A29] shadow-[0_0_0_1px_rgba(255,122,41,0.4),0_8px_28px_-12px_rgba(255,122,41,0.35)]" : "border-[var(--eg-line)] hover:border-[var(--eg-muted)]"}
        ${!err && !p.selected ? "hover:shadow-[0_10px_30px_-14px_rgba(0,0,0,0.6)]" : ""}`}
      style={err ? { borderColor: "rgba(240,86,74,0.8)" } : undefined}
    >
      {/* 状态色条 */}
      <span className="absolute left-0 top-3 bottom-3 w-[3px] rounded-full" style={{ background: meta.c }} />

      {/* 头部 */}
      <div className="flex items-center gap-2 pl-2">
        <span
          className={`h-2 w-2 shrink-0 rounded-full ${t.state === "running" ? "pulse-dot" : ""} ${t.state === "fused" ? "pulse-dot-err" : ""}`}
          style={{ background: meta.c }}
        />
        <span className="truncate font-mono text-[13.5px] font-bold text-[var(--eg-text)]">{t.name}</span>
        <span
          className="rounded-[4px] border px-1.5 py-px text-[10px] font-semibold"
          style={{ color: meta.c, borderColor: `${meta.c}55`, background: `${meta.c}14` }}
        >
          {t.state === "backoff" ? `退避 ${countdown}s` : meta.label}
        </span>
        <span className="ml-auto shrink-0 font-mono text-[10.5px] text-[var(--eg-muted)]">
          {t.state === "running" ? (
            <span className="text-[#3ECF6E]">● 健康{t.probeMs !== null ? ` ${t.probeMs}ms` : ""}</span>
          ) : t.state === "starting" ? (
            <span className="text-[#F5B84B]">● 探测中</span>
          ) : (
            <span>✕ 离线</span>
          )}
        </span>
      </div>

      {/* 命令行 */}
      <div className="mt-2 flex items-center gap-1.5 pl-2">
        <span className="rounded-[4px] px-1.5 py-px font-mono text-[10px] font-bold" style={{ color: kind.c, background: `${kind.c}16` }}>
          {kind.t}
        </span>
        <code className="truncate font-mono text-[11px] text-[var(--eg-muted)]" title={buildCommand(t.kind, t.path, t.args)}>
          {buildCommand(t.kind, t.path, t.args)}
        </code>
      </div>

      {/* 运行信息 */}
      <div className="mt-2 grid grid-cols-3 gap-1 pl-2 font-mono text-[10.5px] text-[var(--eg-muted)]">
        <span>PID {t.pid ?? "—"}</span>
        <span>时长 {t.startedAt && active ? fmtDur(now - t.startedAt) : "—"}</span>
        <span>重启 {t.restarts} 次</span>
      </div>
      {t.exitCode !== null && !active && (
        <div className="mt-1 pl-2 font-mono text-[10.5px] text-[var(--eg-muted)]">退出码 {t.exitCode}</div>
      )}
      {t.lastError && (
        <div className="mt-1.5 rounded-[5px] border border-[rgba(240,86,74,0.35)] bg-[rgba(240,86,74,0.08)] px-2 py-1 text-[10.5px] leading-snug text-[#FF7B70]">
          {t.lastError}
        </div>
      )}

      {/* 依赖链 */}
      {p.depNames.length > 0 && (
        <div className="mt-2 flex flex-wrap items-center gap-1 pl-2">
          <IconLink size={11} className="text-[var(--eg-muted)]" />
          {p.depNames.map((d) => (
            <span key={d} className="rounded-[4px] border border-[var(--eg-line)] bg-[var(--eg-inset)] px-1.5 py-px font-mono text-[10px] text-[var(--eg-muted)]">
              ← {d}
            </span>
          ))}
        </div>
      )}

      {/* 操作区 */}
      <div className="mt-3 flex items-center gap-1.5 border-t border-[var(--eg-line-soft)] pt-2.5 pl-2" onClick={(e) => e.stopPropagation()}>
        <button
          onClick={p.onStart}
          disabled={t.state === "running" || t.state === "starting"}
          className={`${btn} border-[rgba(62,207,110,0.4)] text-[#3ECF6E] hover:bg-[rgba(62,207,110,0.12)]`}
        >
          <IconPlay size={11} /> 启动
        </button>
        <button
          onClick={p.onRestart}
          disabled={t.state !== "running"}
          className={`${btn} border-[rgba(245,184,75,0.4)] text-[#F5B84B] hover:bg-[rgba(245,184,75,0.12)]`}
        >
          <IconRestart size={11} /> 重启
        </button>
        <button
          onClick={p.onStop}
          disabled={t.state === "stopped"}
          className={`${btn} border-[rgba(240,86,74,0.4)] text-[#FF7B70] hover:bg-[rgba(240,86,74,0.12)]`}
        >
          <IconStop size={11} /> 停止
        </button>
        <span className="ml-auto flex items-center gap-1.5">
          {t.state === "fused" && (
            <button onClick={p.onReset} className={`${btn} border-[rgba(240,86,74,0.5)] text-[#FF7B70] hover:bg-[rgba(240,86,74,0.14)]`}>
              <IconFuse size={11} /> 重置熔断
            </button>
          )}
          <button onClick={p.onCrash} disabled={t.state !== "running"} title="模拟进程意外退出，演示守护策略" className={`${btn} border-[var(--eg-line)] text-[var(--eg-muted)] hover:text-[#FFC86B] hover:border-[rgba(255,200,107,0.5)]`}>
            <IconBolt size={11} /> 模拟异常
          </button>
          <button onClick={p.onEdit} title="编辑任务" className={`${btn} border-[var(--eg-line)] text-[var(--eg-muted)] hover:text-[var(--eg-text)]`}>
            <IconEdit size={11} />
          </button>
          <button onClick={p.onDelete} title="删除任务" className={`${btn} border-[var(--eg-line)] text-[var(--eg-muted)] hover:text-[#FF7B70] hover:border-[rgba(240,86,74,0.5)]`}>
            <IconX size={11} />
          </button>
        </span>
      </div>
    </div>
  );
}
