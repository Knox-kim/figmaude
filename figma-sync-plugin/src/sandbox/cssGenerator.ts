import type { RawVariableData, RawStyleData } from "./hash";

export interface ModeInfo {
  modeMap: Map<string, string>;       // modeId → modeName
  defaultModes: Map<string, string>;  // collectionName → defaultModeId
}

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

export function generateCSS(
  variables: RawVariableData[],
  styles: RawStyleData[],
  modeInfo?: ModeInfo
): string {
  const lines: string[] = [":root {"];

  // Group variables by collection
  const collections = new Map<string, RawVariableData[]>();
  for (const v of variables) {
    const group = collections.get(v.collectionName) ?? [];
    group.push(v);
    collections.set(v.collectionName, group);
  }

  // Collect non-default mode entries: modeName → Array<{cssName, cssValue, collectionName}>
  const modeBlocks = new Map<string, Array<{ cssName: string; cssValue: string; collectionName: string }>>();

  for (const [collectionName, vars] of collections) {
    lines.push(`  /* === Collection: ${collectionName} === */`);
    const sorted = [...vars].sort((a, b) => a.name.localeCompare(b.name));

    // Determine default mode ID for this collection
    const defaultModeId = modeInfo?.defaultModes.get(collectionName);

    for (const v of sorted) {
      const modeEntries = Object.entries(v.valuesByMode);

      // Pick default value: use defaultModeId if available, else first entry
      let defaultValue: string;
      if (defaultModeId && v.valuesByMode[defaultModeId] !== undefined) {
        defaultValue = v.valuesByMode[defaultModeId];
      } else {
        defaultValue = modeEntries[0]?.[1] ?? "";
      }
      const cssValue = formatVariableValue(v.resolvedType, defaultValue as string);
      lines.push(`  --${toKebab(v.name)}: ${cssValue};`);

      // Collect non-default mode values
      if (modeInfo) {
        for (const [modeId, rawValue] of modeEntries) {
          if (modeId === defaultModeId) continue;
          const modeName = modeInfo.modeMap.get(modeId);
          if (!modeName) continue;
          const modeCssValue = formatVariableValue(v.resolvedType, rawValue as string);
          const entries = modeBlocks.get(modeName) ?? [];
          entries.push({ cssName: `--${toKebab(v.name)}`, cssValue: modeCssValue, collectionName });
          modeBlocks.set(modeName, entries);
        }
      }
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
      if (s.fontSize != null) lines.push(`  ${prefix}-size: ${s.fontSize}px;`);
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

  // Output non-default mode blocks
  for (const [modeName, entries] of modeBlocks) {
    lines.push("");
    lines.push(`[data-mode="${modeName}"] {`);

    // Group entries by collection for section comments
    const byCollection = new Map<string, Array<{ cssName: string; cssValue: string }>>();
    for (const e of entries) {
      const group = byCollection.get(e.collectionName) ?? [];
      group.push({ cssName: e.cssName, cssValue: e.cssValue });
      byCollection.set(e.collectionName, group);
    }

    for (const [collectionName, vars] of byCollection) {
      lines.push(`  /* === Collection: ${collectionName} === */`);
      for (const v of vars) {
        lines.push(`  ${v.cssName}: ${v.cssValue};`);
      }
      lines.push("");
    }

    lines.push("}");
  }

  return lines.join("\n");
}
