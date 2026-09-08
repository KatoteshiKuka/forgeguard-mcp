# Project Brain

Project Brain gives ForgeGuard a small, explicit, local project memory that survives MCP client and server restarts.

It is intended for handoff between ChatGPT, Codex, IDE agents, and future ForgeGuard clients without depending on one conversation staying alive.

## Storage

Project Brain data is stored outside the source workspace:

```text
<FORGEGUARD_STATE_DIR>/brain/<project-id>.json
```

The file is written atomically and is not reachable through normal ForgeGuard workspace file tools unless the user separately registers the ForgeGuard state directory as a project root, which is not recommended.

## Data model

Each project brain contains:

- `context` — concise high-level project context;
- `tasks` — durable work items with status and progress notes;
- `decisions` — durable architectural/product decisions with optional rationale.

Task statuses are:

```text
todo
in_progress
blocked
done
```

## MCP tools

### Context

- `project_context_get`
- `project_context_set`

### Tasks

- `task_create`
- `task_list`
- `task_get`
- `task_update`
- `task_resume`

### Decisions

- `decision_add`
- `decision_list`

## Recommended handoff workflow

An agent can create a task:

```text
task_create
  title: Implement Google authentication
  status: in_progress
```

As work progresses it can append concise notes:

```text
task_update
  addNote: Android callback flow verified; iOS remains.
```

Important project choices should be persisted separately:

```text
decision_add
  summary: Use custom URL scheme for OAuth callback
  rationale: Required to return from the native browser flow.
```

A later session can call:

```text
task_resume
```

and receive a compact handoff bundle containing:

- registered project metadata;
- the requested task;
- current project context;
- recent project decisions;
- other open tasks.

This makes the handoff independent of a particular chat transcript.

## Concurrency

Mutations for the same project are serialized in-process so concurrent agent tool calls do not overwrite each other's task/decision changes. Persistent writes use a temporary file followed by rename.

## Privacy and audit

Task descriptions, notes, context, and decision text live in the local Project Brain file. ForgeGuard's audit log records the tool name and project metadata but does not copy these text bodies into `audit.jsonl`.

## What Project Brain is not

Project Brain is not an embedding database, automatic code index, or hidden long-term memory. It only stores information explicitly written through its tools.

A future context compiler may combine this explicit state with repository symbols, related files, Git changes, and tests to build a task-specific context bundle.
