import { McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod/v4';
import { AuditLogger } from './audit/audit-logger.js';
import type { ForgeGuardConfig } from './config.js';
import {
  directoryTree,
  patchWorkspaceFile,
  readWorkspaceFile,
  searchWorkspaceText,
  writeWorkspaceFile,
} from './filesystem/workspace-files.js';
import { ProjectPolicyStore } from './policies/project-policy.js';
import { ProjectRegistry } from './projects/project-registry.js';
import { runStructuredProcess } from './terminal/process-executor.js';
import { TransactionManager } from './transactions/transaction-manager.js';

function text(value: unknown) {
  return { content: [{ type: 'text' as const, text: typeof value === 'string' ? value : JSON.stringify(value, null, 2) }] };
}

export function buildServer(config: ForgeGuardConfig): McpServer {
  const server = new McpServer({ name: 'forgeguard-mcp', version: '0.2.0-alpha.1' });
  const projects = new ProjectRegistry(config.allowedRoots, config.stateDir);
  const policies = new ProjectPolicyStore(config.stateDir);
  const audit = new AuditLogger(config.stateDir);
  const transactions = new TransactionManager(config.stateDir, config.maxOutputBytes);

  server.registerTool(
    'project_register',
    {
      description: 'Register and persist a project directory below a locally configured allowed root.',
      inputSchema: z.object({ root: z.string().min(1), name: z.string().min(1).optional() }),
    },
    async ({ root, name }) => text(await audit.run('project_register', { path: root }, () => projects.register(root, name))),
  );

  server.registerTool(
    'project_list',
    {
      description: 'List persistently registered project workspaces that remain inside configured allowed roots.',
      inputSchema: z.object({}),
    },
    async () => text(await audit.run('project_list', {}, async () => projects.list())),
  );

  server.registerTool(
    'project_info',
    {
      description: 'Get one registered project by id.',
      inputSchema: z.object({ projectId: z.string().uuid() }),
    },
    async ({ projectId }) => text(await audit.run('project_info', { projectId }, async () => projects.get(projectId))),
  );

  server.registerTool(
    'project_policy_get',
    {
      description: 'Get the effective fail-closed policy for a project. Policy files live outside the workspace in ForgeGuard state and may only narrow global permissions.',
      inputSchema: z.object({ projectId: z.string().uuid() }),
    },
    async ({ projectId }) => text(await audit.run('project_policy_get', { projectId }, async () => {
      projects.get(projectId);
      const policy = await policies.load(projectId, config.commandAllowlist);
      return { ...policy, policyFile: policies.policyPath(projectId) };
    })),
  );

  server.registerTool(
    'file_read',
    {
      description: 'Read a guarded UTF-8 file inside a registered workspace.',
      inputSchema: z.object({ projectId: z.string().uuid(), path: z.string().min(1) }),
    },
    async ({ projectId, path }) => text(await audit.run('file_read', { projectId, path }, async () => {
      const project = projects.get(projectId);
      await policies.assert(projectId, 'allowFileRead', config.commandAllowlist);
      return readWorkspaceFile(project.root, path);
    })),
  );

  server.registerTool(
    'file_write',
    {
      description: 'Create or replace one guarded UTF-8 file inside a registered workspace.',
      inputSchema: z.object({
        projectId: z.string().uuid(),
        path: z.string().min(1),
        content: z.string().max(5_000_000),
      }),
    },
    async ({ projectId, path, content }) => text(await audit.run('file_write', {
      projectId,
      path,
      contentBytes: Buffer.byteLength(content, 'utf8'),
    }, async () => {
      const project = projects.get(projectId);
      await policies.assert(projectId, 'allowFileWrite', config.commandAllowlist);
      return writeWorkspaceFile(project.root, path, content);
    })),
  );

  server.registerTool(
    'file_patch',
    {
      description: 'Replace exactly one matching text block in a guarded UTF-8 project file.',
      inputSchema: z.object({
        projectId: z.string().uuid(),
        path: z.string().min(1),
        oldText: z.string().min(1).max(1_000_000),
        newText: z.string().max(1_000_000),
      }),
    },
    async ({ projectId, path, oldText, newText }) => text(await audit.run('file_patch', {
      projectId,
      path,
      contentBytes: Buffer.byteLength(newText, 'utf8'),
    }, async () => {
      const project = projects.get(projectId);
      await policies.assert(projectId, 'allowFileWrite', config.commandAllowlist);
      return patchWorkspaceFile(project.root, path, oldText, newText);
    })),
  );

  server.registerTool(
    'directory_tree',
    {
      description: 'List a bounded guarded directory tree inside a registered workspace.',
      inputSchema: z.object({
        projectId: z.string().uuid(),
        path: z.string().default('.'),
        maxDepth: z.number().int().min(0).max(10).default(4),
      }),
    },
    async ({ projectId, path, maxDepth }) => text(await audit.run('directory_tree', { projectId, path }, async () => {
      const project = projects.get(projectId);
      await policies.assert(projectId, 'allowFileRead', config.commandAllowlist);
      return directoryTree(project.root, path, maxDepth);
    })),
  );

  server.registerTool(
    'code_search',
    {
      description: 'Search project text while hiding sensitive files and known secret patterns.',
      inputSchema: z.object({
        projectId: z.string().uuid(),
        query: z.string().min(1),
        maxResults: z.number().int().min(1).max(500).default(100),
      }),
    },
    async ({ projectId, query, maxResults }) => text(await audit.run('code_search', {
      projectId,
      queryLength: query.length,
    }, async () => {
      const project = projects.get(projectId);
      await policies.assert(projectId, 'allowFileRead', config.commandAllowlist);
      return searchWorkspaceText(project.root, query, maxResults);
    })),
  );

  server.registerTool(
    'git_status',
    {
      description: 'Run non-mutating git status in a registered project without invoking a shell.',
      inputSchema: z.object({ projectId: z.string().uuid() }),
    },
    async ({ projectId }) => text(await audit.run('git_status', { projectId }, async () => {
      const project = projects.get(projectId);
      await policies.assert(projectId, 'allowGitRead', config.commandAllowlist);
      return runStructuredProcess({
        workspaceRoot: project.root,
        command: 'git',
        args: ['status', '--short', '--branch'],
        allowlist: new Set(['git']),
        maxOutputBytes: config.maxOutputBytes,
      });
    })),
  );

  server.registerTool(
    'git_diff',
    {
      description: 'Run a non-mutating git diff in a registered project.',
      inputSchema: z.object({ projectId: z.string().uuid(), staged: z.boolean().default(false) }),
    },
    async ({ projectId, staged }) => text(await audit.run('git_diff', { projectId }, async () => {
      const project = projects.get(projectId);
      await policies.assert(projectId, 'allowGitRead', config.commandAllowlist);
      return runStructuredProcess({
        workspaceRoot: project.root,
        command: 'git',
        args: staged ? ['diff', '--cached', '--no-ext-diff'] : ['diff', '--no-ext-diff'],
        allowlist: new Set(['git']),
        maxOutputBytes: config.maxOutputBytes,
      });
    })),
  );

  server.registerTool(
    'process_run',
    {
      description: 'Run one globally and per-project allowlisted executable with argv directly and shell:false.',
      inputSchema: z.object({
        projectId: z.string().uuid(),
        command: z.string().min(1),
        args: z.array(z.string()).max(128).default([]),
        timeoutMs: z.number().int().min(1).max(300_000).default(30_000),
      }),
    },
    async ({ projectId, command, args, timeoutMs }) => text(await audit.run('process_run', {
      projectId,
      command,
      argsCount: args.length,
    }, async () => {
      const project = projects.get(projectId);
      const policy = await policies.assert(projectId, 'allowProcessRun', config.commandAllowlist);
      return runStructuredProcess({
        workspaceRoot: project.root,
        command,
        args,
        timeoutMs,
        allowlist: new Set(policy.effectiveCommands),
        maxOutputBytes: config.maxOutputBytes,
      });
    })),
  );

  server.registerTool(
    'transaction_begin',
    {
      description: 'Start an isolated Git worktree transaction. The original project must be clean.',
      inputSchema: z.object({ projectId: z.string().uuid() }),
    },
    async ({ projectId }) => text(await audit.run('transaction_begin', { projectId }, async () => {
      const project = projects.get(projectId);
      await policies.assert(projectId, 'allowGitRead', config.commandAllowlist);
      await policies.assert(projectId, 'allowFileWrite', config.commandAllowlist);
      return transactions.begin(project);
    })),
  );

  server.registerTool(
    'transaction_list',
    {
      description: 'List active isolated worktree transactions for this ForgeGuard process.',
      inputSchema: z.object({}),
    },
    async () => text(transactions.list()),
  );

  server.registerTool(
    'transaction_status',
    {
      description: 'Get git status for an active isolated transaction.',
      inputSchema: z.object({ transactionId: z.string().uuid() }),
    },
    async ({ transactionId }) => {
      const transaction = transactions.get(transactionId);
      return text(await audit.run('transaction_status', { transactionId, projectId: transaction.projectId }, async () => {
        await policies.assert(transaction.projectId, 'allowGitRead', config.commandAllowlist);
        return transactions.status(transactionId);
      }));
    },
  );

  server.registerTool(
    'transaction_diff',
    {
      description: 'Get the unstaged diff for an active isolated transaction.',
      inputSchema: z.object({ transactionId: z.string().uuid() }),
    },
    async ({ transactionId }) => {
      const transaction = transactions.get(transactionId);
      return text(await audit.run('transaction_diff', { transactionId, projectId: transaction.projectId }, async () => {
        await policies.assert(transaction.projectId, 'allowGitRead', config.commandAllowlist);
        return transactions.diff(transactionId);
      }));
    },
  );

  server.registerTool(
    'transaction_file_read',
    {
      description: 'Read a guarded file from an isolated transaction worktree.',
      inputSchema: z.object({ transactionId: z.string().uuid(), path: z.string().min(1) }),
    },
    async ({ transactionId, path }) => {
      const transaction = transactions.get(transactionId);
      return text(await audit.run('transaction_file_read', { transactionId, projectId: transaction.projectId, path }, async () => {
        await policies.assert(transaction.projectId, 'allowFileRead', config.commandAllowlist);
        return readWorkspaceFile(transaction.worktreeRoot, path);
      }));
    },
  );

  server.registerTool(
    'transaction_file_write',
    {
      description: 'Write a guarded file only inside an isolated transaction worktree.',
      inputSchema: z.object({
        transactionId: z.string().uuid(),
        path: z.string().min(1),
        content: z.string().max(5_000_000),
      }),
    },
    async ({ transactionId, path, content }) => {
      const transaction = transactions.get(transactionId);
      return text(await audit.run('transaction_file_write', {
        transactionId,
        projectId: transaction.projectId,
        path,
        contentBytes: Buffer.byteLength(content, 'utf8'),
      }, async () => {
        await policies.assert(transaction.projectId, 'allowFileWrite', config.commandAllowlist);
        return writeWorkspaceFile(transaction.worktreeRoot, path, content);
      }));
    },
  );

  server.registerTool(
    'transaction_file_patch',
    {
      description: 'Apply one exact guarded patch only inside an isolated transaction worktree.',
      inputSchema: z.object({
        transactionId: z.string().uuid(),
        path: z.string().min(1),
        oldText: z.string().min(1).max(1_000_000),
        newText: z.string().max(1_000_000),
      }),
    },
    async ({ transactionId, path, oldText, newText }) => {
      const transaction = transactions.get(transactionId);
      return text(await audit.run('transaction_file_patch', {
        transactionId,
        projectId: transaction.projectId,
        path,
        contentBytes: Buffer.byteLength(newText, 'utf8'),
      }, async () => {
        await policies.assert(transaction.projectId, 'allowFileWrite', config.commandAllowlist);
        return patchWorkspaceFile(transaction.worktreeRoot, path, oldText, newText);
      }));
    },
  );

  server.registerTool(
    'transaction_process_run',
    {
      description: 'Run a globally and per-project allowlisted command inside an isolated transaction worktree.',
      inputSchema: z.object({
        transactionId: z.string().uuid(),
        command: z.string().min(1),
        args: z.array(z.string()).max(128).default([]),
        timeoutMs: z.number().int().min(1).max(300_000).default(30_000),
      }),
    },
    async ({ transactionId, command, args, timeoutMs }) => {
      const transaction = transactions.get(transactionId);
      return text(await audit.run('transaction_process_run', {
        transactionId,
        projectId: transaction.projectId,
        command,
        argsCount: args.length,
      }, async () => {
        const policy = await policies.assert(transaction.projectId, 'allowProcessRun', config.commandAllowlist);
        return runStructuredProcess({
          workspaceRoot: transaction.worktreeRoot,
          command,
          args,
          timeoutMs,
          allowlist: new Set(policy.effectiveCommands),
          maxOutputBytes: config.maxOutputBytes,
        });
      }));
    },
  );

  server.registerTool(
    'transaction_apply',
    {
      description: 'Commit transaction changes and cherry-pick them into the unchanged clean original project. Refuses stale or dirty originals.',
      inputSchema: z.object({
        transactionId: z.string().uuid(),
        message: z.string().min(1).max(200).default('ForgeGuard transaction'),
      }),
    },
    async ({ transactionId, message }) => {
      const transaction = transactions.get(transactionId);
      return text(await audit.run('transaction_apply', { transactionId, projectId: transaction.projectId }, async () => {
        await policies.assert(transaction.projectId, 'allowFileWrite', config.commandAllowlist);
        await policies.assert(transaction.projectId, 'allowGitRead', config.commandAllowlist);
        return transactions.apply(transactionId, message);
      }));
    },
  );

  server.registerTool(
    'transaction_abort',
    {
      description: 'Discard an active transaction and remove its isolated Git worktree. Cleanup is always allowed for a known transaction.',
      inputSchema: z.object({ transactionId: z.string().uuid() }),
    },
    async ({ transactionId }) => {
      const transaction = transactions.get(transactionId);
      return text(await audit.run('transaction_abort', { transactionId, projectId: transaction.projectId }, async () => {
        await transactions.abort(transactionId);
        return { transactionId, aborted: true };
      }));
    },
  );

  server.registerTool(
    'audit_recent',
    {
      description: 'Read recent local ForgeGuard audit events. File contents and command arguments are never stored in the audit log.',
      inputSchema: z.object({ limit: z.number().int().min(1).max(500).default(50) }),
    },
    async ({ limit }) => text(await audit.recent(limit)),
  );

  return server;
}
