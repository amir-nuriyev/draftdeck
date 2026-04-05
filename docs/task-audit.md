# Assignment Audit

This file checks the current `DraftDeck` PoC against the assignment brief and distinguishes between:

- `Implemented`: present in code and exercised by tests.
- `Partial`: present in a limited PoC form.
- `Document-only`: described in docs but not implemented as runtime behavior.

## Part 4 PoC Minimum

| Requirement | Status | Evidence |
|---|---|---|
| Working frontend | Implemented | `frontend/app/page.tsx`, `frontend/app/drafts/[id]/page.tsx` |
| Frontend to backend communication | Implemented | `frontend/app/lib/api.ts`, FastAPI routes under `backend/app/routers/` |
| Data contract validation | Implemented | backend pytest suite in `backend/tests/` |
| Clear README | Implemented | `README.md`, `backend/README.md`, `frontend/README.md` |

## Functional Scope

| Capability area from brief | Status | Notes |
|---|---|---|
| Real-time collaboration | Partial | Presence, live patch fan-out, reconnect behavior, and overlap conflict warnings are implemented. Full OT/CRDT conflict resolution is not. |
| Presence awareness (who is online, where) | Implemented | WebSocket presence sync includes cursor/selection metadata. |
| Conflict handling for same region edits | Partial | Overlapping edit warnings are implemented via `conflict:warning`. Automatic merge/reconciliation is not. |
| AI writing assistant | Implemented | Rewrite, summarize, translate, restructure, suggestion review, accept/reject/partial apply, and history tracking. |
| Document management | Implemented | Draft CRUD, sharing, snapshots, restore, export. |
| User management | Partial | Demo-header auth, role enforcement, and session introspection endpoint exist. Production authentication is not implemented. |
| Session handling | Partial | `GET /api/session` returns current member, draft role, and capability flags. There is no persistent login flow. |

## Assignment-specific Quality Points

| Brief expectation | Status | Notes |
|---|---|---|
| Authorization for owner/editor/commenter/viewer | Implemented | Backend role checks cover edit, assistant use, snapshot restore, and collaborator management. |
| Suggestion accept/reject flow | Implemented | Assistant runs track `pending`, `accepted`, `rejected`, and `partial`. |
| Export to common formats | Implemented | Markdown, text, and JSON exports. |
| AI unavailable fallback | Implemented | Mock mode plus 502-style error handling for LM Studio failures. |
| Reconnect communication model | Partial | Frontend reconnects the WebSocket and restores room presence; offline persistence is not implemented. |

## Automated Coverage

The backend test suite currently covers:

- draft create/read/update/share/export/restore flows
- unauthorized access rejection
- session capability reporting
- assistant mock responses and decision updates
- realtime presence, patch events, and overlap conflict warnings

Run with:

```bash
cd backend
. .venv/bin/activate
pytest -q
```

## Remaining non-PoC items

These are still intentionally outside the current implementation:

- production auth, passwords, OAuth, or JWT login
- persistent server-side session store
- CRDT or operational transform merge logic
- organization-wide quotas and billing
- full report sections for requirements engineering, project management, ADRs, and timeline
