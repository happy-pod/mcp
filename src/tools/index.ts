// All Happy Pod tools, grouped the way the skills describe them.
import { z } from "zod";
import { defineTool, idemKey, type ToolDef } from "../tool.js";

const id = (what: string) => z.string().min(3).max(64).describe(`${what} id`);
const dryRun = z.boolean().optional().describe("true: return the price only (hourly and monthly, USD) and change nothing");
const idem = z.string().min(8).max(128).optional().describe("Idempotency-Key: a retry with the same value returns the first result instead of doing it twice");
const confirmName = (what: string) => z.string().max(255).describe(`The ${what}'s exact name, typed back after the user agreed`);
const envName = z.string().regex(/^[A-Z_][A-Z0-9_]{0,127}$/).describe("Variable name, UPPER_SNAKE_CASE");

// ---------- account and catalogue ----------
export const accountTools = [
    defineTool({
        name: "whoami", title: "Who am I", kind: "read",
        description: "The account behind the API key: name, plan, credit balance (USD), spend this month and the key's scope. Call it first in a session. mode \"demo\" means the built-in simulator, not a real account.",
        input: {},
        run: (_a, api) => api.api("GET", "/me"),
    }),
    defineTool({
        name: "list_regions", title: "List regions", kind: "read",
        description: "Regions where pods and databases can run, with their city and whether GPUs are available there. Pick the one closest to the app's users.",
        input: {},
        run: (_a, api) => api.api("GET", "/regions"),
    }),
    defineTool({
        name: "list_sizes", title: "List pod sizes", kind: "read",
        description: "CPU pod sizes (vCPU, memory, hourly and monthly USD price). Start small: most vibe-coded apps run on `small`.",
        input: {},
        run: (_a, api) => api.api("GET", "/sizes"),
    }),
    defineTool({
        name: "list_gpu_types", title: "List GPU types", kind: "read",
        description: "GPU types for GPU pods: VRAM, hourly USD price and the regions with free capacity right now.",
        input: { region: z.string().optional().describe("Only GPUs with capacity in this region") },
        run: (a, api) => api.api("GET", "/gpu-types", { query: { region: a.region } }),
    }),
];

// ---------- projects ----------
export const projectTools = [
    defineTool({
        name: "list_projects", title: "List projects", kind: "read",
        description: "Projects this key can reach, each with its pod and database counts. Start here to find a projectId.",
        input: {},
        run: (_a, api) => api.api("GET", "/projects"),
    }),
    defineTool({
        name: "create_project", title: "Create project", kind: "write",
        description: "Create an empty project (free). One project per app is a good default.",
        input: { name: z.string().min(2).max(60), idempotencyKey: idem },
        run: (a, api) => api.api("POST", "/projects", { body: { name: a.name }, idempotencyKey: a.idempotencyKey }),
    }),
    defineTool({
        name: "delete_project", title: "Delete project", kind: "destructive",
        description: "Delete an EMPTY project. Irreversible. Refused with 409 PROJECT_NOT_EMPTY while pods or databases remain. Only after the user agrees; confirm must be the project's exact name.",
        input: { projectId: id("Project"), confirm: confirmName("project") },
        run: (a, api) => api.api("DELETE", `/projects/${a.projectId}`, { body: { confirm: a.confirm } }),
    }),
];

// ---------- pods: ship ----------
const port = z.object({
    port: z.number().int().min(1).max(65535),
    public: z.boolean().optional().describe("Give it an HTTPS URL (default true)"),
});

export const podTools = [
    defineTool({
        name: "list_pods", title: "List pods", kind: "read",
        description: "Pods in a project: app pods (web apps, APIs, workers) and GPU pods, with status, size, replicas, URL and the last deployment.",
        input: { projectId: id("Project") },
        run: (a, api) => api.api("GET", `/projects/${a.projectId}/pods`),
    }),
    defineTool({
        name: "get_pod", title: "Get pod", kind: "read",
        description: "One pod in full: source, size, replicas, region, ports, URL, domains, status and the last deployment.",
        input: { podId: id("Pod") },
        run: (a, api) => api.api("GET", `/pods/${a.podId}`),
    }),
    defineTool({
        name: "create_pod", title: "Create pod", kind: "write",
        description: "Create an app pod and start its first deployment. Source is a Git repository (built automatically: a Dockerfile is used when present, otherwise the stack is detected) or a container image. ALWAYS call with dryRun: true first, tell the user the price, and create only after a clear yes. Then poll get_deployment until success or failed.",
        input: {
            projectId: id("Project"),
            name: z.string().regex(/^[a-z][a-z0-9-]{1,39}$/).describe("Lowercase name, used in the default URL"),
            repo: z.string().url().optional().describe("Git repository URL (https)"),
            branch: z.string().max(100).optional().describe("Branch to build (default: the repository's default branch)"),
            rootDirectory: z.string().max(200).optional().describe("Sub-folder for monorepos"),
            image: z.string().max(300).optional().describe("Container image instead of a repo, e.g. ghcr.io/acme/api:1.4"),
            size: z.string().optional().describe("A size from list_sizes (default small)"),
            replicas: z.number().int().min(1).max(20).optional().describe("Default 1"),
            region: z.string().optional().describe("A region from list_regions"),
            ports: z.array(port).max(5).optional().describe("Ports the app listens on (default [{ port: 3000 }])"),
            env: z.record(envName, z.string()).optional().describe("Plain environment variables"),
            secrets: z.record(envName, z.string()).optional().describe("Secret variables: write-only, never shown again"),
            dryRun, idempotencyKey: idem,
        },
        run: (a, api) => {
            if (!a.repo === !a.image) throw new Error("Give exactly one source: repo or image.");
            const { projectId, dryRun: dr, idempotencyKey, ...body } = a;
            return api.api("POST", `/projects/${projectId}/pods`, { body: { ...body, kind: "app" }, query: { dryRun: dr }, idempotencyKey: idemKey(dr, idempotencyKey) });
        },
    }),
    defineTool({
        name: "create_gpu_pod", title: "Create GPU pod", kind: "write",
        description: "Start a GPU pod from a container image (inference servers, notebooks, fine-tuning, batch jobs). Billed per hour while running. ALWAYS dryRun first and tell the user the hourly price; stop it with stop_pod when the job is done.",
        input: {
            projectId: id("Project"),
            name: z.string().regex(/^[a-z][a-z0-9-]{1,39}$/),
            image: z.string().max(300).describe("Container image, e.g. vllm/vllm-openai:latest"),
            gpuType: z.string().describe("A GPU type from list_gpu_types"),
            gpuCount: z.number().int().min(1).max(8).optional().describe("Default 1"),
            volumeGb: z.number().int().min(0).max(2000).optional().describe("Persistent volume mounted at /workspace (default 20)"),
            region: z.string().optional(),
            ports: z.array(port).max(5).optional(),
            env: z.record(envName, z.string()).optional(),
            secrets: z.record(envName, z.string()).optional(),
            dryRun, idempotencyKey: idem,
        },
        run: (a, api) => {
            const { projectId, dryRun: dr, idempotencyKey, ...body } = a;
            return api.api("POST", `/projects/${projectId}/pods`, { body: { ...body, kind: "gpu" }, query: { dryRun: dr }, idempotencyKey: idemKey(dr, idempotencyKey) });
        },
    }),
    defineTool({
        name: "deploy_pod", title: "Deploy pod", kind: "write",
        description: "Build and roll out the pod again from its source (latest commit of the branch, or the image tag). Needed after changing variables. Zero-downtime: the old version serves until the new one is healthy.",
        input: { podId: id("Pod"), idempotencyKey: idem },
        run: (a, api) => api.api("POST", `/pods/${a.podId}/deployments`, { idempotencyKey: idemKey(false, a.idempotencyKey) }),
    }),
    defineTool({
        name: "list_deployments", title: "List deployments", kind: "read",
        description: "A pod's deployments, newest first: id, status, commit or image, start and finish time. Use it to pick a deploymentId for rollback_pod.",
        input: { podId: id("Pod"), limit: z.number().int().min(1).max(50).optional() },
        run: (a, api) => api.api("GET", `/pods/${a.podId}/deployments`, { query: { limit: a.limit } }),
    }),
    defineTool({
        name: "get_deployment", title: "Get deployment", kind: "read",
        description: "One deployment's status: queued, building, deploying, success or failed. Poll every few seconds after create_pod or deploy_pod; builds take one to five minutes.",
        input: { deploymentId: id("Deployment") },
        run: (a, api) => api.api("GET", `/deployments/${a.deploymentId}`),
    }),
    defineTool({
        name: "get_deployment_logs", title: "Deployment logs", kind: "read",
        description: "Build and start-up log of a deployment. Read it when a deployment failed: the cause is usually a missing variable, the wrong port or a build error.",
        input: { deploymentId: id("Deployment"), tail: z.number().int().min(10).max(2000).optional().describe("Last N lines (default 200)") },
        run: (a, api) => api.api("GET", `/deployments/${a.deploymentId}/logs`, { query: { tail: a.tail } }),
    }),
];

// ---------- pods: operate ----------
export const opsTools = [
    defineTool({
        name: "get_pod_logs", title: "Pod logs", kind: "read",
        description: "Runtime logs of a running pod across replicas.",
        input: { podId: id("Pod"), since: z.string().regex(/^\d+[smhd]$/).optional().describe("e.g. 15m, 1h, 2d (default 1h)"), level: z.enum(["error", "warn", "info", "all"]).optional(), tail: z.number().int().min(10).max(2000).optional() },
        run: (a, api) => api.api("GET", `/pods/${a.podId}/logs`, { query: { since: a.since, level: a.level, tail: a.tail } }),
    }),
    defineTool({
        name: "get_pod_metrics", title: "Pod metrics", kind: "read",
        description: "CPU, memory, requests per second, error rate and p95 latency over a window, per replica and in total.",
        input: { podId: id("Pod"), window: z.enum(["15m", "1h", "6h", "24h", "7d"]).optional() },
        run: (a, api) => api.api("GET", `/pods/${a.podId}/metrics`, { query: { window: a.window } }),
    }),
    defineTool({
        name: "diagnose_pod", title: "Diagnose pod", kind: "read",
        description: "Happy Pod's own health check for a pod: reads the last deployment, recent error logs and metrics, and returns findings (severity, evidence, suggested fix). Start here when the user says something is broken or slow.",
        input: { podId: id("Pod") },
        run: (a, api) => api.api("POST", `/pods/${a.podId}/diagnose`),
    }),
    defineTool({
        name: "restart_pod", title: "Restart pod", kind: "write", idempotent: true,
        description: "Restart the running replicas without rebuilding. Brief interruption per replica.",
        input: { podId: id("Pod") },
        run: (a, api) => api.api("POST", `/pods/${a.podId}/restart`),
    }),
    defineTool({
        name: "stop_pod", title: "Stop pod", kind: "write", idempotent: true,
        description: "Stop a pod (billing for compute stops; volumes are kept). GPU pods should be stopped as soon as their job is done.",
        input: { podId: id("Pod") },
        run: (a, api) => api.api("POST", `/pods/${a.podId}/stop`),
    }),
    defineTool({
        name: "start_pod", title: "Start pod", kind: "write", idempotent: true,
        description: "Start a stopped pod again. Billing resumes.",
        input: { podId: id("Pod") },
        run: (a, api) => api.api("POST", `/pods/${a.podId}/start`),
    }),
    defineTool({
        name: "scale_pod", title: "Scale pod", kind: "write", idempotent: true,
        description: "Change a pod's size and/or replica count. dryRun: true first, show the user the current and new monthly price, apply after a clear yes.",
        input: { podId: id("Pod"), size: z.string().optional(), replicas: z.number().int().min(1).max(20).optional(), dryRun },
        run: (a, api) => api.api("PATCH", `/pods/${a.podId}/scale`, { body: { size: a.size, replicas: a.replicas }, query: { dryRun: a.dryRun } }),
    }),
    defineTool({
        name: "rollback_pod", title: "Roll back pod", kind: "write",
        description: "Put an earlier successful deployment back live (no rebuild). The quickest fix when a new deploy broke the app.",
        input: { podId: id("Pod"), deploymentId: id("Deployment") },
        run: (a, api) => api.api("POST", `/pods/${a.podId}/rollback`, { body: { deploymentId: a.deploymentId } }),
    }),
    defineTool({
        name: "delete_pod", title: "Delete pod", kind: "destructive",
        description: "Delete a pod, its deployments, domains and volumes. Irreversible. Only after the user agrees; confirm must be the pod's exact name.",
        input: { podId: id("Pod"), confirm: confirmName("pod") },
        run: (a, api) => api.api("DELETE", `/pods/${a.podId}`, { body: { confirm: a.confirm } }),
    }),
];

// ---------- configuration: variables and domains ----------
export const configTools = [
    defineTool({
        name: "list_env", title: "List variables", kind: "read",
        description: "A pod's environment variables. Secret values come back masked.",
        input: { podId: id("Pod") },
        run: (a, api) => api.api("GET", `/pods/${a.podId}/env`),
    }),
    defineTool({
        name: "set_env", title: "Set variables", kind: "write", idempotent: true,
        description: "Create or update variables. Put credentials in secrets. Changes apply on the next deploy: call deploy_pod afterwards.",
        input: { podId: id("Pod"), env: z.record(envName, z.string()).optional(), secrets: z.record(envName, z.string()).optional() },
        run: (a, api) => api.api("PUT", `/pods/${a.podId}/env`, { body: { env: a.env ?? {}, secrets: a.secrets ?? {} } }),
    }),
    defineTool({
        name: "unset_env", title: "Remove variable", kind: "destructive", idempotent: true,
        description: "Remove one variable. Applies on the next deploy.",
        input: { podId: id("Pod"), key: envName },
        run: (a, api) => api.api("DELETE", `/pods/${a.podId}/env/${a.key}`),
    }),
    defineTool({
        name: "add_domain", title: "Add custom domain", kind: "write",
        description: "Attach a custom domain to a pod's public port. Returns the DNS record the user must create (CNAME for subdomains, A/AAAA for an apex). HTTPS is issued automatically once DNS points here.",
        input: { podId: id("Pod"), hostname: z.string().regex(/^(?=.{1,253}$)([a-z0-9-]{1,63}\.)+[a-z]{2,63}$/i).describe("e.g. app.example.com") },
        run: (a, api) => api.api("POST", `/pods/${a.podId}/domains`, { body: { hostname: a.hostname } }),
    }),
    defineTool({
        name: "list_domains", title: "List domains", kind: "read",
        description: "A pod's domains with DNS and certificate status (pending_dns, issuing, active).",
        input: { podId: id("Pod") },
        run: (a, api) => api.api("GET", `/pods/${a.podId}/domains`),
    }),
];

// ---------- databases ----------
export const databaseTools = [
    defineTool({
        name: "list_databases", title: "List databases", kind: "read",
        description: "Managed databases in a project: engine, plan, status, region.",
        input: { projectId: id("Project") },
        run: (a, api) => api.api("GET", `/projects/${a.projectId}/databases`),
    }),
    defineTool({
        name: "create_database", title: "Create database", kind: "write",
        description: "Create a managed Postgres or Redis database with daily backups. The hobby plan is free. dryRun first for paid plans. Then pass its connection URL to the app as a secret (get_database_connection + set_env).",
        input: {
            projectId: id("Project"), name: z.string().regex(/^[a-z][a-z0-9-]{1,39}$/),
            engine: z.enum(["postgres", "redis"]), plan: z.enum(["hobby", "standard", "pro"]).optional().describe("Default hobby (free)"),
            region: z.string().optional(), dryRun, idempotencyKey: idem,
        },
        run: (a, api) => {
            const { projectId, dryRun: dr, idempotencyKey, ...body } = a;
            return api.api("POST", `/projects/${projectId}/databases`, { body, query: { dryRun: dr }, idempotencyKey: idemKey(dr, idempotencyKey) });
        },
    }),
    defineTool({
        name: "get_database_connection", title: "Database connection", kind: "read",
        description: "Host, port, database and user, plus the connection URL with the password masked. reveal: true returns the real URL: use it only to pass into set_env secrets, never print it to the user.",
        input: { databaseId: id("Database"), reveal: z.boolean().optional() },
        run: (a, api) => api.api("GET", `/databases/${a.databaseId}/connection`, { query: { reveal: a.reveal } }),
    }),
    defineTool({
        name: "delete_database", title: "Delete database", kind: "destructive",
        description: "Delete a database and all its data and backups. Irreversible. Only after the user agrees; confirm must be the database's exact name.",
        input: { databaseId: id("Database"), confirm: confirmName("database") },
        run: (a, api) => api.api("DELETE", `/databases/${a.databaseId}`, { body: { confirm: a.confirm } }),
    }),
];

export const allTools: ToolDef<any>[] = [...accountTools, ...projectTools, ...podTools, ...opsTools, ...configTools, ...databaseTools];
