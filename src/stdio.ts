#!/usr/bin/env node
/**
 * Local MCP server over stdio: `npx -y happypod-mcp`.
 *   HAPPYPOD_API_KEY   Happy Pod API key
 *   HAPPYPOD_API_URL   optional, another API base URL (default https://api.happypod.io/v1)
 *   HAPPYPOD_MODE=demo use the built-in simulator (no account, nothing billed)
 */
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createHappyPodServer, VERSION } from "./server.js";

if (process.argv.includes("--version")) { console.log(VERSION); process.exit(0); }

const demo = process.env.HAPPYPOD_MODE === "demo" || process.argv.includes("--demo");
const server = createHappyPodServer({ demo, apiKey: process.env.HAPPYPOD_API_KEY, apiUrl: process.env.HAPPYPOD_API_URL });
if (demo) console.error("happypod-mcp: demo mode, every call goes to the built-in simulator.");
else if (!process.env.HAPPYPOD_API_KEY) console.error("happypod-mcp: set HAPPYPOD_API_KEY (create one at https://happypod.io under Settings → API keys), or HAPPYPOD_MODE=demo to try it without an account.");
await server.connect(new StdioServerTransport());
