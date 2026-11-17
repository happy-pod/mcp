import { describe, it, expect, beforeEach } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createHappyPodServer } from "../src/server.js";
import { HappyPodClient } from "../src/client.js";
import { allTools } from "../src/tools/index.js";

async function connect() {
    const server = createHappyPodServer({ demo: true });
    const [a, b] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "test", version: "0" });
    await Promise.all([server.connect(a), client.connect(b)]);
    const call = async (name: string, args: Record<string, unknown> = {}) => {
        const r: any = await client.callTool({ name, arguments: args });
        const data = JSON.parse(r.content[0].text);
        return { error: !!r.isError, data };
    };
    return { client, call };
}

describe("tool catalogue", () => {
    it("registers every tool with honest annotations", async () => {
        const { client } = await connect();
        const { tools } = await client.listTools();
        expect(tools.length).toBe(allTools.length);
        for (const t of tools) {
            const def = allTools.find(d => d.name === t.name)!;
            expect(t.annotations?.readOnlyHint).toBe(def.kind === "read");
            expect(t.annotations?.destructiveHint).toBe(def.kind !== "read");
            expect(t.description!.length).toBeGreaterThan(30);
        }
        expect(tools.filter(t => t.name.startsWith("delete_")).every(t => JSON.stringify(t.inputSchema).includes("confirm"))).toBe(true);
    });
});

describe("demo mode end to end", () => {
    let call: Awaited<ReturnType<typeof connect>>["call"];
    beforeEach(async () => { ({ call } = await connect()); });

    it("whoami says demo", async () => {
        const r = await call("whoami");
        expect(r.data.mode).toBe("demo");
    });

    it("prices first, then ships an app and polls it to success", async () => {
        const p = (await call("create_project", { name: "vibe-app" })).data;
        const dry = await call("create_pod", { projectId: p.id, name: "web", repo: "https://github.com/acme/vibe-app", dryRun: true });
        expect(dry.data.dryRun).toBe(true);
        expect(dry.data.price.monthlyUsd).toBeGreaterThan(0);
        expect((await call("list_pods", { projectId: p.id })).data).toHaveLength(0);

        const made = (await call("create_pod", { projectId: p.id, name: "web", repo: "https://github.com/acme/vibe-app" })).data;
        let status = made.deployment.status;
        for (let i = 0; i < 6 && !["success", "failed"].includes(status); i++) status = (await call("get_deployment", { deploymentId: made.deployment.id })).data.status;
        expect(status).toBe("success");
        const pod = (await call("get_pod", { podId: made.pod.id })).data;
        expect(pod.status).toBe("running");
        expect(pod.url).toMatch(/^https:\/\//);
    });

    it("a failed deploy is explained by its logs and fixed with a secret + redeploy", async () => {
        const p = (await call("create_project", { name: "needs-db-app" })).data;
        const made = (await call("create_pod", { projectId: p.id, name: "api", repo: "https://github.com/acme/needs-db-api" })).data;
        let d = made.deployment;
        for (let i = 0; i < 6 && !["success", "failed"].includes(d.status); i++) d = (await call("get_deployment", { deploymentId: d.id })).data;
        expect(d.status).toBe("failed");
        const logs = (await call("get_deployment_logs", { deploymentId: d.id })).data.lines.join("\n");
        expect(logs).toContain("DATABASE_URL is not set");
        const diag = (await call("diagnose_pod", { podId: made.pod.id })).data;
        expect(diag.findings[0].severity).toBe("critical");

        const db = (await call("create_database", { projectId: p.id, name: "main", engine: "postgres" })).data;
        const masked = (await call("get_database_connection", { databaseId: db.id })).data;
        expect(masked.url).toContain("••••••");
        const real = (await call("get_database_connection", { databaseId: db.id, reveal: true })).data;
        await call("set_env", { podId: made.pod.id, secrets: { DATABASE_URL: real.url } });
        expect((await call("list_env", { podId: made.pod.id })).data.secrets.DATABASE_URL).toBe("••••••");

        let r = (await call("deploy_pod", { podId: made.pod.id })).data;
        for (let i = 0; i < 6 && !["success", "failed"].includes(r.status); i++) r = (await call("get_deployment", { deploymentId: r.id })).data;
        expect(r.status).toBe("success");
    });

    it("refuses deletes without the exact name and non-empty projects", async () => {
        const wrong = await call("delete_pod", { podId: "pod_web", confirm: "website" });
        expect(wrong.error).toBe(true);
        expect(wrong.data.code).toBe("CONFIRM_MISMATCH");
        const busy = await call("delete_project", { projectId: "prj_demo", confirm: "my-saas" });
        expect(busy.data.code).toBe("PROJECT_NOT_EMPTY");
        expect((await call("delete_pod", { podId: "pod_web", confirm: "web" })).error).toBe(false);
    });

    it("scales with a price comparison and a GPU pod honours capacity", async () => {
        const s = (await call("scale_pod", { podId: "pod_web", size: "medium", replicas: 2, dryRun: true })).data;
        expect(s.new.monthlyUsd).toBeGreaterThan(s.current.monthlyUsd);
        const noCap = await call("create_gpu_pod", { projectId: "prj_demo", name: "llm", image: "vllm/vllm-openai:latest", gpuType: "a100-80gb", region: "eu-west", dryRun: true });
        expect(noCap.data.code).toBe("NO_GPU_CAPACITY");
        expect(noCap.data.details.tryRegions).toContain("us-east");
        const ok = await call("create_gpu_pod", { projectId: "prj_demo", name: "llm", image: "vllm/vllm-openai:latest", gpuType: "l4", dryRun: true });
        expect(ok.data.price.hourlyUsd).toBeGreaterThan(0.4);
    });

    it("an idempotency key makes a retried create return the first result", async () => {
        const a = (await call("create_project", { name: "once", idempotencyKey: "retry-12345" })).data;
        const b = (await call("create_project", { name: "once", idempotencyKey: "retry-12345" })).data;
        expect(b.id).toBe(a.id);
    });

    it("rolls back to an earlier successful deployment", async () => {
        const r = await call("rollback_pod", { podId: "pod_web", deploymentId: "dep_seed" });
        expect(r.data.live).toBe("dep_seed");
    });
});

describe("real mode client", () => {
    it("defaults to api.happypod.io and explains a missing key", async () => {
        expect(new HappyPodClient({}).apiUrl).toBe("https://api.happypod.io/v1");
        await expect(new HappyPodClient({}).api("GET", "/me")).rejects.toMatchObject({ code: "NO_API_KEY" });
    });

    it("sends the bearer key and idempotency header, and unwraps the envelope", async () => {
        let seen: any;
        const f: typeof fetch = async (u, init) => { seen = { u: String(u), init }; return new Response(JSON.stringify({ data: { ok: 1 } }), { status: 200 }); };
        const c = new HappyPodClient({ apiKey: "hp_x", apiUrl: "https://example.test/v1/", fetch: f });
        expect(await c.api("POST", "/projects", { body: { name: "a" }, idempotencyKey: "k-123456" })).toEqual({ ok: 1 });
        expect(seen.u).toBe("https://example.test/v1/projects");
        expect(seen.init.headers.Authorization).toBe("Bearer hp_x");
        expect(seen.init.headers["Idempotency-Key"]).toBe("k-123456");
    });
});
