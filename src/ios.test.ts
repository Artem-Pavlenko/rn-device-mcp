import { describe, expect, it, vi } from "vitest";
import type { Runner } from "./exec.js";
import { buildLogPredicate, formatSimulators, IosSimulator, parseSimulatorList, tail } from "./ios.js";

const listJson = JSON.stringify({
  devices: {
    "com.apple.CoreSimulator.SimRuntime.iOS-26-2": [
      { name: "iPhone 17 Pro", udid: "AAA", state: "Booted", isAvailable: true },
      { name: "iPad Air", udid: "BBB", state: "Shutdown", isAvailable: true },
    ],
    "com.apple.CoreSimulator.SimRuntime.iOS-18-0": [{ name: "iPhone 16", udid: "CCC", state: "Shutdown", isAvailable: false }],
  },
});

describe("parseSimulatorList", () => {
  it("flattens runtimes and keeps availability", () => {
    const simulators = parseSimulatorList(listJson);
    expect(simulators).toHaveLength(3);
    expect(simulators[0]).toEqual({ name: "iPhone 17 Pro", udid: "AAA", state: "Booted", runtime: "iOS 26 2", isAvailable: true });
    expect(simulators[2].isAvailable).toBe(false);
  });

  it("formats booted simulators first", () => {
    const out = formatSimulators(parseSimulatorList(listJson));
    expect(out.startsWith("Booted:\n- iPhone 17 Pro")).toBe(true);
    expect(out).toContain("Available:\n- iPad Air");
  });
});

describe("buildLogPredicate", () => {
  it("combines process and message filters and escapes quotes", () => {
    expect(buildLogPredicate({ process: 'My "App"', contains: "error" })).toBe('process == "My \\"App\\"" AND eventMessage CONTAINS[c] "error"');
    expect(buildLogPredicate({})).toBeUndefined();
  });
});

describe("tail", () => {
  it("keeps the last N lines and says how many were dropped", () => {
    expect(tail("a\nb\nc\nd\n", 2)).toBe("… 2 earlier lines omitted\nc\nd");
    expect(tail("a\nb", 5)).toBe("a\nb");
  });
});

describe("IosSimulator", () => {
  it("treats 'already booted' as success and waits for bootstatus", async () => {
    const runner = vi.fn<Runner>(async (command, args) => {
      if (args[1] === "boot") return { stdout: "", stderr: "Unable to boot device in current state: Booted", code: 149 };
      return { stdout: "", stderr: "", code: 0 };
    });
    await new IosSimulator(runner).boot("AAA");
    const calls = runner.mock.calls.map(([command, args]) => [command, ...args].join(" "));
    expect(calls).toEqual(["xcrun simctl boot AAA", "xcrun simctl bootstatus AAA -b", "open -a Simulator"]);
  });

  it("builds the log show command with a predicate", async () => {
    const runner = vi.fn<Runner>(async () => ({ stdout: "line1\nline2", stderr: "", code: 0 }));
    const out = await new IosSimulator(runner).logs("booted", { process: "MyApp", lastMinutes: 5, maxLines: 1 });
    const [, args] = runner.mock.calls[0];
    expect(args).toEqual(["simctl", "spawn", "booted", "log", "show", "--last", "5m", "--style", "compact", "--predicate", 'process == "MyApp"']);
    expect(out).toBe("… 1 earlier lines omitted\nline2");
  });

  it("throws with stderr when simctl fails", async () => {
    const runner = vi.fn<Runner>(async () => ({ stdout: "", stderr: "No such file or directory", code: 2 }));
    await expect(new IosSimulator(runner).openUrl("booted", "myapp://x")).rejects.toThrow(/No such file/);
  });
});
