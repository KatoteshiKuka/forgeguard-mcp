import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { writeWorkspaceFile } from '../src/filesystem/workspace-files.js';
import type { ProjectRecord } from '../src/projects/project-registry.js';
import { TransactionManager } from '../src/transactions/transaction-manager.js';

const execFileAsync = promisify(execFile);
const created: string[] = [];

afterEach(async () => {
  await Promise.all(created.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function git(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync('git', args, { cwd });
  return stdout.trim();
}

async function createRepository(): Promise<{ root: string; stateDir: string; project: ProjectRecord }> {
  const temp = await mkdtemp(path.join(os.tmpdir(), 'forgeguard-tx-'));
  created.push(temp);
  const root = path.join(temp, 'repo');
  const stateDir = path.join(temp, 'state');
  await mkdir(root, { recursive: true });
  await git(root, ['init', '-b', 'main']);
  await writeFile(path.join(root, 'hello.txt'), 'original\n', 'utf8');
  await git(root, ['add', 'hello.txt']);
  await git(root, ['-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '-m', 'initial']);
  return {
    root,
    stateDir,
    project: {
      id: '44444444-4444-4444-8444-444444444444',
      name: 'transaction-test',
      root,
    },
  };
}

describe('TransactionManager', () => {
  it('keeps changes isolated until apply then cherry-picks them to the original', async () => {
    const { root, stateDir, project } = await createRepository();
    const manager = new TransactionManager(stateDir, 1_048_576);
    const beforeHead = await git(root, ['rev-parse', 'HEAD']);

    const transaction = await manager.begin(project);
    await writeWorkspaceFile(transaction.worktreeRoot, 'hello.txt', 'changed in transaction\n');

    expect(await readFile(path.join(root, 'hello.txt'), 'utf8')).toBe('original\n');
    expect(await manager.diff(transaction.id)).toContain('changed in transaction');

    const result = await manager.apply(transaction.id, 'apply transaction test');
    expect(result.applied).toBe(true);
    expect(await readFile(path.join(root, 'hello.txt'), 'utf8')).toBe('changed in transaction\n');
    expect(await git(root, ['rev-parse', 'HEAD'])).not.toBe(beforeHead);
    expect(manager.list()).toEqual([]);
  }, 30_000);

  it('discards worktree changes on abort without touching the original', async () => {
    const { root, stateDir, project } = await createRepository();
    const manager = new TransactionManager(stateDir, 1_048_576);
    const transaction = await manager.begin(project);
    await writeWorkspaceFile(transaction.worktreeRoot, 'hello.txt', 'discard me\n');

    await manager.abort(transaction.id);

    expect(await readFile(path.join(root, 'hello.txt'), 'utf8')).toBe('original\n');
    expect(manager.list()).toEqual([]);
  }, 30_000);
});
