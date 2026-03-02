import type { FlatSnapshot } from "../../shared/types";

interface DiffViewerProps {
  before: FlatSnapshot;
  after: FlatSnapshot;
}

interface Change {
  label: string;
  oldVal: string;
  newVal: string;
}

function extractHexColor(jsonStr: string): string | null {
  const match = jsonStr.match(/"color"\s*:\s*\{[^}]*"r"\s*:\s*([\d.]+)[^}]*"g"\s*:\s*([\d.]+)[^}]*"b"\s*:\s*([\d.]+)/);
  if (!match) return null;
  const [, r, g, b] = match;
  const toHex = (v: string) => Math.round(parseFloat(v) * 255).toString(16).padStart(2, "0");
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

function formatValue(key: string, val: string | number): string {
  if (typeof val === "number") return String(val);
  if (key === "fills" || key === "strokes") {
    const hex = extractHexColor(val);
    return hex ?? (val ? `${key} changed` : "none");
  }
  if (key === "cornerRadius") {
    return val === "\"MIXED\"" ? "mixed" : val;
  }
  return val || "none";
}

function computeChanges(before: FlatSnapshot, after: FlatSnapshot): Change[] {
  const changes: Change[] = [];

  const simple: Array<{ key: keyof FlatSnapshot; label: string }> = [
    { key: "type", label: "Type" },
    { key: "width", label: "Width" },
    { key: "height", label: "Height" },
    { key: "fills", label: "Fills" },
    { key: "strokes", label: "Strokes" },
    { key: "cornerRadius", label: "Corner radius" },
    { key: "layoutMode", label: "Layout" },
    { key: "itemSpacing", label: "Item spacing" },
    { key: "childCount", label: "Children" },
  ];

  for (const { key, label } of simple) {
    const oldVal = before[key];
    const newVal = after[key];
    if (String(oldVal) !== String(newVal)) {
      changes.push({
        label,
        oldVal: formatValue(key, oldVal),
        newVal: formatValue(key, newVal),
      });
    }
  }

  // Group padding into single row
  const padBefore = `${before.paddingTop},${before.paddingRight},${before.paddingBottom},${before.paddingLeft}`;
  const padAfter = `${after.paddingTop},${after.paddingRight},${after.paddingBottom},${after.paddingLeft}`;
  if (padBefore !== padAfter) {
    changes.push({
      label: "Padding",
      oldVal: `${before.paddingTop} ${before.paddingRight} ${before.paddingBottom} ${before.paddingLeft}`,
      newVal: `${after.paddingTop} ${after.paddingRight} ${after.paddingBottom} ${after.paddingLeft}`,
    });
  }

  return changes;
}

export function summarizeChanges(before: FlatSnapshot, after: FlatSnapshot): string {
  const changes = computeChanges(before, after);
  if (changes.length === 0) return "No visual changes";
  if (changes.length === 1) return `${changes[0].label} changed`;
  return `${changes.length} properties changed`;
}

export default function DiffViewer({ before, after }: DiffViewerProps) {
  const changes = computeChanges(before, after);

  if (changes.length === 0) {
    return (
      <div className="text-xs text-gray-400 py-2">No visual changes detected</div>
    );
  }

  return (
    <div className="space-y-1">
      {changes.map((c) => (
        <div key={c.label} className="flex items-baseline gap-1 text-xs">
          <span className="text-gray-500 shrink-0">{c.label}:</span>
          <span className="text-red-500 line-through">{c.oldVal}</span>
          <span className="text-gray-300">&rarr;</span>
          <span className="text-green-600">{c.newVal}</span>
        </div>
      ))}
    </div>
  );
}
