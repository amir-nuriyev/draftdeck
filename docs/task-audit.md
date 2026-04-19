# Assignment 2 Task Audit

Date: 2026-04-19

This audit tracks implemented runtime scope against Assignment 2 requirements (including bonus items requested).

## Core App (Part 1)

- Authentication/session lifecycle: Implemented
  - JWT access + refresh rotation, logout revocation, hashed passwords.
- Protected API routes: Implemented
  - Bearer auth enforced through dependency layer.
- Document management: Implemented
  - Draft CRUD, metadata, dashboard listing, autosave, snapshots, restore.
- Rich-text editing baseline: Implemented
  - Tiptap with headings/bold/italic/lists/code blocks.
- Server-side role enforcement: Implemented
  - Owner/editor/viewer/commenter checks on REST + websocket write messages.

## Real-Time Collaboration (Part 2)

- Authenticated websocket transport: Implemented
- Concurrent editing baseline: Implemented
- Character-level conflict resolution (bonus): Implemented
  - Yjs update synchronization across clients.
- Presence/awareness baseline: Implemented
  - Online participants + live selection range display.
- Reconnect lifecycle: Implemented
  - Automatic websocket reconnect + pending local update flush.
- Offline editing graceful behavior: Implemented
  - Local draft cache + autosave resumes on reconnect.

## AI Assistant (Part 3)

- AI feature set (>=2): Implemented
  - rewrite, summarize, translate, restructure, expand, grammar, custom.
- Streaming (hard requirement): Implemented
  - SSE token streaming with progressive UI rendering.
- Cancel in-progress generation: Implemented
- Compare/accept/reject/edit UX: Implemented
- Undo after acceptance: Implemented
- Partial acceptance bonus: Implemented
  - diff-segment selection and partial apply path.
- Prompt configurability + provider abstraction: Implemented
- AI interaction history: Implemented

## Testing & Quality (Part 4)

- Backend unit/integration/websocket tests: Implemented (`pytest`)
- Frontend component tests: Implemented (`vitest` + RTL)
- End-to-end bonus tests: Implemented (`playwright`)
- Single-command local startup: Implemented (`run.sh`, `Makefile`)
- `.env.example` coverage: Implemented (backend + frontend)
- FastAPI API docs with operation metadata: Implemented
- Deviation report: Implemented (`DEVIATIONS.md`)

## Bonus Coverage (Part 3 + rubric bonus section)

- CRDT character-level collaboration: Implemented (Yjs updates)
- Cursor/selection awareness bonus: Implemented (selection visualization in live presence cards)
- Share-by-link with revocation: Implemented
- Partial acceptance of AI suggestions: Implemented
- End-to-end tests for login→AI acceptance: Implemented

