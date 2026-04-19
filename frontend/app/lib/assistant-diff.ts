import { diffWordsWithSpace } from "diff";

export type DiffSegmentKind = "same" | "added" | "removed";

export type DiffSegment = {
  id: string;
  kind: DiffSegmentKind;
  value: string;
};

export function buildDiffSegments(original: string, suggestion: string): DiffSegment[] {
  return diffWordsWithSpace(original, suggestion).map((part, index) => ({
    id: `seg-${index}`,
    kind: part.added ? "added" : part.removed ? "removed" : "same",
    value: part.value,
  }));
}

export function defaultSegmentSelection(segments: DiffSegment[]): Record<string, boolean> {
  return segments.reduce<Record<string, boolean>>((accumulator, segment) => {
    if (segment.kind !== "same") {
      accumulator[segment.id] = true;
    }
    return accumulator;
  }, {});
}

export function composeFromSegmentSelection(
  segments: DiffSegment[],
  selection: Record<string, boolean>,
): string {
  return segments
    .map((segment) => {
      if (segment.kind === "same") {
        return segment.value;
      }
      const accepted = Boolean(selection[segment.id]);
      if (segment.kind === "added") {
        return accepted ? segment.value : "";
      }
      // removed: keep only when change is rejected
      return accepted ? "" : segment.value;
    })
    .join("");
}

