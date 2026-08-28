import { memo, useCallback, useEffect, useRef, useState } from "react";
import type { LogLine, SimTask } from "../../sim/useSimulator";
import { fmtClock, LOG_CAP } from "../../sim/useSimulator";
import { IconCheck, IconCopy, IconTerminal, IconX } from "../ui";

/* ------------------------------------------------------------------ */
/* 实时日志面板：Ring Buffer 回看 · 自动滚动 · ERR 标红 · 清空/复制        */
/* 顶部拖拽把手：按住上下拖动调整日志区高度（localStorage 持久化，双击复位） */
/* ------------------------------------------------------------------ */

const LEVEL_STYLE: Record<LogLine["level"], string> = {
  INFO: "text-[var(--eg-muted)]",
  WARN: "text-[#F5B84B]",
  ERR: "text-[#FF7B70]",
  SYS: "text-[#7AD4E8]",
};

const LS_KEY = "taskw…t-v1";
const DEFAULT_H = 196;
const MIN_H = 120;

function clampHeight(v: number) {
  const max = Math.max(MIN_H, Math.min(1000, window.innerHeight - 300));
  return Math.min(max, Math.max(MIN_H, v));
}

function initialHeight(): number {
  try {
    const v = Number(localStorage.getItem(LS_KEY));
    if (Number.isFinite(v) && v >= MIN_H) return clampHeight(v);
  } catch {
    /* 存储不可用则默认 */
  }
  return DEFAULT_H;
}

interface Props {
  task: SimTask | null;
  lines: LogLine[];
  autoScroll: boolean;
  onToggleAutoScroll: () => void;
  onClear: () => void;
}

function LogPanel({ task, lines, autoScroll, onToggleAutoScroll, onClear }: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [copied, setCopied] = useState(false);
  const [h, setH] = useState<number>(initialHeight);
  const drag = useRef<{ startY: number; startH: number } | null>(null);

  useEffect(() => {
    if (autoScroll && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [lines, autoScroll]);

  const onPointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    drag.current = { startY: e.clientY, startH: h };
    e.currentTarget.setPointerCapture(e.pointerId);
    e.preventDefault();
  }, [h]);

  const onPointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d) return;
    setH(clampHeight(d.startH - (e.clientY - d.startY))); // 向上拖 → 日志区变高
  }, []);

  const endDrag = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!drag.current) return;
    drag.current = null;
    e.currentTarget.releasePointerCapture(e.pointerId);
    try {
      localStorage.setItem(LS_KEY, String(h));
    } catch {
      /* 忽略 */
    }
  }, [h]);

  const copy = async () => {
    const text = lines.map((l) => `[${fmtClock(l.t)}] [${l.level}] ${l.msg}`).join("\n");
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      /* 剪贴板不可用时静默 */
    }
  };

  const smallBtn =
    "inline-flex items-center gap-1 rounded-[5px] border border-[var(--eg-line)] px-2 py-[3px] text-[10.5px] font-medium text-[var(--eg-muted)] transition-colors hover:text-[var(--eg-text)] hover:border-[var(--eg-muted)]";

  return (
    <div className="border-t border-[var(--eg-line)] bg-[var(--eg-panel)]">
      {/* 拖拽把手：调节日志区高度 */}
      <div
        role="separator"
        aria-orientation="horizontal"
        title="按住上下拖动调整日志区高度 · 双击恢复默认"
        className="group relative h-[7px] shrink-0 cursor-row-resize select-none touch-none bg-transparent"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onDoubleClick={() => {
          setH(DEFAULT_H);
          try {
            localStorage.removeItem(LS_KEY);
          } catch {
            /* 忽略 */
          }
        }}
      >
        <div className="absolute inset-x-0 top-0 h-px bg-[var(--eg-line)] transition-colors group-hover:bg-[#FF7A29]/70" />
        <div className="absolute left-1/2 top-1/2 h-[3px] w-10 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[var(--eg-line)] opacity-0 transition-opacity group-hover:opacity-100 group-hover:bg-[#FF7A29]" />
      </div>

      {/* 面板头 */}
      <div className="flex items-center gap-2 px-3 py-2">
        <IconTerminal size={13} className="text-[#FF9557]" />
        <span className="font-display text-[12px] font-bold text-[var(--eg-text)]">实时日志</span>
        {task ? (
          <>
            <span className="rounded-[4px] border border-[rgba(255,122,41,0.4)] bg-[rgba(255,122,41,0.1)] px-1.5 py-px font-mono text-[10px] font-semibold text-[#FF9557]">
              {task.name}
            </span>
            <span className="font-mono text-[10px] text-[var(--eg-muted)]">logs\{task.name}.log</span>
          </>
        ) : (
          <span className="font-mono text-[10px] text-[var(--eg-muted)]">未选择任务</span>
        )}
        <span className="ml-1 hidden font-mono text-[10px] text-[var(--eg-muted)]/70 sm:block">
          Ring Buffer {lines.length}/{LOG_CAP}
        </span>

        <span className="ml-auto flex items-center gap-1.5">
          <button onClick={onToggleAutoScroll} className={`${smallBtn} ${autoScroll ? "!border-[rgba(62,207,110,0.5)] !text-[#3ECF6E]" : ""}`}>
            <span className={`h-1.5 w-1.5 rounded-full ${autoScroll ? "bg-[#3ECF6E]" : "bg-[var(--eg-muted)]"}`} />
            自动滚动
          </button>
          <button onClick={copy} className={smallBtn}>
            {copied ? <IconCheck size={11} className="text-[#3ECF6E]" /> : <IconCopy size={11} />}
            {copied ? "已复制" : "复制"}
          </button>
          <button onClick={onClear} className={smallBtn} disabled={!task}>
            <IconX size={11} /> 清空
          </button>
        </span>
      </div>

      {/* 日志流 */}
      <div
        ref={scrollRef}
        style={{ height: h }}
        className="overflow-y-auto border-t border-[var(--eg-line-soft)] bg-[var(--eg-inset)] px-3 py-2 font-mono text-[11px] leading-[1.7]"
      >
        {lines.length === 0 && (
          <div className="flex h-full items-center justify-center text-[11px] text-[var(--eg-muted)]">
            {task ? "暂无日志 —— 启动任务或触发操作后，输出将实时回放到此环状缓冲区" : "点击上方任务卡片查看其日志"}
          </div>
        )}
        {lines.map((l) => (
          <div key={l.id} className={`log-in grid grid-cols-[64px_44px_1fr] gap-2 rounded-[3px] px-1 ${l.level === "ERR" ? "bg-[rgba(240,86,74,0.09)]" : ""}`}>
            <span className="select-none text-[var(--eg-muted)]/60">{fmtClock(l.t)}</span>
            <span className={`select-none font-bold ${LEVEL_STYLE[l.level]}`}>[{l.level}]</span>
            <span className={`break-all ${l.level === "ERR" ? "text-[#FF7B70]" : "text-[var(--eg-text)]/90"}`}>{l.msg}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * 日志面板仅在选中任务/日志内容/自动滚动开关变化时重渲染：
 * lines 为父层每帧重建的引用，故按「长度 + 末行 id」判内容等价；
 * 函数 props 为内联闭包，其捕获值仅随 selectedId / autoScroll 变化，忽略其引用。
 * 面板自身拖拽高度、复制态为内部 state，不受 memo 影响。
 */
export default memo(LogPanel, (a, b) =>
  a.task === b.task &&
  a.autoScroll === b.autoScroll &&
  a.lines.length === b.lines.length &&
  a.lines[a.lines.length - 1]?.id === b.lines[b.lines.length - 1]?.id,
);
