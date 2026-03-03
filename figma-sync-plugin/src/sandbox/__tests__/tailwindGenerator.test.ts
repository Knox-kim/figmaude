import { describe, it, expect } from "vitest";
import { generateTailwindConfig } from "../tailwindGenerator";
import type { RawVariableData, RawStyleData } from "../hash";
import type { ModeInfo } from "../cssGenerator";

describe("generateTailwindConfig", () => {
  it("generates color tokens from COLOR variables", () => {
    const variables: RawVariableData[] = [{
      id: "v1", name: "color/primary/500", resolvedType: "COLOR",
      collectionName: "Colors",
      valuesByMode: { "mode:1": JSON.stringify({ r: 0.388, g: 0.4, b: 0.945, a: 1 }) },
    }];
    const config = JSON.parse(generateTailwindConfig(variables, []));
    expect(config.theme.extend.colors["primary-500"]).toBeDefined();
    expect(config.theme.extend.colors["primary-500"]).toMatch(/^#/);
  });

  it("generates spacing from FLOAT variables", () => {
    const variables: RawVariableData[] = [{
      id: "v2", name: "spacing/sm", resolvedType: "FLOAT",
      collectionName: "Spacing",
      valuesByMode: { "mode:1": "4" },
    }];
    const config = JSON.parse(generateTailwindConfig(variables, []));
    expect(config.theme.extend.spacing["sm"]).toBe("4px");
  });

  it("generates fontSize from text styles", () => {
    const styles: RawStyleData[] = [{
      id: "s1", name: "heading/1", styleType: "TEXT",
      fontSize: 32, fontFamily: "Inter", fontWeight: "Bold",
      lineHeight: JSON.stringify({ unit: "PIXELS", value: 40 }),
      letterSpacing: JSON.stringify({ unit: "PERCENT", value: -2 }),
    }];
    const config = JSON.parse(generateTailwindConfig([], styles));
    expect(config.theme.extend.fontSize["heading-1"]).toBeDefined();
    const [size, meta] = config.theme.extend.fontSize["heading-1"];
    expect(size).toBe("32px");
    expect(meta.lineHeight).toBe("40px");
    expect(meta.fontWeight).toBe("Bold");
  });

  it("generates boxShadow from effect styles", () => {
    const styles: RawStyleData[] = [{
      id: "e1", name: "card", styleType: "EFFECT",
      effects: JSON.stringify([{
        type: "DROP_SHADOW", offset: { x: 0, y: 4 }, radius: 8,
        color: { r: 0, g: 0, b: 0, a: 0.25 }, visible: true,
      }]),
    }];
    const config = JSON.parse(generateTailwindConfig([], styles));
    expect(config.theme.extend.boxShadow["card"]).toContain("rgba(");
  });

  it("generates blur from blur effect styles", () => {
    const styles: RawStyleData[] = [{
      id: "e2", name: "overlay", styleType: "EFFECT",
      effects: JSON.stringify([{ type: "LAYER_BLUR", radius: 8, visible: true }]),
    }];
    const config = JSON.parse(generateTailwindConfig([], styles));
    expect(config.theme.extend.blur["overlay"]).toBe("8px");
  });

  it("uses CSS variables for multi-mode colors", () => {
    const variables: RawVariableData[] = [{
      id: "v3", name: "color/primary", resolvedType: "COLOR",
      collectionName: "Colors",
      valuesByMode: {
        "mode:1": JSON.stringify({ r: 1, g: 0, b: 0, a: 1 }),
        "mode:2": JSON.stringify({ r: 0, g: 0, b: 1, a: 1 }),
      },
    }];
    const modeInfo: ModeInfo = {
      modeMap: new Map([["mode:1", "Light"], ["mode:2", "Dark"]]),
      defaultModes: new Map([["Colors", "mode:1"]]),
    };
    const config = JSON.parse(generateTailwindConfig(variables, [], modeInfo));
    expect(config.theme.extend.colors["primary"]).toContain("var(--color-primary)");
  });

  it("includes paint styles as colors", () => {
    const styles: RawStyleData[] = [{
      id: "p1", name: "brand/accent", styleType: "PAINT",
      paints: JSON.stringify([{ type: "SOLID", color: { r: 1, g: 0, b: 0 }, visible: true }]),
    }];
    const config = JSON.parse(generateTailwindConfig([], styles));
    expect(config.theme.extend.colors["brand-accent"]).toMatch(/^#/);
  });

  it("outputs valid JSON", () => {
    const variables: RawVariableData[] = [{
      id: "v1", name: "color/test", resolvedType: "COLOR",
      collectionName: "C",
      valuesByMode: { "m:1": JSON.stringify({ r: 0.5, g: 0.5, b: 0.5, a: 1 }) },
    }];
    const result = generateTailwindConfig(variables, []);
    expect(() => JSON.parse(result)).not.toThrow();
  });
});
