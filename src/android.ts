/**
 * Android devices and emulators via adb. adb is rarely on PATH on a Mac, so we also
 * look in ANDROID_HOME / ANDROID_SDK_ROOT and the default Android Studio location.
 */
import { existsSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { runOrThrow, type Runner } from "./exec.js";
import { pngToContent, tempPngPath, type ImageContent } from "./image.js";
import { tail } from "./ios.js";

export interface AndroidDevice {
  serial: string;
  state: string;
  model?: string;
  product?: string;
}

export function resolveAdb(env: NodeJS.ProcessEnv = process.env, exists: (path: string) => boolean = existsSync): string {
  if (env.ADB_PATH && exists(env.ADB_PATH)) return env.ADB_PATH;
  const candidates = [env.ANDROID_HOME, env.ANDROID_SDK_ROOT, join(homedir(), "Library", "Android", "sdk")]
    .filter((value): value is string => Boolean(value))
    .map((sdk) => join(sdk, "platform-tools", "adb"));
  for (const candidate of candidates) if (exists(candidate)) return candidate;
  // Fall back to PATH lookup; execFile will report ENOENT if it is not there either.
  return "adb";
}

/** Parses `adb devices -l`. */
export function parseDeviceList(output: string): AndroidDevice[] {
  return output
    .split("\n")
    .slice(1)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("*"))
    .map((line) => {
      const [serial, state, ...rest] = line.split(/\s+/);
      const device: AndroidDevice = { serial, state };
      for (const pair of rest) {
        const [key, value] = pair.split(":");
        if (key === "model") device.model = value;
        if (key === "product") device.product = value;
      }
      return device;
    });
}

export function formatDevices(devices: AndroidDevice[]): string {
  if (devices.length === 0) return "No Android devices or emulators connected.";
  return devices.map((device) => `- ${device.serial} · ${device.state}${device.model ? ` · ${device.model}` : ""}`).join("\n");
}

export class Android {
  constructor(
    private readonly runner: Runner,
    private readonly adbPath: string = resolveAdb(),
  ) {}

  private adb(serial: string | undefined, args: string[], options?: Parameters<Runner>[2]) {
    return runOrThrow(this.runner, this.adbPath, [...(serial ? ["-s", serial] : []), ...args], options);
  }

  async devices(): Promise<AndroidDevice[]> {
    const result = await this.adb(undefined, ["devices", "-l"]);
    return parseDeviceList(result.stdout as string);
  }

  /** The serial to use when the caller did not pick one: the single connected device, or an error. */
  async defaultSerial(): Promise<string> {
    const devices = (await this.devices()).filter((device) => device.state === "device");
    if (devices.length === 1) return devices[0].serial;
    if (devices.length === 0) throw new Error("No Android device is online. Start an emulator or plug in a device.");
    throw new Error(`Several Android devices are online; pass serial: ${devices.map((device) => device.serial).join(", ")}`);
  }

  async screenshot(serial: string, maxDimension?: number): Promise<ImageContent> {
    const result = await this.adb(serial, ["exec-out", "screencap", "-p"], { encoding: "buffer", timeoutMs: 30_000 });
    const file = tempPngPath("android");
    await writeFile(file, result.stdout as Buffer);
    return pngToContent(this.runner, file, maxDimension);
  }

  async openUrl(serial: string, url: string): Promise<string> {
    const result = await this.adb(serial, ["shell", "am", "start", "-a", "android.intent.action.VIEW", "-d", url]);
    return (result.stdout as string).trim();
  }

  async launch(serial: string, packageName: string): Promise<void> {
    await this.adb(serial, ["shell", "monkey", "-p", packageName, "-c", "android.intent.category.LAUNCHER", "1"]);
  }

  async forceStop(serial: string, packageName: string): Promise<void> {
    await this.adb(serial, ["shell", "am", "force-stop", packageName]);
  }

  async install(serial: string, apkPath: string): Promise<string> {
    const result = await this.adb(serial, ["install", "-r", apkPath], { timeoutMs: 300_000 });
    return (result.stdout as string).trim();
  }

  async uninstall(serial: string, packageName: string): Promise<void> {
    await this.adb(serial, ["uninstall", packageName]);
  }

  /** Metro reaches the emulator through this; required for physical devices over USB. */
  async reverseMetro(serial: string, port = 8081): Promise<void> {
    await this.adb(serial, ["reverse", `tcp:${port}`, `tcp:${port}`]);
  }

  /** Opens the React Native dev menu (menu key). */
  async devMenu(serial: string): Promise<void> {
    await this.adb(serial, ["shell", "input", "keyevent", "82"]);
  }

  async keyevent(serial: string, key: string): Promise<void> {
    await this.adb(serial, ["shell", "input", "keyevent", key]);
  }

  async typeText(serial: string, text: string): Promise<void> {
    // adb's input text takes a single argument; spaces must be %s.
    await this.adb(serial, ["shell", "input", "text", text.replace(/ /g, "%s")]);
  }

  async tap(serial: string, x: number, y: number): Promise<void> {
    await this.adb(serial, ["shell", "input", "tap", String(x), String(y)]);
  }

  /**
   * Dumps the recent logcat buffer. By default only ReactNativeJS (console.* from JS) and
   * crash-relevant tags, which is what you want 90% of the time; `all` lifts the filter.
   */
  async logcat(serial: string, options: { maxLines?: number; all?: boolean; contains?: string; clearAfter?: boolean } = {}): Promise<string> {
    const maxLines = options.maxLines ?? 200;
    const args = ["logcat", "-d", "-t", String(Math.max(maxLines * 4, 400)), "-v", "time"];
    if (!options.all) args.push("ReactNativeJS:V", "ReactNative:V", "AndroidRuntime:E", "DEBUG:E", "*:S");
    const result = await this.adb(serial, args, { timeoutMs: 60_000, maxBuffer: 256 * 1024 * 1024 });
    let text = result.stdout as string;
    if (options.contains) {
      const needle = options.contains.toLowerCase();
      text = text
        .split("\n")
        .filter((line) => line.toLowerCase().includes(needle))
        .join("\n");
    }
    if (options.clearAfter) await this.adb(serial, ["logcat", "-c"]);
    return tail(text, maxLines);
  }
}
