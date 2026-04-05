"use client";

import { roleOptions, type UserRole } from "@/app/lib/types";

type PersonaSwitcherProps = {
  value: UserRole;
  onChange: (role: UserRole) => void;
  compact?: boolean;
};

export default function PersonaSwitcher({
  value,
  onChange,
  compact = false,
}: PersonaSwitcherProps) {
  return (
    <div className={`grid gap-2 ${compact ? "sm:grid-cols-4" : "sm:grid-cols-2 xl:grid-cols-4"}`}>
      {roleOptions.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            onClick={() => onChange(option.value)}
            className={`rounded-[1.2rem] border px-4 py-3 text-left ${
              active
                ? "border-[rgba(205,95,45,0.55)] bg-[rgba(255,232,219,0.9)] text-[#3f2416]"
                : "border-[rgba(34,39,46,0.08)] bg-[rgba(255,255,255,0.68)] text-slate-600"
            }`}
          >
            <div className="text-sm font-semibold tracking-tight">{option.label}</div>
            {!compact ? <div className="mt-1 text-xs leading-5">{option.description}</div> : null}
          </button>
        );
      })}
    </div>
  );
}
