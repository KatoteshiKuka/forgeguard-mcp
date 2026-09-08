import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { AuditLogger } from '../src/audit/audit-logger.js';
import { ProjectPolicyStore } from '../src/policies/project-policy.js';

const created: string[] = [];

afterEach(async () => {
  await Promise.all(created.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('ProjectPolicyStore', () => {
  it('can only narrow globally allowed commands', async () => {
    const stateDir = await mkdtemp(path.join(os.tmpdir(), 'forgeguard-policy-'));
    created.push(stateDir);
    const store = new ProjectPolicyStore(stateDir);
    const projectId = '11111111-1111-4111-8111-111111111111';
    await mkdir(path.dirname(store.policyPath(projectId)), { recursive: true });
    await writeFile(store.policyPath(projectId), JSON.stringify({
      allowFileWrite: false,
      allowedCommands: ['npm', 'python', 'not-global'],
    }), 'utf8');

    const policy = await store.load(projectId, new Set(['npm', 'node']));
    expect(policy.allowFileWrite).toBe(false);
    expect(policy.effectiveCommands).toEqual(['npm']);
  });

  it('fails closed on invalid policy JSON', async () => {
    const stateDir = await mkdtemp(path.join(os.tmpdir(), 'forgeguard-policy-'));
    created.push(stateDir);
    const store = new ProjectPolicyStore(stateDir);
    const projectId = '22222222-2222-4222-8222-222222222222';
    await mkdir(path.dirname(store.policyPath(projectId)), { recursive: true });
    await writeFile(store.policyPath(projectId), '{invalid', 'utf8');

    await expect(store.load(projectId, new Set())).rejects.toThrow('invalid JSON');
  });
});

describe('AuditLogger', () => {
  it('stores metadata without storing file content', async () => {
    const stateDir = await mkdtemp(path.join(os.tmpdir(), 'forgeguard-audit-'));
    created.push(stateDir);
    const audit = new AuditLogger(stateDir);
    const secretContent = 'SUPER_SECRET_CONTENT_SHOULD_NOT_APPEAR';

    await audit.run('file_write', {
      projectId: '33333333-3333-4333-8333-333333333333',
      path: 'src/example.ts',
      contentBytes: Buffer.byteLength(secretContent),
    }, async () => ({ ok: true }));

    const raw = await readFile(path.join(stateDir, 'audit.jsonl'), 'utf8');
    expect(raw).toContain('file_write');
    expect(raw).toContain('contentBytes');
    expect(raw).not.toContain(secretContent);
    expect((await audit.recent(10))).toHaveLength(1);
  });
});
