import React, { useEffect, useId, useRef, useState } from "react";

/* ------------------------------------------------------------------ */
/* 通用 UI 基件：图标 / 标题解码 / 滚动显现 / 代码高亮 / 趋势线            */
/* ------------------------------------------------------------------ */

type IconProps = { size?: number; className?: string; strokeWidth?: number };

const base = (p: IconProps) => ({
  width: p.size ?? 16,
  height: p.size ?? 16,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: p.strokeWidth ?? 1.8,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  className: p.className,
});

export const IconPlay = (p: IconProps) => (
  <svg {...base(p)}><path d="M7 4.8v14.4L19 12 7 4.8z" fill="currentColor" stroke="none" /></svg>
);
export const IconStop = (p: IconProps) => (
  <svg {...base(p)}><rect x="6.5" y="6.5" width="11" height="11" rx="1.5" fill="currentColor" stroke="none" /></svg>
);
export const IconRestart = (p: IconProps) => (
  <svg {...base(p)}><path d="M20 12a8 8 0 1 1-2.3-5.6" /><path d="M20 3v5h-5" /></svg>
);
export const IconEdit = (p: IconProps) => (
  <svg {...base(p)}><path d="M4 20h4L20 8a2.4 2.4 0 0 0-4-4L4 16v4z" /><path d="M13.5 6.5l4 4" /></svg>
);
export const IconX = (p: IconProps) => (
  <svg {...base(p)}><path d="M6 6l12 12M18 6L6 18" /></svg>
);
export const IconPlus = (p: IconProps) => (
  <svg {...base(p)}><path d="M12 5v14M5 12h14" /></svg>
);
export const IconBolt = (p: IconProps) => (
  <svg {...base(p)}><path d="M13 2 4.5 13.5H11L10 22l8.5-11.5H13L13 2z" /></svg>
);
export const IconCheck = (p: IconProps) => (
  <svg {...base(p)}><path d="M4.5 12.5 10 18 19.5 7" /></svg>
);
export const IconCopy = (p: IconProps) => (
  <svg {...base(p)}><rect x="9" y="9" width="11" height="11" rx="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" transform="translate(2 2)" /></svg>
);
export const IconSun = (p: IconProps) => (
  <svg {...base(p)}><circle cx="12" cy="12" r="4.2" /><path d="M12 2.5v2.4M12 19.1v2.4M2.5 12h2.4M19.1 12h2.4M5 5l1.7 1.7M17.3 17.3 19 19M19 5l-1.7 1.7M6.7 17.3 5 19" /></svg>
);
export const IconMoon = (p: IconProps) => (
  <svg {...base(p)}><path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5z" /></svg>
);
export const IconClock = (p: IconProps) => (
  <svg {...base(p)}><circle cx="12" cy="12" r="8.5" /><path d="M12 7v5.2l3.4 2" /></svg>
);
export const IconCpu = (p: IconProps) => (
  <svg {...base(p)}><rect x="6" y="6" width="12" height="12" rx="2" /><rect x="9.5" y="9.5" width="5" height="5" /><path d="M9 2.5V6M15 2.5V6M9 18v3.5M15 18v3.5M2.5 9H6M2.5 15H6M18 9h3.5M18 15h3.5" /></svg>
);
export const IconRam = (p: IconProps) => (
  <svg {...base(p)}><rect x="2.5" y="7" width="19" height="9" rx="1.5" /><path d="M6 16v3M10 16v3M14 16v3M18 16v3M6 10v3M10 10v3M14 10v3M18 10v3" /></svg>
);
export const IconGpu = (p: IconProps) => (
  <svg {...base(p)}><rect x="2.5" y="6" width="19" height="11" rx="1.5" /><circle cx="9" cy="11.5" r="3" /><path d="M15.5 9h3.5M15.5 12h3.5M6 17v2.5M12 17v2.5" /></svg>
);
export const IconTemp = (p: IconProps) => (
  <svg {...base(p)}><path d="M10 4a2 2 0 0 1 4 0v9.2a4.5 4.5 0 1 1-4 0V4z" /><path d="M12 9v6" /><circle cx="12" cy="17.3" r="1.4" fill="currentColor" stroke="none" /></svg>
);
export const IconShield = (p: IconProps) => (
  /* 品牌图标：与 exe 图标同一设计（深底渐变 + 渐变守护盾 + 心跳脉冲） */
  <svg viewBox="0 0 24 24" width={p.size ?? 24} height={p.size ?? 24} className={p.className} role="img" aria-label="TaskWarden">
    <defs>
      <linearGradient id="twIcoBg" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stopColor="#1C222C" />
        <stop offset="1" stopColor="#06080B" />
      </linearGradient>
      <linearGradient id="twIcoSh" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor="#FFC191" />
        <stop offset="0.5" stopColor="#FF8A3D" />
        <stop offset="1" stopColor="#EF5C0A" />
      </linearGradient>
      <linearGradient id="twIcoPl" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0" stopColor="#FF9557" />
        <stop offset="1" stopColor="#FFD9B8" />
      </linearGradient>
    </defs>
    <rect x="0.5" y="0.5" width="23" height="23" rx="5.2" fill="url(#twIcoBg)" stroke="#FF7A29" strokeOpacity="0.28" strokeWidth="0.8" />
    <path
      d="M12 3.6 L18.3 6 V12.1 C18.3 16.6 15.6 19.7 12 21.2 C8.4 19.7 5.7 16.6 5.7 12.1 V6 Z"
      fill="rgba(255,122,41,0.10)"
      stroke="url(#twIcoSh)"
      strokeWidth="1.5"
      strokeLinejoin="round"
    />
    <path d="M8.2 12 H10.4 L11.5 9.5 L13.2 14 L14.4 11.9 H15.9" fill="none" stroke="url(#twIcoPl)" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);
export const IconFolder = (p: IconProps) => (
  <svg {...base(p)}><path d="M3 7a2 2 0 0 1 2-2h4l2 2.5h8a2 2 0 0 1 2 2V18a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z" /></svg>
);
export const IconTerminal = (p: IconProps) => (
  <svg {...base(p)}><rect x="2.5" y="4.5" width="19" height="15" rx="2" /><path d="M6.5 9.5 10 12l-3.5 2.5M12.5 15h5" /></svg>
);
export const IconFile = (p: IconProps) => (
  <svg {...base(p)}><path d="M6 2.8h8L19 8v12a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 5 20V4.3A1.5 1.5 0 0 1 6.5 2.8z" /><path d="M13.5 3v5h5M8.5 13h7M8.5 16.5h5" /></svg>
);
export const IconBell = (p: IconProps) => (
  <svg {...base(p)}><path d="M6 16v-5.5a6 6 0 1 1 12 0V16l1.8 2.5H4.2L6 16z" /><path d="M10 21a2.2 2.2 0 0 0 4 0" /></svg>
);
export const IconLink = (p: IconProps) => (
  <svg {...base(p)}><path d="M9.5 14.5 14.5 9.5" /><path d="M11 6.5 12.8 4.7a4 4 0 0 1 5.7 5.7L16.6 12.2" /><path d="M13 17.5l-1.8 1.8a4 4 0 0 1-5.7-5.7l1.9-1.8" /></svg>
);
export const IconFuse = (p: IconProps) => (
  <svg {...base(p)}><path d="M3 12h4M17 12h4" /><rect x="7" y="8.5" width="10" height="7" rx="2" /><path d="M9.5 12h1.5l1-2 1.5 4 1-2h.5" /></svg>
);
export const IconCursor = (p: IconProps) => (
  <svg {...base(p)}><path d="M5 3.5 19 10l-6 2-2.5 6L5 3.5z" /><path d="M13.5 13.5 19 19" /></svg>
);
export const IconGhost = (p: IconProps) => (
  <svg {...base(p)}><path d="M5 20V10a7 7 0 0 1 14 0v10l-2.3-2-2.4 2-2.3-2-2.3 2-2.4-2L5 20z" /><circle cx="9.5" cy="10" r="1" fill="currentColor" stroke="none" /><circle cx="14.5" cy="10" r="1" fill="currentColor" stroke="none" /></svg>
);
export const IconStack = (p: IconProps) => (
  <svg {...base(p)}><path d="m12 3 8.5 4.5L12 12 3.5 7.5 12 3z" /><path d="m4.5 12.5 7.5 4 7.5-4M4.5 16.5l7.5 4 7.5-4" /></svg>
);
export const IconFeather = (p: IconProps) => (
  <svg {...base(p)}><path d="M20 4c-6.5 0-12 4-13.5 10.5L4 20" /><path d="M20 4c0 6.5-4 12-10.5 13.5" /><path d="M8.5 15.5H15M11 11h6" /></svg>
);
export const IconLock = (p: IconProps) => (
  <svg {...base(p)}><rect x="5" y="10.5" width="14" height="10" rx="2" /><path d="M8 10.5V8a4 4 0 0 1 8 0v2.5" /><circle cx="12" cy="15.5" r="1.3" fill="currentColor" stroke="none" /></svg>
);
export const IconAlert = (p: IconProps) => (
  <svg {...base(p)}><rect x="3.5" y="3.5" width="17" height="17" rx="2.5" /><path d="M12 7.5v5.5" /><circle cx="12" cy="16.5" r="1.1" fill="currentColor" stroke="none" /></svg>
);
export const IconEye = (p: IconProps) => (
  <svg {...base(p)}><path d="M2.5 12S6 5.8 12 5.8 21.5 12 21.5 12 18 18.2 12 18.2 2.5 12 2.5 12z" /><circle cx="12" cy="12" r="2.8" /></svg>
);
export const IconTimer = (p: IconProps) => (
  <svg {...base(p)}><circle cx="12" cy="13.5" r="7.5" /><path d="M12 10v3.8l2.6 1.6M9.5 2.5h5M12 2.5V6" /></svg>
);
export const IconMinimize = (p: IconProps) => (
  <svg {...base(p)}><rect x="3" y="4.5" width="18" height="13" rx="2" /><path d="M7 21l3-3.5M17 21l-3-3.5" /></svg>
);
export const IconRestore = (p: IconProps) => (
  <svg {...base(p)}><rect x="4" y="7" width="14" height="11" rx="2" /><path d="M8 7V5.5A1.5 1.5 0 0 1 9.5 4H19a1.5 1.5 0 0 1 1.5 1.5V15A1.5 1.5 0 0 1 19 16.5h-1.5" /><path d="M11 12.5h.01" /></svg>
);
export const IconTrayMenu = (p: IconProps) => (
  <svg {...base(p)}><rect x="3" y="5" width="18" height="14" rx="2" /><path d="M7 19V12h10v7" /><path d="M10 15h4" /></svg>
);
export const IconArrow = (p: IconProps) => (
  <svg {...base(p)}><path d="M4 12h15M13.5 5.5 20 12l-6.5 6.5" /></svg>
);
export const IconWindowOff = (p: IconProps) => (
  <svg {...base(p)}><rect x="3" y="4.5" width="18" height="15" rx="2" /><path d="M3 8.5h18M6.2 6.7h.01M8.6 6.7h.01" /><path d="m9.5 12 5 5M14.5 12l-5 5" /></svg>
);

/* ---------------- 乱码解码标题 ---------------- */

const POOL = "01<>/\\{}[]=+*#%&$@abcdef";

export function Scramble({ text, className = "", delay = 0 }: { text: string; className?: string; delay?: number }) {
  const [out, setOut] = useState(text);
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setOut(text);
      return;
    }
    let frame = 0;
    let raf = 0;
    const tick = () => {
      frame += 1;
      const reveal = Math.floor(frame / 2.4);
      if (reveal >= text.length) {
        setOut(text);
        return;
      }
      let s = "";
      for (let i = 0; i < text.length; i += 1) {
        const ch = text[i];
        if (ch === " ") { s += ch; continue; }
        s += i < reveal ? ch : POOL[Math.floor(Math.random() * POOL.length)];
      }
      setOut(s);
      raf = requestAnimationFrame(tick);
    };
    const to = window.setTimeout(() => { raf = requestAnimationFrame(tick); }, delay);
    return () => { window.clearTimeout(to); cancelAnimationFrame(raf); };
  }, [text, delay]);
  return <span className={className}>{out}</span>;
}

/* ---------------- 滚动显现 ---------------- */

export function Reveal({ children, className = "", delay = 0 }: { children: React.ReactNode; className?: string; delay?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) {
          el.classList.add("is-in");
          io.disconnect();
        }
      },
      { threshold: 0.1, rootMargin: "0px 0px -40px 0px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return (
    <div ref={ref} className={`reveal ${className}`} style={{ transitionDelay: `${delay}ms` }}>
      {children}
    </div>
  );
}

/* ---------------- 代码高亮 ---------------- */

const RUST_RULES: [string, string][] = [
  ["\\/\\/[^\\n]*", "tok-com"],
  ["\"(?:[^\"\\\\\\n]|\\\\.)*\"", "tok-str"],
  ["\\b(fn|let|mut|pub|struct|enum|impl|use|crate|match|if|else|loop|while|for|in|return|move|unsafe|const|static|trait|where|self|Self|async|await|dyn|ref|mod|type|as|break|continue|extern)\\b", "tok-kw"],
  ["\\b(Some|None|Ok|Err|String|str|u8|u32|u64|i32|i64|usize|f32|f64|bool|Vec|VecDeque|Option|Result|Duration|Instant|Command|Child|PathBuf|Arc|Mutex|HashMap|Box|HANDLE|Self)\\b", "tok-ty"],
  ["\\b\\d[\\d_]*(?:\\.\\d+)?\\b", "tok-num"],
  ["[A-Za-z_][A-Za-z0-9_]*!", "tok-mac"],
];

const TOML_RULES: [string, string][] = [
  ["#[^\\n]*", "tok-com"],
  ["\"(?:[^\"\\\\\\n]|\\\\.)*\"", "tok-str"],
  ["\\[[^\\]\\n]+\\]", "tok-sec"],
  ["[\\w.-]+(?=\\s*=)", "tok-key"],
  ["\\b\\d[\\d_]*(?:\\.\\d+)?\\b", "tok-num"],
];

function tokenizeLine(line: string, rules: [string, string][]): React.ReactNode[] {
  const re = new RegExp(rules.map((r) => `(${r[0]})`).join("|"), "g");
  const out: React.ReactNode[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  let k = 0;
  while ((m = re.exec(line)) !== null) {
    if (m.index > last) out.push(line.slice(last, m.index));
    const gi = m.slice(1).findIndex((g) => g !== undefined);
    out.push(
      <span key={k++} className={rules[gi][1]}>
        {m[0]}
      </span>,
    );
    last = m.index + m[0].length;
  }
  if (last < line.length) out.push(line.slice(last));
  return out;
}

export function CodeBlock({ code, lang, className = "" }: { code: string; lang: "rust" | "toml"; className?: string }) {
  const rules = lang === "rust" ? RUST_RULES : TOML_RULES;
  const lines = code.split("\n");
  return (
    <pre className={`font-mono text-[12.5px] leading-[1.75] overflow-x-auto ${className}`}>
      {lines.map((ln, i) => (
        <div key={i} className="grid grid-cols-[2.6em_1fr] hover:bg-white/[0.04] rounded-sm">
          <span className="select-none text-right pr-3 text-[var(--color-fog-600)] opacity-70">{i + 1}</span>
          <span className="whitespace-pre">{tokenizeLine(ln, rules)}</span>
        </div>
      ))}
    </pre>
  );
}

/* ---------------- 迷你趋势线 ---------------- */

export function Sparkline({ data, color, min = 0, max = 100, w = 96, h = 26 }: { data: number[]; color: string; min?: number; max?: number; w?: number; h?: number }) {
  const gid = useId().replace(/:/g, "");
  if (data.length < 2) return null;
  const pts = data
    .map((v, i) => {
      const x = (i / (data.length - 1)) * w;
      const y = h - 1.5 - ((Math.min(max, Math.max(min, v)) - min) / (max - min)) * (h - 3);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} className="block">
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.35" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <polygon points={`0,${h} ${pts} ${w},${h}`} fill={`url(#${gid})`} />
      <polyline points={pts} fill="none" stroke={color} strokeWidth="1.6" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}
