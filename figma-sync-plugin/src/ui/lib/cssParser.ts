import type { ApplyVariableValuesPayload, ApplyStyleValuesPayload } from "../../shared/messages";

interface ParsedTokens {
  variables: ApplyVariableValuesPayload[];
  paintStyles: ApplyStyleValuesPayload[];
  textStyles: ApplyStyleValuesPayload[];
  effectStyles: ApplyStyleValuesPayload[];
}

/**
 * Convert a CSS custom property name to Figma-style name.
 * e.g. "--color-brand-primary" → "color/brand/primary"
 *      "--paint-brand-primary" → "brand/primary" (strips prefix)
 */
export function cssNameToFigmaName(cssName: string, prefix?: string): string {
  let name = cssName.replace(/^--/, "");
  if (prefix && name.startsWith(prefix + "-")) {
    name = name.slice(prefix.length + 1);
  }
  return name.replace(/-/g, "/");
}

/**
 * Convert a CSS value back to a Figma variable value (JSON-serialized).
 */
export function cssValueToVariableValue(
  value: string,
  resolvedType: "COLOR" | "FLOAT" | "STRING" | "BOOLEAN"
): string {
  const trimmed = value.trim().replace(/;$/, "");

  if (resolvedType === "COLOR") {
    return JSON.stringify(hexToRgba(trimmed));
  }
  if (resolvedType === "FLOAT") {
    return JSON.stringify(parseFloat(trimmed));
  }
  if (resolvedType === "STRING") {
    // Remove surrounding quotes
    return JSON.stringify(trimmed.replace(/^["']|["']$/g, ""));
  }
  if (resolvedType === "BOOLEAN") {
    return JSON.stringify(trimmed === "true");
  }
  return JSON.stringify(trimmed);
}

export function hexToRgba(hex: string): { r: number; g: number; b: number; a: number } {
  hex = hex.replace(/^#/, "");
  if (!/^[0-9a-fA-F]{3,8}$/.test(hex)) {
    return { r: 0, g: 0, b: 0, a: 1 };
  }
  if (hex.length === 3) hex = hex[0] + hex[0] + hex[1] + hex[1] + hex[2] + hex[2];
  if (hex.length === 4) hex = hex[0] + hex[0] + hex[1] + hex[1] + hex[2] + hex[2] + hex[3] + hex[3];

  const r = parseInt(hex.slice(0, 2), 16) / 255;
  const g = parseInt(hex.slice(2, 4), 16) / 255;
  const b = parseInt(hex.slice(4, 6), 16) / 255;
  const a = hex.length >= 8 ? parseInt(hex.slice(6, 8), 16) / 255 : 1;
  return { r, g, b, a };
}

function inferVariableType(value: string): "COLOR" | "FLOAT" | "STRING" | "BOOLEAN" {
  const trimmed = value.trim().replace(/;$/, "");
  if (trimmed.startsWith("#")) return "COLOR";
  if (trimmed === "true" || trimmed === "false") return "BOOLEAN";
  if (/^-?\d+(\.\d+)?(px|rem|em|%)?$/.test(trimmed)) return "FLOAT";
  return "STRING";
}

/**
 * Group text style tokens that share a prefix into complete TextStyle payloads.
 * e.g. --text-heading-1-size, --text-heading-1-family → one style "heading/1"
 */
export function groupTextStyleTokens(
  textTokens: Map<string, string>
): ApplyStyleValuesPayload[] {
  const groups = new Map<string, Record<string, string>>();

  for (const [prop, value] of textTokens) {
    // e.g. "--text-heading-1-size" → suffix = "size", baseName = "heading-1"
    const withoutPrefix = prop.replace(/^--text-/, "");
    const suffixes = ["size", "family", "weight", "line-height", "letter-spacing"];
    let matchedSuffix = "";
    for (const s of suffixes) {
      if (withoutPrefix.endsWith("-" + s)) {
        matchedSuffix = s;
        break;
      }
    }
    if (!matchedSuffix) continue;

    const baseName = withoutPrefix.slice(0, -(matchedSuffix.length + 1));
    const group = groups.get(baseName) ?? {};
    group[matchedSuffix] = value.trim().replace(/;$/, "");
    groups.set(baseName, group);
  }

  return [...groups.entries()].map(([baseName, props]) => {
    const payload: ApplyStyleValuesPayload = {
      name: baseName.replace(/-/g, "/"),
      styleType: "TEXT",
    };
    if (props["size"]) payload.fontSize = parseFloat(props["size"]);
    if (props["family"]) payload.fontFamily = props["family"].replace(/^["']|["']$/g, "");
    if (props["weight"]) payload.fontWeight = props["weight"];
    if (props["line-height"]) {
      const lh = props["line-height"];
      if (lh.endsWith("px")) {
        payload.lineHeight = JSON.stringify({ unit: "PIXELS", value: parseFloat(lh) });
      } else if (lh.endsWith("%")) {
        payload.lineHeight = JSON.stringify({ unit: "PERCENT", value: parseFloat(lh) });
      } else {
        payload.lineHeight = JSON.stringify({ unit: "AUTO", value: 0 });
      }
    }
    if (props["letter-spacing"]) {
      const ls = props["letter-spacing"];
      if (ls.endsWith("px")) {
        payload.letterSpacing = JSON.stringify({ unit: "PIXELS", value: parseFloat(ls) });
      } else if (ls.endsWith("%")) {
        payload.letterSpacing = JSON.stringify({ unit: "PERCENT", value: parseFloat(ls) });
      }
    }
    return payload;
  });
}

/**
 * Parse a CSS `:root { ... }` token file and categorize tokens.
 * Also detects Tailwind config format (JSON) and routes accordingly.
 */
export function parseCSSTokenFile(css: string): ParsedTokens {
  // Check if this is a Tailwind config (JSON format)
  const trimmed = css.trim();
  if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
    try {
      return parseTailwindConfig(JSON.parse(trimmed));
    } catch {
      // Not valid JSON, fall through to CSS parsing
    }
  }

  const variables: ApplyVariableValuesPayload[] = [];
  const paintStyles: ApplyStyleValuesPayload[] = [];
  const textTokens = new Map<string, string>();
  const effectStyles: ApplyStyleValuesPayload[] = [];

  // Extract content inside :root { ... }
  const rootMatch = css.match(/:root\s*\{([\s\S]*?)\}/);
  if (!rootMatch) return { variables: [], paintStyles: [], textStyles: [], effectStyles: [] };

  const lines = rootMatch[1].split("\n");
  let currentSection = "";

  for (const line of lines) {
    const trimmed = line.trim();

    // Track section comments
    if (trimmed.startsWith("/* === ")) {
      if (trimmed.includes("Collection:")) currentSection = "variables";
      else if (trimmed.includes("PaintStyles")) currentSection = "paint";
      else if (trimmed.includes("TextStyles")) currentSection = "text";
      else if (trimmed.includes("EffectStyles")) currentSection = "effect";
      continue;
    }

    // Skip comments and empty lines
    if (!trimmed || trimmed.startsWith("/*")) continue;

    // Parse CSS custom property
    const propMatch = trimmed.match(/^(--[\w-]+)\s*:\s*(.+?);?\s*$/);
    if (!propMatch) continue;

    const [, propName, propValue] = propMatch;

    if (currentSection === "variables") {
      const resolvedType = inferVariableType(propValue);
      variables.push({
        name: cssNameToFigmaName(propName),
        resolvedType,
        valuesByMode: { default: cssValueToVariableValue(propValue, resolvedType) },
      });
    } else if (currentSection === "paint" && propName.startsWith("--paint-")) {
      const { a, ...rgb } = hexToRgba(propValue.trim());
      paintStyles.push({
        name: cssNameToFigmaName(propName, "paint"),
        styleType: "PAINT",
        paints: JSON.stringify([{ type: "SOLID", color: rgb, opacity: a, visible: true }]),
      });
    } else if (currentSection === "text" && propName.startsWith("--text-")) {
      textTokens.set(propName, propValue);
    } else if (currentSection === "effect") {
      if (propName.startsWith("--shadow-")) {
        effectStyles.push({
          name: cssNameToFigmaName(propName, "shadow"),
          styleType: "EFFECT",
          effects: parseShadowValue(propName, propValue),
        });
      } else if (propName.startsWith("--bg-blur-")) {
        effectStyles.push({
          name: cssNameToFigmaName(propName, "bg-blur"),
          styleType: "EFFECT",
          effects: JSON.stringify([{
            type: "BACKGROUND_BLUR",
            radius: parseFloat(propValue),
            visible: true,
          }]),
        });
      } else if (propName.startsWith("--blur-")) {
        effectStyles.push({
          name: cssNameToFigmaName(propName, "blur"),
          styleType: "EFFECT",
          effects: JSON.stringify([{
            type: "LAYER_BLUR",
            radius: parseFloat(propValue),
            visible: true,
          }]),
        });
      }
    }
  }

  const textStyles = groupTextStyleTokens(textTokens);

  // Parse mode-specific blocks: [data-mode="<name>"] { ... }
  const modeBlockRegex = /\[data-mode="([^"]+)"\]\s*\{([\s\S]*?)\}/g;
  let modeMatch;
  while ((modeMatch = modeBlockRegex.exec(css))) {
    const modeName = modeMatch[1];
    const modeContent = modeMatch[2];
    const modeLines = modeContent.split("\n");
    let modeSection = "";

    for (const line of modeLines) {
      const trimmed = line.trim();
      if (trimmed.startsWith("/* === ")) {
        if (trimmed.includes("Collection:")) modeSection = "variables";
        else modeSection = "";
        continue;
      }
      if (!trimmed || trimmed.startsWith("/*")) continue;

      const propMatch = trimmed.match(/^(--[\w-]+)\s*:\s*(.+?);?\s*$/);
      if (!propMatch) continue;
      const [, propName, propValue] = propMatch;

      if (modeSection === "variables") {
        const figmaName = cssNameToFigmaName(propName);
        const resolvedType = inferVariableType(propValue);
        const value = cssValueToVariableValue(propValue, resolvedType);

        const existing = variables.find((v) => v.name === figmaName);
        if (existing) {
          existing.valuesByMode[modeName] = value;
        } else {
          variables.push({
            name: figmaName,
            resolvedType,
            valuesByMode: { [modeName]: value },
          });
        }
      }
    }
  }

  return { variables, paintStyles, textStyles, effectStyles };
}

function parseTailwindConfig(config: Record<string, unknown>): ParsedTokens {
  const variables: ApplyVariableValuesPayload[] = [];
  const paintStyles: ApplyStyleValuesPayload[] = [];
  const textStyles: ApplyStyleValuesPayload[] = [];
  const effectStyles: ApplyStyleValuesPayload[] = [];

  const theme = config.theme as Record<string, unknown> | undefined;
  const extend = theme?.extend as Record<string, unknown> ?? {};

  // Colors -> variables (skip CSS variable references)
  const colors = extend.colors as Record<string, string> ?? {};
  for (const [key, value] of Object.entries(colors)) {
    if (typeof value !== "string" || value.startsWith("var(")) continue;
    variables.push({
      name: key.replace(/-/g, "/"),
      resolvedType: "COLOR",
      valuesByMode: { default: cssValueToVariableValue(value, "COLOR") },
    });
  }

  // Spacing -> variables
  const spacing = extend.spacing as Record<string, string> ?? {};
  for (const [key, value] of Object.entries(spacing)) {
    if (typeof value !== "string") continue;
    variables.push({
      name: `spacing/${key}`,
      resolvedType: "FLOAT",
      valuesByMode: { default: JSON.stringify(parseFloat(value)) },
    });
  }

  // fontSize -> text styles
  const fontSizes = extend.fontSize as Record<string, unknown> ?? {};
  for (const [key, entry] of Object.entries(fontSizes)) {
    if (!Array.isArray(entry)) continue;
    const [size, meta] = entry as [string, Record<string, string>?];
    const payload: ApplyStyleValuesPayload = {
      name: key.replace(/-/g, "/"),
      styleType: "TEXT",
      fontSize: parseFloat(size),
    };
    if (meta?.lineHeight) {
      if (meta.lineHeight.endsWith("px")) {
        payload.lineHeight = JSON.stringify({ unit: "PIXELS", value: parseFloat(meta.lineHeight) });
      } else if (meta.lineHeight.endsWith("%")) {
        payload.lineHeight = JSON.stringify({ unit: "PERCENT", value: parseFloat(meta.lineHeight) });
      }
    }
    if (meta?.fontWeight) payload.fontWeight = meta.fontWeight;
    if (meta?.letterSpacing) {
      if (meta.letterSpacing.endsWith("px")) {
        payload.letterSpacing = JSON.stringify({ unit: "PIXELS", value: parseFloat(meta.letterSpacing) });
      } else if (meta.letterSpacing.endsWith("em")) {
        payload.letterSpacing = JSON.stringify({ unit: "PERCENT", value: parseFloat(meta.letterSpacing) * 100 });
      }
    }
    textStyles.push(payload);
  }

  // boxShadow -> effect styles
  const shadows = extend.boxShadow as Record<string, string> ?? {};
  for (const [key, value] of Object.entries(shadows)) {
    if (typeof value !== "string") continue;
    effectStyles.push({
      name: key.replace(/-/g, "/"),
      styleType: "EFFECT",
      effects: parseShadowValue("--shadow-" + key, value),
    });
  }

  // blur -> effect styles
  const blurs = extend.blur as Record<string, string> ?? {};
  for (const [key, value] of Object.entries(blurs)) {
    if (typeof value !== "string") continue;
    effectStyles.push({
      name: key.replace(/-/g, "/"),
      styleType: "EFFECT",
      effects: JSON.stringify([{ type: "LAYER_BLUR", radius: parseFloat(value), visible: true }]),
    });
  }

  return { variables, paintStyles, textStyles, effectStyles };
}

function parseShadowValue(_propName: string, value: string): string {
  // Split by comma after closing paren — separates individual shadows
  // e.g. "0px 4px 8px rgba(0, 0, 0, 0.25), inset 0px 1px 2px rgba(255, 255, 255, 0.1)"
  const shadowParts = value.split(/\)\s*,\s*/).map((s, i, arr) =>
    i < arr.length - 1 ? s + ")" : s
  );
  const effects = [];

  for (const part of shadowParts) {
    const trimmed = part.trim();
    const isInset = trimmed.startsWith("inset ");
    const shadowStr = isInset ? trimmed.slice(6) : trimmed;

    const match = shadowStr.match(
      /(-?\d+(?:\.\d+)?)px\s+(-?\d+(?:\.\d+)?)px\s+(-?\d+(?:\.\d+)?)px\s+rgba\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*([\d.]+)\s*\)/
    );
    if (!match) continue;

    const [, x, y, blur, r, g, b, a] = match;
    effects.push({
      type: isInset ? "INNER_SHADOW" : "DROP_SHADOW",
      offset: { x: parseFloat(x), y: parseFloat(y) },
      radius: parseFloat(blur),
      color: {
        r: parseInt(r) / 255,
        g: parseInt(g) / 255,
        b: parseInt(b) / 255,
        a: parseFloat(a),
      },
      visible: true,
    });
  }

  return JSON.stringify(effects);
}
