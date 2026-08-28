import { describe, expect, it } from "vitest";
import { parseArgs, topoLevels, type SimTask } from "./useSimulator";

/* 纯逻辑单测：参数解析与 DAG 拓扑 —— 与 Rust 侧 scheduler.rs 测试互为镜像 */

const task = (id: string, deps: string[]): SimTask =>
  ({
    id,
    name: id,
    kind: "exe",
    path: "x.exe",
    args: "",
    cwd: "",
    strategy: "on-failure",
    health: "none",
    healthTarget: "",
    gracefulTimeout: 0,
    deps,
    state: "stopped",
    pid: null,
    startedAt: null,
    restarts: 0,
    exitCode: null,
    lastError: null,
    probeMs: null,
    crashTimes: [],
    backoffUntil: null,
    backoffAttempt: 0,
  }) as SimTask;

describe("parseArgs", () => {
  it("splits on whitespace", () => {
    expect(parseArgs("--port 8080 --verbose").args).toEqual(["--port", "8080", "--verbose"]);
  });

  it("keeps quoted tokens together", () => {
    expect(parseArgs('--msg "hello world" \'a b\'').args).toEqual(["--msg", "hello world", "a b"]);
  });

  it("supports escaped double quotes inside quotes", () => {
    expect(parseArgs('--msg "say \\"hi\\""').args).toEqual(["--msg", 'say "hi"']);
  });

  it("rejects unbalanced quotes", () => {
    const r = parseArgs('--msg "oops');
    expect(r.args).toEqual([]);
    expect(r.error).toMatch(/引号未闭合/);
  });

  it("handles empty input", () => {
    expect(parseArgs("   ").args).toEqual([]);
    expect(parseArgs("").error).toBeNull();
  });
});

describe("topoLevels", () => {
  it("orders diamond dependencies layer by layer", () => {
    const levels = topoLevels([task("a", []), task("b", ["a"]), task("c", ["a"]), task("d", ["b", "c"])]);
    expect(levels[0]).toEqual(["a"]);
    expect([...levels[1]].sort()).toEqual(["b", "c"]);
    expect(levels[2]).toEqual(["d"]);
  });

  it("drops cyclic nodes instead of hanging", () => {
    // 环上的节点入度永不为 0：不产出该层（Rust 侧将残环追加为末层，两端均以不死锁为契约）
    const levels = topoLevels([task("a", ["b"]), task("b", ["a"])]);
    expect(levels).toEqual([]);
  });

  it("keeps independent tasks on one layer", () => {
    const levels = topoLevels([task("x", []), task("y", []), task("z", [])]);
    expect(levels).toHaveLength(1);
    expect([...levels[0]].sort()).toEqual(["x", "y", "z"]);
  });

  it("ignores unknown dependency names", () => {
    const levels = topoLevels([task("a", ["ghost"])]);
    expect(levels[0]).toEqual(["a"]);
  });
});
