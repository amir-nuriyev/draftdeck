type SaveStatus = "saving" | "saved" | "offline" | "error";

function saveStatusLabel(status: SaveStatus) {
  switch (status) {
    case "saving":
      return "saving";
    case "saved":
      return "saved";
    case "offline":
      return "offline";
    default:
      return "error";
  }
}

export default function AutosaveIndicator({
  status,
  dirty,
}: {
  status: SaveStatus;
  dirty: boolean;
}) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <span data-testid="autosave-status" className="signal-pill">
        Autosave: {saveStatusLabel(status)}
      </span>
      <span className="text-sm text-slate-500">
        {dirty ? "Unsaved changes will autosave." : "Editor state matches the backend."}
      </span>
    </div>
  );
}

