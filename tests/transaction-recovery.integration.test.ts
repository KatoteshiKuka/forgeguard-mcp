import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { afterEach, describe, expect, it } from 'vitest';

const execFileAsync = promisify(execFile);
const created: string[] = [];

afterEach(async () => {
  await Promise.all(created.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

function firstText(result: { content?: unknown }): string {
  if (!Array.isArray(result.content)) throw new Error('MCP result has no content array.');
  const item = result.content[0] as { type?: unknown; text?: unknown } | undefined;
  if (!item || item.type !== 'text' || typeof item.text !== 'string') throw new Error('Expected text MCP result.');
  return item.text;
}

async function git(cwd: string, args: string[]): Promise<void> {
  await execFileAsync('git', args, { cwd });
}

function connectable(allowedRoot: string, stateDir: string): { client: Client; transport: StdioClientTransport } {
  const client = new Client({ name: 'forgeguard-recovery-test', version: '1.0.0' });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ['dist/index.js'],
    env: {
      PATH: process.env.PATH ?? '',
      FORGEGUARD_ALLOWED_ROOTS: allowedRoot,
      FORGEGUARD_STATE_DIR: stateDir,
    },
  });
  return { client, transport };
}

describe('transaction recovery over MCP', () => {
  it('recovers an active worktree after server restart and safely applies it', async () => {
    const temp = await mkdtemp(path.join(os.tmpdir(), 'forgeguard-recovery-'));
    created.push(temp);
    const allowedRoot = path.join(temp, 'projects');
    const projectRoot = path.join(allowedRoot, 'repo');
    const stateDir = path.join(temp, 'state');
    await mkdir(projectRoot, { recursive: true });
    await git(projectRoot, ['init', '-b', 'main']);
    await writeFile(path.join(projectRoot, 'hello.txt'), 'original\n', 'utf8');
    await git(projectRoot, ['add', 'hello.txt']);
    await git(projectRoot, ['-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '-m', 'initial']);

    let transactionId = '';
    const first = connectable(allowedRoot, stateDir);
    try {
      await first.client.connect(first.transport);
      const registered = await first.client.callTool({
        name: 'project_register',
        arguments: { root: projectRoot, name: 'recoverable-project' },
      });
      const projectId = (JSON.parse(firstText(registered)) as { id: string }).id;
      const begun = await first.client.callTool({
        name: 'transaction_begin',
        arguments: { projectId },
      });
      transactionId = (JSON.parse(firstText(begun)) as { id: string }).id;
      await first.client.callTool({
        name: 'transaction_file_write',
        arguments: { transactionId, path: 'hello.txt', content: 'recovered change\n' },
      });
      expect(await readFile(path.join(projectRoot, 'hello.txt'), 'utf8')).toBe('original\n');
    } finally {
      await first.client.close();
    }

    const second = connectable(allowedRoot, stateDir);
    try {
      await second.client.connect(second.transport);
      const listed = await second.client.callTool({ name: 'transaction_list', arguments: {} });
      const transactions = JSON.parse(firstText(listed)) as Array<{ id: string }>;
      expect(transactions.some((transaction) => transaction.id === transactionId)).toBe(true);

      const diff = await second.client.callTool({
        name: 'transaction_diff',
        arguments: { transactionId },
      });
      expect(firstText(diff)).toContain('recovered change');

      const applied = await second.client.callTool({
        name: 'transaction_apply',
        arguments: { transactionId, message: 'recover after restart' },
      });
      expect(applied.isError).not.toBe(true);
      expect(firstText(applied)).toContain('"applied": true');
      expect(await readFile(path.join(projectRoot, 'hello.txt'), 'utf8')).toBe('recovered change\n');

      const after = await second.client.callTool({ name: 'transaction_list', arguments: {} });
      expect(JSON.parse(firstText(after))).toEqual([]);
    } finally {
      await second.client.close();
    }
  }, 45_000);
});
