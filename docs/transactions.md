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
4. removes the temporary worktree and transaction branch.

## Failed gates

A failed gate does not apply or discard the transaction. The original remains unchanged, and the transaction remains available for inspection, further edits, or another apply attempt.

## Abort

`transaction_abort` is intentionally always available for a known active transaction so cleanup cannot be trapped behind a policy change.

## Current limitation

Active transaction metadata is currently in memory. The Git worktree may remain on disk if the ForgeGuard process is terminated unexpectedly, but transaction recovery after restart is not yet implemented. Persistent transaction recovery is a planned next step.

Worktrees provide repository-level isolation only. They do not sandbox processes from the host operating system.
