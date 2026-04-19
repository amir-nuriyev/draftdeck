from __future__ import annotations

from app.schemas import AssistantSuggestRequest


PROMPT_TEMPLATES: dict[str, str] = {
    "rewrite": (
        "Rewrite the selected text with a {tone} tone and keep all factual details intact."
    ),
    "summarize": (
        "Summarize the selected text into a {output_length} response while preserving key points."
    ),
    "translate": (
        "Translate the selected text into {target_language} and preserve structure and meaning."
    ),
    "restructure": (
        "Restructure the selected text into a clearer flow while preserving intent and facts."
    ),
    "expand": (
        "Expand the selected text with concrete details and transitions without inventing facts."
    ),
    "grammar": (
        "Correct grammar, spelling, and punctuation while preserving style and meaning."
    ),
    "custom": "{custom_prompt}",
}


def _clip(value: str, limit: int, *, label: str) -> str:
    compact = value.strip()
    if len(compact) <= limit:
        return compact
    omitted = len(compact) - limit
    return f"{compact[:limit].rstrip()}\n\n[{label}: truncated {omitted} chars]"


def build_prompt(payload: AssistantSuggestRequest) -> str:
    template = PROMPT_TEMPLATES[payload.feature]
    task = template.format(
        tone=payload.tone or "professional",
        output_length=payload.output_length or "concise",
        target_language=payload.target_language or "English",
        custom_prompt=payload.custom_prompt or "Follow the custom instruction carefully.",
    )
    context_block = _clip(
        payload.surrounding_context.strip() or "No surrounding context supplied.",
        2500,
        label="context",
    )
    selected_text = _clip(payload.selected_text, 3500, label="selection")

    return (
        "DraftDeck editorial request\n"
        f"Task:\n{task}\n\n"
        "Rules:\n"
        "- Return only transformed text.\n"
        "- Do not add markdown fences or explanations.\n"
        "- Keep names, numbers, and domain facts intact unless translation is requested.\n\n"
        f"Surrounding context:\n{context_block}\n\n"
        f"Selected text:\n{selected_text}\n"
    )
