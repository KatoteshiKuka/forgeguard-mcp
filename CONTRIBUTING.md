# Contributing to ForgeGuard MCP

Thanks for helping improve ForgeGuard MCP.

## Development setup

```bash
git clone https://github.com/KatoteshiKuka/forgeguard-mcp.git
cd forgeguard-mcp
npm install
npm run build
npm test
```

## Pull requests

Keep changes focused and include tests for behavior changes. Security-sensitive changes should include regression tests covering the expected boundary.

Before opening a pull request, run:

```bash
npm run build
npm test
```

## Security-sensitive code

Changes involving paths, symlinks, process execution, environment variables, secret handling, or Git operations require extra care. Prefer fail-closed behavior and explicit allowlists over implicit access.

Do not weaken a security boundary merely to make a workflow more convenient without documenting the tradeoff.

## Issues

Bug reports should include operating system, Node.js version, reproduction steps, expected behavior, and observed behavior.

Feature requests should explain the user workflow and the security implications when relevant.

## Vulnerabilities

Do not publish working security exploits as ordinary public issues. Follow `SECURITY.md` for vulnerability reporting guidance.

## License

By contributing, you agree that your contributions are licensed under the repository's Apache License 2.0.
