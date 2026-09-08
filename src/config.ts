import path from 'node:path';

export interface ForgeGuardConfig {
  allowedRoots: string[];
  commandAllowlist: Set<string>;
  maxOutputBytes: number;
}

function splitPathList(value: string | undefined): string[] {
  if (!value?.trim()) return [];
  return value
    .split(path.delimiter)
    .map((item) => item.trim())
    .filter(Boolean);
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ForgeGuardConfig {
  const commands = (env.FORGEGUARD_COMMANDS ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);

  const maxOutput = Number.parseInt(env.FORGEGUARD_MAX_OUTPUT_BYTES ?? '1048576', 10);

  return {
    allowedRoots: splitPathList(env.FORGEGUARD_ALLOWED_ROOTS),
    commandAllowlist: new Set(commands),
    maxOutputBytes: Number.isFinite(maxOutput) && maxOutput > 0 ? maxOutput : 1_048_576,
  };
}
