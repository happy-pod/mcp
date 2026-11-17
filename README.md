<p align="center">
  <img src="https://raw.githubusercontent.com/happy-pod/.github/main/profile/happypod-banner.png" alt="Happy Pod: the DevOps AI agent for vibe coders" width="100%">
</p>

# Happy Pod MCP server and skills

Use [Happy Pod](https://happypod.io) from your AI coding tool: ship an app, add a database, start a GPU pod, find out why production is slow and fix it, all by asking in plain language.

- **MCP server** (`happypod-mcp`): 33 tools over the Happy Pod API. Works in Claude Code, Codex, Cursor, VS Code, Windsurf, Claude Desktop and any MCP client.
- **Skills** (`skills/`): playbooks so the agent works the way Happy Pod expects (price first, confirm before deleting, read the logs when a deploy fails):
  - `happypod`: access, safety rules, which skill to use.
  - `happypod-ship`: app pods from a repo or image, managed Postgres and Redis, custom domains, GPU pods.
  - `happypod-ops`: diagnose, logs and metrics, roll back, restart, scale, keep the bill low.

## Install

### Claude Code (plugin: server and skills together)

```
/plugin marketplace add happy-pod/mcp
/plugin install happypod@happypod
```

Then give it your key (Settings → API keys at [happypod.io](https://happypod.io)) before starting Claude Code:

```bash
export HAPPYPOD_API_KEY=hp_...
```

### Any MCP client (local server)

```bash
git clone https://github.com/happy-pod/mcp happypod-mcp
```

```json
{
  "mcpServers": {
    "happypod": {
      "command": "node",
      "args": ["/path/to/happypod-mcp/dist/stdio.js"],
      "env": { "HAPPYPOD_API_KEY": "hp_..." }
    }
  }
}
```

`dist/stdio.js` is a single bundled file: no `npm install` needed to run it.

### Try it without an account

Set `HAPPYPOD_MODE=demo` (or pass `--demo`). Every tool then talks to a built-in simulator: a sample project, deployments that build and go live (or fail with a real-looking error you can fix), logs, metrics and example prices. Nothing leaves your machine and nothing is billed.

```bash
HAPPYPOD_MODE=demo node dist/stdio.js
```

## Configuration

| Variable | |
| --- | --- |
| `HAPPYPOD_API_KEY` | Your API key from happypod.io → Settings → API keys |
| `HAPPYPOD_API_URL` | Optional, another API base URL. Default `https://api.happypod.io/v1` |
| `HAPPYPOD_MODE` | `demo` to use the built-in simulator |

## Tools

| Group | Tools |
| --- | --- |
| **Account and catalogue** | `whoami`, `list_regions`, `list_sizes`, `list_gpu_types` |
| **Projects** | `list_projects`, `create_project`, `delete_project` |
| **Ship** | `list_pods`, `get_pod`, `create_pod`, `create_gpu_pod`, `deploy_pod`, `list_deployments`, `get_deployment`, `get_deployment_logs` |
| **Operate** | `get_pod_logs`, `get_pod_metrics`, `diagnose_pod`, `restart_pod`, `stop_pod`, `start_pod`, `scale_pod`, `rollback_pod`, `delete_pod` |
| **Variables and domains** | `list_env`, `set_env`, `unset_env`, `add_domain`, `list_domains` |
| **Databases** | `list_databases`, `create_database`, `get_database_connection`, `delete_database` |

Every tool that changes something is marked destructive, so MCP clients ask before running it. Paid tools take `dryRun: true` (returns the price, changes nothing) and an `idempotencyKey` (a retry never creates twice). Deletes need the resource's exact name in `confirm`. Errors come back as `{ status, code, error, details }` so the agent can act on them.

## Things to ask

- "Ship this repo to Happy Pod with a Postgres database."
- "Why is checkout slow in production?"
- "The last deploy broke the login page, roll it back."
- "Serve Llama 3.1 8B on the cheapest GPU and stop it when I'm done."
- "What am I paying for this month, and what can I turn off?"

## Develop

```bash
npm install
npm test          # tool catalogue, demo flows and the bundled stdio server
npm run build     # bundles src/stdio.ts into dist/stdio.js
```

The API contract the server expects is in [docs/API.md](docs/API.md).

## License

MIT
