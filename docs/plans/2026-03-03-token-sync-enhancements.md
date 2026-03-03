# Token Sync Enhancements Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Enhance the CSS token sync pipeline with multi-mode support, fix data loss in CSS round-trips, add description tag parsing for components, and support Tailwind config output.

**Architecture:** Four sequential improvements to the existing token sync pipeline. Tasks 1-2 modify cssGenerator (sandbox) and cssParser (UI). Task 3 adds a new pure parser + extends ComponentDescriptor types. Task 4 adds an alternative output format alongside CSS. All new code is pure functions — no Figma API changes except minor controller wiring.

**Tech Stack:** TypeScript, Vitest (new), existing Figma Plugin sandbox + React UI architecture

---

## Task 0: Add Vitest Test Infrastructure

**Files:**
- Modify: `figma-sync-plugin/package.json`
- Create: `figma-sync-plugin/vitest.config.ts`
- Create: `figma-sync-plugin/src/ui/lib/__tests__/cssParser.test.ts`

**Step 1: Install vitest**

```bash
cd figma-sync-plugin && npm install -D vitest
```

**Step 2: Create vitest config**

```ts
// figma-sync-plugin/vitest.config.ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/__tests__/**/*.test.ts"],
  },
});
```

**Step 3: Add test script to package.json**

Add to `"scripts"`:
```json
"test": "vitest run",
"test:watch": "vitest"
```

**Step 4: Write a smoke test for existing cssParser**

```ts
// figma-sync-plugin/src/ui/lib/__tests__/cssParser.test.ts
import { describe, it, expect } from "vitest";
import { parseCSSTokenFile, hexToRgba, cssNameToFigmaName } from "../cssParser";

describe("cssNameToFigmaName", () => {
  it("converts kebab-case to slash-separated", () => {
    expect(cssNameToFigmaName("--color-brand-primary")).toBe("color/brand/primary");
  });
  it("strips prefix", () => {
    expect(cssNameToFigmaName("--paint-brand-primary", "paint")).toBe("brand/primary");
  });
});

describe("hexToRgba", () => {
  it("parses 6-digit hex", () => {
    expect(hexToRgba("#ff0000")).toEqual({ r: 1, g: 0, b: 0, a: 1 });
  });
  it("parses 8-digit hex with alpha", () => {
    const result = hexToRgba("#ff000080");
    expect(result.a).toBeCloseTo(0.502, 2);
  });
});

describe("parseCSSTokenFile", () => {
  it("parses variables from :root block", () => {
    const css = `:root {
  /* === Collection: Colors === */
  --color-primary: #6366f1;
}`;
    const result = parseCSSTokenFile(css);
    expect(result.variables).toHaveLength(1);
    expect(result.variables[0].name).toBe("color/primary");
    expect(result.variables[0].resolvedType).toBe("COLOR");
  });

  it("parses paint styles", () => {
    const css = `:root {
  /* === PaintStyles === */
  --paint-brand: #ff0000;
}`;
    const result = parseCSSTokenFile(css);
    expect(result.paintStyles).toHaveLength(1);
    expect(result.paintStyles[0].name).toBe("brand");
  });

  it("parses shadow effect styles", () => {
    const css = `:root {
  /* === EffectStyles === */
  --shadow-card: 2px 4px 8px rgba(0, 0, 0, 0.25);
}`;
    const result = parseCSSTokenFile(css);
    expect(result.effectStyles).toHaveLength(1);
    expect(result.effectStyles[0].name).toBe("card");
  });
});
```

**Step 5: Run tests to verify setup**

```bash
cd figma-sync-plugin && npm test
```

Expected: All tests PASS.

**Step 6: Commit**

```bash
git add figma-sync-plugin/package.json figma-sync-plugin/vitest.config.ts figma-sync-plugin/src/ui/lib/__tests__/cssParser.test.ts
git commit -m "chore: add vitest test infrastructure with cssParser smoke tests"
```

---

## Task 1: Multi-Mode CSS Support (light/dark)

**Problem:** `generateCSS()` only outputs the first mode's values. Multi-mode variables (light/dark) lose all non-default mode data during CSS round-trip.

**Solution:** Output default mode in `:root { }`, additional modes in `[data-mode="<ModeName>"] { }` blocks. Parser reads them back with mode names as keys.

**Files:**
- Modify: `figma-sync-plugin/src/sandbox/cssGenerator.ts`
- Modify: `figma-sync-plugin/src/sandbox/tokenMapping.ts` (new `getModeInfo()`)
- Modify: `figma-sync-plugin/src/sandbox/controller.ts` (pass modeInfo to generateCSS)
- Modify: `figma-sync-plugin/src/ui/lib/cssParser.ts` (parse mode blocks)
- Create: `figma-sync-plugin/src/ui/lib/__tests__/cssParser.multimode.test.ts`
- Create: `figma-sync-plugin/src/sandbox/__tests__/cssGenerator.test.ts`

### Step 1: Write failing tests for multi-mode CSS generation

```ts
// figma-sync-plugin/src/sandbox/__tests__/cssGenerator.test.ts
import { describe, it, expect } from "vitest";
import { generateCSS } from "../cssGenerator";
import type { RawVariableData, RawStyleData } from "../hash";
import type { ModeInfo } from "../cssGenerator";

describe("generateCSS multi-mode", () => {
  const variables: RawVariableData[] = [
    {
      id: "v1",
      name: "color/primary",
      resolvedType: "COLOR",
      collectionName: "Colors",
      valuesByMode: {
        "mode:1": JSON.stringify({ r: 0.388, g: 0.4, b: 0.945, a: 1 }),
        "mode:2": JSON.stringify({ r: 0.506, g: 0.549, b: 0.973, a: 1 }),
      },
    },
  ];

  const modeInfo: ModeInfo = {
    modeMap: new Map([
      ["mode:1", "Light"],
      ["mode:2", "Dark"],
    ]),
    defaultModes: new Map([["Colors", "mode:1"]]),
  };

  it("outputs default mode values in :root", () => {
    const css = generateCSS(variables, [], modeInfo);
    expect(css).toContain(":root {");
    expect(css).toContain("--color-primary:");
  });

  it("outputs non-default modes in [data-mode] blocks", () => {
    const css = generateCSS(variables, [], modeInfo);
    expect(css).toContain('[data-mode="Dark"]');
    expect(css).toMatch(/\[data-mode="Dark"\]\s*\{[\s\S]*--color-primary:/);
  });

  it("does not output mode blocks for single-mode collections", () => {
    const singleModeVars: RawVariableData[] = [
      {
        id: "v2",
        name: "spacing/sm",
        resolvedType: "FLOAT",
        collectionName: "Spacing",
        valuesByMode: { "mode:3": "4" },
      },
    ];
    const singleModeInfo: ModeInfo = {
      modeMap: new Map([["mode:3", "Default"]]),
      defaultModes: new Map([["Spacing", "mode:3"]]),
    };
    const css = generateCSS(singleModeVars, [], singleModeInfo);
    expect(css).not.toContain("[data-mode=");
  });

  it("falls back to first-mode behavior without modeInfo", () => {
    const css = generateCSS(variables, []);
    expect(css).toContain(":root {");
    expect(css).not.toContain("[data-mode=");
  });
});
```

**Step 2: Run test to verify it fails**

```bash
cd figma-sync-plugin && npx vitest run src/sandbox/__tests__/cssGenerator.test.ts
```

Expected: FAIL — `ModeInfo` type doesn't exist yet, `generateCSS` doesn't accept 3rd arg.

**Step 3: Implement multi-mode generateCSS**

In `figma-sync-plugin/src/sandbox/cssGenerator.ts`:

1. Export `ModeInfo` interface:
```ts
export interface ModeInfo {
  modeMap: Map<string, string>;       // modeId → modeName
  defaultModes: Map<string, string>;  // collectionName → defaultModeId
}
```

2. Change `generateCSS` signature:
```ts
export function generateCSS(
  variables: RawVariableData[],
  styles: RawStyleData[],
  modeInfo?: ModeInfo
): string
```

3. In the variables loop, use `modeInfo.defaultModes.get(collectionName)` to pick the default mode value (falling back to first entry if no modeInfo).

4. After the `:root` closing brace, if `modeInfo` is provided, iterate non-default modes and output `[data-mode="<modeName>"] { ... }` blocks containing only variable overrides for that mode. Styles (paint/text/effect) are NOT duplicated in mode blocks — they stay in `:root` only.

Key logic for the mode blocks:
```ts
if (modeInfo) {
  // Collect all non-default mode names
  const nonDefaultModes = new Map<string, string>(); // modeName → modeId
  for (const [collName, vars] of collections) {
    const defaultModeId = modeInfo.defaultModes.get(collName);
    for (const v of vars) {
      for (const modeId of Object.keys(v.valuesByMode)) {
        if (modeId !== defaultModeId) {
          const modeName = modeInfo.modeMap.get(modeId);
          if (modeName) nonDefaultModes.set(modeName, modeId);
        }
      }
    }
  }

  for (const [modeName] of nonDefaultModes) {
    lines.push("");
    lines.push(`[data-mode="${modeName}"] {`);
    for (const [collName, vars] of collections) {
      const defaultModeId = modeInfo.defaultModes.get(collName);
      // Find modeId matching this modeName within this collection's variables
      let modeId: string | undefined;
      for (const v of vars) {
        for (const mid of Object.keys(v.valuesByMode)) {
          if (mid !== defaultModeId && modeInfo.modeMap.get(mid) === modeName) {
            modeId = mid;
            break;
          }
        }
        if (modeId) break;
      }
      if (!modeId) continue;

      const modeVars = vars.filter(v => modeId! in v.valuesByMode);
      if (modeVars.length === 0) continue;

      lines.push(`  /* === Collection: ${collName} === */`);
      for (const v of [...modeVars].sort((a, b) => a.name.localeCompare(b.name))) {
        const value = v.valuesByMode[modeId!];
        if (value) {
          lines.push(`  --${toKebab(v.name)}: ${formatVariableValue(v.resolvedType, value as string)};`);
        }
      }
      lines.push("");
    }
    lines.push("}");
  }
}
```

**Step 4: Run tests to verify they pass**

```bash
cd figma-sync-plugin && npx vitest run src/sandbox/__tests__/cssGenerator.test.ts
```

Expected: All PASS.

**Step 5: Write failing tests for multi-mode CSS parsing**

```ts
// figma-sync-plugin/src/ui/lib/__tests__/cssParser.multimode.test.ts
import { describe, it, expect } from "vitest";
import { parseCSSTokenFile } from "../cssParser";

describe("parseCSSTokenFile multi-mode", () => {
  const multiModeCss = `:root {
  /* === Collection: Colors === */
  --color-primary: #6366f1;
  --color-neutral: #f5f5f5;
}

[data-mode="Dark"] {
  /* === Collection: Colors === */
  --color-primary: #818cf8;
  --color-neutral: #262626;
}`;

  it("parses default mode from :root", () => {
    const result = parseCSSTokenFile(multiModeCss);
    const primary = result.variables.find(v => v.name === "color/primary");
    expect(primary).toBeDefined();
    expect(primary!.valuesByMode["default"]).toBeDefined();
  });

  it("parses Dark mode values from [data-mode] block", () => {
    const result = parseCSSTokenFile(multiModeCss);
    const primary = result.variables.find(v => v.name === "color/primary");
    expect(primary!.valuesByMode["Dark"]).toBeDefined();
  });

  it("merges modes into same variable entry", () => {
    const result = parseCSSTokenFile(multiModeCss);
    expect(result.variables).toHaveLength(2); // 2 variables, not 4
    const primary = result.variables.find(v => v.name === "color/primary");
    expect(Object.keys(primary!.valuesByMode)).toHaveLength(2);
  });

  it("ignores styles in mode blocks", () => {
    const cssWithStyles = `:root {
  /* === PaintStyles === */
  --paint-brand: #ff0000;
}

[data-mode="Dark"] {
  /* === Collection: Colors === */
  --color-primary: #818cf8;
}`;
    const result = parseCSSTokenFile(cssWithStyles);
    expect(result.paintStyles).toHaveLength(1);
  });
});
```

**Step 6: Run test to verify it fails**

```bash
cd figma-sync-plugin && npx vitest run src/ui/lib/__tests__/cssParser.multimode.test.ts
```

Expected: FAIL — parser doesn't handle `[data-mode]` blocks.

**Step 7: Implement multi-mode parsing in cssParser**

In `figma-sync-plugin/src/ui/lib/cssParser.ts`, modify `parseCSSTokenFile()`:

1. After parsing `:root { ... }`, add a second pass for mode blocks:
```ts
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
      else modeSection = ""; // Skip styles in mode blocks
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

      // Find existing variable and add mode, or create new
      const existing = variables.find(v => v.name === figmaName);
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
```

**Step 8: Run tests to verify they pass**

```bash
cd figma-sync-plugin && npx vitest run src/ui/lib/__tests__/
```

Expected: All PASS.

**Step 9: Wire up controller — add getModeInfo() and update GENERATE_CSS + APPLY_VARIABLE_VALUES**

In `figma-sync-plugin/src/sandbox/tokenMapping.ts`, add:
```ts
export interface ModeInfoData {
  modeMap: Array<[string, string]>;       // serializable version of Map
  defaultModes: Array<[string, string]>;
}

export async function getModeInfo(): Promise<ModeInfoData> {
  const collections = await figma.variables.getLocalVariableCollectionsAsync();
  const modeMap: Array<[string, string]> = [];
  const defaultModes: Array<[string, string]> = [];
  for (const c of collections) {
    defaultModes.push([c.name, c.defaultModeId]);
    for (const m of c.modes) {
      modeMap.push([m.modeId, m.name]);
    }
  }
  return { modeMap, defaultModes };
}
```

In `figma-sync-plugin/src/sandbox/controller.ts`, update `GENERATE_CSS`:
```ts
onRequestFromUI("GENERATE_CSS", async () => {
  const [variables, styles] = await Promise.all([scanVariables(), scanStyles()]);
  const modeData = await getModeInfo();
  const modeInfo = {
    modeMap: new Map(modeData.modeMap),
    defaultModes: new Map(modeData.defaultModes),
  };
  return { css: generateCSS(variables, styles, modeInfo) };
});
```

Update `APPLY_VARIABLE_VALUES` to resolve mode names:
```ts
// Replace existing mode resolution logic:
let modeId: string | undefined;
if (modeKey === "default") {
  modeId = collection.modes[0]?.modeId;
} else {
  // Match by modeId first, then by mode name
  const byId = collection.modes.find(m => m.modeId === modeKey);
  const byName = collection.modes.find(m => m.name === modeKey);
  modeId = byId?.modeId ?? byName?.modeId;
}
```

**Step 10: Typecheck**

```bash
cd figma-sync-plugin && npm run typecheck
```

Expected: No errors.

**Step 11: Commit**

```bash
git add -A && git commit -m "feat: multi-mode CSS support for variables (light/dark)"
```

---

## Task 2: Fix CSS Conversion Losses

**Problem:** Letter-spacing, inner shadow, and background blur data is lost or misidentified during CSS round-trip.

**Files:**
- Modify: `figma-sync-plugin/src/sandbox/cssGenerator.ts`
- Modify: `figma-sync-plugin/src/ui/lib/cssParser.ts`
- Create: `figma-sync-plugin/src/ui/lib/__tests__/cssLossfix.test.ts`
- Create: `figma-sync-plugin/src/sandbox/__tests__/cssGenerator.lossfix.test.ts`

### Sub-task 2a: Letter-spacing

**Step 1: Write failing test for letter-spacing generation**

```ts
// figma-sync-plugin/src/sandbox/__tests__/cssGenerator.lossfix.test.ts
import { describe, it, expect } from "vitest";
import { generateCSS } from "../cssGenerator";
import type { RawStyleData } from "../hash";

describe("generateCSS loss fixes", () => {
  describe("letter-spacing", () => {
    it("outputs letter-spacing for text styles", () => {
      const styles: RawStyleData[] = [
        {
          id: "s1",
          name: "heading/1",
          styleType: "TEXT",
          fontSize: 32,
          fontFamily: "Inter",
          fontWeight: "Bold",
          lineHeight: JSON.stringify({ unit: "PIXELS", value: 40 }),
          letterSpacing: JSON.stringify({ unit: "PERCENT", value: -2 }),
        },
      ];
      const css = generateCSS([], styles);
      expect(css).toContain("--text-heading-1-letter-spacing: -2%;");
    });

    it("outputs pixel letter-spacing", () => {
      const styles: RawStyleData[] = [
        {
          id: "s2",
          name: "body",
          styleType: "TEXT",
          fontSize: 16,
          fontFamily: "Inter",
          fontWeight: "Regular",
          lineHeight: JSON.stringify({ unit: "AUTO", value: 0 }),
          letterSpacing: JSON.stringify({ unit: "PIXELS", value: 0.5 }),
        },
      ];
      const css = generateCSS([], styles);
      expect(css).toContain("--text-body-letter-spacing: 0.5px;");
    });
  });
});
```

**Step 2: Run test to verify it fails**

```bash
cd figma-sync-plugin && npx vitest run src/sandbox/__tests__/cssGenerator.lossfix.test.ts
```

**Step 3: Add letter-spacing to cssGenerator**

In `cssGenerator.ts`, inside the textStyles loop, after the lineHeight block, add:
```ts
if (s.letterSpacing) {
  try {
    const ls = JSON.parse(s.letterSpacing);
    if (ls.unit === "PIXELS") lines.push(`  ${prefix}-letter-spacing: ${ls.value}px;`);
    else if (ls.unit === "PERCENT") lines.push(`  ${prefix}-letter-spacing: ${ls.value}%;`);
  } catch {
    // skip malformed
  }
}
```

**Step 4: Run test to verify it passes**

**Step 5: Write failing test for letter-spacing parsing**

```ts
// figma-sync-plugin/src/ui/lib/__tests__/cssLossfix.test.ts
import { describe, it, expect } from "vitest";
import { parseCSSTokenFile } from "../cssParser";

describe("parseCSSTokenFile loss fixes", () => {
  describe("letter-spacing", () => {
    it("parses pixel letter-spacing", () => {
      const css = `:root {
  /* === TextStyles === */
  --text-body-size: 16px;
  --text-body-family: "Inter";
  --text-body-weight: Regular;
  --text-body-line-height: normal;
  --text-body-letter-spacing: 0.5px;
}`;
      const result = parseCSSTokenFile(css);
      expect(result.textStyles).toHaveLength(1);
      expect(result.textStyles[0].letterSpacing).toBeDefined();
      const ls = JSON.parse(result.textStyles[0].letterSpacing!);
      expect(ls).toEqual({ unit: "PIXELS", value: 0.5 });
    });

    it("parses percent letter-spacing", () => {
      const css = `:root {
  /* === TextStyles === */
  --text-heading-size: 32px;
  --text-heading-letter-spacing: -2%;
}`;
      const result = parseCSSTokenFile(css);
      const ls = JSON.parse(result.textStyles[0].letterSpacing!);
      expect(ls).toEqual({ unit: "PERCENT", value: -2 });
    });
  });
});
```

**Step 6: Run test to verify it fails**

**Step 7: Add letter-spacing to cssParser**

In `cssParser.ts`:

1. In `groupTextStyleTokens()`, add `"letter-spacing"` to the `suffixes` array:
```ts
const suffixes = ["size", "family", "weight", "line-height", "letter-spacing"];
```

2. In the output mapping, after line-height handling, add:
```ts
if (props["letter-spacing"]) {
  const ls = props["letter-spacing"];
  if (ls.endsWith("px")) {
    payload.letterSpacing = JSON.stringify({ unit: "PIXELS", value: parseFloat(ls) });
  } else if (ls.endsWith("%")) {
    payload.letterSpacing = JSON.stringify({ unit: "PERCENT", value: parseFloat(ls) });
  }
}
```

**Step 8: Run tests to verify all pass**

**Step 9: Commit**

```bash
git commit -m "feat: add letter-spacing to CSS token round-trip"
```

### Sub-task 2b: Inner Shadow + Background Blur

**Step 10: Write failing tests for inner shadow generation**

Add to `cssGenerator.lossfix.test.ts`:
```ts
describe("inner shadow", () => {
  it("outputs inner shadow with inset keyword", () => {
    const styles: RawStyleData[] = [
      {
        id: "e1",
        name: "inner-glow",
        styleType: "EFFECT",
        effects: JSON.stringify([
          {
            type: "INNER_SHADOW",
            offset: { x: 0, y: 2 },
            radius: 4,
            color: { r: 0, g: 0, b: 0, a: 0.1 },
            visible: true,
          },
        ]),
      },
    ];
    const css = generateCSS([], styles);
    expect(css).toContain("--shadow-inner-glow: inset 0px 2px 4px rgba(0, 0, 0, 0.1);");
  });
});

describe("background blur", () => {
  it("uses --bg-blur- prefix for BACKGROUND_BLUR", () => {
    const styles: RawStyleData[] = [
      {
        id: "e2",
        name: "frosted",
        styleType: "EFFECT",
        effects: JSON.stringify([
          { type: "BACKGROUND_BLUR", radius: 12, visible: true },
        ]),
      },
    ];
    const css = generateCSS([], styles);
    expect(css).toContain("--bg-blur-frosted: 12px;");
    expect(css).not.toContain("--blur-frosted");
  });
});

describe("multiple effects per style", () => {
  it("combines drop shadow and inner shadow with comma", () => {
    const styles: RawStyleData[] = [
      {
        id: "e3",
        name: "combined",
        styleType: "EFFECT",
        effects: JSON.stringify([
          {
            type: "DROP_SHADOW",
            offset: { x: 0, y: 4 },
            radius: 8,
            color: { r: 0, g: 0, b: 0, a: 0.25 },
            visible: true,
          },
          {
            type: "INNER_SHADOW",
            offset: { x: 0, y: 1 },
            radius: 2,
            color: { r: 1, g: 1, b: 1, a: 0.1 },
            visible: true,
          },
        ]),
      },
    ];
    const css = generateCSS([], styles);
    expect(css).toMatch(/--shadow-combined:.+,.+inset/);
  });
});
```

**Step 11: Run test to verify it fails**

**Step 12: Implement inner shadow + background blur in cssGenerator**

Replace the effect styles section in `generateCSS()`:

```ts
if (effectStyles.length > 0) {
  lines.push("  /* === EffectStyles === */");
  for (const s of effectStyles.sort((a, b) => a.name.localeCompare(b.name))) {
    if (!s.effects) continue;
    try {
      const effects = JSON.parse(s.effects);
      const shadows: string[] = [];
      const blurs: { type: string; radius: number }[] = [];

      for (const effect of effects) {
        if (!effect.visible) continue;
        if (effect.type === "DROP_SHADOW" || effect.type === "INNER_SHADOW") {
          const { offset, radius, color } = effect;
          const rgba = `rgba(${Math.round(color.r * 255)}, ${Math.round(color.g * 255)}, ${Math.round(color.b * 255)}, ${color.a})`;
          const inset = effect.type === "INNER_SHADOW" ? "inset " : "";
          shadows.push(`${inset}${offset.x}px ${offset.y}px ${radius}px ${rgba}`);
        } else if (effect.type === "LAYER_BLUR" || effect.type === "BACKGROUND_BLUR") {
          blurs.push({ type: effect.type, radius: effect.radius });
        }
      }

      if (shadows.length > 0) {
        lines.push(`  --shadow-${toKebab(s.name)}: ${shadows.join(", ")};`);
      }
      for (const blur of blurs) {
        const prefix = blur.type === "BACKGROUND_BLUR" ? "bg-blur" : "blur";
        lines.push(`  --${prefix}-${toKebab(s.name)}: ${blur.radius}px;`);
      }
    } catch {
      lines.push(`  /* --effect-${toKebab(s.name)}: complex effect */`);
    }
  }
  lines.push("");
}
```

**Step 13: Run tests to verify they pass**

**Step 14: Write failing tests for inner shadow + bg blur parsing**

Add to `cssLossfix.test.ts`:
```ts
describe("inner shadow parsing", () => {
  it("parses inset shadow as INNER_SHADOW", () => {
    const css = `:root {
  /* === EffectStyles === */
  --shadow-inner: inset 0px 2px 4px rgba(0, 0, 0, 0.1);
}`;
    const result = parseCSSTokenFile(css);
    expect(result.effectStyles).toHaveLength(1);
    const effects = JSON.parse(result.effectStyles[0].effects!);
    expect(effects[0].type).toBe("INNER_SHADOW");
  });

  it("parses combined shadows (drop + inner)", () => {
    const css = `:root {
  /* === EffectStyles === */
  --shadow-combined: 0px 4px 8px rgba(0, 0, 0, 0.25), inset 0px 1px 2px rgba(255, 255, 255, 0.1);
}`;
    const result = parseCSSTokenFile(css);
    const effects = JSON.parse(result.effectStyles[0].effects!);
    expect(effects).toHaveLength(2);
    expect(effects[0].type).toBe("DROP_SHADOW");
    expect(effects[1].type).toBe("INNER_SHADOW");
  });
});

describe("background blur parsing", () => {
  it("parses --bg-blur- prefix as BACKGROUND_BLUR", () => {
    const css = `:root {
  /* === EffectStyles === */
  --bg-blur-frosted: 12px;
}`;
    const result = parseCSSTokenFile(css);
    expect(result.effectStyles).toHaveLength(1);
    const effects = JSON.parse(result.effectStyles[0].effects!);
    expect(effects[0].type).toBe("BACKGROUND_BLUR");
  });
});
```

**Step 15: Run test to verify it fails**

**Step 16: Update cssParser for inner shadow + bg blur**

In `parseCSSTokenFile()`, update the effect section parsing:

1. Add `--bg-blur-` prefix handling alongside existing `--blur-`:
```ts
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
```

2. Rewrite `parseShadowValue()` to handle `inset` keyword and multiple comma-separated shadows:
```ts
function parseShadowValue(_propName: string, value: string): string {
  // Split by comma, but not commas inside rgba()
  const shadowParts = value.split(/,\s*(?=(?:inset\s+)?-?\d)/);
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
```

**Step 17: Run all tests**

```bash
cd figma-sync-plugin && npm test
```

Expected: All PASS.

**Step 18: Typecheck**

```bash
cd figma-sync-plugin && npm run typecheck
```

**Step 19: Commit**

```bash
git commit -m "feat: fix CSS conversion losses (inner shadow, bg blur, multi-effect, letter-spacing)"
```

---

## Task 3: Description Tag Parsing

**Problem:** Component descriptions with `@onClick`, `@animation`, `@state`, `@a11y` etc. are stored as plain strings. No parsing, no structured data for code generation.

**Solution:** Add a pure parser for `@tag: value` format. Extend `ComponentDescriptor` with optional structured fields. Wire parser into `extractComponentJSON()`.

**Files:**
- Create: `figma-sync-plugin/src/shared/descriptionParser.ts`
- Create: `figma-sync-plugin/src/shared/__tests__/descriptionParser.test.ts`
- Modify: `figma-sync-plugin/src/shared/types.ts`
- Modify: `figma-sync-plugin/src/sandbox/componentExtractor.ts`

### Step 1: Write failing tests for description parser

```ts
// figma-sync-plugin/src/shared/__tests__/descriptionParser.test.ts
import { describe, it, expect } from "vitest";
import { parseDescription } from "../descriptionParser";

describe("parseDescription", () => {
  it("returns empty annotations for plain text", () => {
    const result = parseDescription("A simple button component");
    expect(result.plainDescription).toBe("A simple button component");
    expect(result.annotations).toEqual({});
  });

  it("parses single @tag", () => {
    const result = parseDescription("@onClick: toggleDropdown");
    expect(result.annotations["onClick"]).toBe("toggleDropdown");
    expect(result.plainDescription).toBe("");
  });

  it("parses multiple @tags", () => {
    const result = parseDescription(
      "@onClick: toggleDropdown\n@animation: fadeIn 200ms ease"
    );
    expect(result.annotations["onClick"]).toBe("toggleDropdown");
    expect(result.annotations["animation"]).toBe("fadeIn 200ms ease");
  });

  it("separates plain text from tags", () => {
    const result = parseDescription(
      "Primary action button\n@onClick: handleSubmit\n@a11y: role=\"button\""
    );
    expect(result.plainDescription).toBe("Primary action button");
    expect(result.annotations["onClick"]).toBe("handleSubmit");
    expect(result.annotations["a11y"]).toBe('role="button"');
  });

  it("handles multi-line tag values with continuation", () => {
    const result = parseDescription(
      "@notes: Line one\n  continues here\n@onClick: handler"
    );
    expect(result.annotations["notes"]).toBe("Line one\ncontinues here");
    expect(result.annotations["onClick"]).toBe("handler");
  });

  it("returns empty for undefined/empty input", () => {
    expect(parseDescription("")).toEqual({ plainDescription: "", annotations: {} });
    expect(parseDescription(undefined as unknown as string)).toEqual({
      plainDescription: "",
      annotations: {},
    });
  });
});
```

**Step 2: Run test to verify it fails**

```bash
cd figma-sync-plugin && npx vitest run src/shared/__tests__/descriptionParser.test.ts
```

**Step 3: Implement descriptionParser**

```ts
// figma-sync-plugin/src/shared/descriptionParser.ts

export interface ParsedDescription {
  plainDescription: string;
  annotations: Record<string, string>;
}

/**
 * Parse a Figma component description for @tag: value annotations.
 *
 * Convention:
 *   @onClick: toggleDropdown
 *   @animation: fadeIn 200ms ease
 *   @state: isOpen → shows children
 *   @a11y: role="button", aria-expanded={isOpen}
 *   @notes: Free-form notes
 *
 * Lines not starting with @ are treated as plain description.
 * Indented continuation lines are appended to the previous tag.
 */
export function parseDescription(description: string): ParsedDescription {
  if (!description) return { plainDescription: "", annotations: {} };

  const lines = description.split("\n");
  const plainLines: string[] = [];
  const annotations: Record<string, string> = {};
  let currentTag: string | null = null;

  for (const line of lines) {
    const tagMatch = line.match(/^@(\w+)\s*:\s*(.*)$/);
    if (tagMatch) {
      currentTag = tagMatch[1];
      annotations[currentTag] = tagMatch[2].trim();
    } else if (currentTag && /^\s+/.test(line) && line.trim()) {
      // Continuation line for current tag
      annotations[currentTag] += "\n" + line.trim();
    } else {
      currentTag = null;
      if (line.trim()) plainLines.push(line.trim());
    }
  }

  return {
    plainDescription: plainLines.join("\n"),
    annotations,
  };
}
```

**Step 4: Run test to verify it passes**

**Step 5: Extend ComponentDescriptor types**

In `figma-sync-plugin/src/shared/types.ts`, add after the existing `ComponentDescriptor` interface:

```ts
export interface ComponentAnnotations {
  onClick?: string;
  onChange?: string;
  onHover?: string;
  animation?: string;
  state?: string;
  a11y?: string;
  responsive?: string;
  notes?: string;
  [key: string]: string | undefined;  // allow custom tags
}
```

Add `annotations` field to `ComponentDescriptor`:
```ts
export interface ComponentDescriptor {
  $schema: string;
  name: string;
  description?: string;
  annotations?: ComponentAnnotations;  // NEW
  properties?: ComponentDescriptorProperty[];
  layout?: ComponentDescriptorLayout;
  styles?: ComponentDescriptorStyles;
  children?: ComponentDescriptorChild[];
  variants?: ComponentDescriptorVariantOverride[];
}
```

**Step 6: Wire parser into componentExtractor**

In `figma-sync-plugin/src/sandbox/componentExtractor.ts`, at line ~667:

```ts
// Replace:
if (node.description) {
  descriptor.description = node.description;
}

// With:
import { parseDescription } from "../shared/descriptionParser";

if (node.description) {
  const parsed = parseDescription(node.description);
  if (parsed.plainDescription) {
    descriptor.description = parsed.plainDescription;
  }
  if (Object.keys(parsed.annotations).length > 0) {
    descriptor.annotations = parsed.annotations;
  }
}
```

**Step 7: Typecheck**

```bash
cd figma-sync-plugin && npm run typecheck
```

**Step 8: Run all tests**

```bash
cd figma-sync-plugin && npm test
```

**Step 9: Commit**

```bash
git commit -m "feat: parse @tag annotations from component descriptions"
```

---

## Task 4: Tailwind Config Output

**Problem:** Only CSS Custom Properties output is supported. The `GlobalConfig.styling` field (`"tailwind" | "css-modules"`) exists but is unused.

**Solution:** Add a Tailwind config generator that produces a `tailwind.config.ts`-compatible theme object. Route output via `GENERATE_CSS` based on `GlobalConfig.styling`.

**Files:**
- Create: `figma-sync-plugin/src/sandbox/tailwindGenerator.ts`
- Create: `figma-sync-plugin/src/sandbox/__tests__/tailwindGenerator.test.ts`
- Modify: `figma-sync-plugin/src/sandbox/controller.ts`
- Modify: `figma-sync-plugin/src/ui/lib/cssParser.ts` (add tailwind parser)

### Step 1: Write failing tests for tailwind generator

```ts
// figma-sync-plugin/src/sandbox/__tests__/tailwindGenerator.test.ts
import { describe, it, expect } from "vitest";
import { generateTailwindConfig } from "../tailwindGenerator";
import type { RawVariableData, RawStyleData } from "../hash";
import type { ModeInfo } from "../cssGenerator";

describe("generateTailwindConfig", () => {
  it("generates color tokens", () => {
    const variables: RawVariableData[] = [
      {
        id: "v1",
        name: "color/primary/500",
        resolvedType: "COLOR",
        collectionName: "Colors",
        valuesByMode: { "mode:1": JSON.stringify({ r: 0.388, g: 0.4, b: 0.945, a: 1 }) },
      },
    ];
    const result = generateTailwindConfig(variables, []);
    const config = JSON.parse(result);
    expect(config.theme.extend.colors["primary-500"]).toBeDefined();
  });

  it("generates spacing tokens from FLOAT variables", () => {
    const variables: RawVariableData[] = [
      {
        id: "v2",
        name: "spacing/sm",
        resolvedType: "FLOAT",
        collectionName: "Spacing",
        valuesByMode: { "mode:1": "4" },
      },
    ];
    const result = generateTailwindConfig(variables, []);
    const config = JSON.parse(result);
    expect(config.theme.extend.spacing["sm"]).toBe("4px");
  });

  it("generates fontSize from text styles", () => {
    const styles: RawStyleData[] = [
      {
        id: "s1",
        name: "heading/1",
        styleType: "TEXT",
        fontSize: 32,
        fontFamily: "Inter",
        fontWeight: "Bold",
        lineHeight: JSON.stringify({ unit: "PIXELS", value: 40 }),
        letterSpacing: JSON.stringify({ unit: "PERCENT", value: -2 }),
      },
    ];
    const result = generateTailwindConfig([], styles);
    const config = JSON.parse(result);
    expect(config.theme.extend.fontSize["heading-1"]).toBeDefined();
  });

  it("generates boxShadow from effect styles", () => {
    const styles: RawStyleData[] = [
      {
        id: "e1",
        name: "card",
        styleType: "EFFECT",
        effects: JSON.stringify([
          {
            type: "DROP_SHADOW",
            offset: { x: 0, y: 4 },
            radius: 8,
            color: { r: 0, g: 0, b: 0, a: 0.25 },
            visible: true,
          },
        ]),
      },
    ];
    const result = generateTailwindConfig([], styles);
    const config = JSON.parse(result);
    expect(config.theme.extend.boxShadow["card"]).toBeDefined();
  });

  it("supports multi-mode via CSS variables", () => {
    const variables: RawVariableData[] = [
      {
        id: "v1",
        name: "color/primary",
        resolvedType: "COLOR",
        collectionName: "Colors",
        valuesByMode: {
          "mode:1": JSON.stringify({ r: 1, g: 0, b: 0, a: 1 }),
          "mode:2": JSON.stringify({ r: 0, g: 0, b: 1, a: 1 }),
        },
      },
    ];
    const modeInfo: ModeInfo = {
      modeMap: new Map([["mode:1", "Light"], ["mode:2", "Dark"]]),
      defaultModes: new Map([["Colors", "mode:1"]]),
    };
    const result = generateTailwindConfig(variables, [], modeInfo);
    // Tailwind should reference CSS variables for multi-mode support
    const config = JSON.parse(result);
    expect(config.theme.extend.colors["primary"]).toContain("var(--color-primary)");
  });
});
```

**Step 2: Run test to verify it fails**

**Step 3: Implement tailwindGenerator**

```ts
// figma-sync-plugin/src/sandbox/tailwindGenerator.ts
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
  // "color/primary/500" → "primary-500" (strip first segment if it's a category name)
  const parts = name.split("/");
  if (parts.length > 1) {
    return parts.slice(1).join("-").toLowerCase();
  }
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

  // Check if any collection has multiple modes
  const hasMultiMode = modeInfo && [...modeInfo.defaultModes.values()].some(defaultId => {
    const allModeIds = [...modeInfo.modeMap.keys()];
    return allModeIds.length > modeInfo.defaultModes.size;
  });

  for (const v of variables) {
    const key = stripCollectionPrefix(v.name);
    const defaultModeId = modeInfo?.defaultModes.get(v.collectionName);
    const defaultValue = defaultModeId
      ? v.valuesByMode[defaultModeId]
      : Object.values(v.valuesByMode)[0];

    if (!defaultValue) continue;

    // If multi-mode, reference CSS custom property instead of hardcoded value
    const collectionHasMultipleModes = modeInfo && Object.keys(v.valuesByMode).length > 1;

    if (v.resolvedType === "COLOR") {
      if (collectionHasMultipleModes) {
        colors[key] = `var(--${toKebab(v.name)})`;
      } else {
        try {
          colors[key] = rgbaToHex(JSON.parse(defaultValue));
        } catch {
          colors[key] = defaultValue;
        }
      }
    } else if (v.resolvedType === "FLOAT") {
      try {
        spacing[key] = `${JSON.parse(defaultValue)}px`;
      } catch {
        spacing[key] = defaultValue;
      }
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

  // Effect styles → boxShadow / blur
  for (const s of styles.filter(s => s.styleType === "EFFECT")) {
    if (!s.effects) continue;
    try {
      const effects = JSON.parse(s.effects);
      const shadows: string[] = [];
      for (const e of effects) {
        if (!e.visible) continue;
        if (e.type === "DROP_SHADOW" || e.type === "INNER_SHADOW") {
          const rgba = `rgba(${Math.round(e.color.r * 255)}, ${Math.round(e.color.g * 255)}, ${Math.round(e.color.b * 255)}, ${e.color.a})`;
          const inset = e.type === "INNER_SHADOW" ? "inset " : "";
          shadows.push(`${inset}${e.offset.x}px ${e.offset.y}px ${e.radius}px ${rgba}`);
        } else if (e.type === "LAYER_BLUR" || e.type === "BACKGROUND_BLUR") {
          blur[toKebab(s.name)] = `${e.radius}px`;
        }
      }
      if (shadows.length > 0) {
        boxShadow[toKebab(s.name)] = shadows.join(", ");
      }
    } catch { /* skip */ }
  }

  // Paint styles → colors (if not already covered by variables)
  for (const s of styles.filter(s => s.styleType === "PAINT")) {
    if (!s.paints) continue;
    const key = toKebab(s.name);
    if (colors[key]) continue; // variable already covers it
    try {
      const paints = JSON.parse(s.paints);
      const first = paints[0];
      if (first?.type === "SOLID" && first.color) {
        colors[key] = rgbaToHex(first.color);
      }
    } catch { /* skip */ }
  }

  const config: Record<string, unknown> = {
    theme: {
      extend: {
        ...(Object.keys(colors).length > 0 && { colors }),
        ...(Object.keys(spacing).length > 0 && { spacing }),
        ...(Object.keys(fontSize).length > 0 && { fontSize }),
        ...(Object.keys(boxShadow).length > 0 && { boxShadow }),
        ...(Object.keys(blur).length > 0 && { blur }),
      },
    },
  };

  return JSON.stringify(config, null, 2);
}
```

**Step 4: Run tests to verify they pass**

**Step 5: Wire tailwind generator into controller**

In `figma-sync-plugin/src/sandbox/controller.ts`, update `GENERATE_CSS` handler:

```ts
import { generateTailwindConfig } from "./tailwindGenerator";

onRequestFromUI("GENERATE_CSS", async () => {
  const [variables, styles] = await Promise.all([scanVariables(), scanStyles()]);
  const modeData = await getModeInfo();
  const modeInfo = {
    modeMap: new Map(modeData.modeMap),
    defaultModes: new Map(modeData.defaultModes),
  };

  const config = getGlobalConfig();
  if (config?.styling === "tailwind") {
    return { css: generateTailwindConfig(variables, styles, modeInfo) };
  }
  return { css: generateCSS(variables, styles, modeInfo) };
});
```

Note: The response field is still called `css` for backward compat, even though it may contain Tailwind JSON. The UI side already receives it as a string and commits to GitHub. A future enhancement could add a `format` field.

**Step 6: Add Tailwind config parsing to cssParser**

In `figma-sync-plugin/src/ui/lib/cssParser.ts`, add at the top of `parseCSSTokenFile()`:

```ts
export function parseCSSTokenFile(css: string): ParsedTokens {
  // Check if this is a Tailwind config (JSON)
  const trimmed = css.trim();
  if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
    try {
      return parseTailwindConfig(JSON.parse(trimmed));
    } catch {
      // Not valid JSON, fall through to CSS parsing
    }
  }

  // ... existing CSS parsing
}

function parseTailwindConfig(config: Record<string, unknown>): ParsedTokens {
  const variables: ApplyVariableValuesPayload[] = [];
  const paintStyles: ApplyStyleValuesPayload[] = [];
  const textStyles: ApplyStyleValuesPayload[] = [];
  const effectStyles: ApplyStyleValuesPayload[] = [];

  const extend = (config.theme as Record<string, unknown>)?.extend as Record<string, unknown> ?? {};

  // Colors → variables
  const colors = extend.colors as Record<string, string> ?? {};
  for (const [key, value] of Object.entries(colors)) {
    if (value.startsWith("var(")) continue; // CSS variable reference, skip
    const resolvedType = "COLOR" as const;
    variables.push({
      name: key.replace(/-/g, "/"),
      resolvedType,
      valuesByMode: { default: cssValueToVariableValue(value, resolvedType) },
    });
  }

  // Spacing → variables
  const spacing = extend.spacing as Record<string, string> ?? {};
  for (const [key, value] of Object.entries(spacing)) {
    variables.push({
      name: `spacing/${key}`,
      resolvedType: "FLOAT",
      valuesByMode: { default: JSON.stringify(parseFloat(value)) },
    });
  }

  // fontSize → text styles
  const fontSizes = extend.fontSize as Record<string, [string, Record<string, string>]> ?? {};
  for (const [key, [size, meta]] of Object.entries(fontSizes)) {
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

  // boxShadow → effect styles
  const shadows = extend.boxShadow as Record<string, string> ?? {};
  for (const [key, value] of Object.entries(shadows)) {
    effectStyles.push({
      name: key.replace(/-/g, "/"),
      styleType: "EFFECT",
      effects: parseShadowValue("--shadow-" + key, value),
    });
  }

  return { variables, paintStyles, textStyles, effectStyles };
}
```

Note: `parseShadowValue` from Task 2 already handles `inset` and multi-shadow. Reuse it here.

**Step 7: Typecheck**

```bash
cd figma-sync-plugin && npm run typecheck
```

**Step 8: Run all tests**

```bash
cd figma-sync-plugin && npm test
```

**Step 9: Commit**

```bash
git commit -m "feat: add Tailwind config output format, route via GlobalConfig.styling"
```

---

## Summary of Changes

| File | Task | Change |
|------|------|--------|
| `package.json` | 0 | Add vitest |
| `vitest.config.ts` | 0 | New config |
| `cssGenerator.ts` | 1,2 | Multi-mode blocks, inner shadow, bg blur, letter-spacing, multi-effect |
| `cssParser.ts` | 1,2,4 | Mode block parsing, inner shadow, bg blur, letter-spacing, tailwind parsing |
| `tokenMapping.ts` | 1 | New `getModeInfo()` |
| `controller.ts` | 1,4 | Pass modeInfo, route to tailwind generator, mode name resolution |
| `descriptionParser.ts` | 3 | New `@tag` parser |
| `types.ts` | 3 | `ComponentAnnotations` type, `annotations` field |
| `componentExtractor.ts` | 3 | Wire description parser |
| `tailwindGenerator.ts` | 4 | New tailwind config generator |
| `__tests__/` | All | Test files |
