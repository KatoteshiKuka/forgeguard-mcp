import { spawn } from 'node:child_process';

export interface ProcessResult {
  command: string;
  args: string[];
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
  truncated: boolean;
}

function safeEnvironment(workspaceRoot: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    PATH: process.env.PATH,
    LANG: process.env.LANG,
    LC_ALL: process.env.LC_ALL,
    TMPDIR: process.env.TMPDIR,
    TEMP: process.env.TEMP,
    TMP: process.env.TMP,
    HOME: workspaceRoot,
    USERPROFILE: workspaceRoot,
    PWD: workspaceRoot,
  };
  return Object.fromEntries(Object.entries(env).filter(([, value]) => value !== undefined));
}

export async function runStructuredProcess(options: {
  workspaceRoot: string;
  command: string;
  args?: string[];
  allowlist: ReadonlySet<string>;
  timeoutMs?: number;
  maxOutputBytes: number;
}): Promise<ProcessResult> {
  const { workspaceRoot, command, allowlist, maxOutputBytes } = options;
  const args = options.args ?? [];
  const timeoutMs = Math.min(Math.max(options.timeoutMs ?? 30_000, 1), 300_000);

  if (!/^[A-Za-z0-9._+-]+$/.test(command) || !allowlist.has(command)) {
    throw new Error(`Command is not allowed: ${command}`);
  }
  if (args.some((arg) => arg.includes('\0'))) {
    throw new Error('Command arguments may not contain NUL bytes.');
  }

  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: workspaceRoot,
      env: safeEnvironment(workspaceRoot),
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let truncated = false;

    const append = (current: string, currentBytes: number, chunk: Buffer): [string, number] => {
      if (currentBytes >= maxOutputBytes) {
        truncated = true;
        return [current, currentBytes];
      }
      const remaining = maxOutputBytes - currentBytes;
      const accepted = chunk.subarray(0, remaining);
      if (chunk.length > accepted.length) truncated = true;
      return [current + accepted.toString('utf8'), currentBytes + accepted.length];
    };

    child.stdout.on('data', (chunk: Buffer) => {
      [stdout, stdoutBytes] = append(stdout, stdoutBytes, chunk);
    });
    child.stderr.on('data', (chunk: Buffer) => {
      [stderr, stderrBytes] = append(stderr, stderrBytes, chunk);
    });

    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      setTimeout(() => child.kill('SIGKILL'), 2_000).unref();
    }, timeoutMs);
    timer.unref();

    child.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once('close', (exitCode, signal) => {
      clearTimeout(timer);
      resolve({
        command,
        args,
        exitCode,
        signal,
        stdout,
        stderr,
        truncated,
      });
    });
  });
}
