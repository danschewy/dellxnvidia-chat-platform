# Eve Hub

Eve is a mostly-offline enterprise agent hub built for the Dell × NVIDIA AI
Hackathon. The entire application is self-hosted on a Dell Pro Max GB10: Next.js
serves the web experience, Eve runs durable agent sessions, Qwen runs through a
local OpenAI-compatible vLLM endpoint, MongoDB stores durable user/business state,
and NVIDIA OpenShell isolates long-running work.

## What is implemented

- Per-user signed web sessions. Conversations, learned procedures, tasks,
  approvals, sandbox mappings, and checkpoints include tenant, workspace, and
  owner keys.
- Durable chat history and long-running Eve tasks.
- OpenShell task sandboxes with a no-egress policy, MongoDB/GridFS checkpoints,
  integrity hashes, restore-on-recreation, and lifecycle evidence.
- Retrieval that changes behavior: approved conventions and annotated task
  procedures are retrieved from MongoDB into Eve's instructions.
- Real business data: the SEC ingestion job stores cited Dell, NVIDIA, and MongoDB
  company facts and retrieval passages in MongoDB.
- Per-turn capability toggles for web search, screen context, computer control,
  browser use, and email. Server-side tool checks enforce the toggles.
- OpenClaw gateway integration for a paired macOS node's screen and computer use.
- A clearly labelled LoRA training preview; no weights are changed. Approved task
  examples affect behavior immediately through retrieval.

## Runtime shape

```text
macOS OpenClaw node ──> loopback OpenClaw gateway ─┐
                                                   │
browser ──> Next.js + Eve ──> local Qwen/vLLM      │
                 │                                 │
                 ├──> MongoDB + GridFS             │
                 ├──> NVIDIA OpenShell sandboxes   │
                 └─────────────────────────────────┘
```

OpenShell is the execution boundary for arbitrary work. Web search and enterprise
connectors are separate host-side tools so enabling them does not grant arbitrary
sandbox network access.

## Local development

Requirements: Node 24, MongoDB, and an OpenAI-compatible local chat endpoint.

```bash
npm ci
cp .env.example .env.local
npm run dev
```

Open `http://127.0.0.1:3000`. Development uses Eve's `local-dev` principal. A
production start requires either configured users or the explicit public-demo
switch.

## Configure users

Generate one password hash per user:

```bash
npm run auth:hash -- 'choose a strong password'
```

Place the resulting hash in `EVE_USERS_JSON`; see `.env.example`. Escape each `$`
as `\$` in the dotenv file so Next.js does not treat the hash as variable
expansion. The signed,
HTTP-only session cookie carries a stable user ID and tenant/workspace claims.
Setting `EVE_DEMO_PUBLIC_ACCESS=1` intentionally bypasses sign-in and uses one
shared demo user; do not use that switch for a multi-user deployment.

## Import real business data

The importer calls the official SEC Company Facts API once, then the agent queries
the resulting MongoDB collections offline:

```bash
SEC_USER_AGENT='Eve Hackathon your-email@example.com' npm run ingest:sec
```

If `EMBEDDING_BASE_URL` is configured, passages receive local embeddings as they
are imported. MongoDB text retrieval remains available when vector search is off.

## GB10 service

Build both the Next.js surface and the separately supervised Eve runtime, then
install the user services:

```bash
npm run build
mkdir -p ~/.config/systemd/user
cp deploy/systemd/eve-hub.service deploy/systemd/eve-agent.service deploy/systemd/eve-qwen.service ~/.config/systemd/user/
systemctl --user daemon-reload
systemctl --user enable --now eve-qwen eve-agent eve-hub
```

After any later `npm run build`, restart both generated-runtime consumers so
Next and Eve load the same build:

```bash
systemctl --user restart eve-agent eve-hub
```

The web service listens on port `3100`; the Next.js rewrite reaches the Eve
runtime on loopback port `4274`. The Qwen vLLM endpoint is intentionally reserved
for loopback port `9000` so it does not collide with the pre-existing services on
the hackathon GB10.

## macOS menu bar

Build the lightweight native wrapper with the Command Line Tools already present
on macOS:

```bash
zsh macos/EveMenuBar/build.sh
open dist/Eve.app
```

Eve then lives only in the menu bar and opens its mini chat with `Option+Space`.
It loads `http://10.0.0.88:3100/` by default and keeps the signed web session in
the app's persistent WebKit data store. Set a different endpoint before launch
with `EVE_HUB_URL`, or set the `EveHubURL` user default for a persistent override.

If the GB10 web port is not directly reachable on the current network, use the
included launcher. It opens an SSH tunnel without storing a password, points the
menu app at the tunnel, and launches Eve:

```bash
zsh macos/EveMenuBar/open-with-tunnel.command
```

Screen observation and computer control deliberately stay in the OpenClaw Mac
node so macOS Screen Recording and Accessibility consent remain isolated from the
web surface. Pair that node before enabling the Screen, Control, or Browser
toggles.

## Checks

```bash
npm run lint
npx tsc --noEmit
npm run build
```

Implementation research and the NVIDIA stack decision are recorded in
`docs/research/nemoclaw-openshell-openclaw.md`.
