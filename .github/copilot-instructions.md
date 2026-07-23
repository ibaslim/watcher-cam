# Motion Detection AI Camera Portal - Copilot Instructions

## Mandatory Context First

Before starting any task, read `PROJECT_CONTEXT.md`. It is the canonical project map and contains the architecture, code ownership map, commands, configuration guidance, workflows, and validation rules.

Read `COMPUTER_USE_TESTING.md` only for end-to-end browser/webcam verification tasks. Read `training/README.md` only for model-training tasks. Do not read every project document or crawl the repository when the context map identifies the owning files.

## Task Workflow

1. Read `PROJECT_CONTEXT.md` before every task.
2. Identify the owning service and exact file from its repository map.
3. Read only the relevant nearby implementation and its tests or call sites.
4. Before editing, state one local hypothesis about the controlling code path and one cheap check that could disconfirm it.
5. Make the smallest focused change that tests the hypothesis.
6. After the first substantive edit, run the narrowest useful validation immediately.
7. If validation fails, repair the same slice and rerun it before expanding scope.
8. Update `PROJECT_CONTEXT.md` only when architecture, commands, routes, configuration, or operational behavior changes.

## Exploration Rules

- Prefer targeted file and symbol searches over broad repository crawling.
- Start from the most concrete anchor: a named file, symbol, failing behavior, failing command, test, or nearby implementation.
- If a file only wires or forwards behavior, follow the nearest hop to the code that computes or controls it.
- Reuse repository patterns and existing helpers before introducing abstractions.
- Keep changes limited to the requested behavior; do not repair unrelated issues.
- Never discard existing user changes. Work with them unless they make the task impossible.
- Do not commit, create branches, reset, or revert changes unless explicitly requested.

## Validation Rules

- Prefer a behavior-scoped check or narrow test over a full build.
- For frontend changes, use the narrowest relevant TypeScript/build check, normally `pnpm run build` from `frontend/` when no narrower check exists.
- For backend or detector changes, use the relevant tests, health check, or service command before broad Docker validation.
- Finish with at least one executable post-edit validation whenever the environment provides one.
- Report any validation that could not be run and why.

## Project Safety and Security

- Do not expose secrets, camera passwords, database files, guard photos, or model artifacts.
- Default admin credentials are for a fresh database only and must be changed in production.
- Keep MediaMTX control port `9997` private.
- Use a TLS reverse proxy for public deployments.
- Do not use destructive database or data commands without explicit user direction.

## Frontend Rules

- Follow the existing React, Tailwind, and component patterns in the repository.
- Do not introduce undefined CSS variables in JSX/TSX.
- Use Tailwind utilities or existing design tokens for styling.
- Give `<img>` and `<svg>` elements explicit HTML dimensions as well as CSS sizing.
- Preserve responsive layouts and verify that text and controls do not overlap.
- Use existing icon libraries when available instead of hand-drawn SVG icons.
