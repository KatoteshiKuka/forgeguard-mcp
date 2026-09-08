# Security Policy

ForgeGuard MCP is security-sensitive software. Please report vulnerabilities responsibly.

## Supported status

The project is currently pre-release (`0.2.x-alpha`). Security behavior may still change between commits.

## Current security boundaries

ForgeGuard currently enforces application-level controls including:

- explicit allowed project roots via `FORGEGUARD_ALLOWED_ROOTS`
- canonical path checks using `realpath`
- traversal rejection
- symlink escape rejection for reads and writes
- sensitive-file blocking for common secret/key files
- redaction of several known secret/token formats
- atomic UTF-8 file writes and patches
- structured process execution with `shell: false`
- generic process execution disabled by default
- per-project policy files stored outside project workspaces
- policy command lists that may only narrow the global command allowlist
- output limits and process timeouts
- reduced child-process environment
- local JSONL audit events that do not store file bodies or command arguments
- Git worktree transactions that isolate changes before application
- transaction apply refusal when the original worktree is dirty or has moved from the transaction base commit

## ForgeGuard state directory

Persistent state defaults to `~/.forgeguard` and can be moved with `FORGEGUARD_STATE_DIR`.

It contains data such as:

- `projects.json` — persistent registered workspace metadata
- `audit.jsonl` — structured local audit events
- `policies/<project-id>.json` — local per-project policies
- `worktrees/` — temporary Git transaction worktrees

The state directory is intentionally outside project workspaces so ordinary file tools cannot directly edit policy or registry state.

## Per-project policies

A missing policy uses ForgeGuard's safe defaults. A malformed policy fails closed for policy-protected operations instead of silently expanding access.

Project policy files can disable file reads, file writes, Git reads, and generic process execution. `allowedCommands` is intersected with the global `FORGEGUARD_COMMANDS` allowlist, so a project policy cannot grant a command that the local administrator did not globally enable.

## Transaction safety

`transaction_begin` requires a clean Git worktree. Changes are made in a separate Git worktree and branch under the ForgeGuard state directory.

`transaction_apply` verifies that:

1. the original project is still at the exact commit from which the transaction began;
2. the original project has no local modifications;
3. transaction changes can be committed before they are cherry-picked into the original.

If the original moved or became dirty, ForgeGuard refuses to apply rather than guessing how to merge concurrent work.

## Important limitation

ForgeGuard v0.2 is **not an operating-system sandbox**. If the local administrator explicitly allows an executable or project script, that process may still access resources outside the workspace through operating-system APIs, absolute paths, subprocesses, or network access available to that process.

`transaction_process_run` has the same limitation: a Git worktree isolates repository changes, not operating-system capabilities.

Do not enable generic process execution for untrusted repositories. Stronger OS/container sandboxing remains a planned milestone.

## Reporting a vulnerability

Please do not publish a working exploit in a public issue before maintainers have had an opportunity to assess it. Use GitHub's private vulnerability reporting feature when enabled for this repository, or contact the maintainer privately.

When reporting, include:

- affected version/commit
- operating system
- minimal reproduction
- expected security boundary
- observed behavior
- potential impact

## Security design principle

Unknown, malformed, stale, or missing security configuration should fail closed rather than silently expand access.
