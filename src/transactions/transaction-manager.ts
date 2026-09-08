import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { mkdir, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { ProjectRecord } from '../projects/project-registry.js';
import { runStructuredProcess } from '../terminal/process-executor.js';

export interface TransactionRecord {
  id: string;
  projectId: string;
  projectRoot: string;
  worktreeRoot: string;
  branch: string;
  baseHead: string;
  createdAt: string;
}

export interface ApplyResult {
  transactionId: string;
  applied: boolean;
  commit?: string;
  noChanges?: boolean;
}

function isInside(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function isTransactionRecord(value: unknown): value is TransactionRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const input = value as Record<string, unknown>;
  return (
    typeof input.id === 'string' && /^[0-9a-f-]{36}$/i.test(input.id) &&
    typeof input.projectId === 'string' && /^[0-9a-f-]{36}$/i.test(input.projectId) &&
    typeof input.projectRoot === 'string' &&
    typeof input.worktreeRoot === 'string' &&
    typeof input.branch === 'string' &&
    typeof input.baseHead === 'string' && /^[0-9a-f]{40}([0-9a-f]{24})?$/i.test(input.baseHead) &&
    typeof input.createdAt === 'string' && Number.isFinite(Date.parse(input.createdAt))
  );
}

export class TransactionManager {
  private readonly transactions = new Map<string, TransactionRecord>();
  private readonly worktreesDir: string;
  private readonly transactionsPath: string;
  private readonly stateDir: string;
  private readonly allowedRoots: string[];

  constructor(
    stateDir: string,
    private readonly maxOutputBytes: number,
    allowedRoots?: readonly string[],
  ) {
    this.stateDir = path.resolve(stateDir);
    this.worktreesDir = path.join(this.stateDir, 'worktrees');
    this.transactionsPath = path.join(this.stateDir, 'transactions.json');
    this.allowedRoots = allowedRoots
      ? [...allowedRoots]
      : (process.env.FORGEGUARD_ALLOWED_ROOTS ?? '')
          .split(path.delimiter)
          .map((item) => item.trim())
          .filter(Boolean);
    this.loadExisting();
  }

  private loadExisting(): void {
    if (!existsSync(this.transactionsPath) || !existsSync(path.join(this.stateDir, 'projects.json'))) return;
    if (this.allowedRoots.length === 0 || !existsSync(this.worktreesDir)) return;

    let rawTransactions: unknown;
    let rawProjects: unknown;
    try {
      rawTransactions = JSON.parse(readFileSync(this.transactionsPath, 'utf8')) as unknown;
      rawProjects = JSON.parse(readFileSync(path.join(this.stateDir, 'projects.json'), 'utf8')) as unknown;
    } catch {
      return;
    }
    if (!Array.isArray(rawTransactions) || !Array.isArray(rawProjects)) return;

    const canonicalAllowedRoots: string[] = [];
    for (const root of this.allowedRoots) {
      try {
        const canonical = realpathSync(path.resolve(root));
        if (statSync(canonical).isDirectory()) canonicalAllowedRoots.push(canonical);
      } catch {
        // Invalid roots cannot authorize recovered state.
      }
    }
    if (canonicalAllowedRoots.length === 0) return;

    let canonicalWorktreesRoot: string;
    try {
      canonicalWorktreesRoot = realpathSync(this.worktreesDir);
      if (!statSync(canonicalWorktreesRoot).isDirectory()) return;
    } catch {
      return;
    }

    const registeredProjects = new Map<string, string>();
    for (const rawProject of rawProjects) {
      if (!rawProject || typeof rawProject !== 'object' || Array.isArray(rawProject)) continue;
      const candidate = rawProject as Record<string, unknown>;
      if (typeof candidate.id !== 'string' || typeof candidate.root !== 'string') continue;
      try {
        const canonicalRoot = realpathSync(path.resolve(candidate.root));
        if (!statSync(canonicalRoot).isDirectory()) continue;
        if (!canonicalAllowedRoots.some((root) => isInside(root, canonicalRoot))) continue;
        registeredProjects.set(candidate.id, canonicalRoot);
      } catch {
        continue;
      }
    }

    for (const rawTransaction of rawTransactions) {
      if (!isTransactionRecord(rawTransaction)) continue;
      const registeredRoot = registeredProjects.get(rawTransaction.projectId);
      if (!registeredRoot) continue;
      try {
        const projectRoot = realpathSync(path.resolve(rawTransaction.projectRoot));
        const worktreeRoot = realpathSync(path.resolve(rawTransaction.worktreeRoot));
        if (projectRoot !== registeredRoot) continue;
        if (!statSync(worktreeRoot).isDirectory()) continue;
        if (!isInside(canonicalWorktreesRoot, worktreeRoot)) continue;
        if (rawTransaction.branch !== `forgeguard/tx-${rawTransaction.id.slice(0, 8)}`) continue;
        this.transactions.set(rawTransaction.id, {
          ...rawTransaction,
          projectRoot,
          worktreeRoot,
        });
      } catch {
        continue;
      }
    }
  }

  private async persist(): Promise<void> {
    await mkdir(this.stateDir, { recursive: true, mode: 0o700 });
    const temporary = `${this.transactionsPath}.${process.pid}.${randomUUID()}.tmp`;
    const records = this.list();
    await writeFile(temporary, `${JSON.stringify(records, null, 2)}\n`, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
    await rename(temporary, this.transactionsPath);
  }

  private async git(cwd: string, args: string[]): Promise<string> {
    const result = await runStructuredProcess({
      workspaceRoot: cwd,
      command: 'git',
      args,
      allowlist: new Set(['git']),
      maxOutputBytes: this.maxOutputBytes,
      timeoutMs: 120_000,
    });
    if (result.exitCode !== 0) {
      throw new Error(`git ${args.join(' ')} failed: ${result.stderr || result.stdout}`.trim());
    }
    return result.stdout.trim();
  }

  async begin(project: ProjectRecord): Promise<TransactionRecord> {
    const inside = await this.git(project.root, ['rev-parse', '--is-inside-work-tree']);
    if (inside !== 'true') throw new Error('Transactions require a Git worktree.');

    const status = await this.git(project.root, ['status', '--porcelain']);
    if (status) throw new Error('Project must be clean before starting a transaction.');

    const baseHead = await this.git(project.root, ['rev-parse', 'HEAD']);
    const id = randomUUID();
    const branch = `forgeguard/tx-${id.slice(0, 8)}`;
    const worktreeRoot = path.join(this.worktreesDir, id);
    await mkdir(this.worktreesDir, { recursive: true, mode: 0o700 });

    await this.git(project.root, ['worktree', 'add', '-b', branch, worktreeRoot, baseHead]);
    const record: TransactionRecord = {
      id,
      projectId: project.id,
      projectRoot: project.root,
      worktreeRoot,
      branch,
      baseHead,
      createdAt: new Date().toISOString(),
    };
    this.transactions.set(id, record);
    try {
      await this.persist();
    } catch (error) {
      this.transactions.delete(id);
      try {
        await this.git(project.root, ['worktree', 'remove', '--force', worktreeRoot]);
      } catch {
        await rm(worktreeRoot, { recursive: true, force: true });
      }
      try {
        await this.git(project.root, ['branch', '-D', branch]);
      } catch {
        // Preserve the state persistence error.
      }
      throw error;
    }
    return record;
  }

  get(id: string): TransactionRecord {
    const transaction = this.transactions.get(id);
    if (!transaction) throw new Error(`Unknown transaction id: ${id}`);
    return transaction;
  }

  list(): TransactionRecord[] {
    return [...this.transactions.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  async status(id: string): Promise<{ transaction: TransactionRecord; gitStatus: string }> {
    const transaction = this.get(id);
    const gitStatus = await this.git(transaction.worktreeRoot, ['status', '--short', '--branch']);
    return { transaction, gitStatus };
  }

  async diff(id: string): Promise<string> {
    const transaction = this.get(id);
    return this.git(transaction.worktreeRoot, ['diff', '--no-ext-diff']);
  }

  async abort(id: string): Promise<void> {
    const transaction = this.get(id);
    let worktreeRemovalError: unknown;
    try {
      await this.git(transaction.projectRoot, ['worktree', 'remove', '--force', transaction.worktreeRoot]);
    } catch (error) {
      worktreeRemovalError = error;
      try {
        await this.git(transaction.projectRoot, ['worktree', 'prune']);
      } catch {
        // Continue local cleanup; original error is preserved below.
      }
    }

    try {
      await this.git(transaction.projectRoot, ['branch', '-D', transaction.branch]);
    } catch {
      // The branch may already be gone.
    }
    await rm(transaction.worktreeRoot, { recursive: true, force: true });
    this.transactions.delete(id);
    await this.persist();

    if (worktreeRemovalError && existsSync(transaction.worktreeRoot)) throw worktreeRemovalError;
  }

  async apply(id: string, message = 'ForgeGuard transaction'): Promise<ApplyResult> {
    const transaction = this.get(id);

    const currentHead = await this.git(transaction.projectRoot, ['rev-parse', 'HEAD']);
    if (currentHead !== transaction.baseHead) {
      throw new Error('Project HEAD changed after the transaction began; refusing to apply.');
    }
    const originalStatus = await this.git(transaction.projectRoot, ['status', '--porcelain']);
    if (originalStatus) {
      throw new Error('Project has local changes; refusing to apply transaction.');
    }

    const worktreeStatus = await this.git(transaction.worktreeRoot, ['status', '--porcelain']);
    if (!worktreeStatus) {
      await this.abort(id);
      return { transactionId: id, applied: false, noChanges: true };
    }

    await this.git(transaction.worktreeRoot, ['add', '--all']);
    await this.git(transaction.worktreeRoot, [
      '-c', 'user.name=ForgeGuard',
      '-c', 'user.email=forgeguard@localhost',
      'commit', '-m', message.slice(0, 200),
    ]);
    const commit = await this.git(transaction.worktreeRoot, ['rev-parse', 'HEAD']);

    try {
      await this.git(transaction.projectRoot, [
        '-c', 'user.name=ForgeGuard',
        '-c', 'user.email=forgeguard@localhost',
        'cherry-pick', commit,
      ]);
    } catch (error) {
      try {
        await this.git(transaction.projectRoot, ['cherry-pick', '--abort']);
      } catch {
        // Preserve the original cherry-pick failure.
      }
      throw error;
    }

    await this.git(transaction.projectRoot, ['worktree', 'remove', '--force', transaction.worktreeRoot]);
    try {
      await this.git(transaction.projectRoot, ['branch', '-D', transaction.branch]);
    } catch {
      // Cherry-pick succeeded; stale branch cleanup failure is non-fatal.
    }
    await rm(transaction.worktreeRoot, { recursive: true, force: true });
    this.transactions.delete(id);
    await this.persist();
    return { transactionId: id, applied: true, commit };
  }
}
