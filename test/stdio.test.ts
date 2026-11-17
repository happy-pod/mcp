import { describe, it, expect } from "vitest";
import { existsSync } from "node:fs";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

// The bundled file the Claude Code plugin runs (needs `npm run build` first).
describe.skipIf(!existsSync("dist/stdio.js"))("bundled stdio server", () => {
    it("starts in demo mode with no node_modules lookups and answers tools", async () => {
        const transport = new StdioClientTransport({ command: process.execPath, args: ["dist/stdio.js"], env: { HAPPYPOD_MODE: "demo", PATH: process.env.PATH ?? "" }, stderr: "pipe" });
        const client = new Client({ name: "stdio-test", version: "0" });
        await client.connect(transport);
        const { tools } = await client.listTools();
        expect(tools.map(t => t.name)).toContain("create_pod");
        const r: any = await client.callTool({ name: "list_projects", arguments: {} });
        expect(JSON.parse(r.content[0].text)[0].name).toBe("my-saas");
        await client.close();
    }, 20000);
});
