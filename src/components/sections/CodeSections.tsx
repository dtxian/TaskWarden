import { useState } from "react";
import { OUT_OF_SCOPE, PERF_STATS, ROBUSTNESS, STACK, TRAY_BEHAVIORS } from "../../data/content";
import { SNIPPETS } from "../../data/snippets";
import {
  IconAlert, IconCheck, IconCopy, IconEye, IconLock, IconMinimize, IconRestore,
  IconTimer, IconTrayMenu, IconX, CodeBlock, Reveal,
} from "../ui";
import { SectionHead } from "./DesignSections";

/* ------------------------------------------------------------------ */
/* 关键实现（代码标签页） · 托盘交互 · 性能与边界 · 技术栈                  */
/* ------------------------------------------------------------------ */

/* ---------------- 关键实现 ---------------- */

export function CodeSection() {
  const [active, setActive] = useState(SNIPPETS[0].id);
  const [copied, setCopied] = useState(false);
  const snip = SNIPPETS.find((s) => s.id === active) ?? SNIPPETS[0];

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(snip.code);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch { /* 忽略 */ }
  };

  return (
    <section id="code" className="mx-auto max-w-[1200px] scroll-mt-24 px-5 py-20">
      <SectionHead
        no="02 / 关键实现"
        title="把 Windows 的脏活，封装进干净的 Rust 抽象"
        desc="以下代码片段对应需求文档中的每一项硬指标：静默派生、进程树终结、滑动窗口熔断、DAG 调度、环状日志与单实例托盘入口。全部基于 std 与 windows-rs，无异步运行时。"
      />

      <div className="grid gap-6 lg:grid-cols-[280px_1fr]">
        {/* 标签列表 */}
        <Reveal className="flex flex-row gap-2 overflow-x-auto pb-1 lg:flex-col lg:overflow-visible">
          {SNIPPETS.map((s) => (
            <button
              key={s.id}
              onClick={() => setActive(s.id)}
              className={`shrink-0 rounded-[9px] border px-3.5 py-2.5 text-left transition-all lg:shrink ${
                active === s.id
                  ? "border-[#FF7A29]/70 bg-[#FF7A29]/[0.09] shadow-[0_8px_28px_-12px_rgba(255,122,41,0.5)]"
                  : "border-ink-700 bg-ink-850/60 hover:border-ink-500 hover:bg-ink-800"
              }`}
            >
              <div className={`font-mono text-[12px] font-bold ${active === s.id ? "text-[#FF9557]" : "text-fog-300"}`}>{s.file}</div>
              <div className="mt-0.5 text-[10.5px] text-fog-500">{s.title}</div>
              <div className="mt-1 inline-block rounded-[4px] bg-ink-700 px-1.5 py-px font-mono text-[9px] tracking-wider text-fog-500">{s.layer}</div>
            </button>
          ))}
        </Reveal>

        {/* 代码面板 */}
        <Reveal delay={100}>
          <div className="overflow-hidden rounded-[12px] border border-ink-700 bg-[#0C0F14]">
            <div className="flex items-center gap-2 border-b border-ink-700 bg-ink-850 px-4 py-2.5">
              <span className="h-2.5 w-2.5 rounded-full bg-[#F0564A]/80" />
              <span className="h-2.5 w-2.5 rounded-full bg-[#F5B84B]/80" />
              <span className="h-2.5 w-2.5 rounded-full bg-[#3ECF6E]/80" />
              <span className="ml-2 font-mono text-[11px] text-fog-300">{snip.file}</span>
              <span className="ml-2 rounded-[4px] bg-ink-700 px-1.5 py-px font-mono text-[9px] tracking-widest text-fog-500">
                {snip.lang === "rust" ? "RUST" : "TOML"}
              </span>
              <button
                onClick={copy}
                className="ml-auto flex items-center gap-1.5 rounded-[5px] border border-ink-600 px-2.5 py-1 font-mono text-[10.5px] text-fog-500 transition-colors hover:border-[#FF9557] hover:text-[#FF9557]"
              >
                {copied ? <IconCheck size={11} className="text-[#3ECF6E]" /> : <IconCopy size={11} />}
                {copied ? "已复制" : "复制"}
              </button>
            </div>
            <div className="max-h-[560px] overflow-y-auto p-4">
              <CodeBlock key={snip.id} code={snip.code} lang={snip.lang} />
            </div>
            <div className="border-t border-ink-700 bg-ink-850/70 px-4 py-3">
              <p className="text-[12px] leading-relaxed text-fog-500">
                <span className="mr-2 font-mono text-[10px] font-bold tracking-widest text-[#FF9557]">NOTE</span>
                {snip.note}
              </p>
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  );
}

/* ---------------- 托盘与健壮性 ---------------- */

const TRAY_ICONS = [<IconMinimize size={26} key="a" />, <IconRestore size={26} key="b" />, <IconTrayMenu size={26} key="c" />];
const ROBUST_ICONS = [<IconLock size={17} key="a" />, <IconAlert size={17} key="b" />, <IconTimer size={17} key="c" />, <IconEye size={17} key="d" />];

export function TraySection() {
  const [big, ...rest] = TRAY_BEHAVIORS;
  return (
    <section id="tray" className="mx-auto max-w-[1200px] scroll-mt-24 px-5 py-20">
      <SectionHead
        no="03 / 托盘交互与健壮性"
        title="关掉窗口 ≠ 退出 · 守护从不间断"
        desc="右上角 × 只是把 Sentinel 收进系统托盘：左键一键恢复，右键呼出菜单。真正的退出会通过 Job Object 级联终止所有子进程，并把 config.toml 原子落盘。"
      />

      <div className="grid gap-4 lg:grid-cols-[1.15fr_1fr]">
        {/* 大卡：最小化 */}
        <Reveal>
          <div className="group relative h-full overflow-hidden rounded-[14px] border border-ink-700 bg-ink-850/70 p-7 transition-all hover:border-[#FF7A29]/50 hover:shadow-[0_24px_60px_-24px_rgba(255,122,41,0.4)]">
            <div className="absolute -right-8 -top-8 h-40 w-40 rounded-full bg-[#FF7A29]/[0.07] blur-2xl transition-all group-hover:bg-[#FF7A29]/[0.14]" />
            <div className="flex items-center gap-3">
              <span className="flex h-12 w-12 items-center justify-center rounded-[10px] border border-[#FF7A29]/30 bg-[#FF7A29]/10 text-[#FF9557]">
                {TRAY_ICONS[0]}
              </span>
              <div className="font-display text-[19px] font-bold text-fog-100">{big.t}</div>
            </div>
            <p className="mt-4 max-w-[460px] text-[13px] leading-[1.85] text-fog-500">{big.d}</p>
            {/* 迷你动效示意 */}
            <div className="mt-6 flex items-center gap-4 rounded-[10px] border border-ink-700 bg-ink-900/80 p-4">
              <div className="relative h-16 w-24 shrink-0 rounded-[6px] border border-ink-500 bg-ink-800">
                <span className="absolute right-1 top-1 flex h-3 w-3 items-center justify-center rounded-sm bg-[#F0564A]/20 font-mono text-[8px] text-[#FF7B70]">×</span>
                <span className="absolute bottom-1.5 left-1.5 right-1.5 top-4 rounded-sm border border-ink-600 bg-ink-700/50" />
              </div>
              <svg width="60" height="24" viewBox="0 0 60 24" className="shrink-0 text-[#FF9557]">
                <line x1="0" y1="12" x2="48" y2="12" stroke="currentColor" strokeWidth="1.5" className="dash-flow" />
                <path d="M46 6l10 6-10 6" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              <div className="flex items-center gap-2 rounded-full border border-[#FF7A29]/40 bg-ink-800 px-3 py-1.5">
                <span className="h-2 w-2 rounded-full bg-[#3ECF6E] pulse-dot" />
                <span className="font-mono text-[10px] text-fog-300">托盘常驻 · 守护中</span>
              </div>
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              {big.keys.map((k) => <span key={k} className="kbd">{k}</span>)}
            </div>
          </div>
        </Reveal>

        {/* 两个小卡 */}
        <div className="grid gap-4">
          {rest.map((b, i) => (
            <Reveal key={b.t} delay={120 + i * 120}>
              <div className="group h-full rounded-[14px] border border-ink-700 bg-ink-850/70 p-6 transition-all hover:border-cyanx-500/50 hover:shadow-[0_20px_50px_-24px_rgba(83,193,222,0.45)]">
                <div className="flex items-center gap-3">
                  <span className="flex h-10 w-10 items-center justify-center rounded-[9px] border border-cyanx-500/25 bg-cyanx-500/10 text-cyanx-400">
                    {TRAY_ICONS[i + 1]}
                  </span>
                  <div className="font-display text-[16px] font-bold text-fog-100">{b.t}</div>
                </div>
                <p className="mt-3 text-[12.5px] leading-[1.8] text-fog-500">{b.d}</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  {b.keys.map((k) => <span key={k} className="kbd">{k}</span>)}
                </div>
              </div>
            </Reveal>
          ))}
        </div>
      </div>

      {/* 健壮性 */}
      <div className="mt-4 grid gap-4 md:grid-cols-2">
        {ROBUSTNESS.map((r, i) => (
          <Reveal key={r.t} delay={i * 90}>
            <div className="flex gap-3.5 rounded-[12px] border border-ink-700 bg-ink-850/50 p-5 transition-all hover:border-ink-500 hover:bg-ink-850">
              <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-[8px] border border-amberx-500/25 bg-amberx-500/10 text-amberx-400">
                {ROBUST_ICONS[i]}
              </span>
              <div>
                <div className="font-display text-[14.5px] font-bold text-fog-100">{r.t}</div>
                <p className="mt-1 text-[12px] leading-relaxed text-fog-500">{r.d}</p>
              </div>
            </div>
          </Reveal>
        ))}
      </div>
    </section>
  );
}

/* ---------------- 性能与边界 ---------------- */

export function PerfSection() {
  return (
    <section id="perf" className="mx-auto max-w-[1200px] scroll-mt-24 px-5 py-20">
      <SectionHead
        no="04 / 性能目标与明确不做"
        title="轻量是功能，不是妥协"
        desc="每一项「不做」都是为了把资源预算花在守护本身上：无热重载、无自启动、无日志轮转、无曲线图、无流量监控 —— 这些都交给更专业的工具。"
      />

      <div className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
        {/* 性能指标 */}
        <Reveal>
          <div className="grid h-full grid-cols-2 gap-4">
            {PERF_STATS.map((s) => (
              <div key={s.t} className="group relative overflow-hidden rounded-[12px] border border-ink-700 bg-ink-850/70 p-5 transition-all hover:border-[#3ECF6E]/40">
                <div className="absolute right-0 top-0 h-16 w-16 rounded-bl-[40px] bg-[#3ECF6E]/[0.05] transition-all group-hover:bg-[#3ECF6E]/[0.1]" />
                <div className="font-display text-[34px] font-bold leading-none text-fog-100">
                  {s.v}
                  <span className="ml-1 text-[14px] font-semibold text-[#3ECF6E]">{s.u}</span>
                </div>
                <div className="mt-2.5 font-display text-[13.5px] font-bold text-fog-300">{s.t}</div>
                <p className="mt-1 text-[11.5px] leading-relaxed text-fog-600">{s.d}</p>
              </div>
            ))}
          </div>
        </Reveal>

        {/* 不做清单 */}
        <Reveal delay={140}>
          <div className="h-full rounded-[12px] border border-ink-700 bg-ink-900/70 p-6">
            <div className="flex items-center gap-2">
              <span className="font-mono text-[10.5px] font-semibold tracking-[0.22em] text-[#FF7B70]">OUT OF SCOPE · 明确不做</span>
              <span className="h-px flex-1 bg-ink-700" />
            </div>
            <ul className="mt-5 space-y-3.5">
              {OUT_OF_SCOPE.map((o) => {
                const [main, sub] = o.split(" —— ");
                return (
                  <li key={o} className="flex items-start gap-3">
                    <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-[#F0564A]/40 bg-[#F0564A]/10">
                      <IconX size={10} className="text-[#FF7B70]" />
                    </span>
                    <span className="text-[13px] leading-relaxed text-fog-300">
                      {main}
                      {sub && <span className="text-fog-600"> —— {sub}</span>}
                    </span>
                  </li>
                );
              })}
            </ul>
            <p className="mt-6 border-t border-ink-700 pt-4 font-mono text-[10.5px] leading-relaxed text-fog-600">
              // 设计原则：守护器只做「拉起、看着、收掉」三件事，<br />其余复杂度留给操作系统与专职工具。
            </p>
          </div>
        </Reveal>
      </div>

      {/* 技术栈 */}
      <Reveal delay={100} className="mt-10">
        <div className="flex items-center gap-2">
          <span className="font-mono text-[10.5px] font-semibold tracking-[0.22em] text-fog-600">STACK · 技术栈</span>
          <span className="h-px flex-1 bg-ink-700" />
        </div>
        <div className="mt-4 flex flex-wrap gap-2.5">
          {STACK.map((s) => (
            <span key={s.name} className="group flex items-center gap-2 rounded-[8px] border border-ink-600 bg-ink-850 px-3.5 py-2 transition-all hover:-translate-y-0.5 hover:border-[#FF9557]/60">
              <span className="font-mono text-[12px] font-bold text-[#FF9557]">{s.name}</span>
              <span className="text-[11px] text-fog-500 group-hover:text-fog-300">{s.role}</span>
            </span>
          ))}
        </div>
      </Reveal>
    </section>
  );
}
