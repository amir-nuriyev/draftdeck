# DraftDeck (AI1220 Assignment 2)

`DraftDeck` is a collaborative writing cockpit with JWT auth, realtime editing, and a streaming AI assistant.

## What changed from the base repo

- Product framing shifted to a staged drafting cockpit.
- API now uses `drafts`, `assistant`, `members`, `studio`, `auth`, and `share` routes.
- Data model expanded for `RefreshSession`, `DraftVersion`, `ShareLink`, and richer `AssistantRun` history.
- Realtime collaboration now uses authenticated WebSocket sessions with role-based write enforcement.
- AI flow now supports both synchronous and SSE streaming suggestions with cancellation.

## Run locally

### One command

```bash
./run.sh
```

or:

```bash
make run
```

### Manual start

Backend:

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
uvicorn app.main:app --host 127.0.0.1 --port 8000 --reload
```

Frontend:

```bash
cd frontend
npm install
cp .env.example .env.local
npm run dev -- --hostname 127.0.0.1 --port 3000
```

- Frontend: `http://127.0.0.1:3000`
- Backend: `http://127.0.0.1:8000`
- API docs: `http://127.0.0.1:8000/docs`

## LM Studio live mode

1. Start LM Studio and load a chat model.
2. Enable local server at `http://127.0.0.1:1234`.
3. Check available model IDs:

```bash
curl http://127.0.0.1:1234/v1/models
```

4. Set in `backend/.env`:

```env
LLM_MOCK=false
LLM_FAST_MODEL=<model-id-from-lm-studio>
LLM_DEEP_MODEL=<model-id-from-lm-studio>
```

5. Restart backend and verify:

```bash
curl http://127.0.0.1:8000/api/health
```

Expected: `"assistant_mode":"live"`.

### Mock fallback

Set `LLM_MOCK=true` in `backend/.env` to run assistant flows without LM Studio.

## Demo accounts (seeded)

- `maya / owner123` (Owner)
- `omar / editor123` (Editor)
- `irene / comment123` (Commenter)
- `nika / viewer123` (Viewer)

## Verified checks

- Backend: `. .venv/bin/activate && pytest -q`
- Frontend: `npm run lint`
- Frontend: `npm run build`
- Frontend: `npm run test:unit`
- Frontend: `npm run test:e2e`

## Assignment-aligned scope

- JWT auth lifecycle with refresh rotation and revocation
- Draft CRUD with autosave, versions/snapshots, collaborators, and exports
- Rich-text editing (Tiptap) with authenticated realtime collaboration
- Presence and Yjs update sync over WebSocket
- AI streaming + cancel + accept/reject/partial apply + undo
- Share-by-link with revocation and access-mode enforcement

## Docs and diagram links

- Architecture outline: [docs/architecture-outline.md](docs/architecture-outline.md)
- Task audit: [docs/task-audit.md](docs/task-audit.md)
- A2 compliance checklist: [docs/a2-compliance-checklist.md](docs/a2-compliance-checklist.md)
- Deviation note: [DEVIATIONS.md](DEVIATIONS.md)
- System context (C4 L1): [diagrams/c4-level-1-system-context.mermaid](diagrams/c4-level-1-system-context.mermaid)
- Container diagram (C4 L2): [diagrams/c4-level-2-container.mermaid](diagrams/c4-level-2-container.mermaid)
- Backend components (C4 L3): [diagrams/c4-level-3-backend-components.mermaid](diagrams/c4-level-3-backend-components.mermaid)
- Data model ER: [diagrams/data-model-er.mermaid](diagrams/data-model-er.mermaid)
