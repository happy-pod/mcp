# Happy Pod API contract (v1)

Base URL `https://api.happypod.io/v1`. Every request sends `Authorization: Bearer <HAPPYPOD_API_KEY>`.

- Success: `{ "data": ... }`. Failure: `{ "error": { "code": "UPPER_SNAKE", "message": "...", "details": { ... } } }` with a matching HTTP status.
- Create and paid calls accept `Idempotency-Key`; a repeat with the same key returns the first result.
- Paid calls accept `?dryRun=true`: they return `{ dryRun: true, price: { hourlyUsd, monthlyUsd } }` and change nothing.
- Deletes take `{ "confirm": "<exact name>" }` in the body (`422 CONFIRM_MISMATCH` otherwise).

| Method and path | Tool | Notes |
| --- | --- | --- |
| `GET /me` | `whoami` | account, plan, `creditUsd`, `spendThisMonthUsd`, `keyScope`, `mode` |
| `GET /regions` | `list_regions` | `[{ id, city, gpu }]` |
| `GET /sizes` | `list_sizes` | `[{ id, vcpu, memoryGb, hourlyUsd, monthlyUsd }]` |
| `GET /gpu-types?region=` | `list_gpu_types` | `[{ id, vramGb, hourlyUsd, monthlyUsd, regions }]` |
| `GET /projects` | `list_projects` | with `pods` and `databases` counts |
| `POST /projects` | `create_project` | `{ name }`; `409 NAME_TAKEN` |
| `DELETE /projects/:id` | `delete_project` | `409 PROJECT_NOT_EMPTY` while pods or databases remain |
| `GET /projects/:id/pods` | `list_pods` | |
| `POST /projects/:id/pods` | `create_pod`, `create_gpu_pod` | `kind: app` with `repo` or `image`, or `kind: gpu` with `image`, `gpuType`; returns `{ pod, deployment, price }`; `409 NO_GPU_CAPACITY` with `details.tryRegions` |
| `GET /pods/:id` | `get_pod` | source, size, replicas, region, ports, `url`, domains, `price`, `lastDeployment` |
| `DELETE /pods/:id` | `delete_pod` | |
| `POST /pods/:id/deployments` | `deploy_pod` | returns `{ id, status, source }` |
| `GET /pods/:id/deployments?limit=` | `list_deployments` | newest first, `live` flag |
| `GET /deployments/:id` | `get_deployment` | `queued → building → deploying → success | failed` |
| `GET /deployments/:id/logs?tail=` | `get_deployment_logs` | `{ lines: [...] }` |
| `POST /pods/:id/rollback` | `rollback_pod` | `{ deploymentId }` of an earlier `success`; `409 NOT_ROLLBACKABLE` |
| `POST /pods/:id/restart` · `/stop` · `/start` | `restart_pod`, `stop_pod`, `start_pod` | |
| `PATCH /pods/:id/scale?dryRun=` | `scale_pod` | `{ size?, replicas? }`; dry run returns `current` and `new` prices |
| `GET /pods/:id/logs?since=&level=&tail=` | `get_pod_logs` | `{ lines: [{ at, level, replica, message }] }` |
| `GET /pods/:id/metrics?window=` | `get_pod_metrics` | `cpuPercent, memoryPercent, requestsPerSecond, errorRatePercent, p95Ms` |
| `POST /pods/:id/diagnose` | `diagnose_pod` | `{ healthy, findings: [{ severity, title, evidence, fix }], metrics }` |
| `GET /pods/:id/env` | `list_env` | secrets masked |
| `PUT /pods/:id/env` | `set_env` | `{ env, secrets }`; applies on the next deploy |
| `DELETE /pods/:id/env/:key` | `unset_env` | |
| `GET /pods/:id/domains` · `POST /pods/:id/domains` | `list_domains`, `add_domain` | `{ hostname }` → `{ status, dns: { type, name, value } }` |
| `GET /projects/:id/databases` · `POST /projects/:id/databases` | `list_databases`, `create_database` | `{ name, engine: postgres|redis, plan: hobby|standard|pro, region }` |
| `GET /databases/:id/connection?reveal=` | `get_database_connection` | password masked unless `reveal=true` |
| `DELETE /databases/:id` | `delete_database` | |

`src/demo.ts` implements this contract in memory; it is the reference behaviour for the real API.
