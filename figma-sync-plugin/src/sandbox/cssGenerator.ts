import type { RawVariableData, RawStyleData } from "./hash";

function toKebab(name: string): string {
  return name.replace(/\//g, "-").replace(/\s+/g, "-").toLowerCase();
}

function rgbaToHex(value: unknown): string {
  if (typeof value !== "object" || value === null) return String(value);
  const v = value as Record<string, number>;
  if ("r" in v && "g" in v && "b" in v) {
    const toHex = (n: number) => Math.round(n * 255).toString(16).padStart(2, "0");
    const hex = `#${toHex(v.r)}${toHex(v.g)}${toHex(v.b)}`;
    if ("a" in v && v.a < 1) {
      return `${hex}${toHex(v.a)}`;
    }
    return hex;
  }
  return String(value);
}

function formatVariableValue(resolvedType: string, rawValue: string): string {
  try {
    const value = JSON.parse(rawValue);
    if (resolvedType === "COLOR") return rgbaToHex(value);
    if (resolvedType === "FLOAT") return typeof value === "number" ? `${value}px` : String(value);
    if (resolvedType === "STRING") return `"${value}"`;
    if (resolvedType === "BOOLEAN") return String(value);
    return String(value);
  } catch {
    return rawValue;
  }
}

export function generateCSS(variables: RawVariableData[], styles: RawStyleData[]): string {
  const lines: string[] = [":root {"];

  // Group variables by collection
  const collections = new Map<string, RawVariableData[]>();
  for (const v of variables) {
    const group = collections.get(v.collectionName) ?? [];
    group.push(v);
    collections.set(v.collectionName, group);
  }

  for (const [collectionName, vars] of collections) {
    lines.push(`  /* === Collection: ${collectionName} === */`);
    const sorted = [...vars].sort((a, b) => a.name.localeCompare(b.name));
    for (const v of sorted) {
      const modeEntries = Object.entries(v.valuesByMode);
      const defaultValue = modeEntries[0]?.[1] ?? "";
      const cssValue = formatVariableValue(v.resolvedType, defaultValue as string);
      lines.push(`  --${toKebab(v.name)}: ${cssValue};`);
    }
    lines.push("");
  }

  // Group styles by type
  const paintStyles = styles.filter((s) => s.styleType === "PAINT");
  const textStyles = styles.filter((s) => s.styleType === "TEXT");
  const effectStyles = styles.filter((s) => s.styleType === "EFFECT");

  if (paintStyles.length > 0) {
    lines.push("  /* === PaintStyles === */");
    for (const s of paintStyles.sort((a, b) => a.name.localeCompare(b.name))) {
      if (s.paints) {
        try {
          const paints = JSON.parse(s.paints);
          const first = paints[0];
          if (first?.type === "SOLID" && first.color) {
            lines.push(`  --paint-${toKebab(s.name)}: ${rgbaToHex(first.color)};`);
          }
        } catch {
          lines.push(`  /* --paint-${toKebab(s.name)}: complex paint */`);
        }
      }
    }
    lines.push("");
  }

  if (textStyles.length > 0) {
    lines.push("  /* === TextStyles === */");
    for (const s of textStyles.sort((a, b) => a.name.localeCompare(b.name))) {
      const prefix = `--text-${toKebab(s.name)}`;
      if (s.fontSize) lines.push(`  ${prefix}-size: ${s.fontSize}px;`);
      if (s.fontFamily) lines.push(`  ${prefix}-family: "${s.fontFamily}";`);
      if (s.fontWeight) lines.push(`  ${prefix}-weight: ${s.fontWeight};`);
      if (s.lineHeight) {
        try {
          const lh = JSON.parse(s.lineHeight);
          if (lh.unit === "PIXELS") lines.push(`  ${prefix}-line-height: ${lh.value}px;`);
          else if (lh.unit === "PERCENT") lines.push(`  ${prefix}-line-height: ${lh.value}%;`);
          else lines.push(`  ${prefix}-line-height: normal;`);
        } catch {
          lines.push(`  ${prefix}-line-height: normal;`);
        }
      }
    }
    lines.push("");
  }

  if (effectStyles.length > 0) {
    lines.push("  /* === EffectStyles === */");
    for (const s of effectStyles.sort((a, b) => a.name.localeCompare(b.name))) {
      if (s.effects) {
        try {
          const effects = JSON.parse(s.effects);
          const shadow = effects[0];
          if (shadow?.type === "DROP_SHADOW") {
            const { offset, radius, color } = shadow;
            const rgba = `rgba(${Math.round(color.r * 255)}, ${Math.round(color.g * 255)}, ${Math.round(color.b * 255)}, ${color.a})`;
            lines.push(`  --shadow-${toKebab(s.name)}: ${offset.x}px ${offset.y}px ${radius}px ${rgba};`);
          } else if (shadow?.type === "LAYER_BLUR" || shadow?.type === "BACKGROUND_BLUR") {
            lines.push(`  --blur-${toKebab(s.name)}: ${shadow.radius}px;`);
          }
        } catch {
          lines.push(`  /* --effect-${toKebab(s.name)}: complex effect */`);
        }
      }
    }
    lines.push("");
  }

  lines.push("}");
  return lines.join("\n");
}
