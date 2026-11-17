/**
 * demo.ts: an in-memory Happy Pod API that speaks the contract in docs/API.md, exposed as a `fetch` function.
 *
 * HAPPYPOD_MODE=demo plugs it into the client, so every tool works end to end with no account: deployments move
 * through queued → building → deploying → success|failed one step per poll, logs and metrics are synthetic, and
 * prices are example figures. Nothing leaves the machine. The tests use it too.
 */

type Json = Record<string, any>;
interface Pod { id: string; projectId: string; name: string; kind: "app" | "gpu"; repo?: string; branch?: string; rootDirectory?: string; image?: string;
    size?: string; replicas: number; region: string; ports: { port: number; public?: boolean }[]; env: Record<string, string>; secrets: Record<string, string>;
    gpuType?: string; gpuCount?: number; volumeGb?: number; status: "deploying" | "running" | "stopped" | "failed"; domains: Json[]; createdAt: string; liveDeploymentId?: string }
interface Deployment { id: string; podId: string; status: "queued" | "building" | "deploying" | "success" | "failed"; source: string; startedAt: string; finishedAt?: string; log: string[]; willFail?: string }
interface Database { id: string; projectId: string; name: string; engine: "postgres" | "redis"; plan: string; region: string; status: string; password: string; createdAt: string }

const REGIONS = [
    { id: "us-east", city: "Ashburn, United States", gpu: true },
    { id: "eu-west", city: "Amsterdam, Netherlands", gpu: true },
    { id: "ap-southeast", city: "Singapore", gpu: true },
    { id: "ap-northeast", city: "Tokyo, Japan", gpu: false },
];
const SIZES = [
    { id: "nano", vcpu: 0.25, memoryGb: 0.5, hourlyUsd: 0.004 },
    { id: "small", vcpu: 1, memoryGb: 1, hourlyUsd: 0.012 },
    { id: "medium", vcpu: 2, memoryGb: 4, hourlyUsd: 0.04 },
    { id: "large", vcpu: 4, memoryGb: 8, hourlyUsd: 0.08 },
    { id: "xlarge", vcpu: 8, memoryGb: 16, hourlyUsd: 0.16 },
];
const GPUS = [
    { id: "l4", vramGb: 24, hourlyUsd: 0.44, regions: ["us-east", "eu-west", "ap-southeast"] },
    { id: "rtx-4090", vramGb: 24, hourlyUsd: 0.69, regions: ["us-east", "eu-west"] },
    { id: "a100-80gb", vramGb: 80, hourlyUsd: 1.89, regions: ["us-east"] },
    { id: "h100-80gb", vramGb: 80, hourlyUsd: 2.99, regions: ["us-east", "ap-southeast"] },
];
const DB_PLANS: Record<string, number> = { hobby: 0, standard: 0.03, pro: 0.11 };
const HOURS_PER_MONTH = 730;
const money = (h: number) => ({ hourlyUsd: +h.toFixed(4), monthlyUsd: +(h * HOURS_PER_MONTH).toFixed(2) });

class ApiError extends Error { constructor(public status: number, public code: string, msg: string, public details?: Json) { super(msg); } }

export function createDemoApi(now: () => Date = () => new Date()) {
    let seq = 100;
    const nid = (p: string) => `${p}_${(++seq).toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    const ts = () => now().toISOString();
    const projects = new Map<string, Json>(), pods = new Map<string, Pod>(), deps = new Map<string, Deployment>(), dbs = new Map<string, Database>();
    const idem = new Map<string, Json>();

    // A small seeded project so the first list_projects shows something real-looking.
    const seedP = { id: "prj_demo", name: "my-saas", createdAt: ts() };
    projects.set(seedP.id, seedP);
    const web: Pod = { id: "pod_web", projectId: seedP.id, name: "web", kind: "app", repo: "https://github.com/acme/my-saas", branch: "main", size: "small", replicas: 1,
        region: "us-east", ports: [{ port: 3000, public: true }], env: { NODE_ENV: "production" }, secrets: { DATABASE_URL: "postgres://app:s3cret@db.internal:5432/main" },
        status: "running", domains: [], createdAt: ts() };
    pods.set(web.id, web);
    const d0: Deployment = { id: "dep_seed", podId: web.id, status: "success", source: "main@4f2a9c1", startedAt: ts(), finishedAt: ts(), log: buildLog(web, true) };
    deps.set(d0.id, d0); web.liveDeploymentId = d0.id;
    dbs.set("db_main", { id: "db_main", projectId: seedP.id, name: "main", engine: "postgres", plan: "hobby", region: "us-east", status: "available", password: "s3cret", createdAt: ts() });

    function buildLog(p: Pod, ok: boolean, fail?: string): string[] {
        const src = p.repo ? `${p.repo}#${p.branch ?? "main"}` : p.image;
        const lines = [`==> Fetching ${src}`, p.repo ? "==> Detected Node.js 22 (package.json), using npm" : `==> Pulling ${p.image}`,
            ...(p.repo ? ["$ npm ci", "added 412 packages in 9s", "$ npm run build", "✓ Compiled successfully"] : ["image pulled (1.2 GB)"]),
            `==> Starting ${p.replicas} replica(s) on ${p.size ?? p.gpuType}`];
        if (!ok) lines.push(fail ?? "Error: process exited with code 1", "==> Health check failed: no response on port " + (p.ports[0]?.port ?? 3000), "==> Deployment failed, previous version kept live");
        else lines.push(`==> Listening on port ${p.ports[0]?.port ?? 3000}`, "==> Health check passed", "==> Live");
        return lines;
    }
    const podPrice = (p: { kind: string; size?: string; replicas?: number; gpuType?: string; gpuCount?: number; volumeGb?: number }) => {
        if (p.kind === "gpu") {
            const g = GPUS.find(x => x.id === p.gpuType); if (!g) throw new ApiError(422, "UNKNOWN_GPU_TYPE", `Unknown gpuType "${p.gpuType}". See list_gpu_types.`);
            return money(g.hourlyUsd * (p.gpuCount ?? 1) + (p.volumeGb ?? 20) * 0.0001);
        }
        const s = SIZES.find(x => x.id === (p.size ?? "small")); if (!s) throw new ApiError(422, "UNKNOWN_SIZE", `Unknown size "${p.size}". See list_sizes.`);
        return money(s.hourlyUsd * (p.replicas ?? 1));
    };
    const url = (p: Pod) => p.ports.some(x => x.public !== false) ? `https://${p.name}-${projects.get(p.projectId)!.name}.demo.happypod.local` : null;
    const lastDep = (p: Pod) => [...deps.values()].filter(d => d.podId === p.id).pop();
    const podView = (p: Pod) => ({ id: p.id, projectId: p.projectId, name: p.name, kind: p.kind, status: p.status, source: p.repo ? { repo: p.repo, branch: p.branch ?? "main", rootDirectory: p.rootDirectory } : { image: p.image },
        size: p.size, gpuType: p.gpuType, gpuCount: p.gpuCount, replicas: p.replicas, region: p.region, ports: p.ports, url: url(p), domains: p.domains, price: podPrice(p),
        lastDeployment: (() => { const d = lastDep(p); return d ? { id: d.id, status: d.status, source: d.source } : null; })(), createdAt: p.createdAt });
    const need = <T>(m: Map<string, T>, id: string, what: string): T => { const v = m.get(id); if (!v) throw new ApiError(404, "NOT_FOUND", `${what} ${id} not found`); return v; };

    function startDeployment(p: Pod): Deployment {
        const missingDb = /needs-db/.test(p.repo ?? "") && !p.secrets.DATABASE_URL && !p.env.DATABASE_URL;
        const broken = /broken/.test(p.image ?? "");
        const fail = missingDb ? "Error: DATABASE_URL is not set (src/db.ts:4)" : broken ? "Error: exec /app/start.sh: no such file or directory" : undefined;
        const d: Deployment = { id: nid("dep"), podId: p.id, status: "queued", source: p.repo ? `${p.branch ?? "main"}@${Math.random().toString(16).slice(2, 9)}` : p.image!, startedAt: ts(), log: [], willFail: fail };
        deps.set(d.id, d); p.status = "deploying"; return d;
    }
    function advance(d: Deployment) {
        const order: Deployment["status"][] = ["queued", "building", "deploying"];
        const i = order.indexOf(d.status);
        if (i < 0) return;
        if (i < order.length - 1) { d.status = order[i + 1]; return; }
        const p = pods.get(d.podId)!;
        d.finishedAt = ts();
        if (d.willFail) { d.status = "failed"; d.log = buildLog(p, false, d.willFail); if (!p.liveDeploymentId) p.status = "failed"; else p.status = "running"; }
        else { d.status = "success"; d.log = buildLog(p, true); p.status = "running"; p.liveDeploymentId = d.id; }
    }
    function metrics(p: Pod) {
        let h = 0; for (const c of p.id) h = (h * 31 + c.charCodeAt(0)) >>> 0;
        const cpu = 18 + (h % 50), mem = p.name.includes("leaky") ? 93 : 35 + (h % 40), rps = p.status === "running" ? +(2 + (h % 90) / 3).toFixed(1) : 0;
        return { cpuPercent: cpu, memoryPercent: mem, requestsPerSecond: rps, errorRatePercent: +(((h >> 3) % 30) / 10).toFixed(1), p95Ms: 80 + (h % 400) };
    }

    async function handle(method: string, path: string, q: URLSearchParams, body: Json, key?: string): Promise<{ status: number; data: unknown }> {
        const dry = q.get("dryRun") === "true";
        const seg = path.split("/").filter(Boolean);
        const route = `${method} /${seg.map((s, i) => (i % 2 === 1 && !["pods", "databases", "deployments", "env", "domains", "logs", "metrics", "connection", "diagnose", "restart", "stop", "start", "scale", "rollback"].includes(s) ? ":id" : s)).join("/")}`;
        if (key && idem.has(`${route}|${key}`)) return { status: 200, data: idem.get(`${route}|${key}`) };
        const remember = (data: Json) => { if (key) idem.set(`${route}|${key}`, data); return { status: 201, data }; };

        switch (route) {
            case "GET /me": return { status: 200, data: { mode: "demo", account: "Demo account", plan: "starter", creditUsd: 25, spendThisMonthUsd: 3.42, keyScope: "all projects", note: "Built-in simulator: nothing here is real and nothing is billed." } };
            case "GET /regions": return { status: 200, data: REGIONS };
            case "GET /sizes": return { status: 200, data: SIZES.map(s => ({ ...s, ...money(s.hourlyUsd) })) };
            case "GET /gpu-types": { const r = q.get("region"); return { status: 200, data: GPUS.filter(g => !r || g.regions.includes(r)).map(g => ({ ...g, ...money(g.hourlyUsd) })) }; }
            case "GET /projects": return { status: 200, data: [...projects.values()].map(p => ({ ...p, pods: [...pods.values()].filter(x => x.projectId === p.id).length, databases: [...dbs.values()].filter(x => x.projectId === p.id).length })) };
            case "POST /projects": {
                if (!body.name) throw new ApiError(422, "VALIDATION", "name is required");
                if ([...projects.values()].some(p => p.name === body.name)) throw new ApiError(409, "NAME_TAKEN", `A project named ${body.name} already exists`);
                const p = { id: nid("prj"), name: body.name, createdAt: ts() }; projects.set(p.id, p); return remember(p);
            }
            case "DELETE /projects/:id": {
                const p = need(projects, seg[1], "Project");
                if (body.confirm !== p.name) throw new ApiError(422, "CONFIRM_MISMATCH", `confirm must be the project name "${p.name}"`);
                if ([...pods.values()].some(x => x.projectId === p.id) || [...dbs.values()].some(x => x.projectId === p.id)) throw new ApiError(409, "PROJECT_NOT_EMPTY", "Delete its pods and databases first");
                projects.delete(p.id); return { status: 200, data: { deleted: p.id } };
            }
            case "GET /projects/:id/pods": need(projects, seg[1], "Project"); return { status: 200, data: [...pods.values()].filter(p => p.projectId === seg[1]).map(podView) };
            case "POST /projects/:id/pods": {
                need(projects, seg[1], "Project");
                const kind = body.kind === "gpu" ? "gpu" : "app";
                const region = body.region ?? "us-east";
                if (!REGIONS.some(r => r.id === region)) throw new ApiError(422, "UNKNOWN_REGION", `Unknown region "${region}". See list_regions.`);
                if (kind === "gpu" && !GPUS.find(g => g.id === body.gpuType)?.regions.includes(region)) throw new ApiError(409, "NO_GPU_CAPACITY", `No ${body.gpuType} capacity in ${region} right now`, { tryRegions: GPUS.find(g => g.id === body.gpuType)?.regions ?? [] });
                const price = podPrice({ kind, size: body.size, replicas: body.replicas, gpuType: body.gpuType, gpuCount: body.gpuCount, volumeGb: body.volumeGb });
                if ([...pods.values()].some(p => p.projectId === seg[1] && p.name === body.name)) throw new ApiError(409, "NAME_TAKEN", `A pod named ${body.name} already exists in this project`);
                if (dry) return { status: 200, data: { dryRun: true, kind, price, note: kind === "gpu" ? "Billed per hour while running. Stop it when the job is done." : "Billed per hour while running." } };
                const p: Pod = { id: nid("pod"), projectId: seg[1], name: body.name, kind, repo: body.repo, branch: body.branch, rootDirectory: body.rootDirectory, image: body.image,
                    size: kind === "app" ? body.size ?? "small" : undefined, replicas: body.replicas ?? 1, region, ports: body.ports ?? [{ port: kind === "gpu" ? 8000 : 3000, public: true }],
                    env: body.env ?? {}, secrets: body.secrets ?? {}, gpuType: body.gpuType, gpuCount: kind === "gpu" ? body.gpuCount ?? 1 : undefined, volumeGb: kind === "gpu" ? body.volumeGb ?? 20 : undefined,
                    status: "deploying", domains: [], createdAt: ts() };
                pods.set(p.id, p);
                const d = startDeployment(p);
                return remember({ pod: podView(p), deployment: { id: d.id, status: d.status }, price });
            }
            case "GET /pods/:id": return { status: 200, data: podView(need(pods, seg[1], "Pod")) };
            case "DELETE /pods/:id": {
                const p = need(pods, seg[1], "Pod");
                if (body.confirm !== p.name) throw new ApiError(422, "CONFIRM_MISMATCH", `confirm must be the pod name "${p.name}"`);
                pods.delete(p.id); for (const d of [...deps.values()]) if (d.podId === p.id) deps.delete(d.id);
                return { status: 200, data: { deleted: p.id } };
            }
            case "POST /pods/:id/deployments": { const p = need(pods, seg[1], "Pod"); const d = startDeployment(p); return remember({ id: d.id, status: d.status, source: d.source }); }
            case "GET /pods/:id/deployments": {
                const p = need(pods, seg[1], "Pod"); const lim = Number(q.get("limit") ?? 20);
                return { status: 200, data: [...deps.values()].filter(d => d.podId === p.id).reverse().slice(0, lim).map(d => ({ id: d.id, status: d.status, source: d.source, startedAt: d.startedAt, finishedAt: d.finishedAt ?? null, live: p.liveDeploymentId === d.id })) };
            }
            case "GET /deployments/:id": { const d = need(deps, seg[1], "Deployment"); advance(d); return { status: 200, data: { id: d.id, podId: d.podId, status: d.status, source: d.source, startedAt: d.startedAt, finishedAt: d.finishedAt ?? null } }; }
            case "GET /deployments/:id/logs": {
                const d = need(deps, seg[1], "Deployment"); const tail = Number(q.get("tail") ?? 200);
                const lines = d.log.length ? d.log : [`==> ${d.status}…`];
                return { status: 200, data: { deploymentId: d.id, status: d.status, lines: lines.slice(-tail) } };
            }
            case "POST /pods/:id/rollback": {
                const p = need(pods, seg[1], "Pod"); const d = need(deps, body.deploymentId, "Deployment");
                if (d.podId !== p.id || d.status !== "success") throw new ApiError(409, "NOT_ROLLBACKABLE", "Only an earlier successful deployment of this pod can be rolled back to");
                p.liveDeploymentId = d.id; p.status = "running"; return { status: 200, data: { live: d.id, source: d.source } };
            }
            case "POST /pods/:id/restart": { const p = need(pods, seg[1], "Pod"); if (p.status !== "running") throw new ApiError(409, "NOT_RUNNING", `Pod is ${p.status}`); return { status: 200, data: { restarted: p.id, replicas: p.replicas } }; }
            case "POST /pods/:id/stop": { const p = need(pods, seg[1], "Pod"); p.status = "stopped"; return { status: 200, data: { id: p.id, status: p.status } }; }
            case "POST /pods/:id/start": { const p = need(pods, seg[1], "Pod"); if (p.status === "stopped") p.status = "running"; return { status: 200, data: { id: p.id, status: p.status } }; }
            case "PATCH /pods/:id/scale": {
                const p = need(pods, seg[1], "Pod"); if (p.kind === "gpu" && body.size) throw new ApiError(422, "GPU_POD", "GPU pods are resized by creating a new pod with another gpuType");
                const next = { kind: p.kind, size: body.size ?? p.size, replicas: body.replicas ?? p.replicas, gpuType: p.gpuType, gpuCount: p.gpuCount, volumeGb: p.volumeGb };
                const cur = podPrice(p), nu = podPrice(next);
                if (dry) return { status: 200, data: { dryRun: true, current: { size: p.size, replicas: p.replicas, ...cur }, new: { size: next.size, replicas: next.replicas, ...nu } } };
                p.size = next.size; p.replicas = next.replicas; return { status: 200, data: { id: p.id, size: p.size, replicas: p.replicas, price: nu } };
            }
            case "GET /pods/:id/logs": {
                const p = need(pods, seg[1], "Pod"); const lvl = q.get("level") ?? "all";
                const base = [["info", "GET / 200 12ms"], ["info", "GET /api/items 200 48ms"], ["warn", "slow query: SELECT * FROM orders WHERE user_id = $1 (1840ms)"], ["error", "TypeError: Cannot read properties of undefined (reading 'email') at /app/src/routes/profile.ts:27"], ["info", "POST /api/checkout 200 1912ms"]];
                const lines = base.filter(([l]) => lvl === "all" || l === lvl || (lvl === "warn" && l === "error")).map(([l, m], i) => ({ at: new Date(now().getTime() - (5 - i) * 60_000).toISOString(), level: l, replica: `${p.name}-0`, message: m }));
                return { status: 200, data: { podId: p.id, since: q.get("since") ?? "1h", lines } };
            }
            case "GET /pods/:id/metrics": { const p = need(pods, seg[1], "Pod"); return { status: 200, data: { podId: p.id, window: q.get("window") ?? "1h", replicas: p.replicas, ...metrics(p) } }; }
            case "POST /pods/:id/diagnose": {
                const p = need(pods, seg[1], "Pod"); const m = metrics(p), d = lastDep(p), findings: Json[] = [];
                if (d?.status === "failed") findings.push({ severity: "critical", title: "Last deployment failed", evidence: d.log.find(l => l.startsWith("Error")) ?? "see get_deployment_logs", fix: /DATABASE_URL/.test(d.log.join()) ? "Create or reuse a database, pass its URL with set_env secrets.DATABASE_URL, then deploy_pod" : "Read get_deployment_logs, fix the start command or Dockerfile, deploy_pod again", deploymentId: d.id });
                if (m.memoryPercent > 85) findings.push({ severity: "high", title: "Memory nearly full", evidence: `memory ${m.memoryPercent}% of ${p.size}`, fix: "scale_pod to the next size (dryRun first), then look for a memory leak" });
                if (m.p95Ms > 400) findings.push({ severity: "medium", title: "Slow responses", evidence: `p95 ${m.p95Ms} ms; slow query on orders.user_id in the logs`, fix: "Add an index on orders.user_id in the app's migrations, then deploy_pod" });
                if (m.errorRatePercent > 2) findings.push({ severity: "medium", title: "Elevated error rate", evidence: `${m.errorRatePercent}% of requests fail; TypeError in profile.ts:27`, fix: "Guard the undefined user in src/routes/profile.ts, then deploy_pod" });
                return { status: 200, data: { podId: p.id, healthy: findings.length === 0, findings, metrics: m } };
            }
            case "GET /pods/:id/env": { const p = need(pods, seg[1], "Pod"); return { status: 200, data: { env: p.env, secrets: Object.fromEntries(Object.keys(p.secrets).map(k => [k, "••••••"])) } }; }
            case "PUT /pods/:id/env": {
                const p = need(pods, seg[1], "Pod"); Object.assign(p.env, body.env ?? {}); Object.assign(p.secrets, body.secrets ?? {});
                for (const k of Object.keys(body.secrets ?? {})) delete p.env[k];
                return { status: 200, data: { env: Object.keys(p.env), secrets: Object.keys(p.secrets), note: "Applies on the next deploy: call deploy_pod." } };
            }
            case "DELETE /pods/:id/env/:id": { const p = need(pods, seg[1], "Pod"); delete p.env[seg[3]]; delete p.secrets[seg[3]]; return { status: 200, data: { removed: seg[3] } }; }
            case "GET /pods/:id/domains": return { status: 200, data: need(pods, seg[1], "Pod").domains };
            case "POST /pods/:id/domains": {
                const p = need(pods, seg[1], "Pod"); const host = String(body.hostname).toLowerCase(); const apex = host.split(".").length === 2;
                const dom = { hostname: host, status: "pending_dns", dns: apex ? { type: "A", name: host, value: "203.0.113.10" } : { type: "CNAME", name: host, value: `${p.name}-${projects.get(p.projectId)!.name}.demo.happypod.local` } };
                p.domains.push(dom); return { status: 201, data: dom };
            }
            case "GET /projects/:id/databases": need(projects, seg[1], "Project"); return { status: 200, data: [...dbs.values()].filter(d => d.projectId === seg[1]).map(({ password, ...d }) => d) };
            case "POST /projects/:id/databases": {
                need(projects, seg[1], "Project"); const plan = body.plan ?? "hobby";
                if (!(plan in DB_PLANS)) throw new ApiError(422, "UNKNOWN_PLAN", `Unknown plan ${plan}`);
                const price = money(DB_PLANS[plan]);
                if (dry) return { status: 200, data: { dryRun: true, engine: body.engine, plan, price } };
                const d: Database = { id: nid("db"), projectId: seg[1], name: body.name, engine: body.engine, plan, region: body.region ?? "us-east", status: "available", password: Math.random().toString(36).slice(2, 14), createdAt: ts() };
                dbs.set(d.id, d); const { password, ...view } = d; return remember({ ...view, price });
            }
            case "GET /databases/:id/connection": {
                const d = need(dbs, seg[1], "Database"); const reveal = q.get("reveal") === "true"; const pw = reveal ? d.password : "••••••";
                const host = `${d.name}.${d.region}.db.happypod.local`, port = d.engine === "postgres" ? 5432 : 6379;
                return { status: 200, data: { host, port, user: d.engine === "postgres" ? "app" : "default", database: d.engine === "postgres" ? d.name : null,
                    url: d.engine === "postgres" ? `postgres://app:${pw}@${host}:${port}/${d.name}` : `redis://default:${pw}@${host}:${port}`, revealed: reveal } };
            }
            case "DELETE /databases/:id": {
                const d = need(dbs, seg[1], "Database"); if (body.confirm !== d.name) throw new ApiError(422, "CONFIRM_MISMATCH", `confirm must be the database name "${d.name}"`);
                dbs.delete(d.id); return { status: 200, data: { deleted: d.id } };
            }
        }
        throw new ApiError(404, "NO_ROUTE", `${method} ${path} is not part of the Happy Pod API`);
    }

    const demoFetch: typeof fetch = async (input, init) => {
        const u = new URL(String(input));
        const path = u.pathname.replace(/^\/v1/, "");
        const headers = new Headers(init?.headers);
        const body = init?.body ? JSON.parse(String(init.body)) : {};
        try {
            const r = await handle((init?.method ?? "GET").toUpperCase(), path, u.searchParams, body, headers.get("Idempotency-Key") ?? undefined);
            return new Response(JSON.stringify({ data: r.data }), { status: r.status, headers: { "Content-Type": "application/json" } });
        } catch (e) {
            const err = e instanceof ApiError ? e : new ApiError(500, "INTERNAL", String((e as Error).message));
            return new Response(JSON.stringify({ error: { code: err.code, message: err.message, ...(err.details ? { details: err.details } : {}) } }), { status: err.status, headers: { "Content-Type": "application/json" } });
        }
    };
    return demoFetch;
}

export const DEMO_API_URL = "https://demo.happypod.local/v1";
export const DEMO_API_KEY = "hp_demo_key";
