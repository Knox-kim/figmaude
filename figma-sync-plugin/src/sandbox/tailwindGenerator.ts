import type { RawVariableData, RawStyleData } from "./hash";
import type { ModeInfo } from "./cssGenerator";

function toKebab(name: string): string {
  return name.replace(/\//g, "-").replace(/\s+/g, "-").toLowerCase();
}

function rgbaToHex(value: unknown): string {
  if (typeof value !== "object" || value === null) return String(value);
  const v = value as Record<string, number>;
  if ("r" in v && "g" in v && "b" in v) {
    const toHex = (n: number) => Math.round(n * 255).toString(16).padStart(2, "0");
    const hex = `#${toHex(v.r)}${toHex(v.g)}${toHex(v.b)}`;
    if ("a" in v && v.a < 1) return `${hex}${toHex(v.a)}`;
    return hex;
  }
  return String(value);
}

function stripCollectionPrefix(name: string): string {
  const parts = name.split("/");
  if (parts.length > 1) return parts.slice(1).join("-").toLowerCase();
  return name.replace(/\//g, "-").toLowerCase();
}

export function generateTailwindConfig(
  variables: RawVariableData[],
  styles: RawStyleData[],
  modeInfo?: ModeInfo
): string {
  const colors: Record<string, string> = {};
  const spacing: Record<string, string> = {};
  const fontSize: Record<string, [string, Record<string, string>]> = {};
  const boxShadow: Record<string, string> = {};
  const blur: Record<string, string> = {};

  for (const v of variables) {
    const key = stripCollectionPrefix(v.name);
    const defaultModeId = modeInfo?.defaultModes.get(v.collectionName);
    const defaultValue = defaultModeId
      ? v.valuesByMode[defaultModeId]
      : Object.values(v.valuesByMode)[0];
    if (!defaultValue) continue;

    const hasMultipleModes = Object.keys(v.valuesByMode).length > 1;

    if (v.resolvedType === "COLOR") {
      if (hasMultipleModes) {
        colors[key] = `var(--${toKebab(v.name)})`;
      } else {
        try { colors[key] = rgbaToHex(JSON.parse(defaultValue)); }
        catch { colors[key] = defaultValue; }
      }
    } else if (v.resolvedType === "FLOAT") {
      try { spacing[key] = `${JSON.parse(defaultValue)}px`; }
      catch { spacing[key] = defaultValue; }
    }
  }

  // Text styles
  for (const s of styles.filter(s => s.styleType === "TEXT")) {
    const key = toKebab(s.name);
    const meta: Record<string, string> = {};
    if (s.lineHeight) {
      try {
        const lh = JSON.parse(s.lineHeight);
        if (lh.unit === "PIXELS") meta.lineHeight = `${lh.value}px`;
        else if (lh.unit === "PERCENT") meta.lineHeight = `${lh.value}%`;
        else meta.lineHeight = "normal";
      } catch { /* skip */ }
    }
    if (s.fontWeight) meta.fontWeight = s.fontWeight;
    if (s.letterSpacing) {
      try {
        const ls = JSON.parse(s.letterSpacing);
        if (ls.unit === "PIXELS") meta.letterSpacing = `${ls.value}px`;
        else if (ls.unit === "PERCENT") meta.letterSpacing = `${ls.value / 100}em`;
      } catch { /* skip */ }
    }
    if (s.fontSize != null) {
      fontSize[key] = [`${s.fontSize}px`, meta];
    }
  }

  // Effect styles
  for (const s of styles.filter(s => s.styleType === "EFFECT")) {
    if (!s.effects) continue;
    try {
      const effects = JSON.parse(s.effects);
      const shadows: string[] = [];
      for (const e of effects) {
        if (e.visible === false) continue;
        if (e.type === "DROP_SHADOW" || e.type === "INNER_SHADOW") {
          const rgba = `rgba(${Math.round(e.color.r * 255)}, ${Math.round(e.color.g * 255)}, ${Math.round(e.color.b * 255)}, ${e.color.a})`;
          const inset = e.type === "INNER_SHADOW" ? "inset " : "";
          shadows.push(`${inset}${e.offset.x}px ${e.offset.y}px ${e.radius}px ${rgba}`);
        } else if (e.type === "LAYER_BLUR" || e.type === "BACKGROUND_BLUR") {
          blur[toKebab(s.name)] = `${e.radius}px`;
        }
      }
      if (shadows.length > 0) boxShadow[toKebab(s.name)] = shadows.join(", ");
    } catch { /* skip */ }
  }

  // Paint styles -> colors (not covered by variables)
  for (const s of styles.filter(s => s.styleType === "PAINT")) {
    if (!s.paints) continue;
    const key = toKebab(s.name);
    if (colors[key]) continue;
    try {
      const paints = JSON.parse(s.paints);
      const first = paints[0];
      if (first?.type === "SOLID" && first.color) colors[key] = rgbaToHex(first.color);
    } catch { /* skip */ }
  }

  const extend: Record<string, unknown> = {};
  if (Object.keys(colors).length > 0) extend.colors = colors;
  if (Object.keys(spacing).length > 0) extend.spacing = spacing;
  if (Object.keys(fontSize).length > 0) extend.fontSize = fontSize;
  if (Object.keys(boxShadow).length > 0) extend.boxShadow = boxShadow;
  if (Object.keys(blur).length > 0) extend.blur = blur;

  return JSON.stringify({ theme: { extend } }, null, 2);
}
