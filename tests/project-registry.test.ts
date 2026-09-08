import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ProjectRegistry } from '../src/projects/project-registry.js';

const created: string[] = [];

afterEach(async () => {
  await Promise.all(created.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('ProjectRegistry persistence', () => {
  it('restores registered projects across registry instances', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'forgeguard-registry-'));
    created.push(root);
    const allowedRoot = path.join(root, 'projects');
    const stateDir = path.join(root, 'state');
    const projectRoot = path.join(allowedRoot, 'demo');
    await mkdir(projectRoot, { recursive: true });

    const first = new ProjectRegistry([allowedRoot], stateDir);
    const registered = await first.register(projectRoot, 'demo');

    const second = new ProjectRegistry([allowedRoot], stateDir);
    expect(second.get(registered.id)).toEqual(registered);
    expect(second.list()).toEqual([registered]);
  });

  it('fails closed by ignoring corrupt persistent registry data', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'forgeguard-registry-'));
    created.push(root);
    const allowedRoot = path.join(root, 'projects');
    const stateDir = path.join(root, 'state');
    await mkdir(allowedRoot, { recursive: true });
    await mkdir(stateDir, { recursive: true });
    await writeFile(path.join(stateDir, 'projects.json'), '{not-json', 'utf8');

    const registry = new ProjectRegistry([allowedRoot], stateDir);
    expect(registry.list()).toEqual([]);
  });
});
