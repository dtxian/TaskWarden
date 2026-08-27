import { useMemo, useState } from "react";
import type { SimTask, Simulator } from "../../sim/useSimulator";
import { fmtDur } from "../../sim/useSimulator";
import {
  IconCpu, IconFile, IconGpu, IconMoon, IconPlay, IconPlus, IconRam, IconRestore,
  IconShield, IconStop, IconSun, IconTemp, IconTrayMenu, IconWindowOff, IconX, IconBolt,
} from "../ui";
import LogPanel from "./LogPanel";
import TaskCard from "./TaskCard";
import TaskModal, { ConfirmDialog } from "./TaskModal";

/* ------------------------------------------------------------------ */
/* egui 主窗口原型：状态栏 + 任务网格 + 日志面板 + 全局栏 + 托盘生命周期    */
/* ------------------------------------------------------------------ */

type View = "window" | "tray" | "exited";
type Modal = { mode: "add" } | { mode: "edit"; task: SimTask } | null;

const ORDER: Record<string, number> = { running: 0, starting: 1, backoff: 2, fused: 3, stopped: 4 };

export default function SimulatorWindow({ sim }: { sim: Simulator }) {
  const [theme, setTheme] = useState<"dark" | "light">("dark");
  const [view, setView] = useState<View>("window");
  const [modal, setModal] = useState<Modal>(null);
  const [confirmDel, setConfirmDel] = useState<SimTask | null>(null);
  const [trayMenu, setTrayMenu] = useState(false);
  const [nudge, setNudge] = useState(0); // 单实例拦截闪光

  const sorted = useMemo(
    () => [...sim.tasks].sort((a, b) => ORDER[a.state] - ORDER[b.state] || a.name.localeCompare(b.name)),
    [sim.tasks],
  );

  const depNameOf = (t: SimTask) => t.deps.map((d) => sim.tasks.find((x) => x.id === d)?.name ?? d);
  const gpuTempColor = sim.metrics.gpuTemp < 62 ? "#3ECF6E" : sim.metrics.gpuTemp < 76 ? "#F5B84B" : "#FF7B70";
  const uptime = fmtDur(sim.now - sim.appStart);
  const selLines = sim.selectedId ? sim.logs[sim.selectedId] ?? [] : [];

  const exitApp = () => {
    sim.stopAll();
    setTrayMenu(false);
    setView("exited");
  };

  const chipBtn =
    "flex items-center justify-center rounded-[5px] p-[3px] text-[var(--eg-muted)] transition-colors hover:bg-[var(--eg-inset)] hover:text-[var(--eg-text)]";

  return (
    <div className="relative">
      {view === "window" ? (
        /* ============ 主窗口 ============ */
        <div
          className={`egui ${theme === "light" ? "eg-light" : ""} relative overflow-hidden rounded-xl border border-[var(--eg-line)] bg-[var(--eg-bg)] shadow-[0_40px_120px_-30px_rgba(0,0,0,0.85)]${nudge ? " instance-flash" : ""}`}
          onAnimationEnd={(e) => {
            if (e.animationName === "instance-flash") setNudge(0);
          }}
        >
          {/* 标题栏 */}
          <div className="flex items-center gap-2 border-b border-[var(--eg-line)] bg-[var(--eg-inset)] px-3 py-2">
            <IconShield size={16} className="text-[#FF7A29]" />
            <span className="font-display text-[12.5px] font-bold tracking-wide text-[var(--eg-text)]">
              TaskWarden <span className="font-mono text-[10px] font-normal text-[var(--eg-muted)]">— 轻量级任务守护监督器 v0.1.0</span>
            </span>
            <span className="ml-2 hidden items-center gap-1 rounded-[4px] border border-[rgba(62,207,110,0.4)] bg-[rgba(62,207,110,0.08)] px-1.5 py-px font-mono text-[9.5px] text-[#3ECF6E] md:flex">
              <span className="h-1 w-1 rounded-full bg-[#3ECF6E] pulse-dot" /> 单实例 · Global\TaskWarden
            </span>
            <span className="ml-auto flex items-center gap-1">
              <button
                className="mr-1 hidden items-center gap-1 rounded-[5px] border border-[var(--eg-line)] px-2 py-[3px] font-mono text-[9.5px] text-[var(--eg-muted)] transition-colors hover:border-[#7AD4E8] hover:text-[#7AD4E8] md:flex"
                title="模拟再次运行 TaskWarden.exe：单实例互斥体将拦截新进程并激活已有窗口"
                onClick={() => {
                  sim.notify(
                    "info",
                    '单实例拦截：CreateMutexW("Global\\TaskWarden") 返回 ERROR_ALREADY_EXISTS —— 新进程已退出，仅激活已有窗口',
                  );
                  setNudge(Date.now());
                }}
              >
                试双开
              </button>
              <button
                className={`${chipBtn} ${sim.faultInject ? "!bg-[rgba(245,184,75,0.16)] !text-[#F5B84B]" : ""}`}
                style={sim.faultInject ? { boxShadow: "0 0 14px -2px rgba(245,184,75,0.55)" } : undefined}
                title="故障注入（一次性）：下一次启动将在 spawn 处失败，演示启动失败反馈：托盘通知 + 卡片红框 + 错误详情"
                onClick={() => sim.setFaultInject(!sim.faultInject)}
              >
                <IconBolt size={13} />
              </button>
              <button className={chipBtn} title="切换深/浅主题" onClick={() => setTheme(theme === "dark" ? "light" : "dark")}>
                {theme === "dark" ? <IconSun size={13} /> : <IconMoon size={13} />}
              </button>
              <button className={chipBtn} title="最小化"><span className="px-1 font-mono text-[12px]">—</span></button>
              <button className={chipBtn} title="最大化"><span className="block h-[9px] w-[9px] rounded-[2px] border border-current" /></button>
              <button className={`${chipBtn} hover:!bg-[#F0564A] hover:!text-white`} title="最小化到系统托盘（并不退出）" onClick={() => setView("tray")}>
                <IconX size={13} />
              </button>
            </span>
          </div>

          {/* 顶部资源状态栏 */}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-[var(--eg-line)] bg-[var(--eg-panel)] px-4 py-2.5">
            <Metric icon={<IconCpu size={13} />} label="CPU" value={`${sim.metrics.cpu.toFixed(0)}%`} color="#FF9557">
              <Spark data={sim.metrics.cpuHist} color="#FF9557" />
            </Metric>
            <Metric icon={<IconRam size={13} />} label="内存" value={`${sim.metrics.mem.toFixed(0)}%`} color="#7AD4E8">
              <div className="h-[6px] w-14 overflow-hidden rounded-full bg-[var(--eg-inset)]">
                <div className="h-full rounded-full bg-[#53C1DE] transition-all duration-500" style={{ width: `${sim.metrics.mem}%` }} />
              </div>
            </Metric>
            <Metric icon={<IconGpu size={13} />} label="GPU" value={`${sim.metrics.gpu.toFixed(0)}%`} color="#5BE392">
              <Spark data={sim.metrics.gpuHist} color="#3ECF6E" />
            </Metric>
            <Metric icon={<IconGpu size={13} />} label="显存" value={`${sim.metrics.vram.toFixed(1)}/14G`} color="#FFC86B" />
            <Metric icon={<IconTemp size={13} />} label="GPU°C" value={`${sim.metrics.gpuTemp}°`} color={gpuTempColor} />
            <Metric icon={<IconTemp size={13} />} label="CPU°C" value="N/A" color="var(--eg-muted)" title="温度接口已预留，当前返回 N/A" />
            <div className="hidden h-6 w-px bg-[var(--eg-line)] sm:block" />
            <div className="font-mono text-[10.5px] text-[var(--eg-muted)]">
              运行 <span className="text-[var(--eg-text)]">{uptime}</span>
            </div>
            <div className="font-mono text-[10.5px] text-[var(--eg-muted)]">
              任务 <span className="text-[#3ECF6E]">{sim.runningCount}</span>/{sim.tasks.length}
            </div>
            <span className="ml-auto flex items-center gap-2">
              <button
                onClick={sim.startAll}
                className="flex items-center gap-1.5 rounded-[6px] bg-[#FF7A29] px-3 py-1.5 text-[11.5px] font-bold text-[#1a0d04] transition-all hover:bg-[#FF9557] active:scale-[0.96]"
              >
                <IconPlay size={11} /> 启动全部
              </button>
              <button
                onClick={sim.stopAll}
                className="flex items-center gap-1.5 rounded-[6px] border border-[rgba(240,86,74,0.5)] px-3 py-1.5 text-[11.5px] font-bold text-[#FF7B70] transition-all hover:bg-[rgba(240,86,74,0.12)] active:scale-[0.96]"
              >
                <IconStop size={11} /> 停止全部
              </button>
            </span>
          </div>

          {/* 任务网格 */}
          <div className="grid grid-cols-1 gap-3 p-4 md:grid-cols-2 xl:grid-cols-3">
            {sorted.map((t) => (
              <TaskCard
                key={t.id}
                task={t}
                now={sim.now}
                selected={t.id === sim.selectedId}
                depNames={depNameOf(t)}
                onSelect={() => sim.setSelectedId(t.id)}
                onStart={() => sim.startTask(t.id, { manual: true })}
                onStop={() => sim.stopTask(t.id)}
                onRestart={() => sim.restartTask(t.id)}
                onEdit={() => setModal({ mode: "edit", task: t })}
                onDelete={() => setConfirmDel(t)}
                onCrash={() => sim.crashTask(t.id, true)}
                onReset={() => sim.resetBreaker(t.id)}
              />
            ))}
            <button
              onClick={() => setModal({ mode: "add" })}
              className="flex min-h-[150px] flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-[var(--eg-line)] text-[var(--eg-muted)] transition-all hover:border-[#FF7A29] hover:bg-[rgba(255,122,41,0.05)] hover:text-[#FF9557]"
            >
              <IconPlus size={22} strokeWidth={1.6} />
              <span className="text-[12.5px] font-semibold">添加任务</span>
              <span className="font-mono text-[10px] opacity-70">.exe · .bat · .cmd · .ps1</span>
            </button>
          </div>

          {/* 日志面板 */}
          <LogPanel
            task={sim.selectedTask}
            lines={selLines}
            autoScroll={sim.autoScroll}
            onToggleAutoScroll={() => sim.setAutoScroll(!sim.autoScroll)}
            onClear={() => sim.selectedId && sim.clearLogs(sim.selectedId)}
          />

          {/* 全局状态栏 */}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-[var(--eg-line)] bg-[var(--eg-inset)] px-4 py-1.5 font-mono text-[10px] text-[var(--eg-muted)]">
            <span className="flex items-center gap-1.5">
              <IconFile size={11} className="text-[#FF9557]" />
              %APPDATA%\TaskWarden\config.toml
            </span>
            <span>派生 {sim.stats.spawned} · 重启 {sim.stats.restarts}</span>
            <span className={`hidden truncate sm:block ${sim.stats.lastError ? "text-[#FF7B70]" : ""}`}>
              {sim.stats.lastError ? `上次错误：${sim.stats.lastError}` : "✓ 无异常"}
            </span>
            <span className="ml-auto opacity-70">egui 0.3x · eframe · Job Object · Ring Buffer</span>
          </div>

          {/* 托盘气泡通知 */}
          <div className="pointer-events-none absolute right-3 top-11 z-30 flex w-[300px] flex-col gap-2">
            {sim.toasts.map((t) => (
              <div
                key={t.id}
                className="toast-in pointer-events-auto flex items-start gap-2 rounded-[8px] border border-[var(--eg-line)] bg-[var(--eg-panel)] px-3 py-2 shadow-[0_12px_36px_-10px_rgba(0,0,0,0.6)]"
                style={{ borderLeft: `3px solid ${t.kind === "err" ? "#F0564A" : t.kind === "warn" ? "#F5B84B" : t.kind === "ok" ? "#3ECF6E" : "#53C1DE"}` }}
              >
                <span className="mt-[3px] h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: t.kind === "err" ? "#F0564A" : t.kind === "warn" ? "#F5B84B" : t.kind === "ok" ? "#3ECF6E" : "#53C1DE" }} />
                <p className="text-[11px] leading-snug text-[var(--eg-text)]">{t.text}</p>
              </div>
            ))}
          </div>

          {/* 弹窗 */}
          {modal && (
            <TaskModal
              initial={modal.mode === "edit" ? modal.task : null}
              allTasks={sim.tasks}
              onClose={() => setModal(null)}
              onSubmit={(d) => (modal.mode === "edit" ? (sim.updateTask(modal.task.id, d), true) : sim.addTask(d))}
            />
          )}
          {confirmDel && (
            <ConfirmDialog
              title={`删除任务 "${confirmDel.name}"？`}
              desc="将终止其进程树、移除 config.toml 中的配置段并删除 logs 目录下对应日志文件。此操作不可撤销。"
              confirmText="确认删除"
              onCancel={() => setConfirmDel(null)}
              onConfirm={() => {
                sim.deleteTask(confirmDel.id);
                setConfirmDel(null);
              }}
            />
          )}
        </div>
      ) : (
        /* ============ 最小化 / 已退出 占位 ============ */
        <div className="egui flex flex-col items-center justify-center gap-4 rounded-xl border-2 border-dashed border-[var(--eg-line)] bg-[var(--eg-bg)]/60 px-6 py-16 text-center">
          {view === "tray" ? (
            <>
              <IconWindowOff size={40} className="float-slow text-[#FF9557]" />
              <div className="font-display text-[16px] font-bold text-[var(--eg-text)]">主窗口已隐藏 · TaskWarden 驻留系统托盘</div>
              <p className="max-w-[460px] text-[12.5px] leading-relaxed text-[var(--eg-muted)]">
                守护未中断：{sim.runningCount} 个任务仍在后台运行，健康探针与熔断机制持续工作。
                点击右下角托盘图标恢复窗口，右键可呼出菜单。
              </p>
              <button
                onClick={() => setView("window")}
                className="flex items-center gap-2 rounded-[7px] bg-[#FF7A29] px-5 py-2 text-[13px] font-bold text-[#1a0d04] transition-all hover:bg-[#FF9557] active:scale-[0.97]"
              >
                <IconRestore size={14} /> 恢复主窗口
              </button>
            </>
          ) : (
            <>
              <IconShield size={40} className="text-[#3ECF6E]" />
              <div className="font-display text-[16px] font-bold text-[var(--eg-text)]">TaskWarden 已安全退出</div>
              <p className="max-w-[480px] font-mono text-[11.5px] leading-relaxed text-[var(--eg-muted)]">
                全部子进程已随 Job Object 级联终止 · config.toml 已原子落盘 · 日志文件已关闭
              </p>
              <button
                onClick={() => setView("window")}
                className="flex items-center gap-2 rounded-[7px] bg-[#3ECF6E] px-5 py-2 text-[13px] font-bold text-[#062b14] transition-all hover:brightness-110 active:scale-[0.97]"
              >
                <IconPlay size={12} /> 重新启动 TaskWarden
              </button>
            </>
          )}
        </div>
      )}

      {/* ============ 系统托盘图标（固定悬浮） ============ */}
      {view !== "window" && (
        <div className="chip-in fixed bottom-6 right-6 z-50">
          {trayMenu && view === "tray" && (
            <div className="absolute bottom-full right-0 mb-2 w-44 overflow-hidden rounded-[8px] border border-ink-600 bg-ink-800 shadow-[0_18px_50px_-12px_rgba(0,0,0,0.8)]">
              <button onClick={() => { setView("window"); setTrayMenu(false); }} className="flex w-full items-center gap-2 px-3 py-2 text-left text-[11.5px] text-fog-300 transition-colors hover:bg-ink-700 hover:text-fog-100">
                <IconRestore size={13} /> 显示主窗口
              </button>
              <div className="h-px bg-ink-600" />
              <button onClick={exitApp} className="flex w-full items-center gap-2 px-3 py-2 text-left text-[11.5px] text-[#FF7B70] transition-colors hover:bg-[rgba(240,86,74,0.12)]">
                <IconStop size={12} /> 退出程序
              </button>
            </div>
          )}
          <button
            onClick={() => { setView("window"); setTrayMenu(false); }}
            onContextMenu={(e) => { e.preventDefault(); if (view === "tray") setTrayMenu((v) => !v); }}
            title="左键：显示/恢复主窗口 · 右键：菜单"
            className="group flex items-center gap-2.5 rounded-full border border-[rgba(255,122,41,0.5)] bg-ink-800/95 py-2 pl-2.5 pr-4 shadow-[0_16px_44px_-10px_rgba(0,0,0,0.75)] backdrop-blur transition-all hover:border-[#FF9557] hover:shadow-[0_16px_50px_-8px_rgba(255,122,41,0.35)]"
          >
            <span className="relative flex h-7 w-7 items-center justify-center rounded-full bg-[rgba(255,122,41,0.15)]">
              <IconShield size={15} className="text-[#FF9557]" />
              {view === "tray" && <span className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-[#3ECF6E] pulse-dot" />}
            </span>
            <span className="text-left leading-tight">
              <span className="block text-[11.5px] font-bold text-fog-100">
                {view === "tray" ? "TaskWarden · 托盘守护中" : "TaskWarden · 已退出"}
              </span>
              <span className="block font-mono text-[9.5px] text-fog-500">
                {view === "tray" ? `左键恢复 · 右键菜单 · ${sim.runningCount} 运行中` : "点击重新演示"}
              </span>
            </span>
            <IconTrayMenu size={14} className="text-fog-600 transition-colors group-hover:text-fog-300" />
          </button>
        </div>
      )}
    </div>
  );
}

/* ---------------- 状态栏小指标 ---------------- */

function Metric({ icon, label, value, color, title, children }: {
  icon: React.ReactNode;
  label: string;
  value: string;
  color: string;
  title?: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-2" title={title}>
      <span style={{ color }}>{icon}</span>
      <div className="leading-tight">
        <div className="text-[9px] font-semibold tracking-wider text-[var(--eg-muted)]">{label}</div>
        <div className="font-mono text-[12px] font-bold" style={{ color }}>{value}</div>
      </div>
      {children}
    </div>
  );
}

import { Sparkline } from "../ui";
function Spark({ data, color }: { data: number[]; color: string }) {
  return <Sparkline data={data} color={color} w={58} h={22} />;
}
