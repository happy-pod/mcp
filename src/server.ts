import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { HappyPodClient, type HappyPodConfig } from "./client.js";
import { createDemoApi, DEMO_API_KEY, DEMO_API_URL } from "./demo.js";
import { register } from "./tool.js";
import { allTools } from "./tools/index.js";

export const VERSION = "0.1.0";

const INSTRUCTIONS = `Happy Pod is the DevOps AI agent for vibe coders: it ships, scales, watches and fixes apps, GPU pods and managed databases.
Rules: (1) before anything that costs money (create_pod, create_gpu_pod, scale_pod, paid create_database) call it with dryRun: true, tell the user the price, and wait for a clear yes; (2) before delete_* say exactly what will be lost and wait for a yes, then pass the exact name as confirm; (3) deployments are asynchronous: poll get_deployment until success or failed, and on failed read get_deployment_logs and explain the cause; (4) never print secret values or revealed connection URLs; (5) when something is broken or slow, start with diagnose_pod.`;

export interface ServerOptions extends HappyPodConfig {
    /** Use the built-in simulator instead of a real account. */
    demo?: boolean;
}

export function createHappyPodServer(opts: ServerOptions = {}) {
    const cfg: HappyPodConfig = opts.demo
        ? { apiKey: DEMO_API_KEY, apiUrl: DEMO_API_URL, fetch: createDemoApi(), userAgent: `happypod-mcp/${VERSION} (demo)` }
        : { ...opts, userAgent: opts.userAgent ?? `happypod-mcp/${VERSION}` };
    const api = new HappyPodClient(cfg);
    const server = new McpServer({ name: "happypod", title: "Happy Pod", version: VERSION }, { instructions: INSTRUCTIONS });
    register(server, api, allTools);
    return server;
}
