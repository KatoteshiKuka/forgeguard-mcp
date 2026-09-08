import { mkdtemp, mkdir, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { rm } from 'node:fs/promises';
import { assertUnderAllowedRoots, resolveExistingWorkspacePath } from '../src/security/path-guard.js';

const created: string[] = [];

afterEach(async () => {
  await Promise.all(created.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function temp(prefix: string): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), prefix));
  created.push(dir);
  return dir;
}

describe('path guard', () => {
  it('allows a project below an allowed root', async () => {
    const root = await temp('forgeguard-root-');
    const project = path.join(root, 'project');
    await mkdir(project);
    await expect(assertUnderAllowedRoots(project, [root])).resolves.toBe(project);
  });

  it('fails closed when no allowed roots are configured', async () => {
    const project = await temp('forgeguard-project-');
    await expect(assertUnderAllowedRoots(project, [])).rejects.toThrow(/No allowed roots configured/);
  });

  it('rejects lexical path traversal outside the workspace', async () => {
    const root = await temp('forgeguard-workspace-');
    const outside = await temp('forgeguard-outside-');
    await writeFile(path.join(outside, 'secret.txt'), 'secret');
    const escape = path.relative(root, path.join(outside, 'secret.txt'));
    await expect(resolveExistingWorkspacePath(root, escape)).rejects.toThrow(/escapes workspace/);
  });

  it('rejects symlinks resolving outside the workspace', async () => {
    const root = await temp('forgeguard-workspace-');
    const outside = await temp('forgeguard-outside-');
    const secret = path.join(outside, 'secret.txt');
    await writeFile(secret, 'secret');
    await symlink(secret, path.join(root, 'link.txt'));
    await expect(resolveExistingWorkspacePath(root, 'link.txt')).rejects.toThrow(/symlink/);
  });
});
