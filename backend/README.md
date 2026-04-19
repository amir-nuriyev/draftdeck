# DraftDeck Backend

FastAPI backend for Assignment 2.

## What it implements

- JWT auth lifecycle: register, login, refresh rotation, logout, me.
- Role-gated draft CRUD, collaborators, snapshots, restore, exports.
- Share-by-link creation/revocation and token resolve flow.
- AI assistant sync + SSE streaming with cancel and history logging.
- Authenticated websocket rooms for realtime collaboration and presence.
- Local SQLite bootstrap + deterministic demo user seeding.

## Run locally

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
uvicorn app.main:app --host 127.0.0.1 --port 8000 --reload
```

Docs:

- Swagger UI: `http://127.0.0.1:8000/docs`
- OpenAPI JSON: `http://127.0.0.1:8000/openapi.json`

## Environment

See `.env.example`. Main keys:

- `DATABASE_URL`
- `JWT_SECRET_KEY`
- `JWT_ALGORITHM`
- `JWT_ACCESS_TOKEN_MINUTES`
- `JWT_REFRESH_TOKEN_DAYS`
- `LM_STUDIO_BASE_URL`
- `LLM_FAST_MODEL`
- `LLM_DEEP_MODEL`
- `LM_STUDIO_TIMEOUT_SECONDS`
- `LLM_MOCK`

## API summary

Auth:

- `POST /api/auth/register`
- `POST /api/auth/login`
- `POST /api/auth/refresh`
- `POST /api/auth/logout`
- `GET /api/auth/me`

Drafts:

- `GET|POST /api/drafts`
- `GET|PATCH|DELETE /api/drafts/{id}`
- `GET|POST /api/drafts/{id}/snapshots`
- `POST /api/drafts/{id}/snapshots/{snapshot_id}/restore`
- `GET|POST /api/drafts/{id}/collaborators`
- `DELETE /api/drafts/{id}/collaborators/{member_id}`
- `GET /api/drafts/{id}/export?format=md|txt|json`

Share links:

- `GET|POST /api/drafts/{id}/share-links`
- `DELETE /api/drafts/{id}/share-links/{link_id}`
- `GET /api/share/{token}/resolve`

Assistant:

- `POST /api/assistant/suggest`
- `POST /api/assistant/suggest/stream`
- `POST /api/assistant/runs/{run_id}/cancel`
- `GET /api/assistant/runs`
- `PATCH /api/assistant/runs/{run_id}`

Other:

- `GET /api/session`
- `GET /api/studio/overview`
- `GET /api/members`
- `GET /api/members/me`
- `GET /api/health`

WebSocket:

- `WS /ws/drafts/{draftId}?token=<jwt>&clientId=<id>`

## Tests

```bash
cd backend
source .venv/bin/activate
pytest -q
```

Current backend suite covers auth lifecycle, role permissions, share links, assistant streaming/cancel, prompt handling, and websocket auth/message rules.
