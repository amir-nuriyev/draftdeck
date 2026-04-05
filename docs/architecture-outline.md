# DraftDeck Architecture Outline

`DraftDeck` is a local-first collaborative writing cockpit for the February 2026 assignment brief. It stays in the same problem domain as the reference repo, but the product framing, API contracts, data model, and frontend workflow have been redesigned around staged drafts rather than a generic document dashboard.

## Product shape

- `board`: a stage-based board for concept, drafting, and review work.
- `cockpit`: a split layout for editing, realtime room awareness, AI suggestions, snapshots, and sharing.
- `assistant`: suggestion requests are recorded as explicit runs with `pending`, `accepted`, `rejected`, or `partial` outcomes.

## Containers

- `frontend/`: Next.js 16 app router UI.
- `backend/`: FastAPI API plus realtime WebSocket hub.
- `backend/data/draftdeck.db`: local SQLite persistence.
- `LM Studio`: local LLM endpoint, with `LLM_MOCK=true` fallback for demos and tests.

## Backend modules

- `app/routers/drafts.py`: draft CRUD, snapshots, collaborators, and export routes.
- `app/routers/assistant.py`: AI suggestion request and assistant run history.
- `app/routers/session.py`: current demo session identity and capability flags.
- `app/routers/studio.py`: board summary metrics for the frontend header.
- `app/routers/members.py`: demo member list and current member route.
- `app/deps.py`: shared auth header parsing and role checks.
- `app/realtime.py`: in-memory room presence and live patch fan-out.

## Data model

- `Member`: seeded local users for owner, editor, commenter, and viewer perspectives.
- `Draft`: staged writing artifact with `title`, `brief`, `content`, `stage`, and `accent`.
- `DraftCollaborator`: per-draft access role for non-owner members.
- `DraftSnapshot`: named content checkpoints that can be restored.
- `AssistantRun`: selection-aware AI history with decision tracking.

## API surface

- `GET /api/health`
- `GET /api/studio/overview`
- `GET /api/session`
- `GET|POST /api/drafts`
- `GET|PATCH|DELETE /api/drafts/{id}`
- `GET|POST /api/drafts/{id}/snapshots`
- `POST /api/drafts/{id}/snapshots/{snapshot_id}/restore`
- `GET|POST /api/drafts/{id}/collaborators`
- `DELETE /api/drafts/{id}/collaborators/{member_id}`
- `GET /api/drafts/{id}/export?format=md|txt|json`
- `POST /api/assistant/suggest`
- `GET /api/assistant/runs`
- `PATCH /api/assistant/runs/{run_id}`
- `GET /api/members`
- `GET /api/members/me`
- `WS /ws/drafts/{draft_id}`

## Distinct design choices

- The UI is lane-based rather than a file list plus editor.
- Realtime messages use `draft:patch`, `assistant:status`, `snapshot:restored`, and `conflict:warning` events instead of a generic document update event.
- AI requests route to a fast or deep local model based on feature type, rather than a single model setting.
- AI history stores the selection, context excerpt, and user decision, which supports later audit of accepted versus rejected suggestions.
