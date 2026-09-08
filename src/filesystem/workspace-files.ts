import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { resolveExistingWorkspacePath } from '../security/path-guard.js';

const DEFAULT_IGNORES = new Set(['.git', 'node_modules', 'dist', 'build', '.dart_tool', '.idea', '.vscode']);

export async function readWorkspaceFile(root: string, requestedPath: string): Promise<string> {
  const target = await resolveExistingWorkspacePath(root, requestedPath);
  const info = await stat(target);
  if (!info.isFile()) throw new Error(`Not a file: ${requestedPath}`);
  return readFile(target, 'utf8');
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
      if (DEFAULT_IGNORES.has(entry.name)) continue;
      const absolute = path.join(current, entry.name);
      const relative = path.relative(root, absolute) || '.';
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
      const absolute = path.join(current, entry.name);
      if (entry.isDirectory() && !entry.isSymbolicLink()) {
        await walk(absolute);
      } else if (entry.isFile()) {
        let text: string;
        try {
          text = await readFile(absolute, 'utf8');
        } catch {
          continue;
        }
        const lines = text.split(/\r?\n/);
        for (let index = 0; index < lines.length && results.length < maxResults; index += 1) {
          const lineText = lines[index] ?? '';
          if (lineText.includes(query)) {
            results.push({ path: path.relative(root, absolute), line: index + 1, text: lineText });
          }
        }
      }
    }
  }

  await walk(root);
  return results;
}
