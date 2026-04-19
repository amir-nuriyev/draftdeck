# Architecture Deviations (Assignment 1 -> Final Implementation)

This project intentionally evolved from the Assignment 1 PoC architecture.

## 1) Authentication model changed

- **A1 / PoC shape:** Header-based demo identity (`X-User-Id`).
- **Final implementation:** JWT access + refresh token lifecycle with register/login/refresh/logout.
- **Why:** Assignment 2 requires production-style authentication semantics and graceful token refresh.
- **Assessment:** Improvement.

## 2) Data model expanded

- **A1 / PoC shape:** Members, drafts, collaborators, snapshots, assistant runs.
- **Final implementation:** Added refresh sessions, share links, draft versions, richer assistant run metadata.
- **Why:** Needed for token revocation/rotation, share-by-link bonus, and full AI interaction history.
- **Assessment:** Improvement.

## 3) AI flow split into sync + streaming endpoints

- **A1 / PoC shape:** Single blocking assistant request.
- **Final implementation:** Added SSE streaming endpoint and cancellation endpoint while preserving synchronous endpoint.
- **Why:** Assignment 2 streaming requirement and better UX under long-running model calls.
- **Assessment:** Improvement.

## 4) Realtime contract hardened with token-authenticated websocket

- **A1 / PoC shape:** Unauthenticated room websocket query identity.
- **Final implementation:** WebSocket session requires JWT and draft access rights before room join.
- **Why:** Assignment 2 requires authenticated realtime transport and server-side enforcement.
- **Assessment:** Improvement.
