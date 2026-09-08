# Per-project policies

ForgeGuard stores project policies outside the project workspace under:

```text
<FORGEGUARD_STATE_DIR>/policies/<project-id>.json
```

This is deliberate: normal ForgeGuard filesystem tools cannot directly edit the policy that governs them.

Use `project_policy_get` to retrieve the current effective policy and its local policy file path.

## Example

```json
{
  "allowFileRead": true,
  "allowFileWrite": true,
  "allowGitRead": true,
  "allowProcessRun": true,
  "allowedCommands": ["npm", "node"],
  "applyGates": [
    {
      "command": "npm",
      "args": ["test"],
      "timeoutMs": 120000
    }
  ]
}
```

## Capabilities

- `allowFileRead` controls guarded file reads, directory trees, search, and transaction reads.
- `allowFileWrite` controls direct writes/patches and transaction edits/apply.
- `allowGitRead` controls Git inspection and the transaction lifecycle.
- `allowProcessRun` controls generic project/transaction command execution and any configured apply gates.

Missing boolean fields default to `true` to preserve the v0.1 filesystem/Git behavior. Generic command execution is still effectively disabled unless `FORGEGUARD_COMMANDS` contains commands.

## Command narrowing

`allowedCommands` never expands local authority.

The effective command set is:

```text
FORGEGUARD_COMMANDS ∩ project.allowedCommands
```

If `allowedCommands` is omitted, the global command set is used. If `FORGEGUARD_COMMANDS` is empty, the project cannot enable any generic command by itself.

## Apply gates

`applyGates` are mandatory commands run inside the isolated transaction worktree immediately before `transaction_apply` is allowed to commit/cherry-pick changes.

Every gate must:

1. use a command present in the effective command set;
2. finish before its timeout;
3. exit with code `0`.

If any gate fails, the transaction remains active and the original project is left unchanged. The policy can be corrected and the same transaction can be validated/applied again.

Example Flutter policy:

```json
{
  "allowedCommands": ["flutter"],
  "applyGates": [
    { "command": "flutter", "args": ["analyze"], "timeoutMs": 180000 },
    { "command": "flutter", "args": ["test"], "timeoutMs": 300000 }
  ]
}
```

Example Node policy:

```json
{
  "allowedCommands": ["npm"],
  "applyGates": [
    { "command": "npm", "args": ["test"], "timeoutMs": 180000 },
    { "command": "npm", "args": ["run", "build"], "timeoutMs": 180000 }
  ]
}
```

## Fail-closed parsing

Unknown policy keys, malformed JSON, invalid gate definitions, overlong gate lists, or invalid timeout values cause policy-protected operations to fail rather than silently ignoring the invalid configuration.

## OS sandbox limitation

Policies govern ForgeGuard tool decisions. They are not an operating-system sandbox. An explicitly allowed executable may still access resources outside the workspace using OS APIs, subprocesses, absolute paths, or the network.
