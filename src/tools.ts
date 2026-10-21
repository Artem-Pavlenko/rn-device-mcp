/**
 * Tool definitions. iOS tools default to the booted simulator; Android tools default to
 * the only online device. Screenshots come back as image content the model can look at.
 */
import { z } from "zod";
import { Android, formatDevices } from "./android.js";
import type { Runner } from "./exec.js";
import type { ImageContent } from "./image.js";
import { formatSimulators, IosSimulator } from "./ios.js";

export type Content = { type: "text"; text: string } | ImageContent;

export interface ToolResult {
  [key: string]: unknown;
  content: Content[];
  isError?: boolean;
}

export interface ToolDefinition<Shape extends z.ZodRawShape> {
  name: string;
  title: string;
  description: string;
  inputSchema: Shape;
  readOnly: boolean;
  handler: (args: z.infer<z.ZodObject<Shape>>) => Promise<ToolResult>;
}

function text(value: string, isError = false): ToolResult {
  return { content: [{ type: "text", text: value }], isError: isError || undefined };
}

const iosDevice = z.string().optional().describe('Simulator udid or name. Default "booted" (the running simulator).');
const serialSchema = z.string().optional().describe("adb serial (from android_devices). Default: the only online device.");
const maxDimension = z
  .number()
  .int()
  .min(0)
  .max(4000)
  .optional()
  .describe("Downscale so the longest side is at most this many px (default 900; 0 keeps the original size).");

export function createTools(deps: { runner: Runner; ios?: IosSimulator; android?: Android }) {
  const ios = deps.ios ?? new IosSimulator(deps.runner);
  const android = deps.android ?? new Android(deps.runner);
  const iosTarget = (device?: string) => device ?? "booted";
  const serialOf = async (serial?: string) => serial ?? (await android.defaultSerial());

  // ---------- iOS ----------

  const iosSimulators: ToolDefinition<{ includeUnavailable: z.ZodOptional<z.ZodBoolean> }> = {
    name: "ios_simulators",
    title: "List iOS simulators",
    description: "Lists simulators with runtime, state and udid; booted ones first.",
    inputSchema: { includeUnavailable: z.boolean().optional().describe("Include simulators whose runtime is missing") },
    readOnly: true,
    handler: async ({ includeUnavailable }) => text(formatSimulators(await ios.list(!includeUnavailable))),
  };

  const iosBoot: ToolDefinition<{ device: z.ZodString }> = {
    name: "ios_boot",
    title: "Boot a simulator",
    description: "Boots a simulator by udid or name (e.g. 'iPhone 17 Pro'), waits until it is ready and brings Simulator.app to front.",
    inputSchema: { device: z.string().min(1) },
    readOnly: false,
    handler: async ({ device }) => {
      await ios.boot(device);
      return text(`Booted ${device}.`);
    },
  };

  const iosShutdown: ToolDefinition<{ device: z.ZodOptional<z.ZodString> }> = {
    name: "ios_shutdown",
    title: "Shut down a simulator",
    description: "Shuts down the booted simulator (or the given one).",
    inputSchema: { device: iosDevice },
    readOnly: false,
    handler: async ({ device }) => {
      await ios.shutdown(iosTarget(device));
      return text(`Shut down ${iosTarget(device)}.`);
    },
  };

  const iosScreenshot: ToolDefinition<{ device: z.ZodOptional<z.ZodString>; maxDimension: z.ZodOptional<z.ZodNumber> }> = {
    name: "ios_screenshot",
    title: "Screenshot the simulator",
    description: "Captures the simulator screen and returns it as an image. Use it to see what the app is showing right now.",
    inputSchema: { device: iosDevice, maxDimension },
    readOnly: true,
    handler: async ({ device, maxDimension: max }) => ({
      content: [{ type: "text", text: `Screenshot of ${iosTarget(device)}` }, await ios.screenshot(iosTarget(device), max)],
    }),
  };

  const iosOpenUrl: ToolDefinition<{ url: z.ZodString; device: z.ZodOptional<z.ZodString> }> = {
    name: "ios_open_url",
    title: "Open a URL / deep link",
    description: "Opens a URL in the simulator: a deep link (myapp://...), a universal link, or an Expo dev-client URL (exp+myapp://...).",
    inputSchema: { url: z.string().min(1), device: iosDevice },
    readOnly: false,
    handler: async ({ url, device }) => {
      await ios.openUrl(iosTarget(device), url);
      return text(`Opened ${url} on ${iosTarget(device)}.`);
    },
  };

  const iosLaunch: ToolDefinition<{ bundleId: z.ZodString; device: z.ZodOptional<z.ZodString>; relaunch: z.ZodOptional<z.ZodBoolean> }> = {
    name: "ios_launch_app",
    title: "Launch an app",
    description: "Launches an installed app by bundle id. relaunch: true terminates it first (cold start).",
    inputSchema: { bundleId: z.string().min(1), device: iosDevice, relaunch: z.boolean().optional() },
    readOnly: false,
    handler: async ({ bundleId, device, relaunch }) => {
      if (relaunch) await ios.terminate(iosTarget(device), bundleId).catch(() => undefined);
      const out = await ios.launch(iosTarget(device), bundleId);
      return text(out || `Launched ${bundleId}.`);
    },
  };

  const iosTerminate: ToolDefinition<{ bundleId: z.ZodString; device: z.ZodOptional<z.ZodString> }> = {
    name: "ios_terminate_app",
    title: "Terminate an app",
    description: "Kills the app process on the simulator.",
    inputSchema: { bundleId: z.string().min(1), device: iosDevice },
    readOnly: false,
    handler: async ({ bundleId, device }) => {
      await ios.terminate(iosTarget(device), bundleId);
      return text(`Terminated ${bundleId}.`);
    },
  };

  const iosInstall: ToolDefinition<{ appPath: z.ZodString; device: z.ZodOptional<z.ZodString> }> = {
    name: "ios_install_app",
    title: "Install a .app bundle",
    description: "Installs a simulator build (.app directory, e.g. from `eas build --local` or Xcode DerivedData).",
    inputSchema: { appPath: z.string().min(1), device: iosDevice },
    readOnly: false,
    handler: async ({ appPath, device }) => {
      await ios.install(iosTarget(device), appPath);
      return text(`Installed ${appPath} on ${iosTarget(device)}.`);
    },
  };

  const iosApps: ToolDefinition<{ device: z.ZodOptional<z.ZodString>; userOnly: z.ZodOptional<z.ZodBoolean> }> = {
    name: "ios_apps",
    title: "Installed apps",
    description: "Lists installed apps with bundle ids. userOnly (default true) hides Apple's system apps.",
    inputSchema: { device: iosDevice, userOnly: z.boolean().optional() },
    readOnly: true,
    handler: async ({ device, userOnly }) => {
      const apps = await ios.listApps(iosTarget(device));
      const lines = Object.entries(apps)
        .filter(([, info]) => (userOnly ?? true ? info.ApplicationType === "User" : true))
        .map(([bundleId, info]) => `- ${info.CFBundleDisplayName ?? info.CFBundleName ?? "?"} (${bundleId})`)
        .sort();
      return text(lines.length ? lines.join("\n") : "No user apps installed.");
    },
  };

  const iosLogs: ToolDefinition<{
    device: z.ZodOptional<z.ZodString>;
    process: z.ZodOptional<z.ZodString>;
    contains: z.ZodOptional<z.ZodString>;
    lastMinutes: z.ZodOptional<z.ZodNumber>;
    maxLines: z.ZodOptional<z.ZodNumber>;
  }> = {
    name: "ios_logs",
    title: "Simulator logs",
    description:
      "Recent unified-log lines from the simulator. Filter by process (the app's product name, e.g. 'MyApp') and/or a substring. JS console output from RN shows up under the app process.",
    inputSchema: {
      device: iosDevice,
      process: z.string().optional().describe("Process name to filter on, usually the app name"),
      contains: z.string().optional().describe("Case-insensitive substring filter on the message"),
      lastMinutes: z.number().int().min(1).max(120).optional().describe("Window, default 2"),
      maxLines: z.number().int().min(10).max(2000).optional().describe("Default 200 (the last ones)"),
    },
    readOnly: true,
    handler: async ({ device, process, contains, lastMinutes, maxLines }) =>
      text((await ios.logs(iosTarget(device), { process, contains, lastMinutes, maxLines })) || "No matching log lines."),
  };

  // ---------- Android ----------

  const androidDevices: ToolDefinition<{}> = {
    name: "android_devices",
    title: "List Android devices",
    description: "Lists emulators and USB devices known to adb, with serial and state.",
    inputSchema: {},
    readOnly: true,
    handler: async () => text(formatDevices(await android.devices())),
  };

  const androidScreenshot: ToolDefinition<{ serial: z.ZodOptional<z.ZodString>; maxDimension: z.ZodOptional<z.ZodNumber> }> = {
    name: "android_screenshot",
    title: "Screenshot the Android device",
    description: "Captures the device screen and returns it as an image.",
    inputSchema: { serial: serialSchema, maxDimension },
    readOnly: true,
    handler: async ({ serial, maxDimension: max }) => {
      const target = await serialOf(serial);
      return { content: [{ type: "text", text: `Screenshot of ${target}` }, await android.screenshot(target, max)] };
    },
  };

  const androidOpenUrl: ToolDefinition<{ url: z.ZodString; serial: z.ZodOptional<z.ZodString> }> = {
    name: "android_open_url",
    title: "Open a URL / deep link",
    description: "Opens a deep link or URL with an ACTION_VIEW intent.",
    inputSchema: { url: z.string().min(1), serial: serialSchema },
    readOnly: false,
    handler: async ({ url, serial }) => text(await android.openUrl(await serialOf(serial), url)),
  };

  const androidLaunch: ToolDefinition<{ packageName: z.ZodString; serial: z.ZodOptional<z.ZodString>; relaunch: z.ZodOptional<z.ZodBoolean> }> = {
    name: "android_launch_app",
    title: "Launch an app",
    description: "Launches an app by package name. relaunch: true force-stops it first.",
    inputSchema: { packageName: z.string().min(1), serial: serialSchema, relaunch: z.boolean().optional() },
    readOnly: false,
    handler: async ({ packageName, serial, relaunch }) => {
      const target = await serialOf(serial);
      if (relaunch) await android.forceStop(target, packageName);
      await android.launch(target, packageName);
      return text(`Launched ${packageName} on ${target}.`);
    },
  };

  const androidStop: ToolDefinition<{ packageName: z.ZodString; serial: z.ZodOptional<z.ZodString> }> = {
    name: "android_stop_app",
    title: "Force-stop an app",
    description: "Force-stops the app.",
    inputSchema: { packageName: z.string().min(1), serial: serialSchema },
    readOnly: false,
    handler: async ({ packageName, serial }) => {
      await android.forceStop(await serialOf(serial), packageName);
      return text(`Stopped ${packageName}.`);
    },
  };

  const androidInstall: ToolDefinition<{ apkPath: z.ZodString; serial: z.ZodOptional<z.ZodString> }> = {
    name: "android_install_apk",
    title: "Install an APK",
    description: "Installs (or reinstalls, keeping data) an APK.",
    inputSchema: { apkPath: z.string().min(1), serial: serialSchema },
    readOnly: false,
    handler: async ({ apkPath, serial }) => text(await android.install(await serialOf(serial), apkPath)),
  };

  const androidReverse: ToolDefinition<{ port: z.ZodOptional<z.ZodNumber>; serial: z.ZodOptional<z.ZodString> }> = {
    name: "android_reverse_metro",
    title: "adb reverse for Metro",
    description: "Runs `adb reverse tcp:8081 tcp:8081` so the app can reach Metro on the host (needed for USB devices, harmless on emulators).",
    inputSchema: { port: z.number().int().min(1).max(65535).optional(), serial: serialSchema },
    readOnly: false,
    handler: async ({ port, serial }) => {
      await android.reverseMetro(await serialOf(serial), port ?? 8081);
      return text(`Reversed tcp:${port ?? 8081}.`);
    },
  };

  const androidDevMenu: ToolDefinition<{ serial: z.ZodOptional<z.ZodString> }> = {
    name: "android_dev_menu",
    title: "Open the RN dev menu",
    description: "Sends the menu key, which opens the React Native dev menu in debug builds.",
    inputSchema: { serial: serialSchema },
    readOnly: false,
    handler: async ({ serial }) => {
      await android.devMenu(await serialOf(serial));
      return text("Dev menu key sent.");
    },
  };

  const androidInput: ToolDefinition<{
    serial: z.ZodOptional<z.ZodString>;
    tap: z.ZodOptional<z.ZodObject<{ x: z.ZodNumber; y: z.ZodNumber }>>;
    text: z.ZodOptional<z.ZodString>;
    key: z.ZodOptional<z.ZodString>;
  }> = {
    name: "android_input",
    title: "Tap, type or press a key",
    description: "Low-level input: tap at x,y (pixels from android_screenshot at maxDimension 0), type text into the focused field, or send a keyevent such as KEYCODE_BACK / 4.",
    inputSchema: {
      serial: serialSchema,
      tap: z.object({ x: z.number().int(), y: z.number().int() }).optional(),
      text: z.string().optional(),
      key: z.string().optional(),
    },
    readOnly: false,
    handler: async ({ serial, tap, text: typed, key }) => {
      const target = await serialOf(serial);
      const done: string[] = [];
      if (tap) {
        await android.tap(target, tap.x, tap.y);
        done.push(`tapped ${tap.x},${tap.y}`);
      }
      if (typed) {
        await android.typeText(target, typed);
        done.push(`typed ${JSON.stringify(typed)}`);
      }
      if (key) {
        await android.keyevent(target, key);
        done.push(`key ${key}`);
      }
      return done.length ? text(done.join("; ")) : text("Nothing to do: pass tap, text or key.", true);
    },
  };

  const androidLogcat: ToolDefinition<{
    serial: z.ZodOptional<z.ZodString>;
    contains: z.ZodOptional<z.ZodString>;
    maxLines: z.ZodOptional<z.ZodNumber>;
    all: z.ZodOptional<z.ZodBoolean>;
    clearAfter: z.ZodOptional<z.ZodBoolean>;
  }> = {
    name: "android_logcat",
    title: "Logcat",
    description:
      "Recent logcat lines. By default only ReactNativeJS (console.*), ReactNative and crash tags; all: true lifts the filter. clearAfter: true empties the buffer so the next call shows only new lines.",
    inputSchema: {
      serial: serialSchema,
      contains: z.string().optional().describe("Case-insensitive substring filter"),
      maxLines: z.number().int().min(10).max(2000).optional().describe("Default 200"),
      all: z.boolean().optional(),
      clearAfter: z.boolean().optional(),
    },
    readOnly: false,
    handler: async ({ serial, contains, maxLines, all, clearAfter }) =>
      text((await android.logcat(await serialOf(serial), { contains, maxLines, all, clearAfter })) || "No matching log lines."),
  };

  return [
    iosSimulators,
    iosBoot,
    iosShutdown,
    iosScreenshot,
    iosOpenUrl,
    iosLaunch,
    iosTerminate,
    iosInstall,
    iosApps,
    iosLogs,
    androidDevices,
    androidScreenshot,
    androidOpenUrl,
    androidLaunch,
    androidStop,
    androidInstall,
    androidReverse,
    androidDevMenu,
    androidInput,
    androidLogcat,
  ] as const;
}
