import { describe, expect, it, vi } from "vitest";
import { Android } from "./android.js";
import type { Runner } from "./exec.js";
import type { ImageContent } from "./image.js";
import { IosSimulator } from "./ios.js";
import { createTools } from "./tools.js";

const png: ImageContent = { type: "image", data: "iVBORw0KGgo=", mimeType: "image/png" };

function setup() {
  const runner = vi.fn<Runner>(async () => ({ stdout: "", stderr: "", code: 0 }));
  const ios = {
    list: vi.fn(async () => [{ name: "iPhone 17 Pro", udid: "AAA", state: "Booted", runtime: "iOS 26 2", isAvailable: true }]),
    screenshot: vi.fn(async () => png),
    openUrl: vi.fn(async () => undefined),
    launch: vi.fn(async () => ""),
    terminate: vi.fn(async () => undefined),
    listApps: vi.fn(async () => ({
      "com.example.app": { CFBundleDisplayName: "Example", ApplicationType: "User" },
      "com.apple.mobilesafari": { CFBundleDisplayName: "Safari", ApplicationType: "System" },
    })),
    logs: vi.fn(async () => ""),
  } as unknown as IosSimulator;
  const android = {
    devices: vi.fn(async () => [{ serial: "emulator-5554", state: "device" }]),
    defaultSerial: vi.fn(async () => "emulator-5554"),
    screenshot: vi.fn(async () => png),
    tap: vi.fn(async () => undefined),
    typeText: vi.fn(async () => undefined),
    keyevent: vi.fn(async () => undefined),
    forceStop: vi.fn(async () => undefined),
    launch: vi.fn(async () => undefined),
  } as unknown as Android;
  const tools = createTools({ runner, ios, android });
  const tool = (name: string) => {
    const found = tools.find((candidate) => candidate.name === name);
    if (!found) throw new Error(name);
    return found;
  };
  return { tools, tool, ios, android };
}

describe("tools", () => {
  it("returns screenshots as image content with a caption", async () => {
    const { tool, ios } = setup();
    const result = await tool("ios_screenshot").handler({} as never);
    expect(result.content[0]).toEqual({ type: "text", text: "Screenshot of booted" });
    expect(result.content[1]).toEqual(png);
    expect(ios.screenshot).toHaveBeenCalledWith("booted", undefined);
  });

  it("defaults iOS to the booted simulator and Android to the only device", async () => {
    const { tool, ios, android } = setup();
    await tool("ios_open_url").handler({ url: "myapp://x" } as never);
    expect(ios.openUrl).toHaveBeenCalledWith("booted", "myapp://x");
    await tool("android_input").handler({ tap: { x: 10, y: 20 } } as never);
    expect(android.tap).toHaveBeenCalledWith("emulator-5554", 10, 20);
  });

  it("relaunch terminates before launching", async () => {
    const { tool, ios } = setup();
    await tool("ios_launch_app").handler({ bundleId: "com.example.app", relaunch: true } as never);
    expect(ios.terminate).toHaveBeenCalledWith("booted", "com.example.app");
    expect(ios.launch).toHaveBeenCalledWith("booted", "com.example.app");
  });

  it("hides system apps unless asked", async () => {
    const { tool } = setup();
    const user = (await tool("ios_apps").handler({} as never)).content[0];
    expect(user).toEqual({ type: "text", text: "- Example (com.example.app)" });
    const all = (await tool("ios_apps").handler({ userOnly: false } as never)).content[0] as { text: string };
    expect(all.text).toContain("Safari");
  });

  it("reports an error when android_input has nothing to do", async () => {
    const { tool } = setup();
    expect((await tool("android_input").handler({} as never)).isError).toBe(true);
  });

  it("marks only observation tools as read-only", () => {
    const { tools } = setup();
    const readOnly = tools.filter((candidate) => candidate.readOnly).map((candidate) => candidate.name);
    expect(readOnly).toEqual(["ios_simulators", "ios_screenshot", "ios_apps", "ios_logs", "android_devices", "android_screenshot"]);
  });
});
