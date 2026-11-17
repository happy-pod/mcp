---
name: happypod
description: Use when the user mentions Happy Pod (happypod.io) or wants their app shipped, hosted, scaled, monitored or fixed without doing DevOps themselves. Explains access, the safety rules for paid and destructive actions, and which Happy Pod skill fits the task.
---

# Happy Pod

Happy Pod is the DevOps AI agent for vibe coders. It runs **app pods** (web apps, APIs, workers built from a Git repo or an image), **GPU pods** (inference, notebooks, fine-tuning) and **managed databases** (Postgres, Redis), and it watches and fixes them. Prices are in USD, billed per hour while a pod runs.

## Access

- **MCP tools** (preferred): if tools like `whoami`, `list_projects`, `create_pod` are available, use them. Call `whoami` first: `mode: "demo"` means the built-in simulator, so say so and do not present results as real.
- **Without MCP**: the HTTP API at `https://api.happypod.io/v1` with `Authorization: Bearer $HAPPYPOD_API_KEY`. Keys are created at https://happypod.io under Settings → API keys. Responses are `{ "data": ... }` or `{ "error": { "code", "message", "details" } }`.

## Rules (always)

1. **Money first.** Before `create_pod`, `create_gpu_pod`, `scale_pod` or a paid `create_database`, call it with `dryRun: true`, tell the user the hourly and monthly price in USD, and wait for a clear yes. Prefer the smallest size that works; the `hobby` database plan is free.
2. **Destructive actions.** Before `delete_pod`, `delete_database`, `delete_project` or `unset_env`, say exactly what will be lost and wait for a clear yes. Pass the exact name as `confirm`.
3. **Background work.** Deployments are asynchronous: poll `get_deployment` every few seconds until `success` or `failed`. On `failed`, read `get_deployment_logs`, explain the real cause in one sentence, fix it, deploy again.
4. **Secrets.** Never print secret values or a connection URL fetched with `reveal: true`. Pass them straight into `set_env` `secrets`.
5. **Retries.** Reuse the same `idempotencyKey` when retrying a create or deploy so nothing happens twice.
6. **GPU cost.** A GPU pod bills every hour it runs. When its job is finished, offer `stop_pod`.

## Which skill

| The user wants to | Skill |
| --- | --- |
| Put an app online, add a database or a domain, start a GPU pod | `happypod-ship` |
| Find out why something is broken or slow, scale, roll back, cut cost | `happypod-ops` |
