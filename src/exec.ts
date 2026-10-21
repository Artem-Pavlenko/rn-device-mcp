/**
 * One place that spawns processes. No shell: arguments go straight to execFile, so
 * device names with spaces and user-supplied URLs cannot be interpreted as commands.
 */
import { execFile } from "node:child_process";

export interface RunOptions {
  timeoutMs?: number;
  /** "buffer" for binary stdout such as PNG bytes. */
  encoding?: "utf8" | "buffer";
  maxBuffer?: number;
}

export interface RunResult {
  stdout: string | Buffer;
  stderr: string;
  code: number;
}

export type Runner = (command: string, args: string[], options?: RunOptions) => Promise<RunResult>;

export class CommandError extends Error {
  constructor(
    message: string,
    public readonly code: number,
    public readonly stderr: string,
  ) {
    super(message);
    this.name = "CommandError";
  }
}

export const run: Runner = (command, args, options = {}) =>
  new Promise((resolve) => {
    execFile(
      command,
      args,
      {
        timeout: options.timeoutMs ?? 60_000,
        encoding: options.encoding ?? "utf8",
        maxBuffer: options.maxBuffer ?? 64 * 1024 * 1024,
      },
      (error, stdout, stderr) => {
        // execFile's error.code is the exit status for a failed command but a string
        // (e.g. "ENOENT") when the binary is missing; both count as failure here.
        const rawCode: unknown = error ? (error as NodeJS.ErrnoException).code : 0;
        const stderrText = typeof stderr === "string" ? stderr : stderr.toString("utf8");
        resolve({
          stdout: stdout as string | Buffer,
          stderr: typeof rawCode === "string" ? `${rawCode}: ${error?.message ?? ""}\n${stderrText}`.trim() : stderrText,
          code: typeof rawCode === "number" ? rawCode : error ? 1 : 0,
        });
      },
    );
  });

/** Runs and throws a CommandError on a non-zero exit, with stderr in the message. */
export async function runOrThrow(runner: Runner, command: string, args: string[], options?: RunOptions): Promise<RunResult> {
  const result = await runner(command, args, options);
  if (result.code !== 0) {
    const detail = result.stderr.trim() || (typeof result.stdout === "string" ? result.stdout.trim() : "");
    throw new CommandError(`${command} ${args.join(" ")} exited with ${result.code}${detail ? `: ${detail}` : ""}`, result.code, result.stderr);
  }
  return result;
}
