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
        self._yjs_updates: dict[str, list[dict[str, str]]] = defaultdict(list)

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
            self._yjs_updates.pop(room_id, None)
        return connection.presence if connection else None

    async def send_to_client(self, websocket: WebSocket, payload: dict[str, Any]) -> None:
        await websocket.send_json(payload)

    async def send_to_clients(
        self,
        room_id: str,
        payload: dict[str, Any],
        *,
        client_ids: set[str],
    ) -> None:
        for client_id, connection in list(self._rooms.get(room_id, {}).items()):
            if client_id not in client_ids:
                continue
            await connection.websocket.send_json(payload)

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

    @staticmethod
    def _normalize_range(
        range_data: dict[str, Any] | None,
        *,
        expand_cursor: bool = False,
    ) -> tuple[int, int] | None:
        if not isinstance(range_data, dict):
            return None

        start = range_data.get("from")
        end = range_data.get("to")
        if not isinstance(start, int) or not isinstance(end, int):
            return None

        lower = min(start, end)
        upper = max(start, end)
        if lower == upper and expand_cursor:
            upper = lower + 1
        if lower == upper:
            return None
        return (lower, upper)

    def find_conflicts(
        self,
        room_id: str,
        client_id: str,
        *,
        patch_range: dict[str, Any] | None = None,
    ) -> dict[str, Any] | None:
        connection = self._rooms.get(room_id, {}).get(client_id)
        if connection is None:
            return None

        source_range = self._normalize_range(
            patch_range,
            expand_cursor=True,
        ) or self._normalize_range(connection.presence.selection, expand_cursor=True) or self._normalize_range(
            connection.presence.cursor,
            expand_cursor=True,
        )
        if source_range is None:
            return None

        conflicting_participants: list[dict[str, Any]] = []
        conflicting_client_ids: set[str] = set()
        for other_client_id, other_connection in self._rooms.get(room_id, {}).items():
            if other_client_id == client_id:
                continue

            other_range = self._normalize_range(
                other_connection.presence.selection,
                expand_cursor=True,
            ) or self._normalize_range(
                other_connection.presence.cursor,
                expand_cursor=True,
            )
            if other_range is None:
                continue

            overlaps = max(source_range[0], other_range[0]) < min(source_range[1], other_range[1])
            if not overlaps:
                continue

            conflicting_client_ids.add(other_client_id)
            conflicting_participants.append(
                {
                    "memberId": other_connection.presence.member_id,
                    "memberName": other_connection.presence.member_name,
                    "clientId": other_connection.presence.client_id,
                }
            )

        if not conflicting_participants:
            return None

        return {
            "range": {"from": source_range[0], "to": source_range[1]},
            "participants": conflicting_participants,
            "client_ids": conflicting_client_ids,
        }

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

    def record_yjs_update(self, room_id: str, payload: dict[str, Any]) -> None:
        update = payload.get("update")
        if not isinstance(update, str) or not update.strip():
            return
        history = self._yjs_updates[room_id]
        history.append({"update": update})
        if len(history) > 400:
            del history[: len(history) - 400]

    def get_yjs_bootstrap_updates(self, room_id: str) -> list[dict[str, str]]:
        return list(self._yjs_updates.get(room_id, []))


manager = ConnectionManager()
