from dataclasses import dataclass
import re
from textwrap import shorten

import httpx
from fastapi import HTTPException, status

from app.config import settings
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


def model_for_feature(feature: str) -> str:
    if feature in {"rewrite", "restructure"}:
        return settings.llm_deep_model
    return settings.llm_fast_model


def temperature_for_feature(feature: str) -> float:
    return 0.15 if feature == "summarize" else 0.3


def build_prompt(payload: AssistantSuggestRequest) -> str:
    task = {
        "rewrite": (
            "Rewrite the selected text so it reads like a tighter, more polished draft. "
            "Preserve the original intent and concrete facts."
        ),
        "summarize": "Summarize the selected text into a compact overview with the essential ideas only.",
        "translate": (
            f"Translate the selected text into {payload.target_language or 'the requested language'} "
            "while preserving tone and factual meaning."
        ),
        "restructure": (
            "Restructure the selected text into a clearer flow. "
            "You may reorder clauses or convert it into a compact outline if that improves readability."
        ),
    }[payload.feature]

    context_block = payload.surrounding_context.strip() or "No surrounding context supplied."

    return (
        "DraftDeck editorial request\n"
        f"Task:\n{task}\n\n"
        "Rules:\n"
        "- Return only the transformed text.\n"
        "- Do not add titles, labels, markdown fences, or explanations.\n"
        "- Keep names, numbers, and domain facts intact unless the request is translation.\n\n"
        f"Surrounding context:\n{context_block}\n\n"
        f"Selected text:\n{payload.selected_text}\n"
    )


def build_lm_studio_chat_url() -> str:
    base_url = settings.lm_studio_base_url.rstrip("/")
    if base_url.endswith("/chat/completions"):
        return base_url
    if base_url.endswith("/v1"):
        return f"{base_url}/chat/completions"
    return f"{base_url}/v1/chat/completions"


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


async def generate_ai_suggestion(payload: AssistantSuggestRequest) -> AIResult:
    prompt = build_prompt(payload)
    chosen_model = model_for_feature(payload.feature)

    if settings.llm_mock:
        prefix = {
            "rewrite": "Polished pass",
            "summarize": "Brief summary",
            "translate": f"Translation to {payload.target_language or 'the target language'}",
            "restructure": "Restructured outline",
        }[payload.feature]
        mock_response = f"{prefix}: {shorten(payload.selected_text, width=150, placeholder='...')}"
        return AIResult(
            prompt=prompt,
            output_text=mock_response,
            model_name=f"mock-{payload.feature}",
            provider="mock",
            mocked=True,
        )

    request_body = {
        "model": chosen_model,
        "messages": [
            {
                "role": "system",
                "content": (
                    "You are DraftDeck's editorial copilot. "
                    "Return only the requested resulting text. "
                    "Do not add introductions, labels, explanations, quotation marks, bullet points, or markdown fences."
                ),
            },
            {"role": "user", "content": prompt},
        ],
        "temperature": temperature_for_feature(payload.feature),
    }

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
                "LM Studio did not respond before the timeout. Increase "
                "`LM_STUDIO_TIMEOUT_SECONDS` or use a smaller local model."
            ),
        ) from exc
    except httpx.HTTPStatusError as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=(
                "LM Studio returned an HTTP error "
                f"({exc.response.status_code}). Check the loaded model name and server state."
            ),
        ) from exc
    except httpx.HTTPError as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="LM Studio request failed for an unexpected network reason.",
        ) from exc

    try:
        data = response.json()
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="LM Studio returned invalid JSON.",
        ) from exc

    try:
        content = data["choices"][0]["message"]["content"].strip()
    except (KeyError, IndexError, TypeError) as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="LM Studio returned an unexpected response payload.",
        ) from exc
    content = sanitize_model_output(content)
    if not content:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="LM Studio returned an empty completion.",
        )

    return AIResult(
        prompt=prompt,
        output_text=content,
        model_name=chosen_model,
        provider="lm-studio",
        mocked=False,
    )
