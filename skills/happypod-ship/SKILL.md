---
name: happypod-ship
description: Ship an app, API or worker to Happy Pod from a Git repo or an image, connect a managed database, add a custom domain, or start a GPU pod. Use when the user says deploy, host, ship, put online, go live, or wants a model served on a GPU.
---

# Ship with Happy Pod

Follow the `happypod` rules: price first, confirm deletes, never print secrets.

## 1. Read the app before deploying

Check the repository quickly so the first deploy works:

- **Port**: the app should listen on `process.env.PORT` (or the framework default). Pass it in `ports`.
- **Start**: a `Dockerfile` is used when present; otherwise the stack is detected (Node, Bun, Python, Go). Make sure `build` and `start` scripts exist.
- **Needs**: environment variables the code reads (`process.env.X`, `os.environ[...]`, `.env.example`). Anything secret goes in `secrets`.
- **Database**: an ORM, `DATABASE_URL` or `REDIS_URL` in the code means the app needs a managed database (step 3).

## 2. Find or create the project

`list_projects` → reuse the app's project. None yet: `create_project` with the app's name (free).

## 3. Database (when the app needs one)

1. `list_databases`: reuse an existing one.
2. Otherwise `create_database` with `engine: "postgres"` (or `redis`) and the free `hobby` plan. Paid plans: `dryRun: true` first and confirm the price.
3. `get_database_connection` with `reveal: true`, and pass `url` as `secrets.DATABASE_URL` (or `REDIS_URL`) of the pod. Never show it to the user.

## 4. Create the pod (price first)

1. `create_pod` with `dryRun: true`, the source (`repo` + `branch`, or `image`), `size` (default `small`), `region` near the users (`list_regions`), `ports`, `env`, `secrets`.
2. Tell the user the monthly price and wait for a yes.
3. `create_pod` again without `dryRun`, with an `idempotencyKey`.
4. Poll `get_deployment` until `success` or `failed` (one to five minutes).
   - `success`: give the user the pod `url`.
   - `failed`: `get_deployment_logs`, find the real error (missing variable, wrong port, build error), fix it (`set_env`, or a change in the user's code), then `deploy_pod` and poll again.

Changing variables later: `set_env`, then `deploy_pod` (changes apply on the next deploy).

## 5. Custom domain

`add_domain` with the hostname, then tell the user the exact DNS record from the response (`CNAME` for a subdomain, `A` for an apex). `list_domains` shows `pending_dns` → `issuing` → `active`; HTTPS is automatic.

## GPU pods

1. `list_gpu_types` (optionally per `region`): pick the smallest GPU whose VRAM fits the model (an 8B model in fp16 needs about 16 GB, so `l4` fits).
2. `create_gpu_pod` with `dryRun: true`: tell the user the **hourly** price and that it bills while running.
3. After a yes, create it with an `idempotencyKey`, poll `get_deployment`, give the `url`.
4. `409 NO_GPU_CAPACITY`: offer a region from `details.tryRegions` or another GPU type.
5. When the job is done, offer `stop_pod`.
