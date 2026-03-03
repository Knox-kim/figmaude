import { describe, it, expect } from "vitest";
import { parseCSSTokenFile } from "../cssParser";

describe("parseCSSTokenFile loss fixes", () => {
  describe("letter-spacing", () => {
    it("parses pixel letter-spacing", () => {
      const css = `:root {\n  /* === TextStyles === */\n  --text-body-size: 16px;\n  --text-body-letter-spacing: 0.5px;\n}`;
      const result = parseCSSTokenFile(css);
      expect(result.textStyles).toHaveLength(1);
      const ls = JSON.parse(result.textStyles[0].letterSpacing!);
      expect(ls).toEqual({ unit: "PIXELS", value: 0.5 });
    });

    it("parses percent letter-spacing", () => {
      const css = `:root {\n  /* === TextStyles === */\n  --text-heading-size: 32px;\n  --text-heading-letter-spacing: -2%;\n}`;
      const result = parseCSSTokenFile(css);
      const ls = JSON.parse(result.textStyles[0].letterSpacing!);
      expect(ls).toEqual({ unit: "PERCENT", value: -2 });
    });
  });

  describe("inner shadow", () => {
    it("parses inset shadow as INNER_SHADOW", () => {
      const css = `:root {\n  /* === EffectStyles === */\n  --shadow-inner: inset 0px 2px 4px rgba(0, 0, 0, 0.1);\n}`;
      const result = parseCSSTokenFile(css);
      const effects = JSON.parse(result.effectStyles[0].effects!);
      expect(effects[0].type).toBe("INNER_SHADOW");
    });

    it("parses combined shadows (drop + inner)", () => {
      const css = `:root {\n  /* === EffectStyles === */\n  --shadow-combined: 0px 4px 8px rgba(0, 0, 0, 0.25), inset 0px 1px 2px rgba(255, 255, 255, 0.1);\n}`;
      const result = parseCSSTokenFile(css);
      const effects = JSON.parse(result.effectStyles[0].effects!);
      expect(effects).toHaveLength(2);
      expect(effects[0].type).toBe("DROP_SHADOW");
      expect(effects[1].type).toBe("INNER_SHADOW");
    });
  });

  describe("background blur", () => {
    it("parses --bg-blur- prefix as BACKGROUND_BLUR", () => {
      const css = `:root {\n  /* === EffectStyles === */\n  --bg-blur-frosted: 12px;\n}`;
      const result = parseCSSTokenFile(css);
      const effects = JSON.parse(result.effectStyles[0].effects!);
      expect(effects[0].type).toBe("BACKGROUND_BLUR");
    });

    it("parses --blur- prefix as LAYER_BLUR", () => {
      const css = `:root {\n  /* === EffectStyles === */\n  --blur-overlay: 8px;\n}`;
      const result = parseCSSTokenFile(css);
      const effects = JSON.parse(result.effectStyles[0].effects!);
      expect(effects[0].type).toBe("LAYER_BLUR");
    });
  });
});
