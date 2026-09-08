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

describe('ForgeGuard MCP stdio integration', () => {
  it('connects, registers a project, writes a file, and reads it back', async () => {
    const allowedRoot = await mkdtemp(path.join(os.tmpdir(), 'forgeguard-e2e-'));
    created.push(allowedRoot);
    const projectRoot = path.join(allowedRoot, 'project');
    await mkdir(projectRoot);

    const env: Record<string, string> = {
      PATH: process.env.PATH ?? '',
      FORGEGUARD_ALLOWED_ROOTS: allowedRoot,
    };

    const client = new Client({ name: 'forgeguard-test-client', version: '1.0.0' });
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: ['dist/index.js'],
      env,
    });

    try {
      await client.connect(transport);

      const tools = await client.listTools();
      const names = tools.tools.map((tool) => tool.name);
      expect(names).toContain('project_register');
      expect(names).toContain('file_write');
      expect(names).toContain('file_read');

      const registered = await client.callTool({
        name: 'project_register',
        arguments: { root: projectRoot, name: 'integration-project' },
      });
      const project = JSON.parse(firstText(registered)) as { id: string };
      expect(project.id).toMatch(/^[0-9a-f-]{36}$/i);

      const writeResult = await client.callTool({
        name: 'file_write',
        arguments: { projectId: project.id, path: 'hello.txt', content: 'hello through MCP' },
      });
      expect(firstText(writeResult)).toContain('hello.txt');

      const readResult = await client.callTool({
        name: 'file_read',
        arguments: { projectId: project.id, path: 'hello.txt' },
      });
      expect(firstText(readResult)).toBe('hello through MCP');
      await expect(readFile(path.join(projectRoot, 'hello.txt'), 'utf8')).resolves.toBe('hello through MCP');
    } finally {
      await client.close();
    }
  }, 20_000);
});
