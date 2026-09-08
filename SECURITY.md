# Security Policy

ForgeGuard MCP is security-sensitive software. Please report vulnerabilities responsibly.

## Supported status

The project is currently pre-release (`0.1.x-alpha`). Security behavior may still change between commits.

## Current security boundaries

ForgeGuard currently enforces application-level controls including:

- explicit allowed project roots via `FORGEGUARD_ALLOWED_ROOTS`
- canonical path checks using `realpath`
- traversal rejection
- symlink escape rejection for reads and writes
- sensitive-file blocking for common secret/key files
- redaction of several known secret/token formats
- structured process execution with `shell: false`
- generic process execution disabled by default
- output limits and process timeouts
- reduced child-process environment

## Important limitation

ForgeGuard v0.1 is **not an operating-system sandbox**. If the local administrator explicitly allows an executable or project script, that process may still be capable of accessing resources outside the workspace through OS APIs or absolute paths.

Do not enable generic process execution for untrusted repositories. Stronger process isolation using OS/container sandboxing is planned for a later milestone.

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

Unknown, malformed, or missing security configuration should fail closed rather than silently expand access.
