import { randomUUID } from 'node:crypto';
import { mkdir, rename, writeFile } from 'node:fs/promises';
import { existsSync, readFileSync, realpathSync, statSync } from 'node:fs';
import path from 'node:path';
import { assertUnderAllowedRoots } from '../security/path-guard.js';

export interface ProjectRecord {
  id: string;
  name: string;
  root: string;
}

function isInside(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function isUuid(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

export class ProjectRegistry {
  private readonly projects = new Map<string, ProjectRecord>();
  private readonly registryPath: string;

  constructor(
    private readonly allowedRoots: readonly string[],
    private readonly stateDir: string,
  ) {
    this.registryPath = path.join(stateDir, 'projects.json');
    this.loadExisting();
  }

  private loadExisting(): void {
    if (!existsSync(this.registryPath)) return;

    let parsed: unknown;
    try {
      parsed = JSON.parse(readFileSync(this.registryPath, 'utf8')) as unknown;
    } catch {
      // Corrupt persistent state must not grant access. Start empty and require re-registration.
      return;
    }
    if (!Array.isArray(parsed)) return;

    const canonicalAllowedRoots: string[] = [];
    for (const root of this.allowedRoots) {
      try {
        const resolved = realpathSync(path.resolve(root));
        if (statSync(resolved).isDirectory()) canonicalAllowedRoots.push(resolved);
      } catch {
        // Invalid configured roots are ignored here; new registration still fails closed.
      }
    }

    for (const value of parsed) {
      if (!value || typeof value !== 'object' || Array.isArray(value)) continue;
      const candidate = value as Record<string, unknown>;
      if (!isUuid(candidate.id) || typeof candidate.name !== 'string' || typeof candidate.root !== 'string') continue;
      try {
        const root = realpathSync(path.resolve(candidate.root));
        if (!statSync(root).isDirectory()) continue;
        if (!canonicalAllowedRoots.some((allowedRoot) => isInside(allowedRoot, root))) continue;
        this.projects.set(candidate.id, { id: candidate.id, name: candidate.name, root });
      } catch {
        continue;
      }
    }
  }

  private async persist(): Promise<void> {
    await mkdir(this.stateDir, { recursive: true, mode: 0o700 });
    const temporary = `${this.registryPath}.${process.pid}.tmp`;
    const content = `${JSON.stringify(this.list(), null, 2)}\n`;
    await writeFile(temporary, content, { encoding: 'utf8', mode: 0o600 });
    await rename(temporary, this.registryPath);
  }

  async register(root: string, name?: string): Promise<ProjectRecord> {
    const canonicalRoot = await assertUnderAllowedRoots(root, this.allowedRoots);
    const existing = [...this.projects.values()].find((project) => project.root === canonicalRoot);
    if (existing) return existing;

    const record: ProjectRecord = {
      id: randomUUID(),
      name: name?.trim() || path.basename(canonicalRoot),
      root: canonicalRoot,
    };
    this.projects.set(record.id, record);
    await this.persist();
    return record;
  }

  list(): ProjectRecord[] {
    return [...this.projects.values()].sort((a, b) => a.name.localeCompare(b.name));
  }

  get(id: string): ProjectRecord {
    const project = this.projects.get(id);
    if (!project) throw new Error(`Unknown project id: ${id}`);
    return project;
  }
}
