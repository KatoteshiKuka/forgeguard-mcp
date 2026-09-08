# ForgeGuard MCP

ForgeGuard MCP is an open-source, local-first Model Context Protocol (MCP) server for controlled AI access to software projects.

It is designed for coding agents that need to inspect, modify, test, and reason about projects without receiving unrestricted access to the entire machine.

> Status: early development — `0.2.0-alpha.1`.

## What v0.2 already does

- persistently register project workspaces only below explicitly allowed roots
- read, atomically write, and exactly patch guarded UTF-8 files
- list bounded directory trees and search project text
- block common sensitive files such as `.env`, private keys, PEM/key files, and credentials files
- redact several common token/private-key patterns before returning content
- reject lexical traversal and symlink escapes
- run `git status` and `git diff` without a shell
- optionally run explicitly allowlisted executables with `shell: false`
- apply per-project policies stored outside project workspaces
- maintain a structured local JSONL audit log without file bodies or command arguments
- start isolated Git worktree transactions
- edit, inspect, test, apply, or abort transaction changes without touching the original until apply
- refuse transaction apply when the original repository has moved or become dirty

## Security defaults

ForgeGuard is intentionally fail-closed.

Important environment variables:

- `FORGEGUARD_ALLOWED_ROOTS`: directories below which projects may be registered. Missing means `project_register` is denied.
- `FORGEGUARD_COMMANDS`: comma-separated executables permitted through generic process tools. Empty by default.
- `FORGEGUARD_STATE_DIR`: persistent ForgeGuard state directory. Defaults to `~/.forgeguard`.
- `FORGEGUARD_MAX_OUTPUT_BYTES`: maximum captured process output. Defaults to 1 MiB.

Generic process execution is disabled until the local user explicitly enables commands.

ForgeGuard v0.2 is **not an operating-system sandbox**. An explicitly permitted executable or repository script can still access OS resources outside the workspace. Git worktree transactions isolate repository changes, not operating-system capabilities.

See [`SECURITY.md`](SECURITY.md) for the current security boundary.

## Requirements

- Node.js 20+
- npm
- Git for Git tools and transactions

## Install

```bash
git clone https://github.com/KatoteshiKuka/forgeguard-mcp.git
cd forgeguard-mcp
npm install
npm run build
```

## Configure allowed project roots

### macOS / Linux

```bash
export FORGEGUARD_ALLOWED_ROOTS="$HOME/Projects"
npm start
```

Multiple roots use the operating-system path delimiter:

```bash
export FORGEGUARD_ALLOWED_ROOTS="$HOME/Projects:$HOME/Work"
```

### Windows PowerShell

```powershell
$env:FORGEGUARD_ALLOWED_ROOTS = "C:\Users\you\Projects"
npm start
```

Multiple Windows roots are separated with `;`.

## Optional command execution

`process_run` and `transaction_process_run` have no allowed commands by default.

```bash
export FORGEGUARD_COMMANDS="npm,flutter,dart"
```

Commands are spawned as an executable plus argv with `shell: false`. Shell chaining/substitution syntax is not interpreted by ForgeGuard itself.

## Persistent state

By default ForgeGuard stores local state under:

```text
~/.forgeguard/
├── projects.json
├── audit.jsonl
├── policies/
└── worktrees/
```

Override it with:

```bash
export FORGEGUARD_STATE_DIR="$HOME/.local/share/forgeguard"
```

## Per-project policy

After registering a project, call `project_policy_get` to see its project id, effective policy, and policy file path.

A policy file can look like:

```json
{
  "allowFileRead": true,
  "allowFileWrite": true,
  "allowGitRead": true,
  "allowProcessRun": true,
  "allowedCommands": ["npm", "flutter"]
}
```

`allowedCommands` can only narrow the global `FORGEGUARD_COMMANDS` set. It cannot grant additional executables.

Malformed policy JSON fails closed for protected operations.

## MCP client configuration

After `npm run build`, configure an MCP client to launch the compiled server over stdio.

```json
{
  "mcpServers": {
    "forgeguard": {
      "command": "node",
      "args": ["/absolute/path/to/forgeguard-mcp/dist/index.js"],
      "env": {
        "FORGEGUARD_ALLOWED_ROOTS": "/Users/you/Projects",
        "FORGEGUARD_COMMANDS": "npm,flutter,dart"
      }
    }
  }
}
```

Adapt the surrounding configuration format to the MCP client you use.

## Current MCP tools

### Projects

- `project_register`
- `project_list`
- `project_info`
- `project_policy_get`

### Filesystem

- `file_read`
- `file_write`
- `file_patch`
- `directory_tree`
- `code_search`

### Git

- `git_status`
- `git_diff`

### Processes

- `process_run`

### Transactions

- `transaction_begin`
- `transaction_list`
- `transaction_status`
- `transaction_diff`
- `transaction_file_read`
- `transaction_file_write`
- `transaction_file_patch`
- `transaction_process_run`
- `transaction_apply`
- `transaction_abort`

### Audit

- `audit_recent`

## Recommended agent workflow

```text
project_register
      ↓
transaction_begin
      ↓
inspect / edit / patch inside transaction
      ↓
transaction_process_run (tests / analysis, if explicitly allowed)
      ↓
transaction_diff
      ↓
transaction_apply
      │
      └── refuses if original repo changed or became dirty
```

Use `transaction_abort` whenever the work should be discarded.

## Development

```bash
npm install
npm run build
npm test
```

The suite covers path traversal, symlink escape, sensitive-file handling, atomic writes, project persistence, per-project policy narrowing, audit metadata, real Git worktree apply/abort, and real MCP stdio integration with server restart.

GitHub Actions runs build and tests on Node.js 20 and 22.

## Roadmap

### Next

- persistent active transaction recovery after server restart
- named command profiles (`test`, `analyze`, `build`) instead of relying only on executable allowlists
- test gates that can be attached to `transaction_apply`
- richer transaction diff summaries
- project task/context state

### Later

- OS/container process sandboxing
- remote device agent
- multi-machine support
- task handoff between ChatGPT, Codex, and other MCP clients
- project context compiler / code graph

## License

Apache License 2.0. See [`LICENSE`](LICENSE).
