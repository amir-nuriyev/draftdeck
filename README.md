# DraftDeck

`DraftDeck` is a refactored proof of concept for the collaborative editor assignment. It still demonstrates realtime editing, role-aware access, snapshots, exports, and local LLM-assisted writing, but it does so with a different product identity, a new staged-draft workflow, and different API/data contracts than the source repository.

## What changed from the base repo

- The product is now framed as a writing cockpit, not a generic document workspace.
- Route names changed from `documents`/`ai`/`users` to `drafts`/`assistant`/`members` plus a `studio` summary API.
- The backend data model now tracks `Draft`, `DraftSnapshot`, `DraftCollaborator`, and `AssistantRun`.
- The frontend is now a board-and-cockpit experience with lane filters, presence cards, an assistant dock, and share controls.
- AI history now records decision state: `pending`, `accepted`, `rejected`, or `partial`.

## Run locally

### Backend

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
uvicorn app.main:app --reload
```

### Frontend

```bash
cd frontend
npm install
cp .env.example .env.local
npm run dev
```

Backend: `http://127.0.0.1:8000`
Frontend: `http://localhost:3000`

If LM Studio is not running yet, set `LLM_MOCK=true` in [backend/.env.example](/Users/amir.nuriyev/Downloads/lab/lab9/draftdeck/backend/.env.example).

## Demo personas

- `Owner`: Maya Stone
- `Editor`: Omar Vale
- `Commenter`: Irene Park
- `Viewer`: Nika Ross

The frontend stores the selected persona in local storage and sends the matching `X-User-Id` header to the backend.

## Verified checks

- Backend: `. .venv/bin/activate && pytest -q`
- Frontend: `npm run lint`
- Frontend: `npm run build`

## Assignment-aligned scope

- Working frontend to backend communication
- Local SQLite persistence
- Realtime collaboration presence and live draft patches over WebSocket
- Role-based sharing and access control
- Snapshot create and restore
- Local LLM suggestion requests with mock fallback

## Intentional PoC limits

- No production auth or organization management
- No CRDT or operational transform conflict resolution
- No persistent websocket event store
- No deployment or cloud infrastructure

## Additional notes

- Architecture notes: [docs/architecture-outline.md](/Users/amir.nuriyev/Downloads/lab/lab9/draftdeck/docs/architecture-outline.md)
- Mermaid sources: [diagrams/c4-level-1-system-context.mermaid](/Users/amir.nuriyev/Downloads/lab/lab9/draftdeck/diagrams/c4-level-1-system-context.mermaid), [diagrams/c4-level-2-container.mermaid](/Users/amir.nuriyev/Downloads/lab/lab9/draftdeck/diagrams/c4-level-2-container.mermaid), [diagrams/c4-level-3-backend-components.mermaid](/Users/amir.nuriyev/Downloads/lab/lab9/draftdeck/diagrams/c4-level-3-backend-components.mermaid), [diagrams/data-model-er.mermaid](/Users/amir.nuriyev/Downloads/lab/lab9/draftdeck/diagrams/data-model-er.mermaid)
