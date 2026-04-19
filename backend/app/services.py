from __future__ import annotations

import asyncio
import re
from dataclasses import dataclass
from typing import AsyncIterator

from app.config import settings
from app.llm_provider import (
    LLMResult,
    build_lm_studio_chat_url,
    generate_completion,
    model_for_feature,
    stream_completion,
)
from app.prompts import build_prompt
from app.schemas import AssistantSuggestRequest


@dataclass(slots=True)
class AIResult:
    prompt: str
    output_text: str
    model_name: str
    provider: str
    mocked: bool


LEADING_WRAPPER_PATTERNS = [
    r"^(?:here(?:'s| is)\s+(?:your|the)\s+(?:rewritten|revised|translated|restructured|summarized)\s+text\s*:\s*)",
    r"^(?:here(?:'s| is)\s+(?:a|the)\s+summary\s*:\s*)",
    r"^(?:rewritten|revised|translated|restructured|summarized)\s+text\s*:\s*",
    r"^(?:summary|translation|rewrite|restructured\s+version|restructure)\s*:\s*",
    r"^(?:concise\s+summary\s+of\s+the\s+selected\s+text\s*:\s*)",
    r"^(?:result|output)\s*:\s*",
]


def sanitize_model_output(content: str) -> str:
    cleaned = content.strip()

    if cleaned.startswith("```") and cleaned.endswith("```"):
        lines = cleaned.splitlines()
        if len(lines) >= 3:
            cleaned = "\n".join(lines[1:-1]).strip()

    cleaned = cleaned.strip().strip('"').strip("'").strip()

    changed = True
    while changed:
        changed = False
        for pattern in LEADING_WRAPPER_PATTERNS:
            updated = re.sub(pattern, "", cleaned, flags=re.IGNORECASE).strip()
            if updated != cleaned:
                cleaned = updated
                changed = True

    if "\n\n" in cleaned:
        first_line, remainder = cleaned.split("\n\n", 1)
        lowered = first_line.strip().lower()
        if (
            lowered.endswith(":")
            or lowered.startswith("here is")
            or lowered.startswith("here's")
            or lowered.startswith("summary")
            or lowered.startswith("translation")
            or lowered.startswith("rewrite")
            or lowered.startswith("result")
        ):
            cleaned = remainder.strip()

    return cleaned.strip()


def build_prompt_text(payload: AssistantSuggestRequest) -> str:
    return build_prompt(payload)


async def generate_ai_suggestion(payload: AssistantSuggestRequest) -> AIResult:
    prompt = build_prompt_text(payload)
    result: LLMResult = await generate_completion(payload, prompt)
    output = sanitize_model_output(result.output_text)
    return AIResult(
        prompt=prompt,
        output_text=output,
        model_name=result.model_name,
        provider=result.provider,
        mocked=result.mocked,
    )


async def stream_ai_suggestion(
    payload: AssistantSuggestRequest,
    cancel_event: asyncio.Event,
) -> tuple[str, str, str, bool, AsyncIterator[str]]:
    prompt = build_prompt_text(payload)
    model_name = f"mock-{payload.feature}" if settings.llm_mock else model_for_feature(payload.feature)
    provider = "mock" if settings.llm_mock else "lm-studio"
    mocked = settings.llm_mock

    async def iterator() -> AsyncIterator[str]:
        async for chunk in stream_completion(payload, prompt, cancel_event):
            yield chunk

    return prompt, model_name, provider, mocked, iterator()


__all__ = [
    "AIResult",
    "build_lm_studio_chat_url",
    "build_prompt_text",
    "generate_ai_suggestion",
    "sanitize_model_output",
    "stream_ai_suggestion",
]
