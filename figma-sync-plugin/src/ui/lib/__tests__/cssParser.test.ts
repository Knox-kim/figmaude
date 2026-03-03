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
    const css = `:root {\n  /* === Collection: Colors === */\n  --color-primary: #6366f1;\n}`;
    const result = parseCSSTokenFile(css);
    expect(result.variables).toHaveLength(1);
    expect(result.variables[0].name).toBe("color/primary");
    expect(result.variables[0].resolvedType).toBe("COLOR");
  });

  it("parses paint styles", () => {
    const css = `:root {\n  /* === PaintStyles === */\n  --paint-brand: #ff0000;\n}`;
    const result = parseCSSTokenFile(css);
    expect(result.paintStyles).toHaveLength(1);
    expect(result.paintStyles[0].name).toBe("brand");
  });

  it("parses shadow effect styles", () => {
    const css = `:root {\n  /* === EffectStyles === */\n  --shadow-card: 2px 4px 8px rgba(0, 0, 0, 0.25);\n}`;
    const result = parseCSSTokenFile(css);
    expect(result.effectStyles).toHaveLength(1);
    expect(result.effectStyles[0].name).toBe("card");
  });

  it("groups text style tokens", () => {
    const css = `:root {\n  /* === TextStyles === */\n  --text-heading-size: 32px;\n  --text-heading-family: "Inter";\n  --text-heading-weight: Bold;\n  --text-heading-line-height: 40px;\n}`;
    const result = parseCSSTokenFile(css);
    expect(result.textStyles).toHaveLength(1);
    expect(result.textStyles[0].name).toBe("heading");
    expect(result.textStyles[0].fontSize).toBe(32);
  });
});
