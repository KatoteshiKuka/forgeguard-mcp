import { mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { SecurityError } from '../security/path-guard.js';

export interface ApplyGate {
  command: string;
  args: string[];
  timeoutMs: number;
}

export interface ProjectPolicy {
  allowFileRead: boolean;
  allowFileWrite: boolean;
  allowGitRead: boolean;
  allowProcessRun: boolean;
  allowedCommands?: string[];
  applyGates?: ApplyGate[];
}

export interface EffectiveProjectPolicy extends ProjectPolicy {
  effectiveCommands: string[];
  source: 'default' | 'file';
}

const DEFAULT_POLICY: ProjectPolicy = {
  allowFileRead: true,
  allowFileWrite: true,
  allowGitRead: true,
  allowProcessRun: true,
};

function parseGate(value: unknown): ApplyGate {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new SecurityError('Each apply gate must be a JSON object.');
  }
  const input = value as Record<string, unknown>;
  const allowedKeys = new Set(['command', 'args', 'timeoutMs']);
  for (const key of Object.keys(input)) {
    if (!allowedKeys.has(key)) throw new SecurityError(`Unknown apply gate key: ${key}`);
  }
  if (typeof input.command !== 'string' || !input.command.trim()) {
    throw new SecurityError('Apply gate command must be a non-empty string.');
  }
  const args = input.args === undefined ? [] : input.args;
  if (!Array.isArray(args) || args.length > 64 || args.some((item) => typeof item !== 'string' || item.includes('\0'))) {
    throw new SecurityError('Apply gate args must be an array of at most 64 strings without NUL bytes.');
  }
  const timeoutMs = input.timeoutMs === undefined ? 120_000 : input.timeoutMs;
  if (!Number.isInteger(timeoutMs) || (timeoutMs as number) < 1 || (timeoutMs as number) > 300_000) {
    throw new SecurityError('Apply gate timeoutMs must be an integer between 1 and 300000.');
  }
  return { command: input.command.trim(), args: [...args] as string[], timeoutMs: timeoutMs as number };
}

function parsePolicy(value: unknown): ProjectPolicy {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new SecurityError('Project policy must be a JSON object.');
  }
  const input = value as Record<string, unknown>;
  const allowedKeys = new Set([
    'allowFileRead',
    'allowFileWrite',
    'allowGitRead',
    'allowProcessRun',
    'allowedCommands',
    'applyGates',
  ]);
  for (const key of Object.keys(input)) {
    if (!allowedKeys.has(key)) throw new SecurityError(`Unknown project policy key: ${key}`);
  }

  const policy: ProjectPolicy = { ...DEFAULT_POLICY };
  for (const key of ['allowFileRead', 'allowFileWrite', 'allowGitRead', 'allowProcessRun'] as const) {
    if (input[key] !== undefined) {
      if (typeof input[key] !== 'boolean') throw new SecurityError(`${key} must be boolean.`);
      policy[key] = input[key];
    }
  }

  if (input.allowedCommands !== undefined) {
    if (!Array.isArray(input.allowedCommands) || input.allowedCommands.some((item) => typeof item !== 'string')) {
      throw new SecurityError('allowedCommands must be an array of strings.');
    }
    policy.allowedCommands = [...new Set(input.allowedCommands.map((item) => item.trim()).filter(Boolean))];
  }

  if (input.applyGates !== undefined) {
    if (!Array.isArray(input.applyGates) || input.applyGates.length > 16) {
      throw new SecurityError('applyGates must be an array with at most 16 entries.');
    }
    policy.applyGates = input.applyGates.map(parseGate);
  }
  return policy;
}

export class ProjectPolicyStore {
  private readonly policiesDir: string;

  constructor(stateDir: string) {
    this.policiesDir = path.join(stateDir, 'policies');
  }

  policyPath(projectId: string): string {
    return path.join(this.policiesDir, `${projectId}.json`);
  }

  async load(projectId: string, globalCommands: ReadonlySet<string>): Promise<EffectiveProjectPolicy> {
    await mkdir(this.policiesDir, { recursive: true, mode: 0o700 });
    let policy = DEFAULT_POLICY;
    let source: 'default' | 'file' = 'default';

    try {
      const raw = await readFile(this.policyPath(projectId), 'utf8');
      policy = parsePolicy(JSON.parse(raw) as unknown);
      source = 'file';
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== 'ENOENT') {
        if (error instanceof SyntaxError) throw new SecurityError('Project policy contains invalid JSON.');
        throw error;
      }
    }

    const narrowed = policy.allowedCommands
      ? policy.allowedCommands.filter((command) => globalCommands.has(command))
      : [...globalCommands];

    const effective: EffectiveProjectPolicy = {
      allowFileRead: policy.allowFileRead,
      allowFileWrite: policy.allowFileWrite,
      allowGitRead: policy.allowGitRead,
      allowProcessRun: policy.allowProcessRun,
      effectiveCommands: policy.allowProcessRun ? narrowed.sort() : [],
      source,
    };
    if (policy.allowedCommands) effective.allowedCommands = [...policy.allowedCommands];
    if (policy.applyGates) effective.applyGates = policy.applyGates.map((gate) => ({ ...gate, args: [...gate.args] }));
    return effective;
  }

  async assert(projectId: string, capability: keyof Pick<ProjectPolicy, 'allowFileRead' | 'allowFileWrite' | 'allowGitRead' | 'allowProcessRun'>, globalCommands: ReadonlySet<string>): Promise<EffectiveProjectPolicy> {
    const policy = await this.load(projectId, globalCommands);
    if (!policy[capability]) throw new SecurityError(`Project policy denies ${capability}.`);
    return policy;
  }
}
