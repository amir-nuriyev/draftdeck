# DraftDeck Frontend

Next.js frontend for Assignment 2.

## What it implements

- JWT login/register shell with silent refresh.
- Draft board + role-aware draft cockpit.
- Rich-text editor (Tiptap) with headings, bold/italic, lists, code blocks.
- Yjs-based collaborative editing over authenticated websocket.
- Presence indicators with selection ranges.
- Autosave status states: `saving`, `saved`, `offline`, `error`.
- AI streaming UI (SSE), cancel, compare original vs suggestion, partial acceptance, undo after apply.
- Snapshot management, collaborators, share links, exports.
- Share resolve page: `/share/[token]`.

## Run locally

```bash
cd frontend
npm install
cp .env.example .env.local
npm run dev -- --hostname 127.0.0.1 --port 3000
```

Open `http://127.0.0.1:3000`.

## Environment

- `NEXT_PUBLIC_API_BASE_URL` (default `http://127.0.0.1:8000/api`)
- `NEXT_PUBLIC_WS_BASE_URL` (default `ws://127.0.0.1:8000/ws`)

## Scripts

- `npm run lint`
- `npm run build`
- `npm run test:unit`
- `npm run test:e2e`
- `npm run test:e2e:install`

## Tests

- Unit/component tests: auth shell, autosave indicator, AI diff/partial-accept UI.
- Playwright e2e tests: login→edit→AI accept flow, sharing/role enforcement, collaboration sync, snapshots/export, public share resolve.
