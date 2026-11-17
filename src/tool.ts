/**
 * tool.ts: one helper to register a tool with its input schema, MCP annotations, JSON output, and errors an agent
 * can act on (status + code + message + details) instead of a thrown exception.
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ZodRawShape, z } from "zod";
import { HappyPodError, type HappyPodClient } from "./client.js";

/** read: changes nothing. write: changes the account, may cost money. destructive: deletes or loses data. */
export type Kind = "read" | "write" | "destructive";

export interface ToolDef<S extends ZodRawShape> {
    name: string;
    title: string;
    description: string;
    kind: Kind;
    /** Calling it again with the same input has no further effect. */
    idempotent?: boolean;
    input: S;
    run: (args: z.infer<z.ZodObject<S>>, api: HappyPodClient) => Promise<unknown>;
}

export function defineTool<S extends ZodRawShape>(def: ToolDef<S>): ToolDef<S> { return def; }

export function register(server: McpServer, api: HappyPodClient, defs: ToolDef<any>[]) {
    for (const d of defs) {
        server.registerTool(d.name, {
            title: d.title,
            description: d.description,
            inputSchema: d.input,
            annotations: {
                title: d.title,
                readOnlyHint: d.kind === "read",
                // Every change touches a live cloud account, often for money: clients then ask the user before each one.
                destructiveHint: d.kind !== "read",
                idempotentHint: d.kind === "read" || !!d.idempotent,
                openWorldHint: true,
            },
        }, async (args: any) => {
            try {
                const data = await d.run(args ?? {}, api);
                return { content: [{ type: "text" as const, text: data === undefined ? "OK" : JSON.stringify(data, null, 2) }] };
            } catch (e) {
                const err = e instanceof HappyPodError ? e : new HappyPodError(0, "CLIENT_ERROR", String((e as any)?.message ?? e));
                return {
                    isError: true,
                    content: [{ type: "text" as const, text: JSON.stringify({ status: err.status, code: err.code ?? null, error: err.message, ...(err.details ? { details: err.details } : {}) }, null, 2) }],
                };
            }
        });
    }
}

/** Idempotency-Key for a paid call: none on a dry run; the caller's own when given, otherwise a fresh one. */
export function idemKey(dryRun: boolean | undefined, given: string | undefined) {
    if (dryRun) return undefined;
    return given ?? globalThis.crypto.randomUUID();
}
