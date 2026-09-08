import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';

export type TaskStatus = 'todo' | 'in_progress' | 'blocked' | 'done';

export interface ProjectTask {
  id: string;
  title: string;
  description: string;
  status: TaskStatus;
  notes: string[];
  createdAt: string;
  updatedAt: string;
}

export interface ProjectDecision {
  id: string;
  summary: string;
  rationale: string;
  createdAt: string;
}

export interface ProjectBrainData {
  context: string;
  tasks: ProjectTask[];
  decisions: ProjectDecision[];
  updatedAt: string;
}

const EMPTY_BRAIN: ProjectBrainData = {
  context: '',
  tasks: [],
  decisions: [],
  updatedAt: '',
};

function isTaskStatus(value: unknown): value is TaskStatus {
  return value === 'todo' || value === 'in_progress' || value === 'blocked' || value === 'done';
}

function parseBrain(value: unknown): ProjectBrainData {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Project brain state must be a JSON object.');
  const input = value as Record<string, unknown>;
  if (typeof input.context !== 'string' || !Array.isArray(input.tasks) || !Array.isArray(input.decisions)) {
    throw new Error('Project brain state is malformed.');
  }

  const tasks: ProjectTask[] = input.tasks.map((raw) => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Project task state is malformed.');
    const task = raw as Record<string, unknown>;
    if (
      typeof task.id !== 'string' ||
      typeof task.title !== 'string' ||
      typeof task.description !== 'string' ||
      !isTaskStatus(task.status) ||
      !Array.isArray(task.notes) || task.notes.some((note) => typeof note !== 'string') ||
      typeof task.createdAt !== 'string' ||
      typeof task.updatedAt !== 'string'
    ) throw new Error('Project task state is malformed.');
    return {
      id: task.id,
      title: task.title,
      description: task.description,
      status: task.status,
      notes: [...task.notes] as string[],
      createdAt: task.createdAt,
      updatedAt: task.updatedAt,
    };
  });

  const decisions: ProjectDecision[] = input.decisions.map((raw) => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Project decision state is malformed.');
    const decision = raw as Record<string, unknown>;
    if (
      typeof decision.id !== 'string' ||
      typeof decision.summary !== 'string' ||
      typeof decision.rationale !== 'string' ||
      typeof decision.createdAt !== 'string'
    ) throw new Error('Project decision state is malformed.');
    return {
      id: decision.id,
      summary: decision.summary,
      rationale: decision.rationale,
      createdAt: decision.createdAt,
    };
  });

  return {
    context: input.context,
    tasks,
    decisions,
    updatedAt: typeof input.updatedAt === 'string' ? input.updatedAt : '',
  };
}

export class ProjectBrainStore {
  private readonly brainDir: string;
  private readonly mutationQueues = new Map<string, Promise<void>>();

  constructor(stateDir: string) {
    this.brainDir = path.join(stateDir, 'brain');
  }

  private brainPath(projectId: string): string {
    return path.join(this.brainDir, `${projectId}.json`);
  }

  private async load(projectId: string): Promise<ProjectBrainData> {
    try {
      const raw = await readFile(this.brainPath(projectId), 'utf8');
      return parseBrain(JSON.parse(raw) as unknown);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { ...EMPTY_BRAIN, tasks: [], decisions: [] };
      if (error instanceof SyntaxError) throw new Error('Project brain state contains invalid JSON.');
      throw error;
    }
  }

  private async save(projectId: string, data: ProjectBrainData): Promise<void> {
    await mkdir(this.brainDir, { recursive: true, mode: 0o700 });
    const target = this.brainPath(projectId);
    const temporary = `${target}.${process.pid}.${randomUUID()}.tmp`;
    await writeFile(temporary, `${JSON.stringify(data, null, 2)}\n`, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
    await rename(temporary, target);
  }

  private async mutate<T>(projectId: string, operation: (data: ProjectBrainData) => T | Promise<T>): Promise<T> {
    const previous = this.mutationQueues.get(projectId) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolve) => { release = resolve; });
    const queued = previous.then(() => current);
    this.mutationQueues.set(projectId, queued);
    await previous;
    try {
      const data = await this.load(projectId);
      const result = await operation(data);
      data.updatedAt = new Date().toISOString();
      await this.save(projectId, data);
      return result;
    } finally {
      release();
      if (this.mutationQueues.get(projectId) === queued) this.mutationQueues.delete(projectId);
    }
  }

  async get(projectId: string): Promise<ProjectBrainData> {
    return this.load(projectId);
  }

  async setContext(projectId: string, context: string): Promise<ProjectBrainData> {
    return this.mutate(projectId, (data) => {
      data.context = context;
      return data;
    });
  }

  async createTask(projectId: string, input: { title: string; description?: string; status?: TaskStatus }): Promise<ProjectTask> {
    return this.mutate(projectId, (data) => {
      const now = new Date().toISOString();
      const task: ProjectTask = {
        id: randomUUID(),
        title: input.title.trim(),
        description: input.description?.trim() ?? '',
        status: input.status ?? 'todo',
        notes: [],
        createdAt: now,
        updatedAt: now,
      };
      data.tasks.push(task);
      return task;
    });
  }

  async listTasks(projectId: string, status?: TaskStatus): Promise<ProjectTask[]> {
    const data = await this.load(projectId);
    return data.tasks
      .filter((task) => !status || task.status === status)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async getTask(projectId: string, taskId: string): Promise<ProjectTask> {
    const data = await this.load(projectId);
    const task = data.tasks.find((candidate) => candidate.id === taskId);
    if (!task) throw new Error(`Unknown task id: ${taskId}`);
    return task;
  }

  async updateTask(projectId: string, taskId: string, patch: {
    title?: string;
    description?: string;
    status?: TaskStatus;
    addNote?: string;
  }): Promise<ProjectTask> {
    return this.mutate(projectId, (data) => {
      const task = data.tasks.find((candidate) => candidate.id === taskId);
      if (!task) throw new Error(`Unknown task id: ${taskId}`);
      if (patch.title !== undefined) task.title = patch.title.trim();
      if (patch.description !== undefined) task.description = patch.description.trim();
      if (patch.status !== undefined) task.status = patch.status;
      if (patch.addNote !== undefined && patch.addNote.trim()) task.notes.push(patch.addNote.trim());
      task.updatedAt = new Date().toISOString();
      return task;
    });
  }

  async addDecision(projectId: string, summary: string, rationale = ''): Promise<ProjectDecision> {
    return this.mutate(projectId, (data) => {
      const decision: ProjectDecision = {
        id: randomUUID(),
        summary: summary.trim(),
        rationale: rationale.trim(),
        createdAt: new Date().toISOString(),
      };
      data.decisions.push(decision);
      return decision;
    });
  }

  async listDecisions(projectId: string): Promise<ProjectDecision[]> {
    const data = await this.load(projectId);
    return [...data.decisions].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
}
