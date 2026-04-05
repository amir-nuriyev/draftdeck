from collections import defaultdict
from dataclasses import dataclass, field
from typing import Any

from fastapi import WebSocket


@dataclass(slots=True)
class PresenceState:
    member_id: str
    member_name: str
    client_id: str
    cursor: dict[str, Any] | None = None
    selection: dict[str, Any] | None = None


@dataclass(slots=True)
class ConnectionState:
    websocket: WebSocket
    presence: PresenceState = field()


class ConnectionManager:
    def __init__(self) -> None:
        self._rooms: dict[str, dict[str, ConnectionState]] = defaultdict(dict)

    async def connect(
        self,
        room_id: str,
        websocket: WebSocket,
        *,
        user_id: str,
        user_name: str,
        client_id: str,
    ) -> PresenceState:
        await websocket.accept()
        presence = PresenceState(
            member_id=user_id,
            member_name=user_name,
            client_id=client_id,
        )
        self._rooms[room_id][client_id] = ConnectionState(
            websocket=websocket,
            presence=presence,
        )
        return presence

    def disconnect(self, room_id: str, client_id: str) -> PresenceState | None:
        room = self._rooms[room_id]
        connection = room.pop(client_id, None)
        if not room:
            self._rooms.pop(room_id, None)
        return connection.presence if connection else None

    async def send_to_client(self, websocket: WebSocket, payload: dict[str, Any]) -> None:
        await websocket.send_json(payload)

    async def broadcast(
        self,
        room_id: str,
        payload: dict[str, Any],
        *,
        exclude_client_id: str | None = None,
    ) -> None:
        for client_id, connection in list(self._rooms.get(room_id, {}).items()):
            if exclude_client_id is not None and client_id == exclude_client_id:
                continue
            await connection.websocket.send_json(payload)

    def update_presence(
        self,
        room_id: str,
        client_id: str,
        *,
        cursor: dict[str, Any] | None = None,
        selection: dict[str, Any] | None = None,
    ) -> PresenceState | None:
        connection = self._rooms.get(room_id, {}).get(client_id)
        if connection is None:
            return None

        connection.presence.cursor = cursor
        connection.presence.selection = selection
        return connection.presence

    def get_room_presence(self, room_id: str) -> list[dict[str, Any]]:
        return [
            {
                "memberId": connection.presence.member_id,
                "memberName": connection.presence.member_name,
                "clientId": connection.presence.client_id,
                "cursor": connection.presence.cursor,
                "selection": connection.presence.selection,
            }
            for connection in self._rooms.get(room_id, {}).values()
        ]


manager = ConnectionManager()
