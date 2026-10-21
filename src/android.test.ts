import { describe, expect, it, vi } from "vitest";
import { Android, formatDevices, parseDeviceList, resolveAdb } from "./android.js";
import type { Runner } from "./exec.js";

const devicesOutput = `List of devices attached
emulator-5554          device product:sdk_gphone64_arm64 model:sdk_gphone64_arm64 device:emu64a transport_id:1
R58M12345AB            unauthorized transport_id:2
* daemon started successfully
`;

describe("parseDeviceList", () => {
  it("reads serial, state and model", () => {
    expect(parseDeviceList(devicesOutput)).toEqual([
      { serial: "emulator-5554", state: "device", model: "sdk_gphone64_arm64", product: "sdk_gphone64_arm64" },
      { serial: "R58M12345AB", state: "unauthorized" },
    ]);
    expect(formatDevices([])).toMatch(/No Android/);
  });
});

describe("resolveAdb", () => {
  it("prefers ADB_PATH, then ANDROID_HOME, then the default SDK location, then PATH", () => {
    const exists = (path: string) => path === "/sdk/platform-tools/adb";
    expect(resolveAdb({ ANDROID_HOME: "/sdk" } as NodeJS.ProcessEnv, exists)).toBe("/sdk/platform-tools/adb");
    expect(resolveAdb({ ADB_PATH: "/custom/adb" } as NodeJS.ProcessEnv, (path) => path === "/custom/adb")).toBe("/custom/adb");
    expect(resolveAdb({} as NodeJS.ProcessEnv, () => false)).toBe("adb");
  });
});

describe("Android", () => {
  function fake(output = "") {
    return vi.fn<Runner>(async () => ({ stdout: output, stderr: "", code: 0 }));
  }

  it("picks the single online device as default and errors otherwise", async () => {
    const one = new Android(fake(devicesOutput), "/adb");
    expect(await one.defaultSerial()).toBe("emulator-5554");
    const none = new Android(fake("List of devices attached\n"), "/adb");
    await expect(none.defaultSerial()).rejects.toThrow(/No Android device/);
    const two = new Android(fake("List of devices attached\na device\nb device\n"), "/adb");
    await expect(two.defaultSerial()).rejects.toThrow(/pass serial: a, b/);
  });

  it("filters logcat to RN tags by default and lifts it with all", async () => {
    const runner = fake("01-01 10:00:00.000 I/ReactNativeJS( 123): hello\n01-01 10:00:01.000 E/AndroidRuntime( 123): boom");
    const android = new Android(runner, "/adb");
    const out = await android.logcat("emulator-5554", { contains: "boom" });
    const [, args] = runner.mock.calls[0];
    expect(args.slice(0, 2)).toEqual(["-s", "emulator-5554"]);
    expect(args).toContain("ReactNativeJS:V");
    expect(args).toContain("*:S");
    expect(out).toBe("01-01 10:00:01.000 E/AndroidRuntime( 123): boom");
    await android.logcat("emulator-5554", { all: true });
    expect(runner.mock.calls[1][1]).not.toContain("*:S");
  });

  it("escapes spaces for input text and builds the deep-link intent", async () => {
    const runner = fake();
    const android = new Android(runner, "/adb");
    await android.typeText("s", "hello world");
    expect(runner.mock.calls[0][1]).toEqual(["-s", "s", "shell", "input", "text", "hello%sworld"]);
    await android.openUrl("s", "myapp://course/1");
    expect(runner.mock.calls[1][1]).toEqual(["-s", "s", "shell", "am", "start", "-a", "android.intent.action.VIEW", "-d", "myapp://course/1"]);
  });
});
