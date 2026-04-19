from __future__ import annotations

from contextlib import asynccontextmanager
from uuid import uuid4

from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware

from app.config import settings
from app.database import SessionLocal, ensure_local_schema, seed_demo_users
from app.deps import get_member_from_ws_token, require_draft_access_for_ws
from app.models import Draft
from app.realtime import manager
from app.routers import assistant, auth, drafts, members, session, share, studio
from app.schemas import HealthResponse

ensure_local_schema()
seed_demo_users()


@asynccontextmanager
async def lifespan(_: FastAPI):
    ensure_local_schema()
    seed_demo_users()
    yield


app = FastAPI(
    title=settings.app_name,
    lifespan=lifespan,
    version="3.0.0",
)

allowed_origins = [origin.strip() for origin in settings.allowed_origins.split(",") if origin.strip()]
if settings.frontend_origin not in allowed_origins:
    allowed_origins.append(settings.frontend_origin)

app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router, prefix=settings.api_prefix)
app.include_router(studio.router, prefix=settings.api_prefix)
app.include_router(session.router, prefix=settings.api_prefix)
app.include_router(drafts.router, prefix=settings.api_prefix)
app.include_router(assistant.router, prefix=settings.api_prefix)
app.include_router(members.router, prefix=settings.api_prefix)
app.include_router(share.router, prefix=settings.api_prefix)


def session_factory():
    return getattr(app.state, "session_factory", SessionLocal)


@app.get("/", response_model=HealthResponse)
def root():
    return HealthResponse(
        status="ok",
        app_name=settings.app_name,
        assistant_mode="mock" if settings.llm_mock else "live",
    )


@app.get(f"{settings.api_prefix}/health", response_model=HealthResponse)
def health():
    return HealthResponse(
        status="ok",
        app_name=settings.app_name,
        assistant_mode="mock" if settings.llm_mock else "live",
    )


@app.websocket("/ws/drafts/{draft_id}")
async def draft_socket(websocket: WebSocket, draft_id: int):
    client_id = websocket.query_params.get("clientId", str(uuid4()))

    factory = session_factory()
    with factory() as db:
        try:
            member = get_member_from_ws_token(websocket, db)
            draft = db.get(Draft, draft_id)
            if draft is None:
                raise HTTPException(status_code=404, detail="Draft not found.")
            role = require_draft_access_for_ws(draft, member, db)
        except HTTPException as exc:
            close_code = 4403 if exc.status_code == 403 else 4401
            await websocket.close(code=close_code, reason=exc.detail if isinstance(exc.detail, str) else "Denied")
            return

    room_id = str(draft_id)
    presence = await manager.connect(
        room_id,
        websocket,
        user_id=str(member.id),
        user_name=member.display_name,
        client_id=client_id,
    )
    await manager.send_to_client(
        websocket,
        {
            "type": "session:ack",
            "roomId": room_id,
            "clientId": client_id,
            "role": role,
            "presence": {
                "memberId": presence.member_id,
                "memberName": presence.member_name,
                "clientId": presence.client_id,
            },
            "participants": manager.get_room_presence(room_id),
        },
    )
    await manager.send_to_client(
        websocket,
        {
            "type": "yjs:bootstrap",
            "roomId": room_id,
            "updates": manager.get_yjs_bootstrap_updates(room_id),
        },
    )
    await manager.broadcast(
        room_id,
        {
            "type": "presence:sync",
            "roomId": room_id,
            "participants": manager.get_room_presence(room_id),
        },
    )

    try:
        while True:
            payload = await websocket.receive_json()
            message_type = payload.get("type")

            if message_type == "presence:update":
                manager.update_presence(
                    room_id,
                    client_id,
                    cursor=payload.get("cursor"),
                    selection=payload.get("selection"),
                )
                await manager.broadcast(
                    room_id,
                    {
                        "type": "presence:sync",
                        "roomId": room_id,
                        "participants": manager.get_room_presence(room_id),
                    },
                )
                continue

            if message_type in {
                "draft:patch",
                "assistant:status",
                "snapshot:restored",
                "yjs:update",
                "awareness:update",
            }:
                payload_data = payload.get("payload", {})
                if not isinstance(payload_data, dict):
                    payload_data = {}

                blocked_write = message_type in {"draft:patch", "assistant:status", "yjs:update"} and role not in {
                    "owner",
                    "editor",
                }
                blocked_restore = message_type == "snapshot:restored" and role != "owner"
                if blocked_write or blocked_restore:
                    await manager.send_to_client(
                        websocket,
                        {
                            "type": "error",
                            "roomId": room_id,
                            "message": "Your role does not allow this realtime action.",
                        },
                    )
                    continue

                if message_type == "draft:patch":
                    conflict = manager.find_conflicts(
                        room_id,
                        client_id,
                        patch_range=payload_data.get("range"),
                    )
                    if conflict is not None:
                        await manager.send_to_clients(
                            room_id,
                            {
                                "type": "conflict:warning",
                                "roomId": room_id,
                                "message": "Potential edit conflict detected in the same region.",
                                "range": conflict["range"],
                                "participants": [
                                    {
                                        "memberId": member.id,
                                        "memberName": member.display_name,
                                        "clientId": client_id,
                                    },
                                    *conflict["participants"],
                                ],
                            },
                            client_ids={client_id, *conflict["client_ids"]},
                        )
                elif message_type == "yjs:update":
                    manager.record_yjs_update(room_id, payload_data)

                await manager.broadcast(
                    room_id,
                    {
                        "type": message_type,
                        "roomId": room_id,
                        "sender": {
                            "memberId": member.id,
                            "memberName": member.display_name,
                            "clientId": client_id,
                        },
                        "payload": payload_data,
                    },
                    exclude_client_id=None if message_type == "snapshot:restored" else client_id,
                )
                continue

            await manager.send_to_client(
                websocket,
                {
                    "type": "error",
                    "roomId": room_id,
                    "message": "Unsupported WebSocket message type.",
                },
            )
    except WebSocketDisconnect:
        manager.disconnect(room_id, client_id)
        await manager.broadcast(
            room_id,
            {
                "type": "presence:sync",
                "roomId": room_id,
                "participants": manager.get_room_presence(room_id),
            },
        )
