import type { ReadlaterCliResult } from "./types";

export async function fetchUrlMetadata(url: string): Promise<ReadlaterCliResult> {
  const cli = process.env.READLATER_CLI || "readlater-cli";
  const proc = Bun.spawn({
    cmd: [cli, "fetch", "-j", "--summary-length", "280", url],
    stdout: "pipe",
    stderr: "pipe"
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited
  ]);

  if (exitCode !== 0) {
    const message = stderr.trim() || stdout.trim() || `readlater-cli exited with ${exitCode}`;
    throw new Error(message);
  }

  try {
    const parsed = JSON.parse(stdout) as ReadlaterCliResult;
    if (!parsed.url) {
      throw new Error("readlater-cli returned JSON without a url.");
    }

    return parsed;
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`无法解析 readlater-cli 返回的 JSON：${detail}`);
  }
}

export function cliErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  if (typeof error === "string") {
    return error;
  }

  return "未知的 readlater-cli 错误。";
}
