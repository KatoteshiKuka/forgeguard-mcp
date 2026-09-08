import { mkdir, mkdtemp, rm } from 'node:fs/promises';
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
  if (!item || item.type !== 'text' || typeof item.text !== 'string') throw new Error('Expected text MCP result.');
  return item.text;
}

function connectable(allowedRoot: string, stateDir: string): { client: Client; transport: StdioClientTransport } {
  const client = new Client({ name: 'forgeguard-brain-test', version: '1.0.0' });
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

describe('Project Brain MCP integration', () => {
  it('resumes a task with project context and decisions after ForgeGuard restarts', async () => {
    const temp = await mkdtemp(path.join(os.tmpdir(), 'forgeguard-brain-e2e-'));
    created.push(temp);
    const allowedRoot = path.join(temp, 'projects');
    const stateDir = path.join(temp, 'state');
    const projectRoot = path.join(allowedRoot, 'project');
    await mkdir(projectRoot, { recursive: true });

    let projectId = '';
    let taskId = '';
    const first = connectable(allowedRoot, stateDir);
    try {
      await first.client.connect(first.transport);
      const tools = await first.client.listTools();
      const names = tools.tools.map((tool) => tool.name);
      expect(names).toContain('task_create');
      expect(names).toContain('task_resume');
      expect(names).toContain('decision_add');

      const registered = await first.client.callTool({
        name: 'project_register',
        arguments: { root: projectRoot, name: 'brain-project' },
      });
      projectId = (JSON.parse(firstText(registered)) as { id: string }).id;

      await first.client.callTool({
        name: 'project_context_set',
        arguments: { projectId, context: 'Architecture: Flutter client, Supabase backend.' },
      });
      const task = await first.client.callTool({
        name: 'task_create',
        arguments: {
          projectId,
          title: 'Implement authentication',
          description: 'Finish native OAuth callback handling.',
          status: 'in_progress',
        },
      });
      taskId = (JSON.parse(firstText(task)) as { id: string }).id;
      await first.client.callTool({
        name: 'task_update',
        arguments: { projectId, taskId, addNote: 'Android path verified.' },
      });
      await first.client.callTool({
        name: 'decision_add',
        arguments: { projectId, summary: 'Use custom URL scheme', rationale: 'Needed for OAuth callback.' },
      });
    } finally {
      await first.client.close();
    }

    const second = connectable(allowedRoot, stateDir);
    try {
      await second.client.connect(second.transport);
      const resumed = await second.client.callTool({
        name: 'task_resume',
        arguments: { projectId, taskId },
      });
      const bundle = JSON.parse(firstText(resumed)) as {
        project: { name: string };
        task: { title: string; status: string; notes: string[] };
        context: string;
        recentDecisions: Array<{ summary: string }>;
      };

      expect(bundle.project.name).toBe('brain-project');
      expect(bundle.task.title).toBe('Implement authentication');
      expect(bundle.task.status).toBe('in_progress');
      expect(bundle.task.notes).toContain('Android path verified.');
      expect(bundle.context).toContain('Supabase');
      expect(bundle.recentDecisions[0]?.summary).toBe('Use custom URL scheme');
    } finally {
      await second.client.close();
    }
  }, 30_000);
});
