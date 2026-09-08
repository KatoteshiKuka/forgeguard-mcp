import { chmod, readdir, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { resolveExistingWorkspacePath, resolveWorkspaceWritePath } from '../security/path-guard.js';
import { assertNonSecretPath, redactKnownSecrets } from '../security/secret-guard.js';

const DEFAULT_IGNORES = new Set(['.git', 'node_modules', 'dist', 'build', '.dart_tool', '.idea', '.vscode']);

async function atomicWriteUtf8(target: string, content: string): Promise<void> {
  const temporary = path.join(path.dirname(target), `.forgeguard-${randomUUID()}.tmp`);
  let existingMode: number | undefined;
  try {
    existingMode = (await stat(target)).mode;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }

  try {
    await writeFile(temporary, content, { encoding: 'utf8', flag: 'wx', mode: existingMode ?? 0o600 });
    if (existingMode !== undefined) await chmod(temporary, existingMode);
    await rename(temporary, target);
  } catch (error) {
    try {
      await unlink(temporary);
    } catch {
      // Best-effort cleanup of the temporary file.
    }
    throw error;
  }
}

export async function readWorkspaceFile(root: string, requestedPath: string): Promise<string> {
  assertNonSecretPath(requestedPath);
  const target = await resolveExistingWorkspacePath(root, requestedPath);
  const info = await stat(target);
  if (!info.isFile()) throw new Error(`Not a file: ${requestedPath}`);
  return redactKnownSecrets(await readFile(target, 'utf8'));
}

export async function writeWorkspaceFile(
  root: string,
  requestedPath: string,
  content: string,
): Promise<{ path: string; bytes: number }> {
  assertNonSecretPath(requestedPath);
  const target = await resolveWorkspaceWritePath(root, requestedPath);
  await atomicWriteUtf8(target, content);
  return { path: path.relative(root, target), bytes: Buffer.byteLength(content, 'utf8') };
}

export async function patchWorkspaceFile(
  root: string,
  requestedPath: string,
  oldText: string,
  newText: string,
): Promise<{ path: string; replacements: number }> {
  if (!oldText) throw new Error('oldText cannot be empty.');
  assertNonSecretPath(requestedPath);
  const target = await resolveWorkspaceWritePath(root, requestedPath);
  const current = await readFile(target, 'utf8');

  const first = current.indexOf(oldText);
  if (first < 0) throw new Error('Exact patch target was not found.');
  if (current.indexOf(oldText, first + oldText.length) >= 0) {
    throw new Error('Exact patch target is ambiguous because it appears more than once.');
  }

  const updated = current.slice(0, first) + newText + current.slice(first + oldText.length);
  await atomicWriteUtf8(target, updated);
  return { path: path.relative(root, target), replacements: 1 };
}

export async function directoryTree(
  root: string,
  requestedPath = '.',
  maxDepth = 4,
): Promise<string[]> {
  const start = await resolveExistingWorkspacePath(root, requestedPath);
  const results: string[] = [];

  async function walk(current: string, depth: number): Promise<void> {
    if (depth > maxDepth) return;
    const entries = await readdir(current, { withFileTypes: true });
    entries.sort((a, b) => a.name.localeCompare(b.name));

    for (const entry of entries) {
      if (DEFAULT_IGNORES.has(entry.name) || entry.name.startsWith('.forgeguard-') && entry.name.endsWith('.tmp')) continue;
      const absolute = path.join(current, entry.name);
      const relative = path.relative(root, absolute) || '.';
      try {
        assertNonSecretPath(relative);
      } catch {
        continue;
      }
      results.push(entry.isDirectory() ? `${relative}/` : relative);
      if (entry.isDirectory() && !entry.isSymbolicLink()) {
        await walk(absolute, depth + 1);
      }
    }
  }

  await walk(start, 0);
  return results;
}

export async function searchWorkspaceText(
  root: string,
  query: string,
  maxResults = 100,
): Promise<Array<{ path: string; line: number; text: string }>> {
  if (!query) throw new Error('Search query cannot be empty.');
  const results: Array<{ path: string; line: number; text: string }> = [];

  async function walk(current: string): Promise<void> {
    if (results.length >= maxResults) return;
    const entries = await readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      if (results.length >= maxResults || DEFAULT_IGNORES.has(entry.name)) continue;
      if (entry.name.startsWith('.forgeguard-') && entry.name.endsWith('.tmp')) continue;
      const absolute = path.join(current, entry.name);
      const relative = path.relative(root, absolute);
      try {
        assertNonSecretPath(relative);
      } catch {
        continue;
      }

      if (entry.isDirectory() && !entry.isSymbolicLink()) {
        await walk(absolute);
      } else if (entry.isFile()) {
        let fileText: string;
        try {
          fileText = await readFile(absolute, 'utf8');
        } catch {
          continue;
        }
        const lines = fileText.split(/\r?\n/);
        for (let index = 0; index < lines.length && results.length < maxResults; index += 1) {
          const lineText = lines[index] ?? '';
          if (lineText.includes(query)) {
            results.push({ path: relative, line: index + 1, text: redactKnownSecrets(lineText) });
          }
        }
      }
    }
  }

  await walk(root);
  return results;
}
