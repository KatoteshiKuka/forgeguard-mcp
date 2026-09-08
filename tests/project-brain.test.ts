import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ProjectBrainStore } from '../src/brain/project-brain.js';

const created: string[] = [];

afterEach(async () => {
  await Promise.all(created.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('ProjectBrainStore', () => {
  it('persists context tasks decisions and task progress across instances', async () => {
    const stateDir = await mkdtemp(path.join(os.tmpdir(), 'forgeguard-brain-'));
    created.push(stateDir);
    const projectId = '55555555-5555-4555-8555-555555555555';
    const first = new ProjectBrainStore(stateDir);

    await first.setContext(projectId, 'Flutter application using Supabase.');
    const task = await first.createTask(projectId, {
      title: 'Implement login',
      description: 'Add Google OAuth',
      status: 'in_progress',
    });
    await first.updateTask(projectId, task.id, { addNote: 'Android callback complete.' });
    await first.addDecision(projectId, 'Use custom scheme callback', 'Required for native OAuth return.');

    const second = new ProjectBrainStore(stateDir);
    const data = await second.get(projectId);
    expect(data.context).toContain('Supabase');
    expect(data.tasks).toHaveLength(1);
    expect(data.tasks[0]?.notes).toEqual(['Android callback complete.']);
    expect(data.decisions).toHaveLength(1);
    expect((await second.getTask(projectId, task.id)).title).toBe('Implement login');
  });

  it('serializes concurrent mutations for one project without losing tasks', async () => {
    const stateDir = await mkdtemp(path.join(os.tmpdir(), 'forgeguard-brain-'));
    created.push(stateDir);
    const projectId = '66666666-6666-4666-8666-666666666666';
    const brain = new ProjectBrainStore(stateDir);

    await Promise.all(Array.from({ length: 20 }, (_, index) => brain.createTask(projectId, {
      title: `Task ${index}`,
    })));

    const tasks = await brain.listTasks(projectId);
    expect(tasks).toHaveLength(20);
    expect(new Set(tasks.map((task) => task.title)).size).toBe(20);
  });
});
