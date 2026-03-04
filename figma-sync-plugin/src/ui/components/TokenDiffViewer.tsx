import type { TokenSnapshot, VariableSnapshotEntry, StyleSnapshotEntry } from "../../shared/types";

interface TokenDiffViewerProps {
  before: TokenSnapshot;
  after: TokenSnapshot;
}

interface TokenChange {
  name: string;
  type: "added" | "removed" | "changed";
  details?: string;
}

function diffVariables(
  before: VariableSnapshotEntry[],
  after: VariableSnapshotEntry[]
): TokenChange[] {
  const changes: TokenChange[] = [];
  const beforeMap = new Map(before.map((v) => [v.name, v]));
  const afterMap = new Map(after.map((v) => [v.name, v]));

  for (const [name, entry] of afterMap) {
    const prev = beforeMap.get(name);
    if (!prev) {
      const firstVal = Object.values(entry.valuesByMode)[0] ?? "";
      changes.push({ name, type: "added", details: firstVal });
    } else {
      const prevVals = JSON.stringify(prev.valuesByMode);
      const curVals = JSON.stringify(entry.valuesByMode);
      if (prevVals !== curVals) {
        const prevFirst = Object.values(prev.valuesByMode)[0] ?? "";
        const curFirst = Object.values(entry.valuesByMode)[0] ?? "";
        changes.push({ name, type: "changed", details: `${prevFirst} → ${curFirst}` });
      }
    }
  }

  for (const [name] of beforeMap) {
    if (!afterMap.has(name)) {
      changes.push({ name, type: "removed" });
    }
  }

  return changes;
}

function diffStyles(
  before: StyleSnapshotEntry[],
  after: StyleSnapshotEntry[]
): TokenChange[] {
  const changes: TokenChange[] = [];
  const beforeMap = new Map(before.map((s) => [s.name, s]));
  const afterMap = new Map(after.map((s) => [s.name, s]));

  for (const [name, entry] of afterMap) {
    const prev = beforeMap.get(name);
    if (!prev) {
      changes.push({ name, type: "added", details: entry.styleType });
    } else {
      const prevJson = JSON.stringify({ ...prev, id: undefined });
      const curJson = JSON.stringify({ ...entry, id: undefined });
      if (prevJson !== curJson) {
        const diffs: string[] = [];
        if (prev.paints !== entry.paints) diffs.push("paints");
        if (prev.fontSize !== entry.fontSize) diffs.push("fontSize");
        if (prev.fontFamily !== entry.fontFamily) diffs.push("fontFamily");
        if (prev.fontWeight !== entry.fontWeight) diffs.push("fontWeight");
        if (prev.effects !== entry.effects) diffs.push("effects");
        changes.push({ name, type: "changed", details: diffs.join(", ") || "properties changed" });
      }
    }
  }

  for (const [name] of beforeMap) {
    if (!afterMap.has(name)) {
      changes.push({ name, type: "removed" });
    }
  }

  return changes;
}

export function summarizeTokenChanges(before: TokenSnapshot, after: TokenSnapshot): string {
  if (before.kind !== after.kind) return "Token type changed";
  const changes =
    before.kind === "variables" && after.kind === "variables"
      ? diffVariables(before.entries, after.entries)
      : before.kind === "styles" && after.kind === "styles"
        ? diffStyles(before.entries, after.entries)
        : [];
  if (changes.length === 0) return "No token changes";
  const added = changes.filter((c) => c.type === "added").length;
  const removed = changes.filter((c) => c.type === "removed").length;
  const changed = changes.filter((c) => c.type === "changed").length;
  const parts: string[] = [];
  if (added) parts.push(`${added} added`);
  if (removed) parts.push(`${removed} removed`);
  if (changed) parts.push(`${changed} changed`);
  return parts.join(", ");
}

const typeColors = {
  added: { bg: "bg-green-50", text: "text-green-700", badge: "bg-green-100 text-green-600" },
  removed: { bg: "bg-red-50", text: "text-red-700", badge: "bg-red-100 text-red-600" },
  changed: { bg: "bg-amber-50", text: "text-amber-700", badge: "bg-amber-100 text-amber-600" },
};

export default function TokenDiffViewer({ before, after }: TokenDiffViewerProps) {
  if (before.kind !== after.kind) {
    return <div className="text-xs text-gray-400 py-2">Token type mismatch</div>;
  }

  const changes =
    before.kind === "variables" && after.kind === "variables"
      ? diffVariables(before.entries, after.entries)
      : before.kind === "styles" && after.kind === "styles"
        ? diffStyles(before.entries, after.entries)
        : [];

  if (changes.length === 0) {
    return <div className="text-xs text-gray-400 py-2">No token changes detected</div>;
  }

  return (
    <div className="space-y-1">
      {changes.map((c) => {
        const colors = typeColors[c.type];
        return (
          <div key={`${c.type}-${c.name}`} className={`flex items-baseline gap-1.5 text-xs px-1.5 py-0.5 rounded ${colors.bg}`}>
            <span className={`text-[10px] font-medium px-1 rounded ${colors.badge}`}>
              {c.type === "added" ? "+" : c.type === "removed" ? "-" : "~"}
            </span>
            <span className={`font-mono ${colors.text}`}>{c.name}</span>
            {c.details && <span className="text-gray-400 truncate">{c.details}</span>}
          </div>
        );
      })}
    </div>
  );
}
