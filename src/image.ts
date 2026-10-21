/**
 * Screenshots from a 3x iPhone are ~1200×2600 px, which is more pixels (and tokens)
 * than the model needs to read a screen. `sips` ships with macOS and downsizes in place.
 */
import { readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Runner } from "./exec.js";

export const DEFAULT_MAX_DIMENSION = 900;

export interface ImageContent {
  type: "image";
  data: string;
  mimeType: "image/png";
}

export function tempPngPath(prefix: string): string {
  return join(tmpdir(), `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.png`);
}

/** Downscales (longest side ≤ maxDimension) and returns the PNG as MCP image content. */
export async function pngToContent(runner: Runner, filePath: string, maxDimension = DEFAULT_MAX_DIMENSION): Promise<ImageContent> {
  if (maxDimension > 0) {
    await runner("sips", ["-Z", String(maxDimension), filePath], { timeoutMs: 30_000 });
  }
  const bytes = await readFile(filePath);
  await rm(filePath, { force: true });
  return { type: "image", data: bytes.toString("base64"), mimeType: "image/png" };
}
