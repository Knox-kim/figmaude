import { describe, it, expect } from "vitest";
import { generateCSS } from "../cssGenerator";
import type { RawVariableData } from "../hash";
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

  it("uses default mode value (not first entry) in :root when modeInfo provided", () => {
    // Create variables where the first entry is NOT the default mode
    const varsWithDarkFirst: RawVariableData[] = [
      {
        id: "v3",
        name: "color/bg",
        resolvedType: "COLOR",
        collectionName: "Colors",
        valuesByMode: {
          "mode:2": JSON.stringify({ r: 0.1, g: 0.1, b: 0.1, a: 1 }),  // Dark (first entry)
          "mode:1": JSON.stringify({ r: 1, g: 1, b: 1, a: 1 }),         // Light (default)
        },
      },
    ];
    const css = generateCSS(varsWithDarkFirst, [], modeInfo);
    // :root should have the Light (default) value #ffffff, not Dark #1a1a1a
    expect(css).toMatch(/:root\s*\{[\s\S]*--color-bg:\s*#ffffff/);
  });

  it("groups mode variables by mode name across collections", () => {
    const multiCollectionVars: RawVariableData[] = [
      {
        id: "v1",
        name: "color/primary",
        resolvedType: "COLOR",
        collectionName: "Colors",
        valuesByMode: {
          "mode:1": JSON.stringify({ r: 0, g: 0, b: 0, a: 1 }),
          "mode:2": JSON.stringify({ r: 1, g: 1, b: 1, a: 1 }),
        },
      },
      {
        id: "v2",
        name: "color/secondary",
        resolvedType: "COLOR",
        collectionName: "Colors",
        valuesByMode: {
          "mode:1": JSON.stringify({ r: 0.5, g: 0.5, b: 0.5, a: 1 }),
          "mode:2": JSON.stringify({ r: 0.8, g: 0.8, b: 0.8, a: 1 }),
        },
      },
    ];
    const css = generateCSS(multiCollectionVars, [], modeInfo);
    // Both variables should appear in the Dark block
    const darkBlock = css.match(/\[data-mode="Dark"\]\s*\{([\s\S]*?)\}/)?.[1] ?? "";
    expect(darkBlock).toContain("--color-primary:");
    expect(darkBlock).toContain("--color-secondary:");
  });

  it("does not duplicate styles in mode blocks", () => {
    const vars: RawVariableData[] = [
      {
        id: "v1",
        name: "color/primary",
        resolvedType: "COLOR",
        collectionName: "Colors",
        valuesByMode: {
          "mode:1": JSON.stringify({ r: 0, g: 0, b: 0, a: 1 }),
          "mode:2": JSON.stringify({ r: 1, g: 1, b: 1, a: 1 }),
        },
      },
    ];
    const styles = [
      {
        id: "s1",
        name: "brand",
        styleType: "PAINT",
        paints: JSON.stringify([{ type: "SOLID", color: { r: 1, g: 0, b: 0 } }]),
      },
    ];
    const css = generateCSS(vars, styles, modeInfo);
    const darkBlock = css.match(/\[data-mode="Dark"\]\s*\{([\s\S]*?)\}/)?.[1] ?? "";
    expect(darkBlock).not.toContain("--paint-brand:");
  });
});
