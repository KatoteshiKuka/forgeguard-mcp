# Git worktree transactions

ForgeGuard transactions isolate AI edits from the user's primary working tree until the changes are explicitly applied.

## Lifecycle

```text
transaction_begin
      ↓
separate worktree + forgeguard/tx-* branch
      ↓
transaction_file_read / write / patch
      ↓
transaction_process_run (optional)
      ↓
transaction_diff / transaction_status
      ↓
mandatory apply gates (if configured)
      ↓
transaction_apply
      ↓
commit in transaction → cherry-pick into original → cleanup
```

Use `transaction_abort` to discard the isolated worktree and branch.

## Begin safety checks

`transaction_begin` requires:

- a Git worktree;
- a clean original working tree;
- file-write and Git-read permissions under the project policy.

ForgeGuard records the exact base `HEAD` when the transaction starts.

## Isolation

Transaction worktrees are stored below:

```text
<FORGEGUARD_STATE_DIR>/worktrees/<transaction-id>
```

Filesystem and process transaction tools operate against that worktree, not the registered project's original root.

This protects the primary working tree from partial edits, failed builds, and abandoned agent work.

## Persistent recovery

Active transaction metadata is stored in:

```text
<FORGEGUARD_STATE_DIR>/transactions.json
```

A ForgeGuard restart does not automatically trust that file. A recovered record is accepted only when all of these checks succeed:

1. its project id exists in the persistent project registry;
2. that registered project still resolves below a currently configured `FORGEGUARD_ALLOWED_ROOTS` directory;
3. the stored project root resolves to exactly the registered project root;
4. the transaction worktree still exists;
5. the worktree resolves below ForgeGuard's managed `<state>/worktrees` directory;
6. the branch name matches the transaction id-generated `forgeguard/tx-*` name;
7. transaction metadata has the expected bounded structure.

Records that do not satisfy those checks are ignored rather than being used to expand filesystem/Git authority.

Once recovered, the transaction can again be inspected, edited, aborted, or applied through the normal MCP tools.

## Apply safety checks

Before applying, ForgeGuard verifies that the original project:

1. is still at the exact base commit;
2. has no local changes.

If either condition is false, apply is refused. ForgeGuard does not guess how to merge concurrent user work.

If policy `applyGates` exist, every gate must pass before any transaction commit is created.

ForgeGuard then:

1. stages all transaction changes;
2. creates a transaction commit using a local `ForgeGuard <forgeguard@localhost>` identity without changing global Git configuration;
3. cherry-picks that commit into the original using the same local identity;
4. removes the temporary worktree and transaction branch;
5. removes the transaction from persistent active state.

## Failed gates

A failed gate does not apply or discard the transaction. The original remains unchanged, and the transaction remains available for inspection, further edits, restart/recovery, or another apply attempt.

## Abort

`transaction_abort` is intentionally always available for a known active transaction so cleanup cannot be trapped behind a policy change.

Abort removes the managed worktree/branch where possible and removes the transaction from persistent active state.

## Remaining boundary

Persistent recovery protects ForgeGuard from blindly trusting stale/tampered transaction metadata, but it does not make worktrees an operating-system sandbox.

Worktrees provide repository-level isolation only. An explicitly allowed process can still use host OS APIs, absolute paths, subprocesses, or network access available to that process. Stronger process sandboxing remains a future milestone.
