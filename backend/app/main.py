from contextlib import asynccontextmanager

from uuid import uuid4

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware

from app.config import settings
from app.database import ensure_local_schema, seed_demo_users
from app.realtime import manager
from app.routers import assistant, drafts, members, studio
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
    version="2.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[settings.frontend_origin],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(studio.router, prefix=settings.api_prefix)
app.include_router(drafts.router, prefix=settings.api_prefix)
app.include_router(assistant.router, prefix=settings.api_prefix)
app.include_router(members.router, prefix=settings.api_prefix)


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
async def draft_socket(websocket: WebSocket, draft_id: str):
    user_id = websocket.query_params.get("userId", "anonymous")
    user_name = websocket.query_params.get("userName", "Anonymous")
    client_id = websocket.query_params.get("clientId", str(uuid4()))

    presence = await manager.connect(
        draft_id,
        websocket,
        user_id=user_id,
        user_name=user_name,
        client_id=client_id,
    )
    await manager.send_to_client(
        websocket,
        {
            "type": "session:ack",
            "roomId": draft_id,
            "clientId": client_id,
            "presence": {
                "memberId": presence.member_id,
                "memberName": presence.member_name,
                "clientId": presence.client_id,
            },
            "participants": manager.get_room_presence(draft_id),
        },
    )
    await manager.broadcast(
        draft_id,
        {
            "type": "presence:sync",
            "roomId": draft_id,
            "participants": manager.get_room_presence(draft_id),
        },
    )

    try:
        while True:
            payload = await websocket.receive_json()
            message_type = payload.get("type")

            if message_type == "presence:update":
                manager.update_presence(
                    draft_id,
                    client_id,
                    cursor=payload.get("cursor"),
                    selection=payload.get("selection"),
                )
                await manager.broadcast(
                    draft_id,
                    {
                        "type": "presence:sync",
                        "roomId": draft_id,
                        "participants": manager.get_room_presence(draft_id),
                    },
                )
                continue

            if message_type in {"draft:patch", "assistant:status", "snapshot:restored"}:
                await manager.broadcast(
                    draft_id,
                    {
                        "type": message_type,
                        "roomId": draft_id,
                        "sender": {
                            "memberId": user_id,
                            "memberName": user_name,
                            "clientId": client_id,
                        },
                        "payload": payload.get("payload", {}),
                    },
                    exclude_client_id=None if message_type == "snapshot:restored" else client_id,
                )
                continue

            await manager.send_to_client(
                websocket,
                {
                    "type": "error",
                    "roomId": draft_id,
                    "message": "Unsupported WebSocket message type.",
                },
            )
    except WebSocketDisconnect:
        manager.disconnect(draft_id, client_id)
        await manager.broadcast(
            draft_id,
            {
                "type": "presence:sync",
                "roomId": draft_id,
                "participants": manager.get_room_presence(draft_id),
            },
        )
