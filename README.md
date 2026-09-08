# ForgeGuard MCP

ForgeGuard MCP is an open-source, local-first Model Context Protocol server for controlled AI access to software projects.

The project focuses on workspace-scoped access, structured command execution, Git-aware inspection, fail-closed security defaults, and auditability.

> Status: early development — v0.1 bootstrap.

## Goals

- Free and open source
- Local-first: no mandatory cloud backend
- Explicitly registered project workspaces
- Workspace-bound filesystem access
- No raw shell by default
- Structured command execution with `shell: false`
- Git status/diff tools
- Secret-aware file access
- Fail-closed policy decisions
- Portable MCP interface for multiple clients

## Planned v0.1 tools

- `project_register`
- `project_list`
- `project_info`
- `file_read`
- `directory_tree`
- `code_search`
- `git_status`
- `git_diff`
- `process_run`

## Security model

ForgeGuard is designed to reduce the risk of giving an AI agent direct, unrestricted terminal and filesystem access. Application-level policy is not a complete OS sandbox, so process/container isolation is planned as a subsequent milestone.

## Development

Requires Node.js 20+.

```bash
npm install
npm run build
npm test
npm start
```

## License

Apache License 2.0.
