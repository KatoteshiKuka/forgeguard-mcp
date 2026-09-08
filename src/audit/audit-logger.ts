import { mkdir, appendFile, readFile } from 'node:fs/promises';
import path from 'node:path';

export interface AuditEvent {
  timestamp: string;
  tool: string;
  success: boolean;
  durationMs: number;
  projectId?: string;
  transactionId?: string;
  path?: string;
  command?: string;
  argsCount?: number;
  contentBytes?: number;
  queryLength?: number;
  error?: string;
}

export class AuditLogger {
  private readonly filePath: string;

  constructor(private readonly stateDir: string) {
    this.filePath = path.join(stateDir, 'audit.jsonl');
  }

  private async ensureDirectory(): Promise<void> {
    await mkdir(this.stateDir, { recursive: true, mode: 0o700 });
  }

  async record(event: AuditEvent): Promise<void> {
    await this.ensureDirectory();
    await appendFile(this.filePath, `${JSON.stringify(event)}\n`, { encoding: 'utf8', mode: 0o600 });
  }

  async run<T>(
    tool: string,
    metadata: Omit<AuditEvent, 'timestamp' | 'tool' | 'success' | 'durationMs' | 'error'>,
    operation: () => Promise<T>,
  ): Promise<T> {
    const started = Date.now();
    try {
      const result = await operation();
      await this.record({
        timestamp: new Date().toISOString(),
        tool,
        success: true,
        durationMs: Date.now() - started,
        ...metadata,
      });
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      try {
        await this.record({
          timestamp: new Date().toISOString(),
          tool,
          success: false,
          durationMs: Date.now() - started,
          ...metadata,
          error: message.slice(0, 500),
        });
      } catch {
        // Never hide the original tool error because audit persistence failed.
      }
      throw error;
    }
  }

  async recent(limit = 50): Promise<AuditEvent[]> {
    const bounded = Math.min(Math.max(limit, 1), 500);
    try {
      const text = await readFile(this.filePath, 'utf8');
      return text
        .split(/\r?\n/)
        .filter(Boolean)
        .slice(-bounded)
        .map((line) => JSON.parse(line) as AuditEvent);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === 'ENOENT') return [];
      throw error;
    }
  }
}
