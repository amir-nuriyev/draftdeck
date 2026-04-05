# DraftDeck Frontend

## Run locally

```bash
npm install
cp .env.example .env.local
npm run dev
```

Open `http://localhost:3000`.

## Routes

- `/`: board view with lane filters and draft creation
- `/drafts/[id]`: collaborative editing cockpit

## Frontend scope

- Persona switching for owner, editor, commenter, and viewer demo flows
- Stage-based draft board with search and quick metrics
- Live editing cockpit with brief, content, lane, and accent controls
- Assistant dock for rewrite, summarize, translate, and restructure
- Snapshot list, restore actions, export controls, and share controls
- Realtime presence and incoming live patch notices

## Validation

```bash
npm run lint
npm run build
```
