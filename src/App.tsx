import { ArchitectureSection, IntroBand } from "./components/sections/DesignSections";
import { CodeSection, PerfSection, TraySection } from "./components/sections/CodeSections";
import SimulatorWindow from "./components/sim/SimulatorWindow";
import { IconShield } from "./components/ui";
import { useSimulator } from "./sim/useSimulator";

/* ------------------------------------------------------------------ */
/* Sentinel · 轻量级后台任务守护监督器 —— 交互原型 + 工程设计文档           */
/* ------------------------------------------------------------------ */

const NAV = [
  { href: "#sim", label: "原型" },
  { href: "#arch", label: "架构" },
  { href: "#code", label: "实现" },
  { href: "#tray", label: "托盘" },
  { href: "#perf", label: "性能" },
];

function Nav() {
  return (
    <header className="sticky top-0 z-40 border-b border-ink-700/70 bg-ink-950/85 backdrop-blur-md">
      <div className="mx-auto flex max-w-[1200px] items-center gap-5 px-5 py-3">
        <a href="#top" className="group flex items-center gap-2.5">
          <span className="flex h-8 w-8 items-center justify-center rounded-[8px] border border-[#FF7A29]/40 bg-[#FF7A29]/10 text-[#FF7A29] transition-all group-hover:shadow-[0_0_22px_-4px_rgba(255,122,41,0.65)]">
            <IconShield size={17} />
          </span>
          <span className="font-display text-[15px] font-bold tracking-wide text-fog-100">
            Sentinel
            <span className="ml-2 hidden font-mono text-[9.5px] font-normal tracking-[0.18em] text-fog-600 sm:inline">TASK GUARDIAN</span>
          </span>
        </a>
        <nav className="ml-auto hidden items-center gap-1 md:flex">
          {NAV.map((n) => (
            <a
              key={n.href}
              href={n.href}
              className="rounded-[6px] px-3 py-1.5 text-[12.5px] font-medium text-fog-500 transition-all hover:bg-ink-800 hover:text-[#FF9557]"
            >
              {n.label}
            </a>
          ))}
        </nav>
        <a
          href="#sim"
          className="ml-auto flex items-center gap-1.5 rounded-[7px] border border-[#FF7A29]/50 bg-[#FF7A29]/10 px-3 py-1.5 font-mono text-[10.5px] font-bold text-[#FF9557] transition-all hover:bg-[#FF7A29]/20 md:ml-3"
        >
          <span className="h-1.5 w-1.5 rounded-full bg-[#3ECF6E] pulse-dot" />
          v0.1.0 · egui/eframe
        </a>
      </div>
    </header>
  );
}

function Footer() {
  return (
    <footer className="relative z-10 border-t border-ink-700/70 bg-ink-900/60">
      <div className="mx-auto grid max-w-[1200px] gap-8 px-5 py-12 md:grid-cols-[1.2fr_0.8fr_1fr]">
        <div>
          <div className="flex items-center gap-2.5">
            <span className="flex h-9 w-9 items-center justify-center rounded-[9px] border border-[#FF7A29]/40 bg-[#FF7A29]/10 text-[#FF7A29]">
              <IconShield size={18} />
            </span>
            <div>
              <div className="font-display text-[16px] font-bold text-fog-100">Sentinel</div>
              <div className="font-mono text-[9.5px] tracking-[0.2em] text-fog-600">LIGHTWEIGHT TASK GUARDIAN</div>
            </div>
          </div>
          <p className="mt-4 max-w-[340px] text-[12.5px] leading-relaxed text-fog-500">
            让常驻程序安安静静地待在该待的地方 —— 拉起、看着、收掉，仅此而已。
          </p>
        </div>
        <div>
          <div className="font-mono text-[10.5px] font-semibold tracking-[0.22em] text-fog-600">目录</div>
          <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2">
            {[...NAV, { href: "#top", label: "回到顶部" }].map((n) => (
              <a key={n.label} href={n.href} className="text-[12.5px] text-fog-500 transition-colors hover:text-[#FF9557]">
                {n.label}
              </a>
            ))}
          </div>
        </div>
        <div>
          <div className="font-mono text-[10.5px] font-semibold tracking-[0.22em] text-fog-600">说明</div>
          <p className="mt-3 text-[11.5px] leading-relaxed text-fog-600">
            本页为 Sentinel 项目的<strong className="text-fog-300">高保真交互原型与工程设计文档</strong>：原型中的进程、PID、资源指标均为本地模拟数据，不启动任何真实进程；架构与代码片段为 Rust 原生分层实现的设计基线。
          </p>
        </div>
      </div>
      <div className="border-t border-ink-800">
        <div className="mx-auto flex max-w-[1200px] flex-wrap items-center gap-x-4 gap-y-2 px-5 py-4 font-mono text-[10.5px] text-fog-600">
          <span>Rust · egui · eframe · tray-icon · windows-rs · nvml-wrapper · serde/toml</span>
          <span className="ml-auto">需求与设计文档 v1.0 · Windows 专用</span>
        </div>
      </div>
    </footer>
  );
}

export default function App() {
  const sim = useSimulator();

  return (
    <div id="top" className="relative min-h-screen overflow-x-clip">
      {/* 环境背景层 */}
      <div className="pointer-events-none fixed inset-0 z-0">
        <div className="absolute inset-0 ambient-glow" />
        <div className="absolute inset-0 ambient-grid" />
        <div className="absolute inset-0 ambient-noise" />
      </div>

      <Nav />

      <main className="relative z-10">
        <IntroBand />

        {/* ============ 交互原型 ============ */}
        <section id="sim" className="mx-auto max-w-[1280px] scroll-mt-24 px-5 pb-24">
          <div className="mb-5 flex flex-wrap items-end gap-x-6 gap-y-2">
            <div>
              <div className="flex items-center gap-2">
                <span className="font-mono text-[13px] font-bold text-[#3ECF6E]">LIVE</span>
                <span className="h-px w-24 bg-gradient-to-r from-[#3ECF6E]/60 to-transparent" />
              </div>
              <h2 className="mt-2 font-body text-[24px] font-black text-fog-100 md:text-[30px]">
                egui 主窗口 · 高保真交互原型
              </h2>
            </div>
            <p className="max-w-[440px] text-[12px] leading-relaxed text-fog-500">
              完整复现需求文档中的界面布局与守护行为：启动 / 停止 / 重启、熔断退避、依赖级联、实时日志与托盘生命周期，全部可在页面内操作。
            </p>
          </div>

          <SimulatorWindow sim={sim} />

          <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2 rounded-[10px] border border-ink-700 bg-ink-850/60 px-4 py-3 font-mono text-[10.5px] text-fog-500">
            <span className="font-bold tracking-widest text-[#FF9557]">操作提示</span>
            <span>▸ 点击卡片选中并查看其日志</span>
            <span>▸ 添加任务：引号参数实时解析预览，路径不存在红字拦截</span>
            <span>▸ 点亮标题栏「故障注入」：下次启动 spawn 失败全链路反馈</span>
            <span>▸ 「试双开」被单实例互斥体拦截并激活已有窗口</span>
            <span>▸ 停止上游任务观察 DAG 级联</span>
            <span>▸ 点窗口 × 收进托盘，右键托盘图标可退出</span>
          </div>
        </section>

        <ArchitectureSection />
        <CodeSection />
        <TraySection />
        <PerfSection />
      </main>

      <Footer />
    </div>
  );
}
