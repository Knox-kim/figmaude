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
    const primary = result.variables.find((v) => v.name === "color/primary");
    expect(primary).toBeDefined();
    expect(primary!.valuesByMode["default"]).toBeDefined();
  });

  it("parses Dark mode values from [data-mode] block", () => {
    const result = parseCSSTokenFile(multiModeCss);
    const primary = result.variables.find((v) => v.name === "color/primary");
    expect(primary!.valuesByMode["Dark"]).toBeDefined();
  });

  it("merges modes into same variable entry", () => {
    const result = parseCSSTokenFile(multiModeCss);
    expect(result.variables).toHaveLength(2);
    const primary = result.variables.find((v) => v.name === "color/primary");
    expect(Object.keys(primary!.valuesByMode)).toHaveLength(2);
  });

  it("handles CSS with only :root (backward compat)", () => {
    const css = `:root {
  /* === Collection: Colors === */
  --color-primary: #6366f1;
}`;
    const result = parseCSSTokenFile(css);
    expect(result.variables).toHaveLength(1);
    expect(result.variables[0].valuesByMode).toEqual({ default: expect.any(String) });
  });

  it("parses correct color values for each mode", () => {
    const result = parseCSSTokenFile(multiModeCss);
    const primary = result.variables.find((v) => v.name === "color/primary");
    // Default should be parsed from #6366f1
    const defaultVal = JSON.parse(primary!.valuesByMode["default"]);
    expect(defaultVal.r).toBeCloseTo(0.388, 1);
    // Dark should be parsed from #818cf8
    const darkVal = JSON.parse(primary!.valuesByMode["Dark"]);
    expect(darkVal.r).toBeCloseTo(0.506, 1);
  });

  it("does not create mode entries for styles sections", () => {
    const cssWithStylesAndModes = `:root {
  /* === Collection: Colors === */
  --color-primary: #6366f1;

  /* === PaintStyles === */
  --paint-brand: #ff0000;
}

[data-mode="Dark"] {
  /* === Collection: Colors === */
  --color-primary: #818cf8;
}`;
    const result = parseCSSTokenFile(cssWithStylesAndModes);
    // Paint style should still be in paintStyles, not variables
    expect(result.paintStyles).toHaveLength(1);
    // Only 1 variable (color/primary) with 2 modes
    expect(result.variables).toHaveLength(1);
    expect(Object.keys(result.variables[0].valuesByMode)).toHaveLength(2);
  });

  it("handles multiple mode blocks", () => {
    const css = `:root {
  /* === Collection: Colors === */
  --color-primary: #000000;
}

[data-mode="Dark"] {
  /* === Collection: Colors === */
  --color-primary: #ffffff;
}

[data-mode="HighContrast"] {
  /* === Collection: Colors === */
  --color-primary: #0000ff;
}`;
    const result = parseCSSTokenFile(css);
    const primary = result.variables.find((v) => v.name === "color/primary");
    expect(Object.keys(primary!.valuesByMode)).toHaveLength(3);
    expect(primary!.valuesByMode["Dark"]).toBeDefined();
    expect(primary!.valuesByMode["HighContrast"]).toBeDefined();
  });
});
