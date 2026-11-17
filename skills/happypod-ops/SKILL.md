---
name: happypod-ops
description: Operate apps on Happy Pod - find why something is broken, failing or slow, read logs and metrics, roll back a bad deploy, restart, scale up or down, and keep the bill low. Use when the user says it is down, broken, erroring, slow, out of memory, too expensive, or asks how the app is doing.
---

# Operate with Happy Pod

Follow the `happypod` rules: price first, confirm deletes, never print secrets.

## Something is wrong

1. `list_pods` in the project to find the pod, then `diagnose_pod`. It returns findings with `severity`, `evidence` and a suggested `fix`. Lead with the most severe one.
2. Confirm with evidence before acting:
   - failed deploy: `get_deployment_logs` of that deployment;
   - errors: `get_pod_logs` with `level: "error"` and `since: "1h"`;
   - slow or overloaded: `get_pod_metrics` (CPU, memory, p95, error rate).
3. Pick the smallest fix that works, tell the user what you will do, then do it:

| Cause | Fix |
| --- | --- |
| The newest deploy broke it | `list_deployments` → `rollback_pod` to the last `success` (fast, no rebuild). Then fix the code and `deploy_pod` |
| Missing or wrong variable | `set_env` → `deploy_pod` |
| Bug in the user's code (a stack trace in the logs) | Fix the code in the repo, push, `deploy_pod` |
| Memory near 100% or CPU pinned | `scale_pod` with `dryRun: true`, show current vs new monthly price, apply after a yes |
| Stuck process, no code change needed | `restart_pod` |
| Slow queries | Add the missing index in the app's migrations, then `deploy_pod` |

4. Verify: poll `get_deployment` after a deploy, then run `diagnose_pod` again and report what changed (for example p95 before and after).

## How is it doing?

`get_pod_metrics` with `window: "24h"`: summarise requests per second, error rate, p95 and memory in one or two lines, and say whether anything needs attention.

## Keep the bill low

- `whoami` shows the credit balance and spend this month.
- `list_pods` across projects: offer `stop_pod` for idle GPU pods and forgotten preview pods.
- Over-sized pods (CPU and memory under 20% for a day): `scale_pod` down with `dryRun: true` first.
- Never delete to save money without a clear yes; stopping keeps volumes and can be undone with `start_pod`.
