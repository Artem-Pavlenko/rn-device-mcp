# rn-device-mcp

An MCP server that puts the iOS Simulator and Android emulators/devices in front of your coding assistant.
Built for React Native / Expo work: the assistant can **look at the screen**, read the app's logs, open deep
links, install a build and relaunch the app, instead of asking you to do it and describe what you see.

macOS only (uses `xcrun simctl`, `sips` and `adb`).

## Tools

### iOS Simulator

| Tool | What it does |
| --- | --- |
| `ios_simulators` | Simulators with runtime, state and udid, booted first |
| `ios_boot` / `ios_shutdown` | Boot by udid or name (waits until ready), shut down |
| `ios_screenshot` | Screen as an image (downscaled to 900 px by default) |
| `ios_open_url` | Deep link, universal link or Expo dev-client URL |
| `ios_launch_app` / `ios_terminate_app` | By bundle id; `relaunch: true` for a cold start |
| `ios_install_app` | Install a simulator `.app` (from `eas build --local`, Xcode DerivedData) |
| `ios_apps` | Installed apps with bundle ids |
| `ios_logs` | Unified log for the last N minutes, filtered by process and/or substring |

### Android

| Tool | What it does |
| --- | --- |
| `android_devices` | Emulators and USB devices known to adb |
| `android_screenshot` | Screen as an image |
| `android_open_url` | Deep link via ACTION_VIEW |
| `android_launch_app` / `android_stop_app` | By package name; `relaunch: true` for a cold start |
| `android_install_apk` | `adb install -r` |
| `android_reverse_metro` | `adb reverse tcp:8081` so a USB device reaches Metro |
| `android_dev_menu` | Opens the RN dev menu (menu key) |
| `android_input` | Tap at x,y, type text, or send a keyevent |
| `android_logcat` | Recent logcat, RN and crash tags only by default; `clearAfter` to read only new lines next time |

iOS tools default to the booted simulator (`simctl`'s `booted` alias); Android tools default to the only online device.
Observation tools carry `readOnlyHint: true`; everything that changes device state does not.

## Setup

```sh
npm install && npm run build
claude mcp add rn-device --scope user -- node /absolute/path/to/rn-device-mcp/dist/index.js
```

`adb` is found via `ADB_PATH`, `ANDROID_HOME`, `ANDROID_SDK_ROOT`, `~/Library/Android/sdk`, then `PATH`.

## A typical loop

1. `ios_boot "iPhone 17 Pro"` → `ios_install_app build/MyApp.app` → `ios_launch_app com.example.myapp`
2. `ios_open_url myapp://course/954` → `ios_screenshot` → the assistant reads the screen
3. Something is off → `ios_logs process: MyApp contains: "TypeError"`
4. Same on Android with `android_*`, plus `android_input` for a quick tap when there is no test id to hang on to.

## Development

```sh
npm test          # vitest, no devices needed: the process runner is injected
npm run typecheck
```

- `src/exec.ts` — `execFile` wrapper, no shell, so URLs and names are never interpreted
- `src/image.ts` — PNG → downscaled base64 image content
- `src/ios.ts` / `src/android.ts` — `simctl` and `adb` wrappers with output parsers
- `src/tools.ts` — tool definitions and handlers
- `src/index.ts` — MCP wiring over stdio
