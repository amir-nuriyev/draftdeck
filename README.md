# DraftDeck (AI1220 Assignment 2)

DraftDeck is a collaborative document editor with JWT auth, realtime collaboration, and a streaming AI writing assistant.

## Included A2 scope

- JWT register/login/refresh/logout/me with hashed passwords
- Draft CRUD, autosave, snapshots, restore, collaborators, exports
- Rich-text editor (Tiptap): headings, bold, italic, lists, code blocks
- Authenticated realtime websocket collaboration + presence
- Yjs character-level collaborative updates
- AI features: rewrite, summarize, translate, restructure, expand, grammar, custom
- SSE streaming suggestions + cancel + compare/apply/reject/edit + partial acceptance + undo
- AI interaction history logging
- Share-by-link with role/mode and revocation + `/share/[token]` resolve page

## Quick Start

### One command

```bash
./run.sh
```

or

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

## Demo Accounts (seeded)

- `maya / owner123`
- `omar / editor123`
- `irene / comment123`
- `nika / viewer123`

## Environment

- Backend keys: see `backend/.env.example`
- Frontend keys: see `frontend/.env.example`

## Verification

Backend tests:

```bash
cd backend
source .venv/bin/activate
pytest -q
```

Frontend checks:

```bash
cd frontend
npm run lint
npm run build
npm run test:unit
npm run test:e2e
```

## Required A2 docs in repo

- `DEVIATIONS.md`
- `docs/a2-compliance-checklist.md`
- `backend/.env.example`
- `frontend/.env.example`
