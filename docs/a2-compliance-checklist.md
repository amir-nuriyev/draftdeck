# Assignment 2 Compliance Checklist

Date: 2026-04-19

## Part 1: Core Application

- [x] Registration/login with hashed passwords
  - `backend/app/routers/auth.py`, `backend/app/security.py`
- [x] JWT access + refresh lifecycle (rotation + revocation)
  - `backend/app/routers/auth.py`, `backend/app/models.py::RefreshSession`
- [x] Auth-required API endpoints
  - `backend/app/deps.py::get_current_member`
- [x] Session persists and refreshes without editing interruptions
  - `frontend/app/lib/auth.ts`, `frontend/app/lib/api.ts`
- [x] Draft CRUD with metadata + dashboard listing
  - `backend/app/routers/drafts.py`, `frontend/app/components/workspace-board.tsx`
- [x] Rich-text editor (headings/bold/italic/lists/code blocks)
  - `frontend/app/components/draft-cockpit.tsx` (Tiptap)
- [x] Autosave with explicit states (`saving`, `saved`, `offline`, `error`)
  - `frontend/app/components/draft-cockpit.tsx`, `frontend/app/components/autosave-indicator.tsx`
- [x] Version/snapshot history and restore
  - `backend/app/routers/drafts.py`, cockpit snapshot UI
- [x] Role-based access control (owner/editor/viewer/commenter), enforced server-side
  - `backend/app/deps.py`, `backend/app/main.py` (ws message write gating)

## Part 2: Real-Time Collaboration

- [x] Authenticated websocket transport
  - `backend/app/main.py::draft_socket`
- [x] Concurrent editing with reconnect lifecycle
  - `frontend/app/components/draft-cockpit.tsx`, `backend/app/realtime.py`
- [x] Presence awareness (`who is online`)
  - `backend/app/realtime.py::get_room_presence`, cockpit live-room UI
- [x] Graceful offline editing + sync on reconnect
  - local draft cache + pending realtime queue flush in cockpit

## Part 3: AI Writing Assistant

- [x] >=2 AI features (implemented 7)
  - `frontend/app/lib/types.ts`, `backend/app/prompts.py`
- [x] Streaming responses (hard requirement)
  - `POST /api/assistant/suggest/stream`, `frontend/app/lib/api.ts::streamSuggestion`
- [x] Cancel in-progress generation
  - `POST /api/assistant/runs/{run_id}/cancel`
- [x] Suggestion UX: compare + accept/reject/edit
  - cockpit assistant panel
- [x] Undo after acceptance
  - cockpit undo stack (`Undo last AI apply`)
- [x] Context trimming for long content
  - `backend/app/prompts.py::_clip`
- [x] Configurable prompt templates + provider abstraction
  - `backend/app/prompts.py`, `backend/app/llm_provider.py`
- [x] AI interaction history logging + UI
  - `backend/app/models.py::AssistantRun`, `GET /api/assistant/runs`

## Part 4: Testing & Quality

- [x] Backend unit/integration/websocket tests
  - `backend/tests/test_drafts.py`, `backend/tests/test_assistant_and_realtime.py`
- [x] Frontend component tests
  - `frontend/tests/unit/*`
- [x] E2E tests (bonus)
  - `frontend/tests/e2e/*`
- [x] Single-command run setup
  - `run.sh`, `Makefile`
- [x] `.env.example` provided (backend + frontend)
  - `backend/.env.example`, `frontend/.env.example`
- [x] FastAPI docs with route summaries/schemas
  - available via `/docs`
- [x] Deviation report
  - `DEVIATIONS.md`

## Bonus Items

- [x] Character-level conflict resolution (CRDT)
  - Yjs update propagation (`yjs:update`) across websocket clients
- [x] Cursor/selection awareness rendering
  - realtime selection ranges with per-user colors in live-room cards
- [x] Share-by-link with revocation
  - share-link endpoints + `/share/[token]` frontend flow
- [x] Partial acceptance of AI suggestions
  - diff segment toggles + partial apply decision
- [x] End-to-end login → edit → AI acceptance path
  - `frontend/tests/e2e/smoke.spec.ts`
