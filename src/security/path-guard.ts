import { realpath, stat } from 'node:fs/promises';
import path from 'node:path';

export class SecurityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SecurityError';
  }
}

function isInside(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

export async function canonicalDirectory(input: string): Promise<string> {
  const resolved = path.resolve(input);
  const info = await stat(resolved);
  if (!info.isDirectory()) {
    throw new SecurityError(`Not a directory: ${input}`);
  }
  return realpath(resolved);
}

export async function assertUnderAllowedRoots(
  candidateDirectory: string,
  allowedRoots: readonly string[],
): Promise<string> {
  if (allowedRoots.length === 0) {
    throw new SecurityError('No allowed roots configured. Set FORGEGUARD_ALLOWED_ROOTS.');
  }

  const candidate = await canonicalDirectory(candidateDirectory);
  for (const configuredRoot of allowedRoots) {
    const root = await canonicalDirectory(configuredRoot);
    if (isInside(root, candidate)) {
      return candidate;
    }
  }

  throw new SecurityError(`Directory is outside all configured allowed roots: ${candidate}`);
}

export async function resolveExistingWorkspacePath(
  workspaceRoot: string,
  requestedPath: string,
): Promise<string> {
  const canonicalRoot = await canonicalDirectory(workspaceRoot);
  const lexicalCandidate = path.resolve(canonicalRoot, requestedPath);

  if (!isInside(canonicalRoot, lexicalCandidate)) {
    throw new SecurityError(`Path escapes workspace: ${requestedPath}`);
  }

  const canonicalCandidate = await realpath(lexicalCandidate);
  if (!isInside(canonicalRoot, canonicalCandidate)) {
    throw new SecurityError(`Resolved path escapes workspace through a symlink: ${requestedPath}`);
  }

  return canonicalCandidate;
}
