/**
 * client.ts: a small HTTP client for the Happy Pod API (contract in docs/API.md).
 *
 * Every response is `{ "data": ... }` on success or `{ "error": { "code", "message", "details"? } }` on failure.
 * Paid and create calls accept an `Idempotency-Key` header so a retry never does the work twice.
 */

export interface HappyPodConfig {
    apiKey?: string;
    apiUrl?: string;
    /** Sent as User-Agent so requests from agents can be told apart. */
    userAgent?: string;
    fetch?: typeof fetch;
}

export class HappyPodError extends Error {
    constructor(public status: number, public code: string | undefined, message: string, public details?: Record<string, unknown>) {
        super(message);
        this.name = "HappyPodError";
    }
}

type Query = Record<string, string | number | boolean | undefined | null>;

export interface CallOptions {
    query?: Query;
    body?: unknown;
    idempotencyKey?: string;
}

export const DEFAULT_API_URL = "https://api.happypod.io/v1";

export class HappyPodClient {
    readonly apiUrl: string;
    private f: typeof fetch;

    constructor(private cfg: HappyPodConfig) {
        this.apiUrl = (cfg.apiUrl || DEFAULT_API_URL).replace(/\/+$/, "");
        this.f = cfg.fetch ?? fetch;
    }

    async api<T = unknown>(method: string, path: string, opts: CallOptions = {}): Promise<T> {
        if (!this.cfg.apiKey) throw new HappyPodError(401, "NO_API_KEY", "Set HAPPYPOD_API_KEY (create one at https://happypod.io under Settings → API keys), or set HAPPYPOD_MODE=demo to try the tools against the built-in simulator.");
        const url = new URL(this.apiUrl + path);
        for (const [k, v] of Object.entries(opts.query ?? {})) if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
        const headers: Record<string, string> = {
            Authorization: `Bearer ${this.cfg.apiKey}`,
            Accept: "application/json",
            "User-Agent": this.cfg.userAgent ?? "happypod-mcp",
        };
        if (opts.body !== undefined) headers["Content-Type"] = "application/json";
        if (opts.idempotencyKey) headers["Idempotency-Key"] = opts.idempotencyKey;

        let res: Response;
        try {
            res = await this.f(url.toString(), { method, headers, body: opts.body === undefined ? undefined : JSON.stringify(opts.body) });
        } catch (e) {
            throw new HappyPodError(0, "NETWORK_ERROR", `Could not reach ${this.apiUrl}: ${(e as Error).message}`);
        }
        const text = await res.text();
        let json: any = undefined;
        try { json = text ? JSON.parse(text) : undefined; } catch { /* not JSON */ }
        if (!res.ok || json?.error) {
            const err = json?.error ?? {};
            throw new HappyPodError(res.status, err.code, err.message ?? (text.slice(0, 300) || res.statusText), err.details);
        }
        return (json && "data" in json ? json.data : json) as T;
    }
}
