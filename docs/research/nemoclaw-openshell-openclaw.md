# NemoClaw, OpenShell, and OpenClaw for the Eve hub

Research date: 2026-08-22. Sources are limited to current official NVIDIA and OpenClaw documentation and repositories.

## Decision

Use all three, but give each a narrow job:

```text
Eve + MongoDB          durable controller, history, retrieval, task ledger, approvals
NVIDIA OpenShell       replaceable per-task execution sandboxes
NVIDIA NemoClaw        installs and maintains one hardened OpenClaw-on-OpenShell runtime
OpenClaw               macOS device gateway: menu bar, screen capture, computer control
Local Qwen/vLLM        shared host-side inference on the Dell GB10
```

Eve should remain the only user-facing planner. It should call OpenShell for shell/file work and call the OpenClaw Gateway as a device client for Mac screen/computer operations. Do not route normal Eve chat, history, retrieval, or task planning through an OpenClaw agent loop.

This is not a workaround; it follows NVIDIA's own separation of concerns. NVIDIA describes OpenClaw as the assistant runtime, OpenShell as the execution and policy environment, and NemoClaw as the host-side reference stack that packages the two with a versioned blueprint, inference routing, lifecycle management, and harder defaults. NVIDIA explicitly recommends OpenShell directly when building a custom internal orchestration abstraction. See [NemoClaw Ecosystem](https://docs.nvidia.com/nemoclaw/latest/user-guide/openclaw/about/ecosystem) and [NemoClaw Architecture](https://docs.nvidia.com/nemoclaw/latest/user-guide/openclaw/reference/architecture).

## 1. Relationship among the projects

### OpenShell

OpenShell is the agent-agnostic security and execution substrate. Its Gateway owns sandbox lifecycle, provider credentials, inference routes, policy, exec/file transfer, logs, and service forwarding. The CLI talks to that Gateway over gRPC. Sandboxes enforce filesystem restrictions with Landlock, syscall restrictions with seccomp, process and network isolation, and L7 egress policy. The sandbox receives credential placeholders; OpenShell substitutes the real credential at an approved network boundary. See the [OpenShell Gateway architecture](https://github.com/NVIDIA/OpenShell/blob/main/architecture/gateway.md), [CLI manual](https://github.com/NVIDIA/OpenShell/blob/main/deploy/man/openshell.1.md), and [provider model](https://github.com/NVIDIA/OpenShell/blob/main/docs/sandboxes/manage-providers.mdx).

### OpenClaw

OpenClaw is a local-first assistant product with its own always-on Gateway, agent loop, tools, channels, memory, sessions, nodes, WebChat, and native clients. Its Gateway is a WebSocket control plane; it is not the OpenShell sandbox boundary. See [OpenClaw's overview](https://docs.openclaw.ai/faq), [Gateway architecture](https://docs.openclaw.ai/architecture), and [agent loop](https://docs.openclaw.ai/concepts/agent-loop).

The native macOS app already supplies most of the requested desktop surface: a menu-bar companion, Option-Space Quick Chat, permission prompts, screen capture, and computer control. It connects as a Mac node to an OpenClaw Gateway. See [OpenClaw macOS app](https://docs.openclaw.ai/platforms/macos), [macOS IPC](https://docs.openclaw.ai/platforms/mac/xpc), and [computer use](https://docs.openclaw.ai/nodes/computer-use).

### NemoClaw

NemoClaw is NVIDIA's opinionated integration and lifecycle layer on top of OpenShell. It installs a compatible OpenShell runtime, builds a hardened agent image, applies a versioned YAML blueprint and network policy, registers inference credentials/routes, and preserves manifest-declared state across supported rebuilds. OpenClaw is the default selected agent, though current NemoClaw also supports Hermes and LangChain Deep Agents Code. See the [NemoClaw overview](https://docs.nvidia.com/nemoclaw/latest/about/overview.html), [architecture details](https://docs.nvidia.com/nemoclaw/latest/user-guide/openclaw/reference/architecture), and [state behavior](https://docs.nvidia.com/nemoclaw/user-guide/openclaw/manage-sandboxes/state-and-backups/understand-sandbox-state).

A NemoClaw deployment therefore has two distinct gateways:

- the host-side OpenShell Gateway, which owns security, sandboxes, provider custody, and inference routing;
- the in-sandbox OpenClaw Gateway, which owns OpenClaw sessions, clients, nodes, and agent/device RPCs.

Eve is a third agent runtime if allowed to plan independently. That is why OpenClaw should be restricted to device transport (and, optionally, a deliberately bounded specialist worker) rather than becoming a second general orchestrator.

## 2. What is actually runnable on the Dell GB10

### OpenShell: yes, on the normal supported path

OpenShell officially supports Debian/Ubuntu on `aarch64`, publishes Linux ARM64 binaries/images, and supports the Docker driver for single-machine gateways. It requires Docker 28 or newer; the inspected Dell has Ubuntu ARM64 and Docker 29.2.1. See the [OpenShell support matrix](https://docs.nvidia.com/openshell/latest/reference/support-matrix) and [installation guide](https://docs.nvidia.com/openshell/latest/about/installation).

Use the Docker driver, not a GPU MicroVM. Eve's work sandboxes do not need direct GPU access because they call the host-side Qwen service through a controlled route. This also avoids taking the GB10 away from vLLM. OpenShell's current GPU MicroVM path has a documented open GB10/DGX Spark VFIO limitation, while Docker/CDI is the normal supported GPU-container path if it is ever needed. See [NVIDIA/OpenShell issue #1780](https://github.com/NVIDIA/OpenShell/issues/1780) and [sandbox compute drivers](https://docs.nvidia.com/openshell/reference/sandbox-compute-drivers).

### NemoClaw: yes as generic Linux ARM64; do not spoof DGX Spark

NemoClaw's documented Linux + Docker path is applicable. However, NVIDIA explicitly says not to classify a system as DGX Spark from the GB10 GPU name alone. A Dell Pro Max GB10 should be allowed to pass NemoClaw's real platform preflight as the OEM system it is. See [NemoClaw prerequisites](https://docs.nvidia.com/nemoclaw/user-guide/openclaw/get-started/prerequisites) and the current [NemoClaw setup guidance](https://docs.nvidia.com/nemoclaw/latest/user-guide/openclaw/home).

The managed `qwen3.6-35b-a3b-nvfp4` recipe is registered for DGX Spark and N1x, not generic Linux NVIDIA GPU hosts. NemoClaw can reject an otherwise compatible GPU when the host profile is not registered. The reliable Dell path is therefore to run the already selected Qwen vLLM server on host loopback port 8000 and onboard NemoClaw with `NEMOCLAW_PROVIDER=vllm`. NemoClaw detects an existing vLLM endpoint, then routes sandbox calls through `inference.local`; the agent never connects to host vLLM directly. See [Set Up vLLM](https://docs.nvidia.com/nemoclaw/latest/user-guide/openclaw/inference/local-inference/set-up-vllm), [local inference choices](https://docs.nvidia.com/nemoclaw/user-guide/openclaw/inference/local-inference/choose-local-inference-server), and [inference provider support](https://docs.nvidia.com/nemoclaw/latest/reference/inference-profiles.html).

Only use NemoClaw's managed Qwen recipe if this exact machine's `nemoclaw profiles list --json` output marks it compatible. Do not bypass the host-profile gate.

### OpenClaw: yes, inside NemoClaw; macOS app on the Mac

NemoClaw's OpenClaw image runs in the OpenShell Docker sandbox on the Dell. The signed OpenClaw macOS app runs on each user's Mac and connects remotely to that OpenClaw Gateway. The app owns the stable macOS permission identity and exposes `screen.snapshot`, `computer.act`, `system.run`, notification, camera, and related node capabilities. See [macOS remote mode](https://docs.openclaw.ai/platforms/mac/remote) and [macOS IPC](https://docs.openclaw.ai/platforms/mac/xpc).

## 3. Integration seams

### A. Eve to OpenShell: primary task sandbox seam

OpenShell currently exposes a stable CLI and a gRPC Gateway. A mature TypeScript SDK is not yet the primary documented integration surface, so the safest Node integration today is an argv-based wrapper around the CLI (use `child_process.spawn`, never a shell-concatenated command). The CLI provides machine-readable create/list output, propagated remote exit codes, file upload/download, labels, selectors, logs, policy operations, and service forwarding. See [Manage Sandboxes](https://docs.nvidia.com/openshell/sandboxes/manage-sandboxes), the [complete CLI reference](https://github.com/NVIDIA/OpenShell/blob/main/.agents/skills/openshell-cli/cli-reference.md), and the [CLI manual](https://github.com/NVIDIA/OpenShell/blob/main/deploy/man/openshell.1.md).

Representative lifecycle:

```bash
# Install OpenShell on supported Linux ARM64.
curl -LsSf https://raw.githubusercontent.com/NVIDIA/OpenShell/main/install.sh | sh
openshell status

# Create a retained, policy-constrained task sandbox. Use a validated name.
openshell sandbox create \
  --name eve-job-<task-id> \
  --from base \
  --policy ./deploy/openshell/eve-task-policy.yaml \
  --label app=eve \
  --label workspace=<workspace-id> \
  --detach \
  --output json

# Execute without an OpenClaw model loop. Exit status propagates to Eve.
openshell sandbox exec \
  -n eve-job-<task-id> \
  --workdir /sandbox \
  --timeout 0 \
  --no-tty \
  -- <executable> <arg1> <arg2>

openshell sandbox upload eve-job-<task-id> ./checkpoint /sandbox/checkpoint
openshell sandbox download eve-job-<task-id> /sandbox/output ./output
openshell sandbox delete eve-job-<task-id>
```

For the MongoDB sponsor demonstration, MongoDB should hold the authoritative sandbox checkpoint and task cursor. Eve should:

1. create an OpenShell sandbox and hydrate the latest MongoDB/GridFS checkpoint;
2. run a bounded task phase;
3. archive changed workspace artifacts and task state back to MongoDB;
4. deliberately delete the sandbox;
5. create a different sandbox and resume from the MongoDB checkpoint.

That demonstrates an agent surviving the loss of its own execution environment. An OpenShell volume alone would not prove MongoDB is essential.

### B. Eve to OpenClaw Gateway: preferred Mac device seam, no second planner

The OpenClaw Gateway protocol is a versioned WebSocket API. Eve Hub connects to
that protocol directly; the similarly named npm package placeholders are not
usable client libraries. Keep the gateway loopback-only and provide its token
through server-side environment configuration.

See [Building a Gateway client](https://docs.openclaw.ai/gateway/clients) and the [Gateway protocol](https://docs.openclaw.ai/gateway/protocol).

Create a persistent Eve operator device identity and pair it with only the required scopes. `operator.read` is sufficient for discovery, while ordinary `node.invoke` and `tools.invoke` require `operator.write`; computer actions do not require `operator.admin`. See [operator scopes](https://docs.openclaw.ai/gateway/operator-scopes).

There are two valid call levels:

- Higher-level: call Gateway `tools.invoke` for the built-in `computer` tool. This keeps OpenClaw's tool policy and frame/observation validation in the path. A screenshot action returns a frame identifier; every coordinate action must echo the current frame identifier, and the caller must recapture after the scene changes.
- Lower-level: call `node.list`/`node.describe`, then `node.invoke` with `screen.snapshot` or `computer.act`. Inspect the node's advertised descriptor rather than assuming every action family is implemented.

The computer contract includes screenshot, click, drag, move, scroll, type, key, and wait operations. Capable providers can additionally expose app/window/accessibility-tree operations and browser actions. Screenshots are not automatically delivered to a chat channel, which is appropriate for Eve: pass them only to the local Qwen vision turn that requested them. See [Computer use](https://docs.openclaw.ai/nodes/computer-use) and [Nodes](https://docs.openclaw.ai/nodes).

OpenClaw also exposes `POST /tools/invoke`, but shared bearer authentication is full operator access and cannot be narrowed with headers. It must stay on loopback/private ingress and should be used only as a short hackathon bridge; the paired WebSocket client is the production-shaped seam. See the [Tools invoke API security boundary](https://docs.openclaw.ai/gateway/tools-invoke-http-api).

### C. NemoClaw/OpenClaw agent worker: available, but optional

NemoClaw has a documented programmatic worker command specifically for CI, evaluation harnesses, and multi-agent platforms:

```bash
nemoclaw eve-worker agent \
  --session-id <mongo-task-id> \
  --message-file - \
  --json \
  --timeout 0
```

It forwards to `openclaw agent` inside the sandbox and requires an explicit target selector. A direct one-shot command is also supported:

```bash
nemoclaw eve-worker exec \
  --workdir /sandbox/.openclaw/workspace \
  --no-tty \
  --timeout 0 \
  -- <executable> <args>
```

See the [NemoClaw command reference](https://docs.nvidia.com/nemoclaw/user-guide/openclaw/reference/commands), [CLI selection guide](https://docs.nvidia.com/nemoclaw/latest/user-guide/openclaw/reference/cli-selection-guide), and [OpenClaw agent CLI](https://docs.openclaw.ai/cli/agent).

The `agent` form starts a second planner with its own session, tools, prompt, and persistence. Use it only for a narrowly named specialist job where this is intentional, such as a self-contained coding or research worker. Store its task status and final artifacts in MongoDB and return its result to Eve; do not expose its session as the user's canonical history. The `exec` form is preferable for ordinary sandbox commands because it does not add another LLM loop.

There is a current open report against the wrapper returning no output in one DGX Spark scenario. Keep a tested fallback to the equally documented `nemoclaw <name> exec -- openclaw agent ...` path and pin the release validated at the hackathon. See [NVIDIA/NemoClaw issue #8796](https://github.com/NVIDIA/NemoClaw/issues/8796).

## 4. Installation and configuration surfaces

### Install NemoClaw against the existing Qwen vLLM service

The official installer can perform non-interactive onboarding. For the Dell, select the existing vLLM server rather than a managed DGX-Spark-only profile:

```bash
curl -fsSL https://www.nvidia.com/nemoclaw.sh | \
  NEMOCLAW_NON_INTERACTIVE=1 \
  NEMOCLAW_ACCEPT_THIRD_PARTY_SOFTWARE=1 \
  NEMOCLAW_AGENT=openclaw \
  NEMOCLAW_PROVIDER=vllm \
  NEMOCLAW_VLLM_PORT=8000 \
  NEMOCLAW_SANDBOX_NAME=eve-device \
  NEMOCLAW_AGENT_HEARTBEAT_EVERY=0m \
  bash

nemoclaw eve-device status
```

The installer pattern and provider mapping are documented in the [OpenClaw quickstart](https://docs.nvidia.com/nemoclaw/latest/user-guide/openclaw/get-started/quickstart); heartbeat disablement is documented in [Configure OpenClaw Agent Heartbeats](https://docs.nvidia.com/nemoclaw/user-guide/openclaw/configure-agents/configure-agent-heartbeats). Skip NemoClaw's web-search and messaging options so Eve remains the sole capability and enterprise-connector gate.

If NemoClaw is already installed, use:

```bash
NEMOCLAW_PROVIDER=vllm \
NEMOCLAW_VLLM_PORT=8000 \
NEMOCLAW_AGENT_HEARTBEAT_EVERY=0m \
nemoclaw onboard \
  --name eve-device \
  --agent openclaw \
  --non-interactive \
  --no-sandbox-gpu
```

Check the platform and catalog before any managed-model attempt:

```bash
nemoclaw host probe --json
nemoclaw profiles list --json
```

### Expose and pair the Mac node

NemoClaw forwards the in-sandbox OpenClaw Gateway to a host dashboard/API port, default `18789`. Keep it on loopback and use a private SSH tunnel where possible:

```bash
ssh -N -L 18789:127.0.0.1:18789 dell@10.0.0.88
```

Then configure the Mac app to use the local end of that tunnel and provide the Gateway token through a secure local environment/credential flow:

```bash
openclaw-mac configure-remote \
  --direct-url ws://127.0.0.1:18789 \
  --token "$OPENCLAW_GATEWAY_TOKEN"
```

NemoClaw exposes `nemoclaw eve-device gateway-token --quiet` specifically for automation, but the token is password-equivalent and must not be logged, committed, or sent to a browser. See [NemoClaw dashboard/gateway token commands](https://docs.nvidia.com/nemoclaw/user-guide/openclaw/reference/commands) and [OpenClaw remote mode](https://docs.openclaw.ai/platforms/mac/remote).

For a same-LAN demo without an SSH tunnel, NemoClaw supports `NEMOCLAW_DASHBOARD_BIND=0.0.0.0` during onboarding and later connects. That is a deliberate exposure opt-in; production should use SSH, Tailnet, or authenticated WSS. See the [NemoClaw port and bind controls](https://docs.nvidia.com/nemoclaw/latest/user-guide/openclaw/reference/commands) and [gateway authentication controls](https://docs.nvidia.com/nemoclaw/user-guide/openclaw/security/security-controls/gateway-authentication-controls).

After the Mac connects, approve the exact pending node declaration. `screen.snapshot` becomes available after the declared command surface is approved. `computer.act` is advertised only while Computer Control is enabled locally. See [Nodes command policy](https://docs.openclaw.ai/nodes) and [computer-use authorization](https://docs.openclaw.ai/nodes/computer-use).

### Tool policy for the high-level `computer` tool

If Eve uses Gateway `tools.invoke` instead of raw `node.invoke`, expose the high-level tool in OpenClaw's policy:

```json5
{
  tools: {
    alsoAllow: ["computer"],
    sandbox: { tools: { alsoAllow: ["computer"] } }
  }
}
```

NemoClaw-managed config changes should go through its host-side `config set` flow while Shields are down, followed by restart and Shields restoration; do not edit `openclaw.json` behind NemoClaw. See the [NemoClaw config commands](https://docs.nvidia.com/nemoclaw/user-guide/openclaw/reference/commands) and [OpenClaw computer tool policy](https://docs.openclaw.ai/nodes/computer-use).

## 5. The macOS UX decision

Next.js remains the right framework for the shared web application, self-hosted with Eve on the GB10. It is not sufficient for a menu-bar app, global hotkey, Screen Recording, Accessibility, or durable TCC attribution.

The stock OpenClaw app already has the required native Option-Space/menu-bar interaction and node implementation. However, its unchanged Quick Chat sends messages to OpenClaw's own sessions, not Eve. Treating that as the Eve frontend would split user history between MongoDB/Eve and OpenClaw's own store.

There are two honest paths:

1. Hackathon path: use the stock OpenClaw app as the Mac node/device broker; keep the Eve web UI as the canonical chat surface. Demonstrate screen context and computer use from the web app.
2. Product path: fork the open-source macOS app's Quick Chat transport so the composer talks to the Eve web/session API while retaining the OpenClaw node, permissions, and computer-control implementation. Review third-party bundled component licenses before redistributing a rebranded build. The source repository is [openclaw/openclaw](https://github.com/openclaw/openclaw).

Do not put an OpenClaw agent in front of Eve merely to reuse Quick Chat. That would introduce a second prompt/agent loop and duplicate history for a UI convenience.

## 6. Security and enterprise constraints

- **Per-action approval belongs in Eve.** Once Computer Control, node pairing, Accessibility, and Screen Recording are enabled, OpenClaw has no per-action confirmation. Eve must ask before every mutating `computer.act`, enforce the user's `computerUse` toggle, and audit the approved action in MongoDB. The Mac app's local Computer Control switch is the emergency revocation. See [OpenClaw computer-use authorization](https://docs.openclaw.ai/nodes/computer-use).
- **Screen content is untrusted.** Every screen/tool result must be treated as potential prompt injection. A computer action must use the current screenshot frame/observation and recapture after state changes. See [OpenClaw computer-use safety](https://docs.openclaw.ai/nodes/computer-use).
- **Keep Gateway secrets server-side.** The OpenClaw shared token is full operator authority, including on `/tools/invoke`. Prefer a paired Eve Gateway client with `operator.read`/`operator.write`; keep the shared bootstrap token only for pairing/recovery. See [Building a Gateway client](https://docs.openclaw.ai/gateway/clients) and [operator scopes](https://docs.openclaw.ai/gateway/operator-scopes).
- **Separate trust boundaries.** A shared OpenClaw Gateway token is not tenant-scoped. For an enterprise rollout, allocate a separate OpenClaw Gateway/NemoClaw sandbox per customer trust boundary (or use a fully reviewed identity-bearing proxy design). Map each authenticated Eve user to an approved node id in MongoDB.
- **No GPU in task sandboxes.** Keep Qwen/vLLM on the GB10 host and run OpenShell work sandboxes CPU-only. This avoids GPU contention and keeps the model credential/endpoint behind OpenShell or Eve's controlled route.
- **Pin versions for the demo.** NemoClaw is evolving quickly and its blueprint pins a compatible OpenShell range. Pin and retest NemoClaw, OpenShell, OpenClaw, and the Gateway client/protocol packages together. The Gateway protocol documentation explicitly says to upgrade client and Gateway together on protocol changes. See [Gateway client version guidance](https://docs.openclaw.ai/gateway/clients).

## Concise recommendation

Build the Next.js/Eve/MongoDB product as planned. Replace the custom ad-hoc Docker sandbox with an Eve `OpenShellSandboxBackend` that checkpoints to MongoDB. Install one NemoClaw-managed `eve-device` OpenClaw sandbox on the Dell and connect the stock OpenClaw macOS app as a node. Have Eve call that Gateway's typed computer/device API directly, with Eve approvals, so OpenClaw never plans the user's normal task. Use `nemoclaw ... agent` only for a named optional specialist worker.

This is useful—not sponsor-box decoration—and gives a clean demo story:

1. user asks Eve from the web;
2. MongoDB retrieval injects a business convention that visibly changes Eve's answer/plan;
3. Eve sees the Mac through OpenClaw and, after approval, acts through `computer.act`;
4. Eve runs long work in an OpenShell sandbox;
5. the sandbox is destroyed;
6. Eve recreates it from MongoDB and continues the same task.
