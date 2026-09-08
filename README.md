# ForgeGuard MCP

ForgeGuard MCP is an open-source, local-first Model Context Protocol (MCP) server for controlled AI access to software projects.

It is designed for coding agents that need to inspect and modify project files without receiving unrestricted access to the entire machine.

> Status: early development — `0.1.0-alpha.1`.

## What it already does

- register project workspaces only below explicitly allowed roots
- list registered projects
- read UTF-8 files
- create/replace UTF-8 files
- apply exact, unambiguous text patches
- list bounded directory trees
- search text across project files
- run `git status` and `git diff` without a shell
- optionally run explicitly allowlisted commands with `shell: false`
- block common sensitive files such as `.env`, private keys, PEM/key files, and credentials files
- redact several common token/private-key formats before returning file content
- reject lexical path traversal and symlink escapes
- cap process output and execution time

## Security defaults

ForgeGuard is intentionally fail-closed.

Two important environment variables control access:

- `FORGEGUARD_ALLOWED_ROOTS`: directories below which projects may be registered. If it is missing, `project_register` is denied.
- `FORGEGUARD_COMMANDS`: comma-separated executables permitted through the generic `process_run` tool. It is empty by default.

Generic process execution is therefore disabled until the local user explicitly enables commands.

ForgeGuard v0.1 is **not an operating-system sandbox**. An explicitly permitted executable or repository script may still access resources outside the workspace through OS APIs or absolute paths. Do not enable generic process execution for untrusted repositories. Stronger process isolation is planned for a later milestone.

See [`SECURITY.md`](SECURITY.md) for the current security boundary.

## Requirements

- Node.js 20+
- npm
- Git for the Git-specific tools

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

Multiple roots use the operating system path delimiter:

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

`process_run` has no allowed commands by default. To explicitly allow selected executables:

```bash
export FORGEGUARD_COMMANDS="npm,flutter,dart"
```

Commands are spawned directly as an executable plus argv with `shell: false`. This prevents shell chaining/substitution syntax from being interpreted by ForgeGuard itself, but it does not turn the child process into an OS sandbox.

## MCP client configuration

After `npm run build`, configure an MCP client to launch the compiled server over stdio.

Example shape:

```json
{
  "mcpServers": {
    "forgeguard": {
      "command": "node",
      "args": ["/absolute/path/to/forgeguard-mcp/dist/index.js"],
      "env": {
        "FORGEGUARD_ALLOWED_ROOTS": "/Users/you/Projects"
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

## Development

```bash
npm install
npm run build
npm test
```

The test suite includes path traversal, symlink escape, sensitive-file, write/patch, and real MCP stdio integration tests.

GitHub Actions runs build and tests on Node.js 20 and 22.

## Roadmap

### v0.2

- persistent project registry
- structured audit log
- configurable per-project policy files
- safer command profiles instead of generic executable-only allowlists
- atomic file edits and richer diff output

### v0.3

- Git worktree transactions
- automatic checkpoint / rollback
- test gates before accepting AI changes
- task state and project context

### Later

- OS/container process sandboxing
- remote device agent
- multi-machine support
- task handoff between ChatGPT, Codex, and other MCP clients
- project context compiler / code graph

## License

Apache License 2.0. See [`LICENSE`](LICENSE).
