import { useCallback, useEffect, useRef, useState } from "react";

/* ------------------------------------------------------------------ */
/* Sentinel 交互原型 —— 监督器行为模拟引擎                               */
/* ------------------------------------------------------------------ */

export type Kind = "exe" | "bat" | "ps1";
export type Strategy = "always" | "on-failure" | "never";
export type HealthMode = "none" | "tcp" | "http" | "ready";
export type TaskState = "stopped" | "starting" | "running" | "backoff" | "fused";
export type LogLevel = "INFO" | "WARN" | "ERR" | "SYS";

export interface LogLine {
  id: number;
  t: number;
  level: LogLevel;
  msg: string;
}

export interface SimTask {
  id: string;
  name: string;
  kind: Kind;
  path: string;
  args: string;
  cwd: string;
  strategy: Strategy;
  health: HealthMode;
  healthTarget: string;
  gracefulTimeout: number;
  deps: string[];
  state: TaskState;
  pid: number | null;
  startedAt: number | null;
  restarts: number;
  exitCode: number | null;
  lastError: string | null;
  probeMs: number | null;
  crashTimes: number[];
  backoffUntil: number | null;
  backoffAttempt: number;
}

export interface Metrics {
  cpu: number;
  mem: number;
  gpu: number;
  vram: number;
  gpuTemp: number;
  cpuHist: number[];
  gpuHist: number[];
}

export interface Toast {
  id: number;
  kind: "ok" | "err" | "warn" | "info";
  text: string;
}

export interface TaskDraft {
  name: string;
  kind: Kind;
  path: string;
  args: string;
  cwd: string;
  strategy: Strategy;
  health: HealthMode;
  healthTarget: string;
  gracefulTimeout: number;
  deps: string[];
}

export const LOG_CAP = 200;
export const BREAKER_WINDOW = 60_000;
export const BREAKER_MAX = 3;

/* ---------------- 工具函数 ---------------- */

export const fmtClock = (t: number) => {
  const d = new Date(t);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
};

export const fmtDur = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  const p = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}h ${p(m)}m` : `${p(m)}:${p(ss)}`;
};

export const kindFromExt = (path: string): Kind | null => {
  const ext = path.toLowerCase().split(".").pop() ?? "";
  if (ext === "exe") return "exe";
  if (ext === "bat" || ext === "cmd") return "bat";
  if (ext === "ps1") return "ps1";
  return null;
};

/* ---------------- 参数解析（空格 + 引号感知） ---------------- */

export interface ParsedArgs {
  args: string[];
  error: string | null;
}

/**
 * 单一文本框参数解析：按空格切分，支持成对引号包裹的带空格参数，
 * 例如 `--port "80 80"` → ["--port", "80 80"]。引号不闭合 → 报错。
 */
export function parseArgs(input: string): ParsedArgs {
  const args: string[] = [];
  let cur = "";
  let inSingle = false;
  let inDouble = false;
  let hasToken = false;
  for (let i = 0; i < input.length; i++) {
    const c = input[i];
    if (c === "\\" && input[i + 1] === '"') {
      cur += '"';
      i++;
      hasToken = true;
      continue;
    }
    if (c === '"' && !inSingle) {
      inDouble = !inDouble;
      hasToken = true;
      continue;
    }
    if (c === "'" && !inDouble) {
      inSingle = !inSingle;
      hasToken = true;
      continue;
    }
    if ((c === " " || c === "\t" || c === "\n" || c === "\r") && !inSingle && !inDouble) {
      if (hasToken) {
        args.push(cur);
        cur = "";
        hasToken = false;
      }
      continue;
    }
    cur += c;
    hasToken = true;
  }
  if (inSingle || inDouble) {
    return { args: [], error: "引号未闭合：参数解析失败，请检查 \" 或 ' 是否成对" };
  }
  if (hasToken) args.push(cur);
  return { args, error: null };
}

/* ---------------- 路径存在性（模拟文件系统） ---------------- */

/** 原型内置的模拟文件系统白名单；真实实现为 Path::exists() 校验 */
const KNOWN_FS = [
  "C:\\Program Files\\Ollama\\ollama.exe",
  "C:\\tools\\ollama\\ollama.exe",
  "C:\\srv\\gateway\\api-gateway.exe",
  "C:\\srv\\router\\router.exe",
  "C:\\srv\\metrics\\exporter.exe",
  "C:\\tools\\frp\\frpc.exe",
  "C:\\tools\\watchdog\\watchdog.exe",
  "C:\\scripts\\backup-db.bat",
  "C:\\scripts\\sync.bat",
  "C:\\scripts\\ship-logs.ps1",
  "C:\\Windows\\System32\\ping.exe",
  "C:\\Windows\\System32\\notepad.exe",
  "C:\\Windows\\System32\\ipconfig.exe",
];

const normPath = (p: string) => p.trim().toLowerCase().replace(/\//g, "\\");

export function pathExists(path: string, extra: string[] = []): boolean {
  const n = normPath(path);
  if (!n) return false;
  if (n.startsWith("c:\\users\\demo\\")) return true; // 通过「浏览…」选择的文件一律视为存在
  return [...KNOWN_FS, ...extra].some((k) => normPath(k) === n);
}

export const buildCommand = (kind: Kind, path: string, args: string) => {
  const q = (s: string) => (/\s/.test(s) ? `"${s}"` : s);
  const { args: tokens } = parseArgs(args);
  const a = tokens.length ? " " + tokens.map(q).join(" ") : "";
  if (kind === "exe") return `${q(path)}${a}`;
  if (kind === "bat") return `cmd /c ${q(path)}${a}`;
  return `powershell -ExecutionPolicy Bypass -File ${q(path)}${a}`;
};

const slug = (name: string) =>
  name.trim().toLowerCase().replace(/[^a-z0-9\u4e00-\u9fa5]+/g, "-").replace(/^-+|-+$/g, "") || "task";

export function topoLevels(tasks: SimTask[]): string[][] {
  const indeg: Record<string, number> = {};
  const dependents: Record<string, string[]> = {};
  tasks.forEach((t) => {
    indeg[t.id] = 0;
    dependents[t.id] = [];
  });
  tasks.forEach((t) =>
    t.deps.forEach((d) => {
      if (indeg[d] !== undefined) {
        indeg[t.id] += 1;
        dependents[d].push(t.id);
      }
    }),
  );
  const levels: string[][] = [];
  let frontier = Object.keys(indeg).filter((i) => indeg[i] === 0);
  while (frontier.length) {
    levels.push(frontier);
    const next: string[] = [];
    frontier.forEach((i) =>
      dependents[i].forEach((d) => {
        indeg[d] -= 1;
        if (indeg[d] === 0) next.push(d);
      }),
    );
    frontier = next;
  }
  return levels;
}

/* ---------------- 种子任务 ---------------- */

const T = (
  id: string, name: string, kind: Kind, path: string, args: string, cwd: string,
  strategy: Strategy, health: HealthMode, healthTarget: string, gracefulTimeout: number,
  deps: string[],
): SimTask => ({
  id, name, kind, path, args, cwd, strategy, health, healthTarget, gracefulTimeout, deps,
  state: "stopped", pid: null, startedAt: null, restarts: 0, exitCode: null,
  lastError: null, probeMs: null, crashTimes: [], backoffUntil: null, backoffAttempt: 0,
});

const seedTasks = (): SimTask[] => [
  T("ollama-serve", "ollama-serve", "exe", "C:\\tools\\ollama\\ollama.exe", "serve", "C:\\tools\\ollama", "always", "tcp", "127.0.0.1:11434", 5, []),
  T("model-router", "model-router", "exe", "C:\\srv\\router\\router.exe", "--port 8080 --upstream 11434", "C:\\srv\\router", "on-failure", "http", "http://127.0.0.1:8080/health", 3, ["ollama-serve"]),
  T("frpc-tunnel", "frpc-tunnel", "exe", "C:\\tools\\frp\\frpc.exe", "-c frpc.toml", "C:\\tools\\frp", "on-failure", "tcp", "127.0.0.1:7000", 3, ["model-router"]),
  T("log-shipper", "log-shipper", "ps1", "C:\\scripts\\ship-logs.ps1", "-target loki -batch 500", "C:\\scripts", "always", "ready", "stdout:ready", 0, []),
  T("nightly-sync", "nightly-sync", "bat", "C:\\scripts\\sync.bat", "--full --compress", "C:\\scripts", "never", "none", "", 0, []),
];

const HEARTBEATS: Record<Kind, string[]> = {
  exe: [
    "GET /metrics 200 · 3ms",
    "worker pool idle=4 busy=1",
    "rss=86.2MB · handles=214",
    "keep-alive tick seq={n}",
  ],
  ps1: ["batch {n} shipped → loki (11ms)", "cursor checkpoint saved", "queue depth=0"],
  bat: ["synced {n} files · 3.2MB/s", "checksum ok · skipped 12", "snapshot written"],
};

const rndPid = () => 4000 + Math.floor(Math.random() * 28000);
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const walk = (v: number, lo: number, hi: number, step: number) =>
  clamp(v + (Math.random() - 0.5) * step, lo, hi);

/* ---------------- Hook ---------------- */

export function useSimulator() {
  const [tasks, setTasks] = useState<SimTask[]>(seedTasks);
  const [logs, setLogs] = useState<Record<string, LogLine[]>>(() => {
    const init: Record<string, LogLine[]> = {};
    seedTasks().forEach((t) => (init[t.id] = []));
    return init;
  });
  const [metrics, setMetrics] = useState<Metrics>({
    cpu: 14, mem: 46, gpu: 23, vram: 5.1, gpuTemp: 41,
    cpuHist: Array.from({ length: 30 }, () => 12 + Math.random() * 8),
    gpuHist: Array.from({ length: 30 }, () => 20 + Math.random() * 10),
  });
  const [now, setNow] = useState(() => Date.now());
  const [selectedId, setSelectedId] = useState("ollama-serve");
  const [autoScroll, setAutoScroll] = useState(true);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [stats, setStats] = useState({ spawned: 0, restarts: 0, lastError: null as string | null });

  const tasksRef = useRef(tasks);
  tasksRef.current = tasks;
  const logIdRef = useRef(1);
  const toastIdRef = useRef(1);
  const timersRef = useRef<number[]>([]);
  const appStartRef = useRef(Date.now());
  const scriptedCrashRef = useRef(false);

  /* 故障注入开关（一次性）：下一次 spawn 将失败，用于演示启动失败反馈链路 */
  const [faultInject, setFaultInjectState] = useState(false);
  const faultInjectRef = useRef(false);
  const setFaultInject = useCallback((v: boolean) => {
    faultInjectRef.current = v;
    setFaultInjectState(v);
  }, []);

  const later = useCallback((fn: () => void, ms: number) => {
    const id = window.setTimeout(() => {
      timersRef.current = timersRef.current.filter((x) => x !== id);
      fn();
    }, ms);
    timersRef.current.push(id);
  }, []);

  /* ---------- 日志 ---------- */
  const pushLog = useCallback((taskId: string, level: LogLevel, msg: string) => {
    setLogs((prev) => {
      const list = prev[taskId] ?? [];
      const next = [...list, { id: logIdRef.current++, t: Date.now(), level, msg }];
      if (next.length > LOG_CAP) next.splice(0, next.length - LOG_CAP);
      return { ...prev, [taskId]: next };
    });
    if (level === "ERR") {
      const name = tasksRef.current.find((t) => t.id === taskId)?.name ?? taskId;
      setStats((s) => ({ ...s, lastError: `[${name}] ${msg}` }));
    }
  }, []);

  const toast = useCallback((kind: Toast["kind"], text: string) => {
    const id = toastIdRef.current++;
    setToasts((p) => [...p.slice(-3), { id, kind, text }]);
    later(() => setToasts((p) => p.filter((t) => t.id !== id)), 4600);
  }, [later]);

  const patchTask = useCallback((id: string, patch: Partial<SimTask>) => {
    setTasks((prev) => prev.map((t) => (t.id === id ? { ...t, ...patch } : t)));
  }, []);

  /* ---------- 启动 ---------- */
  const startingRef = useRef(new Set<string>());
  const beginStart = useCallback((id: string) => {
    if (startingRef.current.has(id)) return;
    const task = tasksRef.current.find((t) => t.id === id);
    if (!task || task.state === "running" || task.state === "starting") return;
    startingRef.current.add(id);
    const wasRestart = task.startedAt !== null || task.restarts > 0;
    patchTask(id, { state: "starting", lastError: null, exitCode: null, backoffUntil: null });
    pushLog(id, "SYS", `派生子进程 · CREATE_NO_WINDOW · cwd=${task.cwd || task.path}`);

    /* ── 故障注入（一次性）：模拟 CreateProcessW 失败 → 完整反馈链路 ── */
    if (faultInjectRef.current) {
      faultInjectRef.current = false;
      setFaultInject(false);
      startingRef.current.delete(id);
      const err = "CreateProcessW 失败: The system cannot find the file specified. (os error 2)";
      const nowTs = Date.now();
      pushLog(id, "ERR", `派生失败 · ${err}`);
      pushLog(id, "SYS", "启动失败反馈链路已触发：托盘通知 + 卡片红框 + 错误详情");
      toast("err", `任务 "${task.name}" 启动失败：${err}`);
      if (task.strategy === "never") {
        patchTask(id, { state: "stopped", lastError: `启动失败 · ${err}（策略 never，不重试）` });
        return;
      }
      const recent = [...task.crashTimes.filter((t) => nowTs - t < BREAKER_WINDOW), nowTs];
      if (recent.length >= BREAKER_MAX) {
        patchTask(id, {
          state: "fused", crashTimes: [], backoffUntil: null,
          lastError: `熔断触发：窗口内启动失败 ${BREAKER_MAX} 次，自动重试已暂停`,
        });
        pushLog(id, "ERR", `熔断触发：滑动窗口 ${BREAKER_WINDOW / 1000}s 内失败 ${BREAKER_MAX} 次 → 暂停自动重试`);
        toast("warn", `任务 "${task.name}" 已熔断，需手动干预`);
      } else {
        const delay = Math.min(2 ** (task.backoffAttempt + 1), 64) * 1000;
        patchTask(id, {
          state: "backoff", crashTimes: recent, backoffUntil: nowTs + delay,
          backoffAttempt: task.backoffAttempt + 1, lastError: `启动失败 · ${err}`,
        });
        pushLog(id, "WARN", `启动失败计入熔断窗口 (${recent.length}/${BREAKER_MAX}) → 指数退避 ${delay / 1000}s 后重试`);
      }
      return;
    }

    later(() => {
      startingRef.current.delete(id);
      const cur = tasksRef.current.find((t) => t.id === id);
      if (!cur || cur.state !== "starting") return; // 已被停止/删除 → 放弃切换
      const pid = rndPid();
      const probe = task.health === "none" ? null : 2 + Math.floor(Math.random() * 14);
      patchTask(id, {
        state: "running", pid, startedAt: Date.now(),
        restarts: wasRestart ? task.restarts + 1 : task.restarts,
        probeMs: probe, crashTimes: [], backoffAttempt: 0,
      });
      setStats((s) => ({ ...s, spawned: s.spawned + 1, restarts: s.restarts + (wasRestart ? 1 : 0) }));
      pushLog(id, "INFO", `进程已派生 · PID=${pid} · 无窗口标志已置位`);
      if (task.health === "tcp") pushLog(id, "INFO", `TCP 探针 ${task.healthTarget} → 连接成功 (${probe}ms)`);
      else if (task.health === "http") pushLog(id, "INFO", `HTTP GET ${task.healthTarget.replace(/^https?:\/\/[^/]+/, "")} → 200 OK (${probe}ms)`);
      else if (task.health === "ready") pushLog(id, "INFO", `就绪等待：捕获 stdout 关键字 "ready" (1.2s)`);
      pushLog(id, "SYS", "已绑定 Job Object · 进程树纳入监管");
    }, 650 + Math.random() * 450);
  }, [later, patchTask, pushLog]);

  const startTask = useCallback((id: string, opts?: { manual?: boolean }) => {
    const task = tasksRef.current.find((t) => t.id === id);
    if (!task) return;
    if (task.state === "running" || task.state === "starting") return;
    if (task.state === "fused" && !opts?.manual) return;
    if (task.state === "fused") {
      pushLog(id, "SYS", "手动启动：熔断计数已重置");
    }
    // DAG：依赖未运行则先行启动上游
    task.deps.forEach((depId) => {
      const dep = tasksRef.current.find((t) => t.id === depId);
      if (dep && dep.state !== "running" && dep.state !== "starting") {
        pushLog(id, "WARN", `依赖 "${dep.name}" 未运行 → 先行启动上游`);
        startTask(depId);
      }
    });
    beginStart(id);
  }, [beginStart, pushLog]);

  /* ---------- 停止 ---------- */
  const stopTask = useCallback((id: string, opts?: { silentLog?: boolean }) => {
    const task = tasksRef.current.find((t) => t.id === id);
    if (!task || task.state === "stopped") return;
    startingRef.current.delete(id);
    if (task.pid !== null) {
      if (task.kind === "exe" && task.gracefulTimeout > 0) {
        pushLog(id, "SYS", `优雅停止窗口 ${task.gracefulTimeout}s：发送关闭信号 → 超时兜底`);
      }
      pushLog(id, "SYS", `taskkill /F /T /PID ${task.pid} · 整棵进程树已终结`);
    } else if (!opts?.silentLog) {
      pushLog(id, "SYS", "任务已取消");
    }
    patchTask(id, { state: "stopped", pid: null, exitCode: task.pid !== null ? 0 : null, backoffUntil: null, probeMs: null });
    // 级联：依赖本任务的下游一并停止
    tasksRef.current
      .filter((t) => t.deps.includes(id) && t.state !== "stopped")
      .forEach((child) => {
        pushLog(child.id, "WARN", `上游 "${task.name}" 已停止 → 级联停止`);
        stopTask(child.id, { silentLog: true });
      });
  }, [patchTask, pushLog]);

  const restartTask = useCallback((id: string) => {
    const task = tasksRef.current.find((t) => t.id === id);
    if (!task) return;
    if (task.state === "fused") {
      pushLog(id, "SYS", "手动重启：熔断计数已重置");
      patchTask(id, { crashTimes: [], backoffAttempt: 0 });
    }
    pushLog(id, "SYS", "执行重启 …");
    stopTask(id, { silentLog: true });
    later(() => beginStart(id), 500);
  }, [beginStart, later, patchTask, pushLog, stopTask]);

  /* ---------- 异常与熔断 ---------- */
  const crashTask = useCallback((id: string, manual = false) => {
    const task = tasksRef.current.find((t) => t.id === id);
    if (!task || task.state !== "running") return;
    const code = manual && Math.random() > 0.5 ? 3221225477 : 1;
    const codeHex = code === 3221225477 ? " (0xC0000005 访问冲突)" : "";
    pushLog(id, "ERR", `进程意外退出 · exit_code=${code}${codeHex} · PID=${task.pid}`);
    toast("err", `任务 "${task.name}" 意外退出 (code ${code})`);
    setStats((s) => ({ ...s, restarts: s.restarts + 1 }));

    if (task.strategy === "never") {
      patchTask(id, { state: "stopped", pid: null, exitCode: code, startedAt: null, probeMs: null, lastError: `进程退出 (code ${code})，策略 never 不重启` });
      return;
    }
    const nowTs = Date.now();
    const recent = [...task.crashTimes.filter((t) => nowTs - t < BREAKER_WINDOW), nowTs];
    if (recent.length >= BREAKER_MAX) {
      patchTask(id, {
        state: "fused", pid: null, exitCode: code, crashTimes: [], backoffUntil: null, probeMs: null,
        lastError: `熔断触发：${BREAKER_WINDOW / 1000}s 内失败 ${BREAKER_MAX} 次，自动重试已暂停`,
      });
      pushLog(id, "ERR", `熔断触发：滑动窗口 ${BREAKER_WINDOW / 1000}s 内失败 ${BREAKER_MAX} 次 → 暂停自动重启`);
      toast("warn", `任务 "${task.name}" 已熔断，需手动干预`);
      // 通知下游
      tasksRef.current
        .filter((t) => t.deps.includes(id) && (t.state === "running" || t.state === "starting"))
        .forEach((child) => pushLog(child.id, "WARN", `上游 "${task.name}" 熔断 → 依赖链风险通告`));
    } else {
      const delay = Math.min(2 ** (task.backoffAttempt + 1), 64) * 1000;
      patchTask(id, {
        state: "backoff", pid: null, exitCode: code, crashTimes: recent,
        backoffUntil: nowTs + delay, backoffAttempt: task.backoffAttempt + 1, probeMs: null, startedAt: null,
      });
      pushLog(id, "WARN", `策略 ${task.strategy} → 指数退避 ${delay / 1000}s 后重试 (第 ${task.backoffAttempt + 1} 次)`);
    }
  }, [patchTask, pushLog, toast]);

  const resetBreaker = useCallback((id: string) => {
    patchTask(id, { state: "stopped", crashTimes: [], backoffAttempt: 0, backoffUntil: null, lastError: null, exitCode: null });
    pushLog(id, "SYS", "熔断计数已手动重置");
  }, [patchTask, pushLog]);

  /* ---------- 全局操作 ---------- */
  const startAll = useCallback(() => {
    const levels = topoLevels(tasksRef.current);
    let delay = 0;
    levels.forEach((level) => {
      level.forEach((id) => {
        const t = tasksRef.current.find((x) => x.id === id);
        if (t && t.state !== "fused" && t.state !== "running" && t.state !== "starting") {
          later(() => beginStart(id), delay);
        }
      });
      delay += 420;
    });
    toast("info", "按 DAG 拓扑序启动全部任务（依赖优先）");
  }, [beginStart, later, toast]);

  const stopAll = useCallback(() => {
    const levels = topoLevels(tasksRef.current).reverse();
    let delay = 0;
    levels.forEach((level) => {
      level.forEach((id) => later(() => stopTask(id, { silentLog: true }), delay));
      delay += 260;
    });
    toast("info", "按反拓扑序停止全部任务");
  }, [later, stopTask, toast]);

  /* ---------- 增删改 ---------- */
  const addTask = useCallback((draft: TaskDraft) => {
    const id = slug(draft.name);
    if (tasksRef.current.some((t) => t.id === id)) {
      toast("warn", `任务名 "${draft.name}" 已存在`);
      return false;
    }
    const task: SimTask = {
      ...draft, id, state: "stopped", pid: null, startedAt: null, restarts: 0,
      exitCode: null, lastError: null, probeMs: null, crashTimes: [], backoffUntil: null, backoffAttempt: 0,
    };
    setTasks((p) => [...p, task]);
    setLogs((p) => ({ ...p, [id]: [] }));
    pushLog(id, "SYS", "任务已创建 · 配置写入 config.toml（原子替换落盘）");
    toast("ok", `任务 "${draft.name}" 已添加`);
    setSelectedId(id);
    return true;
  }, [pushLog, toast]);

  const updateTask = useCallback((id: string, draft: TaskDraft) => {
    patchTask(id, { ...draft });
    pushLog(id, "SYS", "配置已更新 · config.toml 已落盘（下次启动生效）");
    toast("ok", `任务 "${draft.name}" 配置已保存`);
  }, [patchTask, pushLog, toast]);

  const deleteTask = useCallback((id: string) => {
    const task = tasksRef.current.find((t) => t.id === id);
    if (!task) return;
    stopTask(id, { silentLog: true });
    setTasks((p) => p.filter((t) => t.id !== id));
    setLogs((p) => {
      const next = { ...p };
      delete next[id];
      return next;
    });
    setSelectedId((sel) => {
      if (sel !== id) return sel;
      const rest = tasksRef.current.filter((t) => t.id !== id);
      return rest[0]?.id ?? "";
    });
    toast("info", `任务 "${task.name}" 已删除（含日志文件）`);
  }, [stopTask, toast]);

  const clearLogs = useCallback((id: string) => {
    setLogs((p) => ({ ...p, [id]: [] }));
  }, []);

  /* ---------- 心跳节拍 ---------- */
  useEffect(() => {
    const iv = window.setInterval(() => {
      const nowTs = Date.now();
      setNow(nowTs);

      setMetrics((m) => {
        const cpu = walk(m.cpu, 5, 92, 10);
        const gpu = walk(m.gpu, 8, 98, 12);
        const mem = walk(m.mem, 38, 76, 2.4);
        return {
          cpu, mem, gpu,
          vram: +(3.6 + (gpu / 100) * 10.4 + (Math.random() - 0.5) * 0.3).toFixed(1),
          gpuTemp: +(33 + gpu * 0.42 + (Math.random() - 0.5) * 1.4).toFixed(0),
          cpuHist: [...m.cpuHist.slice(-47), cpu],
          gpuHist: [...m.gpuHist.slice(-47), gpu],
        };
      });

      tasksRef.current.forEach((t) => {
        if (t.state === "backoff" && t.backoffUntil !== null && nowTs >= t.backoffUntil) {
          beginStart(t.id);
        }
        if (t.state === "running" && Math.random() < 0.028) {
          const pool = HEARTBEATS[t.kind];
          const msg = pool[Math.floor(Math.random() * pool.length)].replace("{n}", String(100 + Math.floor(Math.random() * 900)));
          pushLog(t.id, "INFO", msg);
        }
      });

      // 编排一次随机故障，演示守护链路
      if (!scriptedCrashRef.current && nowTs - appStartRef.current > 26_000) {
        scriptedCrashRef.current = true;
        const victim = tasksRef.current.find((t) => t.id === "model-router" && t.state === "running");
        if (victim) {
          pushLog(victim.id, "WARN", "检测到内存压力 · worker 线程异常");
          later(() => crashTask("model-router"), 900);
        }
      }
    }, 500);
    return () => window.clearInterval(iv);
  }, [beginStart, crashTask, later, pushLog]);

  /* ---------- 初始编排：启动种子任务 ---------- */
  useEffect(() => {
    ["ollama-serve", "log-shipper", "model-router"].forEach((id, i) => {
      later(() => beginStart(id), 500 + i * 700);
    });
    return () => {
      timersRef.current.forEach((id) => window.clearTimeout(id));
      timersRef.current = [];
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const selectedTask = tasks.find((t) => t.id === selectedId) ?? null;
  const runningCount = tasks.filter((t) => t.state === "running").length;

  return {
    tasks, logs, metrics, now, toasts, stats,
    selectedId, selectedTask, setSelectedId,
    autoScroll, setAutoScroll,
    appStart: appStartRef.current,
    runningCount,
    startTask, stopTask, restartTask, startAll, stopAll,
    crashTask, resetBreaker, addTask, updateTask, deleteTask, clearLogs,
    faultInject, setFaultInject,
    notify: toast,
  };
}

export type Simulator = ReturnType<typeof useSimulator>;
