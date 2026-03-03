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

function extractAliasId(rawValue: string): string | null {
  try {
    const v = JSON.parse(rawValue);
    return v?.__aliasId ?? null;
  } catch {
    return null;
  }
}

function idComment(id: string, aliasId?: string | null): string {
  const alias = aliasId ? ` @alias ${aliasId}` : "";
  return ` /* @fid ${id}${alias} */`;
}

function formatVariableValue(resolvedType: string, rawValue: string): string {
  try {
    const value = JSON.parse(rawValue);

    // Handle alias references: { __alias: "variable/name" } → var(--variable-name)
    if (typeof value === "object" && value !== null && "__alias" in value) {
      return `var(--${toKebab(value.__alias)})`;
    }

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

  // Collect non-default mode entries: modeName → Array<{cssName, cssValue, collectionName, id, aliasId?}>
  const modeBlocks = new Map<string, Array<{ cssName: string; cssValue: string; collectionName: string; id: string; aliasId: string | null }>>();

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
      const comment = idComment(v.id, extractAliasId(defaultValue as string));
      lines.push(`  --${toKebab(v.name)}: ${cssValue};${comment}`);

      // Collect non-default mode values
      if (modeInfo) {
        for (const [modeId, rawValue] of modeEntries) {
          if (modeId === defaultModeId) continue;
          const modeName = modeInfo.modeMap.get(modeId);
          if (!modeName) continue;
          const modeCssValue = formatVariableValue(v.resolvedType, rawValue as string);
          const entries = modeBlocks.get(modeName) ?? [];
          entries.push({ cssName: `--${toKebab(v.name)}`, cssValue: modeCssValue, collectionName, id: v.id, aliasId: extractAliasId(rawValue as string) });
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
            lines.push(`  --paint-${toKebab(s.name)}: ${rgbaToHex(first.color)};${idComment(s.id)}`);
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
      const comment = idComment(s.id);
      if (s.fontSize != null) lines.push(`  ${prefix}-size: ${s.fontSize}px;${comment}`);
      if (s.fontFamily) lines.push(`  ${prefix}-family: "${s.fontFamily}";${comment}`);
      if (s.fontWeight) lines.push(`  ${prefix}-weight: ${s.fontWeight};${comment}`);
      if (s.lineHeight) {
        try {
          const lh = JSON.parse(s.lineHeight);
          if (lh.unit === "PIXELS") lines.push(`  ${prefix}-line-height: ${lh.value}px;${comment}`);
          else if (lh.unit === "PERCENT") lines.push(`  ${prefix}-line-height: ${lh.value}%;${comment}`);
          else lines.push(`  ${prefix}-line-height: normal;${comment}`);
        } catch {
          lines.push(`  ${prefix}-line-height: normal;${comment}`);
        }
      }
      if (s.letterSpacing) {
        try {
          const ls = JSON.parse(s.letterSpacing);
          if (ls.unit === "PIXELS") lines.push(`  ${prefix}-letter-spacing: ${ls.value}px;${comment}`);
          else if (ls.unit === "PERCENT") lines.push(`  ${prefix}-letter-spacing: ${ls.value}%;${comment}`);
        } catch {
          // skip malformed
        }
      }
    }
    lines.push("");
  }

  if (effectStyles.length > 0) {
    lines.push("  /* === EffectStyles === */");
    for (const s of effectStyles.sort((a, b) => a.name.localeCompare(b.name))) {
      if (!s.effects) continue;
      try {
        const effects = JSON.parse(s.effects);
        const shadows: string[] = [];
        const blurs: { type: string; radius: number }[] = [];

        for (const effect of effects) {
          if (effect.visible === false) continue;
          if (effect.type === "DROP_SHADOW" || effect.type === "INNER_SHADOW") {
            const { offset, radius, color } = effect;
            const rgba = `rgba(${Math.round(color.r * 255)}, ${Math.round(color.g * 255)}, ${Math.round(color.b * 255)}, ${color.a})`;
            const inset = effect.type === "INNER_SHADOW" ? "inset " : "";
            shadows.push(`${inset}${offset.x}px ${offset.y}px ${radius}px ${rgba}`);
          } else if (effect.type === "LAYER_BLUR" || effect.type === "BACKGROUND_BLUR") {
            blurs.push({ type: effect.type, radius: effect.radius });
          }
        }

        const comment = idComment(s.id);
        if (shadows.length > 0) {
          lines.push(`  --shadow-${toKebab(s.name)}: ${shadows.join(", ")};${comment}`);
        }
        for (const blur of blurs) {
          const blurPrefix = blur.type === "BACKGROUND_BLUR" ? "bg-blur" : "blur";
          lines.push(`  --${blurPrefix}-${toKebab(s.name)}: ${blur.radius}px;${comment}`);
        }
      } catch {
        lines.push(`  /* --effect-${toKebab(s.name)}: complex effect */`);
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
    const byCollection = new Map<string, Array<{ cssName: string; cssValue: string; id: string; aliasId: string | null }>>();
    for (const e of entries) {
      const group = byCollection.get(e.collectionName) ?? [];
      group.push({ cssName: e.cssName, cssValue: e.cssValue, id: e.id, aliasId: e.aliasId });
      byCollection.set(e.collectionName, group);
    }

    for (const [collectionName, vars] of byCollection) {
      lines.push(`  /* === Collection: ${collectionName} === */`);
      for (const v of vars) {
        lines.push(`  ${v.cssName}: ${v.cssValue};${idComment(v.id, v.aliasId)}`);
      }
      lines.push("");
    }

    lines.push("}");
  }

  return lines.join("\n");
}
