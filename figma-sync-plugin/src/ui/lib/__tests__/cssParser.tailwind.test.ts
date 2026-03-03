import { describe, it, expect } from "vitest";
import { parseCSSTokenFile } from "../cssParser";

describe("parseCSSTokenFile Tailwind config", () => {
  it("detects JSON as Tailwind config", () => {
    const json = JSON.stringify({
      theme: { extend: { colors: { primary: "#ff0000" } } }
    });
    const result = parseCSSTokenFile(json);
    expect(result.variables).toHaveLength(1);
    expect(result.variables[0].name).toBe("primary");
  });

  it("parses color variables", () => {
    const json = JSON.stringify({
      theme: { extend: { colors: { "brand-accent": "#6366f1" } } }
    });
    const result = parseCSSTokenFile(json);
    expect(result.variables[0].resolvedType).toBe("COLOR");
    expect(result.variables[0].valuesByMode["default"]).toBeDefined();
  });

  it("skips CSS variable references in colors", () => {
    const json = JSON.stringify({
      theme: { extend: { colors: { primary: "var(--color-primary)" } } }
    });
    const result = parseCSSTokenFile(json);
    expect(result.variables).toHaveLength(0);
  });

  it("parses spacing variables", () => {
    const json = JSON.stringify({
      theme: { extend: { spacing: { sm: "4px" } } }
    });
    const result = parseCSSTokenFile(json);
    expect(result.variables[0].name).toBe("spacing/sm");
    expect(result.variables[0].resolvedType).toBe("FLOAT");
  });

  it("parses fontSize with metadata", () => {
    const json = JSON.stringify({
      theme: { extend: { fontSize: {
        "heading-1": ["32px", { lineHeight: "40px", fontWeight: "Bold" }]
      }}}
    });
    const result = parseCSSTokenFile(json);
    expect(result.textStyles).toHaveLength(1);
    expect(result.textStyles[0].fontSize).toBe(32);
    expect(result.textStyles[0].fontWeight).toBe("Bold");
  });

  it("parses boxShadow", () => {
    const json = JSON.stringify({
      theme: { extend: { boxShadow: {
        card: "0px 4px 8px rgba(0, 0, 0, 0.25)"
      }}}
    });
    const result = parseCSSTokenFile(json);
    expect(result.effectStyles).toHaveLength(1);
    const effects = JSON.parse(result.effectStyles[0].effects!);
    expect(effects[0].type).toBe("DROP_SHADOW");
  });

  it("still parses regular CSS normally", () => {
    const css = `:root {\n  /* === Collection: Colors === */\n  --color-test: #ff0000;\n}`;
    const result = parseCSSTokenFile(css);
    expect(result.variables).toHaveLength(1);
    expect(result.variables[0].name).toBe("color/test");
  });
});
