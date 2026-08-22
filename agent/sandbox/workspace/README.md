# Eve workspace

This isolated workspace belongs to one durable conversation. Store working notes,
downloaded business artifacts, scripts, and deliverables here.

Important behavior:

- The sandbox has no network access. Use trusted Eve tools for web, email, and business data.
- Read `CONVENTIONS.md` before creating a deliverable.
- Prefer reproducible scripts under `scripts/` and final outputs under `deliverables/`.
- MongoDB checkpoints this workspace after completed turns and restores it if the sandbox is replaced.
