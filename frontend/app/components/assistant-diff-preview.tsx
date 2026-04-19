import type { DiffSegment } from "@/app/lib/assistant-diff";

export default function AssistantDiffPreview({
  segments,
  selection,
  onToggle,
}: {
  segments: DiffSegment[];
  selection: Record<string, boolean>;
  onToggle: (id: string, checked: boolean) => void;
}) {
  return (
    <div className="space-y-2 rounded-[1.2rem] border border-[rgba(34,39,46,0.08)] bg-[rgba(255,255,255,0.72)] p-3">
      <div className="field-label">Partial acceptance</div>
      <div className="max-h-[13rem] space-y-1 overflow-y-auto pr-1 text-sm">
        {segments.map((segment) => {
          const editableSegment = segment.kind !== "same";
          const accepted = selection[segment.id] ?? false;
          return (
            <label
              key={segment.id}
              className={`flex items-start gap-2 rounded-lg px-2 py-1 ${
                segment.kind === "added"
                  ? "bg-emerald-50"
                  : segment.kind === "removed"
                    ? "bg-rose-50"
                    : "bg-slate-50"
              }`}
            >
              {editableSegment ? (
                <input
                  type="checkbox"
                  checked={accepted}
                  onChange={(event) => onToggle(segment.id, event.target.checked)}
                />
              ) : (
                <span className="mt-1 inline-block h-3 w-3 rounded-full bg-slate-300" />
              )}
              <span className="whitespace-pre-wrap">
                {segment.kind === "added" ? "+ " : segment.kind === "removed" ? "- " : ""}
                {segment.value}
              </span>
            </label>
          );
        })}
      </div>
    </div>
  );
}

