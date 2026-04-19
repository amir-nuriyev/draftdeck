from __future__ import annotations

import asyncio
import json
from dataclasses import dataclass
from textwrap import shorten
from typing import AsyncIterator

import httpx
from fastapi import HTTPException, status

from app.config import settings
from app.schemas import AssistantSuggestRequest


@dataclass(slots=True)
class LLMResult:
    output_text: str
    model_name: str
    provider: str
    mocked: bool


def model_for_feature(feature: str) -> str:
    if feature in {"rewrite", "restructure", "custom", "expand"}:
        return settings.llm_deep_model
    return settings.llm_fast_model


def temperature_for_feature(feature: str) -> float:
    if feature in {"summarize", "grammar"}:
        return 0.2
    if feature == "custom":
        return 0.5
    return 0.3


def build_lm_studio_chat_url() -> str:
    base_url = settings.lm_studio_base_url.rstrip("/")
    if base_url.endswith("/chat/completions"):
        return base_url
    if base_url.endswith("/v1"):
        return f"{base_url}/chat/completions"
    return f"{base_url}/v1/chat/completions"


def _mock_text(payload: AssistantSuggestRequest) -> str:
    prefix = {
        "rewrite": "Polished rewrite",
        "summarize": "Concise summary",
        "translate": f"Translation to {payload.target_language or 'target language'}",
        "restructure": "Restructured output",
        "expand": "Expanded draft",
        "grammar": "Grammar-corrected version",
        "custom": "Custom prompt output",
    }[payload.feature]
    return f"{prefix}: {shorten(payload.selected_text, width=220, placeholder='...')}"


def _request_body(payload: AssistantSuggestRequest, prompt: str, *, stream: bool) -> dict[str, object]:
    return {
        "model": model_for_feature(payload.feature),
        "messages": [
            {
                "role": "system",
                "content": (
                    "You are DraftDeck's editorial copilot. "
                    "Return only the requested resulting text. "
                    "Do not add introductions, labels, explanations, quotation marks, or markdown fences."
                ),
            },
            {"role": "user", "content": prompt},
        ],
        "temperature": temperature_for_feature(payload.feature),
        "stream": stream,
    }


async def generate_completion(payload: AssistantSuggestRequest, prompt: str) -> LLMResult:
    if settings.llm_mock:
        return LLMResult(
            output_text=_mock_text(payload),
            model_name=f"mock-{payload.feature}",
            provider="mock",
            mocked=True,
        )

    request_body = _request_body(payload, prompt, stream=False)

    try:
        async with httpx.AsyncClient(timeout=settings.lm_studio_timeout_seconds) as client:
            response = await client.post(
                build_lm_studio_chat_url(),
                json=request_body,
            )
            response.raise_for_status()
    except httpx.ConnectError as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=(
                "Could not connect to LM Studio. Make sure the local server is running at "
                f"{settings.lm_studio_base_url}."
            ),
        ) from exc
    except httpx.TimeoutException as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=(
                "LM Studio did not respond before timeout. Increase "
                "`LM_STUDIO_TIMEOUT_SECONDS` or use a smaller model."
            ),
        ) from exc
    except httpx.HTTPStatusError as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"LM Studio HTTP error ({exc.response.status_code}).",
        ) from exc
    except httpx.HTTPError as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="LM Studio request failed due to a network error.",
        ) from exc

    try:
        data = response.json()
        content = data["choices"][0]["message"]["content"]
        if not isinstance(content, str) or not content.strip():
            raise ValueError("empty completion")
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="LM Studio returned an invalid response payload.",
        ) from exc

    return LLMResult(
        output_text=content.strip(),
        model_name=model_for_feature(payload.feature),
        provider="lm-studio",
        mocked=False,
    )


async def stream_completion(
    payload: AssistantSuggestRequest,
    prompt: str,
    cancel_event: asyncio.Event,
) -> AsyncIterator[str]:
    if settings.llm_mock:
        for token in _mock_text(payload).split(" "):
            if cancel_event.is_set():
                return
            yield token + " "
            await asyncio.sleep(0.02)
        return

    request_body = _request_body(payload, prompt, stream=True)
    timeout = httpx.Timeout(timeout=settings.lm_studio_timeout_seconds, connect=10.0)
    try:
        async with httpx.AsyncClient(timeout=timeout) as client:
            async with client.stream(
                "POST",
                build_lm_studio_chat_url(),
                json=request_body,
            ) as response:
                response.raise_for_status()
                async for raw_line in response.aiter_lines():
                    if cancel_event.is_set():
                        return
                    line = raw_line.strip()
                    if not line or not line.startswith("data:"):
                        continue
                    data_part = line.removeprefix("data:").strip()
                    if data_part == "[DONE]":
                        return
                    try:
                        parsed = json.loads(data_part)
                        delta = parsed["choices"][0].get("delta", {})
                        chunk = delta.get("content")
                    except Exception:  # noqa: BLE001
                        chunk = None
                    if isinstance(chunk, str) and chunk:
                        yield chunk
    except httpx.HTTPError as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="LM Studio streaming request failed.",
        ) from exc
