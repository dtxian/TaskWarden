import React from "react";
import { LAYERS, PROJECT_TREE, PROMISES, WORKFLOW } from "../../data/content";
import { IconArrow, IconCursor, IconFeather, IconGhost, IconStack, Reveal, Scramble } from "../ui";

/* ------------------------------------------------------------------ */
/* 开篇 + 核心承诺 + 工作流 + 分层架构（粘性双栏）                         */
/* ------------------------------------------------------------------ */

export function SectionHead({ no, title, desc }: { no: string; title: string; desc: string }) {
  return (
    <Reveal className="mb-10">
      <div className="flex items-baseline gap-3">
        <span className="font-mono text-[13px] font-bold text-[#FF7A29]">{no}</span>
        <span className="h-px flex-1 bg-gradient-to-r from-[#FF7A29]/50 to-transparent" />
      </div>
      <h2 className="mt-3 font-body text-[26px] font-black leading-tight text-fog-100 md:text-[34px]">{title}</h2>
      <p className="mt-2 max-w-[640px] text-[13.5px] leading-relaxed text-fog-500">{desc}</p>
    </Reveal>
  );
}

const PROMISE_ICONS: Record<string, React.ReactNode> = {
  cursor: <IconCursor size={18} />,
  ghost: <IconGhost size={18} />,
  stack: <IconStack size={18} />,
  feather: <IconFeather size={18} />,
};

/* ---------------- 开篇 ---------------- */

export function IntroBand() {
  return (
    <section className="mx-auto max-w-[1200px] px-5 pb-14 pt-14 md:pt-20">
      <div className="grid gap-10 lg:grid-cols-[1.12fr_0.88fr] lg:gap-14">
        {/* 左：标题 */}
        <div>
          <Reveal>
            <div className="inline-flex items-center gap-2 rounded-[6px] border border-[#FF7A29]/30 bg-[#FF7A29]/[0.07] px-3 py-1.5 font-mono text-[10.5px] font-semibold tracking-[0.18em] text-[#FF9557]">
              <span className="h-1.5 w-1.5 rounded-full bg-[#FF7A29] pulse-dot" />
              RUST · 原生分层架构 · EGUI + EFRAME · WINDOWS 专用
            </div>
          </Reveal>
          <h1 className="mt-6 font-body text-[38px] font-black leading-[1.08] tracking-tight text-fog-100 md:text-[58px]">
            <Scramble text="轻量级后台任务" delay={150} className="block" />
            <span className="block">
              <Scramble text="守护监督器" delay={650} className="text-[#FF7A29]" />
              <span className="blink-caret ml-2 inline-block h-[0.82em] w-[0.45em] translate-y-[0.12em] bg-[#FF7A29]" />
            </span>
          </h1>
          <p className="mt-6 max-w-[540px] text-[14.5px] leading-[1.85] text-fog-300">
            一条极简工作流：<strong className="text-fog-100">点选添加程序 → 填参数 → 静默启动 → 监控状态与日志 → 停止</strong>。
            不记命令、无黑框、统一管理常驻程序 —— 全部配置收敛进一份{" "}
            <code className="rounded bg-ink-700 px-1.5 py-0.5 font-mono text-[12.5px] text-[#FFC86B]">config.toml</code>，
            冷启动 ≤200ms，常驻内存 18–30MB。
          </p>
          <Reveal delay={200} className="mt-8 flex flex-wrap items-center gap-3">
            <a
              href="#sim"
              className="group flex items-center gap-2 rounded-[8px] bg-[#FF7A29] px-5 py-2.5 text-[13.5px] font-bold text-[#1a0d04] transition-all hover:bg-[#FF9557] hover:shadow-[0_10px_36px_-8px_rgba(255,122,41,0.55)] active:scale-[0.97]"
            >
              进入交互原型 <IconArrow size={14} className="transition-transform group-hover:translate-x-1" />
            </a>
            <a
              href="#arch"
              className="rounded-[8px] border border-ink-500 px-5 py-2.5 text-[13.5px] font-semibold text-fog-300 transition-all hover:border-[#FF9557] hover:text-[#FF9557]"
            >
              查看 Rust 分层设计
            </a>
          </Reveal>
        </div>

        {/* 右：核心承诺 */}
        <div className="lg:border-l lg:border-ink-700 lg:pl-10">
          <p className="mb-4 font-mono text-[10.5px] font-semibold tracking-[0.22em] text-fog-600">CORE PROMISES · 核心价值</p>
          <div>
            {PROMISES.map((p, i) => (
              <Reveal key={p.t} delay={i * 110}>
                <div className="group flex gap-4 border-b border-ink-700/70 py-4 transition-colors first:pt-0 last:border-0 hover:bg-white/[0.02]">
                  <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-[8px] border border-[#FF7A29]/25 bg-[#FF7A29]/[0.08] text-[#FF9557] transition-all group-hover:border-[#FF7A29]/60 group-hover:shadow-[0_0_20px_-4px_rgba(255,122,41,0.5)]">
                    {PROMISE_ICONS[p.icon]}
                  </span>
                  <div>
                    <div className="font-display text-[15px] font-bold text-fog-100">{p.t}</div>
                    <p className="mt-1 text-[12.5px] leading-relaxed text-fog-500">{p.d}</p>
                  </div>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </div>

      {/* 工作流五步 */}
      <Reveal delay={120} className="mt-14">
        <div className="flex items-center gap-2">
          <span className="font-mono text-[10.5px] font-semibold tracking-[0.22em] text-fog-600">WORKFLOW · 极简工作流</span>
          <span className="h-px flex-1 bg-ink-700" />
        </div>
        <div className="mt-5 flex gap-3 overflow-x-auto pb-2">
          {WORKFLOW.map((w, i) => (
            <React.Fragment key={w.k}>
              <div className="group min-w-[196px] flex-1 rounded-[10px] border border-ink-700 bg-ink-850/80 p-4 transition-all hover:-translate-y-1 hover:border-[#FF7A29]/50 hover:shadow-[0_16px_40px_-16px_rgba(255,122,41,0.35)]">
                <div className="font-mono text-[11px] font-bold text-[#FF7A29]">{w.k}</div>
                <div className="mt-1.5 font-display text-[15.5px] font-bold text-fog-100">{w.t}</div>
                <p className="mt-1 text-[11.5px] leading-relaxed text-fog-500">{w.d}</p>
              </div>
              {i < WORKFLOW.length - 1 && (
                <span className="hidden shrink-0 self-center text-fog-600 md:block">
                  <IconArrow size={16} />
                </span>
              )}
            </React.Fragment>
          ))}
        </div>
      </Reveal>
    </section>
  );
}

/* ---------------- 分层架构（粘性双栏） ---------------- */

export function ArchitectureSection() {
  return (
    <section id="arch" className="mx-auto max-w-[1200px] scroll-mt-24 px-5 py-20">
      <SectionHead
        no="01 / 分层架构"
        title="四层原生架构 · 命令向下，事件向上"
        desc="GUI 只发命令、不碰进程句柄；运行时只暴露 Child 与进程树抽象；基础设施无业务依赖可独立单测。层间以 std mpsc 通道解耦 —— 零异步运行时，零 WebView。"
      />

      <div className="grid gap-10 lg:grid-cols-[390px_1fr] lg:gap-12">
        {/* 左：粘性层级栈 */}
        <div className="lg:sticky lg:top-24 lg:self-start">
          <Reveal>
            <div className="rounded-[12px] border border-ink-700 bg-ink-850/70 p-5">
              <p className="mb-4 font-mono text-[10px] font-semibold tracking-[0.22em] text-fog-600">LAYER STACK · crate::sentinel</p>
              {LAYERS.map((l, i) => (
                <React.Fragment key={l.no}>
                  <div
                    className="group rounded-[9px] border border-ink-600/80 bg-ink-800 p-3.5 transition-all hover:border-current hover:shadow-[0_10px_30px_-14px_rgba(0,0,0,0.8)]"
                    style={{ color: l.color, borderLeft: `3px solid ${l.color}` }}
                  >
                    <div className="flex items-baseline gap-2">
                      <span className="font-mono text-[12px] font-bold">{l.no}</span>
                      <span className="font-display text-[15px] font-bold text-fog-100">{l.name}</span>
                    </div>
                    <div className="mt-0.5 font-mono text-[10.5px] opacity-80">{l.en}</div>
                    <p className="mt-1.5 text-[11px] leading-relaxed text-fog-500">{l.deps}</p>
                  </div>
                  {i < LAYERS.length - 1 && (
                    <div className="flex justify-center py-1">
                      <svg width="14" height="26" viewBox="0 0 14 26">
                        <line x1="7" y1="0" x2="7" y2="20" stroke="#3B4654" strokeWidth="1.5" className="dash-flow" />
                        <path d="M3 18l4 6 4-6" fill="none" stroke="#FF7A29" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    </div>
                  )}
                </React.Fragment>
              ))}

              {/* 数据流 */}
              <div className="mt-5 rounded-[9px] border border-ink-600 bg-ink-900 p-4 font-mono text-[10.5px] leading-[2]">
                <p className="mb-1 text-[9.5px] font-semibold tracking-[0.2em] text-fog-600">DATA FLOW · std::sync::mpsc</p>
                <p className="text-fog-300">
                  <span className="text-[#FF9557]">GUI</span> ─命令─▶ <span className="text-[#F5B84B]">Supervisor</span> ─spawn/kill─▶ <span className="text-[#7AD4E8]">Runtime</span>
                </p>
                <p className="text-fog-300">
                  <span className="text-[#7AD4E8]">Runtime</span> ─事件─▶ <span className="text-[#F5B84B]">Supervisor</span> ─状态快照─▶ <span className="text-[#FF9557]">GUI</span>
                </p>
                <p className="mt-1 text-fog-600">日志流：子进程 stdout/err → RingLog → 面板 + logs/*.log</p>
              </div>
            </div>
          </Reveal>
        </div>

        {/* 右：模块树 + 各层明细 */}
        <div>
          <Reveal>
            <div className="overflow-hidden rounded-[12px] border border-ink-700 bg-[#0C0F14]">
              <div className="flex items-center gap-2 border-b border-ink-700 bg-ink-850 px-4 py-2.5">
                <span className="h-2.5 w-2.5 rounded-full bg-[#F0564A]/80" />
                <span className="h-2.5 w-2.5 rounded-full bg-[#F5B84B]/80" />
                <span className="h-2.5 w-2.5 rounded-full bg-[#3ECF6E]/80" />
                <span className="ml-2 font-mono text-[11px] text-fog-500">sentinel · 模块树（src/）</span>
              </div>
              <pre className="overflow-x-auto p-4 font-mono text-[11.5px] leading-[1.85] text-fog-300">{PROJECT_TREE}</pre>
            </div>
          </Reveal>

          <div className="mt-8 space-y-8">
            {LAYERS.map((l, li) => (
              <Reveal key={l.no} delay={li * 60}>
                <div className="rounded-[12px] border border-ink-700 bg-ink-850/60 p-5 transition-colors hover:border-ink-500">
                  <div className="flex items-center gap-3">
                    <span className="flex h-8 w-8 items-center justify-center rounded-[7px] font-mono text-[13px] font-bold" style={{ background: `${l.color}1a`, color: l.color }}>
                      {l.no}
                    </span>
                    <div>
                      <div className="font-display text-[16.5px] font-bold text-fog-100">{l.name}</div>
                      <div className="font-mono text-[10.5px] text-fog-600">{l.en}</div>
                    </div>
                  </div>
                  <div className="mt-4 grid gap-2.5">
                    {l.modules.map((m) => (
                      <div key={m.file} className="group grid gap-1 rounded-[8px] border border-ink-700/70 bg-ink-900/70 px-3.5 py-2.5 transition-all hover:border-ink-500 hover:bg-ink-800 md:grid-cols-[150px_1fr] md:gap-4">
                        <code className="font-mono text-[12px] font-semibold" style={{ color: l.color }}>{m.file}</code>
                        <p className="text-[12px] leading-relaxed text-fog-500 group-hover:text-fog-300">{m.desc}</p>
                      </div>
                    ))}
                  </div>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
