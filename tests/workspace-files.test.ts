import { mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { patchWorkspaceFile, readWorkspaceFile, writeWorkspaceFile } from '../src/filesystem/workspace-files.js';

const created: string[] = [];

afterEach(async () => {
  await Promise.all(created.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function temp(prefix: string): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), prefix));
  created.push(dir);
  return dir;
}

describe('workspace file operations', () => {
  it('writes and reads a file inside the workspace', async () => {
    const root = await temp('forgeguard-files-');
    await writeWorkspaceFile(root, 'hello.txt', 'hello world');
    await expect(readWorkspaceFile(root, 'hello.txt')).resolves.toBe('hello world');
  });

  it('patches exactly one matching block', async () => {
    const root = await temp('forgeguard-files-');
    await writeFile(path.join(root, 'app.ts'), 'const mode = "old";\n');
    await patchWorkspaceFile(root, 'app.ts', '"old"', '"new"');
    await expect(readFile(path.join(root, 'app.ts'), 'utf8')).resolves.toContain('"new"');
  });

  it('rejects ambiguous patches', async () => {
    const root = await temp('forgeguard-files-');
    await writeFile(path.join(root, 'app.ts'), 'old old');
    await expect(patchWorkspaceFile(root, 'app.ts', 'old', 'new')).rejects.toThrow(/ambiguous/);
  });

  it('blocks sensitive file reads', async () => {
    const root = await temp('forgeguard-files-');
    await writeFile(path.join(root, '.env'), 'TOKEN=secret');
    await expect(readWorkspaceFile(root, '.env')).rejects.toThrow(/sensitive file/);
  });

  it('redacts known secret patterns in normal source files', async () => {
    const root = await temp('forgeguard-files-');
    await writeFile(path.join(root, 'config.txt'), 'token=sk-abcdefghijklmnopqrstuvwxyz123456');
    const content = await readWorkspaceFile(root, 'config.txt');
    expect(content).toContain('[REDACTED_API_KEY]');
    expect(content).not.toContain('sk-abcdefghijklmnopqrstuvwxyz123456');
  });

  it('refuses to write through a symlink', async () => {
    const root = await temp('forgeguard-files-');
    const outside = await temp('forgeguard-outside-');
    const outsideFile = path.join(outside, 'target.txt');
    await writeFile(outsideFile, 'outside');
    await symlink(outsideFile, path.join(root, 'link.txt'));
    await expect(writeWorkspaceFile(root, 'link.txt', 'changed')).rejects.toThrow(/symlink/);
    await expect(readFile(outsideFile, 'utf8')).resolves.toBe('outside');
  });
});
