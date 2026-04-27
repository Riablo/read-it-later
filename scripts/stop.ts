const DEFAULT_PORT = 3042;
const DEFAULT_TMUX_SESSION = "read-it-later";

const port = Number(process.env.PORT || DEFAULT_PORT);
const tmuxSession = process.env.READLATER_TMUX_SESSION || DEFAULT_TMUX_SESSION;

let stopped = false;

async function run(command: string, args: string[]) {
  try {
    const proc = Bun.spawn({
      cmd: [command, ...args],
      stdout: "pipe",
      stderr: "pipe"
    });
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited
    ]);

    return { exitCode, stdout, stderr };
  } catch (error) {
    return {
      exitCode: 127,
      stdout: "",
      stderr: error instanceof Error ? error.message : String(error)
    };
  }
}

async function stopTmuxSession() {
  const check = await run("tmux", ["has-session", "-t", tmuxSession]);
  if (check.exitCode !== 0) {
    return;
  }

  const killed = await run("tmux", ["kill-session", "-t", tmuxSession]);
  if (killed.exitCode === 0) {
    stopped = true;
    console.log(`已停止 tmux 会话：${tmuxSession}`);
  } else {
    console.error(`停止 tmux 会话失败：${killed.stderr.trim() || "未知错误"}`);
  }
}

async function findListeningPids() {
  const result = await run("lsof", ["-ti", `TCP:${port}`, "-sTCP:LISTEN"]);
  if (result.exitCode !== 0 && !result.stdout.trim()) {
    return [];
  }

  return result.stdout
    .split("\n")
    .map((line) => Number(line.trim()))
    .filter((pid) => Number.isInteger(pid) && pid > 0 && pid !== process.pid);
}

function isProcessAlive(pid: number) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function stopPortListeners() {
  const pids = await findListeningPids();
  if (pids.length === 0) {
    return;
  }

  for (const pid of pids) {
    try {
      process.kill(pid, "SIGTERM");
      stopped = true;
      console.log(`已向端口 ${port} 的进程发送停止信号：${pid}`);
    } catch (error) {
      console.error(`停止进程失败 ${pid}：${error instanceof Error ? error.message : String(error)}`);
    }
  }

  await Bun.sleep(500);

  for (const pid of pids) {
    if (!isProcessAlive(pid)) {
      continue;
    }

    try {
      process.kill(pid, "SIGKILL");
      console.log(`已强制停止进程：${pid}`);
    } catch {
      // The process may have exited between the liveness check and SIGKILL.
    }
  }
}

await stopTmuxSession();
await Bun.sleep(200);
await stopPortListeners();

if (!stopped) {
  console.log(`没有发现正在运行的本地服务：tmux=${tmuxSession}, port=${port}`);
}

export {};
