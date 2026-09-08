import type { McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod/v4';
import { AuditLogger } from '../audit/audit-logger.js';
import type { ForgeGuardConfig } from '../config.js';
import { ProjectRegistry } from '../projects/project-registry.js';
import { ProjectBrainStore, type TaskStatus } from './project-brain.js';

function text(value: unknown) {
  return { content: [{ type: 'text' as const, text: typeof value === 'string' ? value : JSON.stringify(value, null, 2) }] };
}

const taskStatusSchema = z.enum(['todo', 'in_progress', 'blocked', 'done']);

export function registerBrainTools(server: McpServer, config: ForgeGuardConfig): void {
  const brain = new ProjectBrainStore(config.stateDir);
  const audit = new AuditLogger(config.stateDir);

  const project = (projectId: string) => {
    const registry = new ProjectRegistry(config.allowedRoots, config.stateDir);
    return registry.get(projectId);
  };

  server.registerTool(
    'project_context_get',
    {
      description: 'Get persistent project context, tasks, and decisions stored outside the source workspace.',
      inputSchema: z.object({ projectId: z.string().uuid() }),
    },
    async ({ projectId }) => text(await audit.run('project_context_get', { projectId }, async () => {
      project(projectId);
      return brain.get(projectId);
    })),
  );

  server.registerTool(
    'project_context_set',
    {
      description: 'Replace the persistent high-level context for a registered project.',
      inputSchema: z.object({ projectId: z.string().uuid(), context: z.string().max(100_000) }),
    },
    async ({ projectId, context }) => text(await audit.run('project_context_set', { projectId, contentBytes: Buffer.byteLength(context, 'utf8') }, async () => {
      project(projectId);
      return brain.setContext(projectId, context);
    })),
  );

  server.registerTool(
    'task_create',
    {
      description: 'Create a persistent project task that can be resumed by another agent session.',
      inputSchema: z.object({
        projectId: z.string().uuid(),
        title: z.string().min(1).max(300),
        description: z.string().max(20_000).optional(),
        status: taskStatusSchema.optional(),
      }),
    },
    async ({ projectId, title, description, status }) => text(await audit.run('task_create', { projectId }, async () => {
      project(projectId);
      const input: { title: string; description?: string; status?: TaskStatus } = { title };
      if (description !== undefined) input.description = description;
      if (status !== undefined) input.status = status;
      return brain.createTask(projectId, input);
    })),
  );

  server.registerTool(
    'task_list',
    {
      description: 'List persistent tasks for a registered project, optionally filtered by status.',
      inputSchema: z.object({ projectId: z.string().uuid(), status: taskStatusSchema.optional() }),
    },
    async ({ projectId, status }) => text(await audit.run('task_list', { projectId }, async () => {
      project(projectId);
      return brain.listTasks(projectId, status);
    })),
  );

  server.registerTool(
    'task_get',
    {
      description: 'Get one persistent project task.',
      inputSchema: z.object({ projectId: z.string().uuid(), taskId: z.string().uuid() }),
    },
    async ({ projectId, taskId }) => text(await audit.run('task_get', { projectId }, async () => {
      project(projectId);
      return brain.getTask(projectId, taskId);
    })),
  );

  server.registerTool(
    'task_update',
    {
      description: 'Update a persistent task and optionally append one progress note.',
      inputSchema: z.object({
        projectId: z.string().uuid(),
        taskId: z.string().uuid(),
        title: z.string().min(1).max(300).optional(),
        description: z.string().max(20_000).optional(),
        status: taskStatusSchema.optional(),
        addNote: z.string().max(10_000).optional(),
      }),
    },
    async ({ projectId, taskId, title, description, status, addNote }) => text(await audit.run('task_update', { projectId }, async () => {
      project(projectId);
      const patch: { title?: string; description?: string; status?: TaskStatus; addNote?: string } = {};
      if (title !== undefined) patch.title = title;
      if (description !== undefined) patch.description = description;
      if (status !== undefined) patch.status = status;
      if (addNote !== undefined) patch.addNote = addNote;
      return brain.updateTask(projectId, taskId, patch);
    })),
  );

  server.registerTool(
    'task_resume',
    {
      description: 'Return a compact persistent handoff bundle for resuming a task in a new AI session.',
      inputSchema: z.object({ projectId: z.string().uuid(), taskId: z.string().uuid() }),
    },
    async ({ projectId, taskId }) => text(await audit.run('task_resume', { projectId }, async () => {
      const registeredProject = project(projectId);
      const [data, task] = await Promise.all([brain.get(projectId), brain.getTask(projectId, taskId)]);
      return {
        project: registeredProject,
        task,
        context: data.context,
        recentDecisions: [...data.decisions].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 20),
        otherOpenTasks: data.tasks
          .filter((candidate) => candidate.id !== taskId && candidate.status !== 'done')
          .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
          .slice(0, 20),
      };
    })),
  );

  server.registerTool(
    'decision_add',
    {
      description: 'Persist an architectural or project decision for future agent sessions.',
      inputSchema: z.object({
        projectId: z.string().uuid(),
        summary: z.string().min(1).max(2_000),
        rationale: z.string().max(20_000).optional(),
      }),
    },
    async ({ projectId, summary, rationale }) => text(await audit.run('decision_add', { projectId }, async () => {
      project(projectId);
      return brain.addDecision(projectId, summary, rationale ?? '');
    })),
  );

  server.registerTool(
    'decision_list',
    {
      description: 'List persistent project decisions newest first.',
      inputSchema: z.object({ projectId: z.string().uuid() }),
    },
    async ({ projectId }) => text(await audit.run('decision_list', { projectId }, async () => {
      project(projectId);
      return brain.listDecisions(projectId);
    })),
  );
}
