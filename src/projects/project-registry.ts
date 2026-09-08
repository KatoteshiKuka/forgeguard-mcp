import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { assertUnderAllowedRoots } from '../security/path-guard.js';

export interface ProjectRecord {
  id: string;
  name: string;
  root: string;
}

export class ProjectRegistry {
  private readonly projects = new Map<string, ProjectRecord>();

  constructor(private readonly allowedRoots: readonly string[]) {}

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
