import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { afterEach, describe, expect, it } from 'vitest';

const created: string[] = [];

afterEach(async () => {
  await Promise.all(created.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

function firstText(result: { content?: unknown }): string {
  if (!Array.isArray(result.content)) throw new Error('MCP result has no content array.');
  const item = result.content[0] as { type?: unknown; text?: unknown } | undefined;
  if (!item || item.type !== 'text' || typeof item.text !== 'string') {
    throw new Error('MCP result does not contain text content.');
  }
  return item.text;
}

function createClient(allowedRoot: string, stateDir: string): { client: Client; transport: StdioClientTransport } {
  const client = new Client({ name: 'forgeguard-test-client', version: '1.0.0' });
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

describe('ForgeGuard MCP stdio integration', () => {
  it('connects, writes through MCP, and restores project state after server restart', async () => {
    const temp = await mkdtemp(path.join(os.tmpdir(), 'forgeguard-e2e-'));
    created.push(temp);
    const allowedRoot = path.join(temp, 'projects');
    const stateDir = path.join(temp, 'state');
    const projectRoot = path.join(allowedRoot, 'project');
    await mkdir(projectRoot, { recursive: true });

    const first = createClient(allowedRoot, stateDir);
    let projectId: string;
    try {
      await first.client.connect(first.transport);

      const tools = await first.client.listTools();
      const names = tools.tools.map((tool) => tool.name);
      expect(names).toContain('project_register');
      expect(names).toContain('file_write');
      expect(names).toContain('transaction_begin');
      expect(names).toContain('audit_recent');

      const registered = await first.client.callTool({
        name: 'project_register',
        arguments: { root: projectRoot, name: 'integration-project' },
      });
      const project = JSON.parse(firstText(registered)) as { id: string };
      projectId = project.id;
      expect(projectId).toMatch(/^[0-9a-f-]{36}$/i);

      await first.client.callTool({
        name: 'file_write',
        arguments: { projectId, path: 'hello.txt', content: 'hello through MCP' },
      });
      const readResult = await first.client.callTool({
        name: 'file_read',
        arguments: { projectId, path: 'hello.txt' },
      });
      expect(firstText(readResult)).toBe('hello through MCP');
      await expect(readFile(path.join(projectRoot, 'hello.txt'), 'utf8')).resolves.toBe('hello through MCP');
    } finally {
      await first.client.close();
    }

    const second = createClient(allowedRoot, stateDir);
    try {
      await second.client.connect(second.transport);
      const listed = await second.client.callTool({ name: 'project_list', arguments: {} });
      const projects = JSON.parse(firstText(listed)) as Array<{ id: string; root: string }>;
      expect(projects.some((project) => project.id === projectId && project.root === projectRoot)).toBe(true);

      const audit = await second.client.callTool({ name: 'audit_recent', arguments: { limit: 20 } });
      expect(firstText(audit)).toContain('file_write');
      expect(firstText(audit)).not.toContain('hello through MCP');
    } finally {
      await second.client.close();
    }
  }, 30_000);
});
