import { randomUUID } from 'node:crypto';
import { mkdir, rm } from 'node:fs/promises';
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

export class TransactionManager {
  private readonly transactions = new Map<string, TransactionRecord>();
  private readonly worktreesDir: string;

  constructor(
    stateDir: string,
    private readonly maxOutputBytes: number,
  ) {
    this.worktreesDir = path.join(stateDir, 'worktrees');
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
    try {
      await this.git(transaction.projectRoot, ['worktree', 'remove', '--force', transaction.worktreeRoot]);
    } finally {
      try {
        await this.git(transaction.projectRoot, ['branch', '-D', transaction.branch]);
      } catch {
        // The branch may already be gone; worktree cleanup is the primary operation.
      }
      await rm(transaction.worktreeRoot, { recursive: true, force: true });
      this.transactions.delete(id);
    }
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
    return { transactionId: id, applied: true, commit };
  }
}
