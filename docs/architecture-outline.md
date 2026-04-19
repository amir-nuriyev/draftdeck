# DraftDeck A2 Architecture Outline

## Runtime Shape

- `frontend/` (Next.js + React): auth shell, board, cockpit, share resolve view.
- `backend/` (FastAPI): REST API + websocket collaboration endpoint.
- `SQLite` (`backend/data/*.db`): local persistence.
- `LM Studio` (or `LLM_MOCK=true`): AI provider.

## Backend Modules

- `app/routers/auth.py`: register/login/refresh/logout/me.
- `app/routers/drafts.py`: draft CRUD, versions, snapshots, collaborators, exports, share-link CRUD.
- `app/routers/share.py`: `/share/{token}/resolve` flow.
- `app/routers/assistant.py`: sync + streaming suggestions, cancel, run history/decision updates.
- `app/main.py`: route registration, CORS, websocket token auth, realtime message policy.
- `app/realtime.py`: room connection manager, presence, conflict warnings, Yjs update replay buffer.
- `app/prompts.py` + `app/llm_provider.py`: prompt templates and provider abstraction.

## Frontend Modules

- `app/components/auth-shell.tsx`: login/register shell + session bootstrap.
- `app/components/workspace-board.tsx`: draft listing + creation.
- `app/components/draft-cockpit.tsx`: rich editing, realtime, assistant UX, sharing, snapshots.
- `app/components/share-resolve-view.tsx`: share-token resolve and read/open flow.
- `app/lib/api.ts`: typed API client, bearer auth, refresh retry, SSE parser.
- `app/lib/auth.ts`: token storage + refresh helper.

## Data Model Highlights

- `Member`, `RefreshSession`
- `Draft`, `DraftVersion`, `DraftSnapshot`
- `DraftCollaborator`
- `ShareLink`
- `AssistantRun`

## Collaboration/Data Flow

- Document load: `GET /api/drafts/{id}`.
- Realtime: websocket join with JWT query token.
- Local rich-text edits: Yjs updates sent as websocket `yjs:update` messages.
- Presence: websocket `presence:update` and server `presence:sync`.
- Persistence: autosave `PATCH /api/drafts/{id}` (debounced), snapshots/versions recorded server-side.

## AI Flow

- Client sends `POST /api/assistant/suggest/stream`.
- Backend streams token chunks (`text/event-stream`).
- Client renders progressive output, supports cancel via `POST /api/assistant/runs/{id}/cancel`.
- User compares original vs suggestion, accepts/rejects/partially applies, can undo applied change.
- All runs persisted in `AssistantRun` with prompt/model/provider/output/decision metadata.
