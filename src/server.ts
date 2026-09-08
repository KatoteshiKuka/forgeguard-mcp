import { McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod/v4';
import type { ForgeGuardConfig } from './config.js';
import { directoryTree, readWorkspaceFile, searchWorkspaceText } from './filesystem/workspace-files.js';
import { ProjectRegistry } from './projects/project-registry.js';
import { runStructuredProcess } from './terminal/process-executor.js';

function text(value: unknown) {
  return { content: [{ type: 'text' as const, text: typeof value === 'string' ? value : JSON.stringify(value, null, 2) }] };
}

export function buildServer(config: ForgeGuardConfig): McpServer {
  const server = new McpServer({ name: 'forgeguard-mcp', version: '0.1.0-alpha.1' });
  const projects = new ProjectRegistry(config.allowedRoots);

  server.registerTool(
    'project_register',
    {
      description: 'Register a project directory. The directory must be inside a locally configured allowed root.',
      inputSchema: z.object({ root: z.string().min(1), name: z.string().min(1).optional() }),
    },
    async ({ root, name }) => text(await projects.register(root, name)),
  );

  server.registerTool(
    'project_list',
    {
      description: 'List project workspaces registered for this ForgeGuard process.',
      inputSchema: z.object({}),
    },
    async () => text(projects.list()),
  );

  server.registerTool(
    'project_info',
    {
      description: 'Get one registered project by id.',
      inputSchema: z.object({ projectId: z.string().uuid() }),
    },
    async ({ projectId }) => text(projects.get(projectId)),
  );

  server.registerTool(
    'file_read',
    {
      description: 'Read a UTF-8 file inside a registered workspace. Path traversal and symlink escapes are rejected.',
      inputSchema: z.object({ projectId: z.string().uuid(), path: z.string().min(1) }),
    },
    async ({ projectId, path }) => {
      const project = projects.get(projectId);
      return text(await readWorkspaceFile(project.root, path));
    },
  );

  server.registerTool(
    'directory_tree',
    {
      description: 'List a bounded directory tree inside a registered workspace.',
      inputSchema: z.object({
        projectId: z.string().uuid(),
        path: z.string().default('.'),
        maxDepth: z.number().int().min(0).max(10).default(4),
      }),
    },
    async ({ projectId, path, maxDepth }) => {
      const project = projects.get(projectId);
      return text(await directoryTree(project.root, path, maxDepth));
    },
  );

  server.registerTool(
    'code_search',
    {
      description: 'Search UTF-8 project files for an exact text fragment, ignoring common generated/vendor directories.',
      inputSchema: z.object({
        projectId: z.string().uuid(),
        query: z.string().min(1),
        maxResults: z.number().int().min(1).max(500).default(100),
      }),
    },
    async ({ projectId, query, maxResults }) => {
      const project = projects.get(projectId);
      return text(await searchWorkspaceText(project.root, query, maxResults));
    },
  );

  server.registerTool(
    'git_status',
    {
      description: 'Run git status --short inside a registered project without invoking a shell.',
      inputSchema: z.object({ projectId: z.string().uuid() }),
    },
    async ({ projectId }) => {
      const project = projects.get(projectId);
      return text(await runStructuredProcess({
        workspaceRoot: project.root,
        command: 'git',
        args: ['status', '--short', '--branch'],
        allowlist: new Set(['git']),
        maxOutputBytes: config.maxOutputBytes,
      }));
    },
  );

  server.registerTool(
    'git_diff',
    {
      description: 'Run a non-mutating git diff inside a registered project.',
      inputSchema: z.object({ projectId: z.string().uuid(), staged: z.boolean().default(false) }),
    },
    async ({ projectId, staged }) => {
      const project = projects.get(projectId);
      return text(await runStructuredProcess({
        workspaceRoot: project.root,
        command: 'git',
        args: staged ? ['diff', '--cached', '--no-ext-diff'] : ['diff', '--no-ext-diff'],
        allowlist: new Set(['git']),
        maxOutputBytes: config.maxOutputBytes,
      }));
    },
  );

  server.registerTool(
    'process_run',
    {
      description: 'Run one allowlisted executable in a project workspace using argv directly (no shell).',
      inputSchema: z.object({
        projectId: z.string().uuid(),
        command: z.string().min(1),
        args: z.array(z.string()).max(128).default([]),
        timeoutMs: z.number().int().min(1).max(300_000).default(30_000),
      }),
    },
    async ({ projectId, command, args, timeoutMs }) => {
      const project = projects.get(projectId);
      return text(await runStructuredProcess({
        workspaceRoot: project.root,
        command,
        args,
        timeoutMs,
        allowlist: config.commandAllowlist,
        maxOutputBytes: config.maxOutputBytes,
      }));
    },
  );

  return server;
}
