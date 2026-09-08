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

describe('transaction apply gates over MCP', () => {
  it('blocks apply on a failing gate and applies after the mandatory gate passes', async () => {
    const temp = await mkdtemp(path.join(os.tmpdir(), 'forgeguard-gates-'));
    created.push(temp);
    const allowedRoot = path.join(temp, 'projects');
    const projectRoot = path.join(allowedRoot, 'repo');
    const stateDir = path.join(temp, 'state');
    await mkdir(projectRoot, { recursive: true });
    await git(projectRoot, ['init', '-b', 'main']);
    await writeFile(path.join(projectRoot, 'hello.txt'), 'original\n', 'utf8');
    await git(projectRoot, ['add', 'hello.txt']);
    await git(projectRoot, ['-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '-m', 'initial']);

    const client = new Client({ name: 'forgeguard-gate-test', version: '1.0.0' });
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: ['dist/index.js'],
      env: {
        PATH: process.env.PATH ?? '',
        FORGEGUARD_ALLOWED_ROOTS: allowedRoot,
        FORGEGUARD_STATE_DIR: stateDir,
        FORGEGUARD_COMMANDS: 'node',
      },
    });

    try {
      await client.connect(transport);
      const registered = await client.callTool({
        name: 'project_register',
        arguments: { root: projectRoot, name: 'gated-project' },
      });
      const project = JSON.parse(firstText(registered)) as { id: string };
      const policyDir = path.join(stateDir, 'policies');
      await mkdir(policyDir, { recursive: true });
      const policyPath = path.join(policyDir, `${project.id}.json`);

      await writeFile(policyPath, JSON.stringify({
        allowedCommands: ['node'],
        applyGates: [{ command: 'node', args: ['-e', 'process.exit(7)'] }],
      }), 'utf8');

      const begun = await client.callTool({ name: 'transaction_begin', arguments: { projectId: project.id } });
      const transaction = JSON.parse(firstText(begun)) as { id: string };
      await client.callTool({
        name: 'transaction_file_write',
        arguments: { transactionId: transaction.id, path: 'hello.txt', content: 'changed\n' },
      });

      const failedApply = await client.callTool({
        name: 'transaction_apply',
        arguments: { transactionId: transaction.id, message: 'should be gated' },
      });
      expect(failedApply.isError).toBe(true);
      expect(await readFile(path.join(projectRoot, 'hello.txt'), 'utf8')).toBe('original\n');

      await writeFile(policyPath, JSON.stringify({
        allowedCommands: ['node'],
        applyGates: [{ command: 'node', args: ['-e', 'process.exit(0)'] }],
      }), 'utf8');

      const applied = await client.callTool({
        name: 'transaction_apply',
        arguments: { transactionId: transaction.id, message: 'gate passed' },
      });
      expect(applied.isError).not.toBe(true);
      expect(firstText(applied)).toContain('"applied": true');
      expect(await readFile(path.join(projectRoot, 'hello.txt'), 'utf8')).toBe('changed\n');
    } finally {
      await client.close();
    }
  }, 40_000);
});
