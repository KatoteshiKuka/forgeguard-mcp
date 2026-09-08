import { mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { SecurityError } from '../security/path-guard.js';

export interface ProjectPolicy {
  allowFileRead: boolean;
  allowFileWrite: boolean;
  allowGitRead: boolean;
  allowProcessRun: boolean;
  allowedCommands?: string[];
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
    return effective;
  }

  async assert(projectId: string, capability: keyof Pick<ProjectPolicy, 'allowFileRead' | 'allowFileWrite' | 'allowGitRead' | 'allowProcessRun'>, globalCommands: ReadonlySet<string>): Promise<EffectiveProjectPolicy> {
    const policy = await this.load(projectId, globalCommands);
    if (!policy[capability]) throw new SecurityError(`Project policy denies ${capability}.`);
    return policy;
  }
}
