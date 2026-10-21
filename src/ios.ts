/**
 * iOS Simulator via `xcrun simctl`. Every command takes a device argument; "booted"
 * is simctl's own alias for the running simulator, so it is the default here too.
 */
import { writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runOrThrow, type Runner } from "./exec.js";
import { pngToContent, tempPngPath, type ImageContent } from "./image.js";

export interface Simulator {
  name: string;
  udid: string;
  state: string;
  runtime: string;
  isAvailable: boolean;
}

interface SimctlDevice {
  name: string;
  udid: string;
  state: string;
  isAvailable?: boolean;
}

/** Parses `simctl list devices -j`; runtime keys look like com.apple.CoreSimulator.SimRuntime.iOS-26-2. */
export function parseSimulatorList(json: string): Simulator[] {
  const parsed = JSON.parse(json) as { devices: Record<string, SimctlDevice[]> };
  const simulators: Simulator[] = [];
  for (const [runtimeKey, devices] of Object.entries(parsed.devices)) {
    const runtime = runtimeKey.replace("com.apple.CoreSimulator.SimRuntime.", "").replace(/-/g, " ").replace(/^(\w+) /, "$1 ");
    for (const device of devices) {
      simulators.push({
        name: device.name,
        udid: device.udid,
        state: device.state,
        runtime,
        isAvailable: device.isAvailable ?? true,
      });
    }
  }
  return simulators;
}

export function formatSimulators(simulators: Simulator[]): string {
  if (simulators.length === 0) return "No simulators.";
  const booted = simulators.filter((simulator) => simulator.state === "Booted");
  const rest = simulators.filter((simulator) => simulator.state !== "Booted");
  const line = (simulator: Simulator) => `- ${simulator.name} · ${simulator.runtime} · ${simulator.state} (udid: ${simulator.udid})`;
  return [
    booted.length ? `Booted:\n${booted.map(line).join("\n")}` : "Booted: none",
    rest.length ? `\nAvailable:\n${rest.map(line).join("\n")}` : "",
  ]
    .join("\n")
    .trim();
}

export class IosSimulator {
  constructor(private readonly runner: Runner) {}

  private simctl(args: string[], options?: Parameters<Runner>[2]) {
    return runOrThrow(this.runner, "xcrun", ["simctl", ...args], options);
  }

  async list(onlyAvailable = true): Promise<Simulator[]> {
    const result = await this.simctl(["list", "devices", ...(onlyAvailable ? ["available"] : []), "-j"]);
    return parseSimulatorList(result.stdout as string);
  }

  async boot(device: string): Promise<void> {
    const result = await this.runner("xcrun", ["simctl", "boot", device], { timeoutMs: 120_000 });
    // "Unable to boot device in current state: Booted" is not a failure for our purposes.
    if (result.code !== 0 && !/current state: Booted/.test(result.stderr)) {
      throw new Error(`simctl boot ${device} failed: ${result.stderr.trim()}`);
    }
    await this.simctl(["bootstatus", device, "-b"], { timeoutMs: 180_000 });
    await this.runner("open", ["-a", "Simulator"]);
  }

  async shutdown(device: string): Promise<void> {
    await this.simctl(["shutdown", device], { timeoutMs: 60_000 });
  }

  async screenshot(device: string, maxDimension?: number): Promise<ImageContent> {
    const file = tempPngPath("ios");
    await this.simctl(["io", device, "screenshot", "--type=png", file], { timeoutMs: 30_000 });
    return pngToContent(this.runner, file, maxDimension);
  }

  async openUrl(device: string, url: string): Promise<void> {
    await this.simctl(["openurl", device, url]);
  }

  async launch(device: string, bundleId: string): Promise<string> {
    const result = await this.simctl(["launch", device, bundleId]);
    return (result.stdout as string).trim();
  }

  async terminate(device: string, bundleId: string): Promise<void> {
    await this.simctl(["terminate", device, bundleId]);
  }

  async install(device: string, appPath: string): Promise<void> {
    await this.simctl(["install", device, appPath], { timeoutMs: 180_000 });
  }

  async uninstall(device: string, bundleId: string): Promise<void> {
    await this.simctl(["uninstall", device, bundleId]);
  }

  /** Installed apps as a JSON object keyed by bundle id (simctl prints a plist; plutil converts it). */
  async listApps(device: string): Promise<Record<string, { CFBundleDisplayName?: string; CFBundleName?: string; ApplicationType?: string }>> {
    const result = await this.simctl(["listapps", device]);
    const plistPath = join(tmpdir(), `apps-${Date.now()}.plist`);
    await writeFile(plistPath, result.stdout as string);
    const json = await runOrThrow(this.runner, "plutil", ["-convert", "json", "-o", "-", plistPath]);
    return JSON.parse(json.stdout as string);
  }

  /**
   * Recent unified-log lines. `process` filters by the app's process name (usually the
   * product name); `contains` adds a substring filter on the message.
   */
  async logs(device: string, options: { lastMinutes?: number; process?: string; contains?: string; maxLines?: number } = {}): Promise<string> {
    const predicate = buildLogPredicate(options);
    const args = ["spawn", device, "log", "show", "--last", `${options.lastMinutes ?? 2}m`, "--style", "compact"];
    if (predicate) args.push("--predicate", predicate);
    const result = await this.simctl(args, { timeoutMs: 120_000, maxBuffer: 256 * 1024 * 1024 });
    return tail(result.stdout as string, options.maxLines ?? 200);
  }

  /** Sends a key sequence the dev menu listens for: Cmd+D is handled by Simulator.app, not simctl, so we use the URL route. */
  async shake(device: string): Promise<void> {
    // `simctl` has no shake; the RN dev menu also opens from the Simulator "Device > Shake" menu,
    // which is only reachable through the GUI. The reliable path is the app's own dev-menu deep link
    // when the app registers one, so this helper is intentionally a no-op placeholder that documents it.
    void device;
    throw new Error("iOS Simulator has no scriptable shake; use the Simulator menu Device > Shake, or Cmd+D in the simulator window.");
  }
}

export function buildLogPredicate(options: { process?: string; contains?: string }): string | undefined {
  const parts: string[] = [];
  if (options.process) parts.push(`process == "${escapeQuotes(options.process)}"`);
  if (options.contains) parts.push(`eventMessage CONTAINS[c] "${escapeQuotes(options.contains)}"`);
  return parts.length ? parts.join(" AND ") : undefined;
}

function escapeQuotes(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

export function tail(text: string, maxLines: number): string {
  const lines = text.trimEnd().split("\n");
  if (lines.length <= maxLines) return lines.join("\n");
  return `… ${lines.length - maxLines} earlier lines omitted\n${lines.slice(-maxLines).join("\n")}`;
}
