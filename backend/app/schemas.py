from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field


RoleValue = Literal["owner", "editor", "commenter", "viewer"]
StageValue = Literal["concept", "drafting", "review"]
AssistantFeatureValue = Literal["rewrite", "summarize", "translate", "restructure"]
AssistantDecisionValue = Literal["pending", "accepted", "rejected", "partial"]


class MemberRead(BaseModel):
    id: int
    email: str
    display_name: str
    focus_area: str
    color_hex: str

    model_config = {"from_attributes": True}


class SessionCapabilitiesRead(BaseModel):
    can_create_draft: bool
    can_view_draft: bool
    can_edit_draft: bool
    can_use_assistant: bool
    can_create_snapshot: bool
    can_restore_snapshot: bool
    can_manage_collaborators: bool


class SessionRead(BaseModel):
    auth_mode: Literal["demo-header"]
    member: MemberRead
    draft_id: int | None
    draft_role: RoleValue | None
    capabilities: SessionCapabilitiesRead


class DraftBase(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    brief: str = Field(default="", max_length=500)
    content: str = ""
    stage: StageValue = "concept"
    accent: str = Field(default="ember", max_length=40)


class DraftCreate(DraftBase):
    create_snapshot: bool = True


class DraftUpdate(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=200)
    brief: str | None = Field(default=None, max_length=500)
    content: str | None = None
    stage: StageValue | None = None
    accent: str | None = Field(default=None, max_length=40)
    snapshot_label: str | None = Field(default=None, max_length=200)
    create_snapshot: bool = False


class DraftSummaryRead(BaseModel):
    id: int
    title: str
    brief: str
    stage: StageValue
    accent: str
    owner_id: int
    owner_name: str
    my_role: RoleValue
    created_at: datetime
    updated_at: datetime

class DraftRead(DraftSummaryRead):
    content: str


class SnapshotCreate(BaseModel):
    label: str | None = Field(default=None, max_length=200)


class SnapshotRead(BaseModel):
    id: int
    draft_id: int
    label: str | None
    content: str
    created_at: datetime

    model_config = {"from_attributes": True}


class CollaboratorCreate(BaseModel):
    member_id: int
    role: RoleValue


class CollaboratorRead(BaseModel):
    id: int
    draft_id: int
    member_id: int
    role: RoleValue
    display_name: str
    email: str
    focus_area: str
    color_hex: str


class AssistantSuggestRequest(BaseModel):
    feature: AssistantFeatureValue
    selected_text: str = Field(min_length=1)
    surrounding_context: str = ""
    target_language: str | None = Field(default=None, max_length=80)
    draft_id: int | None = None
    selection_start: int | None = Field(default=None, ge=0)
    selection_end: int | None = Field(default=None, ge=0)


class AssistantSuggestResponse(BaseModel):
    run_id: int
    feature: AssistantFeatureValue
    suggestion_text: str
    model_name: str
    provider: str = "lm-studio"
    status: str = "completed"
    mocked: bool = False
    decision: AssistantDecisionValue = "pending"


class AssistantRunRead(BaseModel):
    id: int
    draft_id: int | None
    member_id: int | None
    member_display_name: str | None = None
    feature: AssistantFeatureValue
    selection_text: str
    context_excerpt: str
    result_text: str
    model_route: str
    status: str
    decision: AssistantDecisionValue
    target_language: str | None
    selection_start: int | None
    selection_end: int | None
    applied_excerpt: str | None
    created_at: datetime


class AssistantRunDecisionUpdate(BaseModel):
    decision: AssistantDecisionValue
    applied_excerpt: str | None = None


class StudioOverviewRead(BaseModel):
    app_name: str
    accessible_drafts: int
    concept_count: int
    drafting_count: int
    review_count: int
    active_members: int
    assistant_mode: Literal["mock", "live"]


class HealthResponse(BaseModel):
    status: str
    app_name: str
    assistant_mode: Literal["mock", "live"]
