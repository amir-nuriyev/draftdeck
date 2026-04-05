# DraftDeck Backend

## Run locally

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
uvicorn app.main:app --reload
```

Swagger UI: `http://127.0.0.1:8000/docs`

## Environment

- `LM_STUDIO_BASE_URL`: LM Studio base URL or `/v1` root
- `LLM_FAST_MODEL`: default model for summarize and translate
- `LLM_DEEP_MODEL`: default model for rewrite and restructure
- `LLM_MOCK=true`: skip live LM Studio and return deterministic mock output

## Main routes

- `GET /api/health`
- `GET /api/studio/overview`
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

## WebSocket room

Connect to:

- `ws://127.0.0.1:8000/ws/drafts/{draftId}?userId=1&userName=Maya`

Client events:

- `presence:update`
- `draft:patch`
- `assistant:status`
- `snapshot:restored`

Server events:

- `session:ack`
- `presence:sync`
- `draft:patch`
- `assistant:status`
- `snapshot:restored`
- `error`

## Tests

```bash
. .venv/bin/activate
pytest -q
```
