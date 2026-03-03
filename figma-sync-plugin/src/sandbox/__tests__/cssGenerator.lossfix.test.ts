import { describe, it, expect } from "vitest";
import { generateCSS } from "../cssGenerator";
import type { RawVariableData, RawStyleData } from "../hash";

describe("generateCSS variable alias", () => {
  it("outputs var() reference for alias variables", () => {
    const variables: RawVariableData[] = [
      {
        id: "v1", name: "background/brand", resolvedType: "COLOR",
        collectionName: "ColorSemantic",
        valuesByMode: {
          "mode:1": JSON.stringify({ __alias: "grey/950" }),
        },
      },
      {
        id: "v2", name: "grey/950", resolvedType: "COLOR",
        collectionName: "ColorPrimitive",
        valuesByMode: {
          "mode:1": JSON.stringify({ r: 0.051, g: 0.063, b: 0.094, a: 1 }),
        },
      },
    ];
    const css = generateCSS(variables, []);
    expect(css).toContain("--background-brand: var(--grey-950);");
    expect(css).toContain("--grey-950: #0d1018;");
  });

  it("does not output [object Object] for alias variables", () => {
    const variables: RawVariableData[] = [
      {
        id: "v1", name: "text/default", resolvedType: "COLOR",
        collectionName: "ColorSemantic",
        valuesByMode: {
          "mode:1": JSON.stringify({ __alias: "grey/100" }),
        },
      },
    ];
    const css = generateCSS(variables, []);
    expect(css).not.toContain("[object Object]");
    expect(css).toContain("var(--grey-100)");
  });
});

describe("generateCSS loss fixes", () => {
  describe("letter-spacing", () => {
    it("outputs pixel letter-spacing", () => {
      const styles: RawStyleData[] = [{
        id: "s1", name: "body", styleType: "TEXT",
        fontSize: 16, fontFamily: "Inter", fontWeight: "Regular",
        lineHeight: JSON.stringify({ unit: "AUTO", value: 0 }),
        letterSpacing: JSON.stringify({ unit: "PIXELS", value: 0.5 }),
      }];
      const css = generateCSS([], styles);
      expect(css).toContain("--text-body-letter-spacing: 0.5px;");
    });

    it("outputs percent letter-spacing", () => {
      const styles: RawStyleData[] = [{
        id: "s2", name: "heading/1", styleType: "TEXT",
        fontSize: 32, fontFamily: "Inter", fontWeight: "Bold",
        lineHeight: JSON.stringify({ unit: "PIXELS", value: 40 }),
        letterSpacing: JSON.stringify({ unit: "PERCENT", value: -2 }),
      }];
      const css = generateCSS([], styles);
      expect(css).toContain("--text-heading-1-letter-spacing: -2%;");
    });
  });

  describe("inner shadow", () => {
    it("outputs inner shadow with inset keyword", () => {
      const styles: RawStyleData[] = [{
        id: "e1", name: "inner-glow", styleType: "EFFECT",
        effects: JSON.stringify([{
          type: "INNER_SHADOW", offset: { x: 0, y: 2 }, radius: 4,
          color: { r: 0, g: 0, b: 0, a: 0.1 }, visible: true,
        }]),
      }];
      const css = generateCSS([], styles);
      expect(css).toContain("inset 0px 2px 4px rgba(0, 0, 0, 0.1)");
    });
  });

  describe("background blur", () => {
    it("uses --bg-blur- prefix for BACKGROUND_BLUR", () => {
      const styles: RawStyleData[] = [{
        id: "e2", name: "frosted", styleType: "EFFECT",
        effects: JSON.stringify([{ type: "BACKGROUND_BLUR", radius: 12, visible: true }]),
      }];
      const css = generateCSS([], styles);
      expect(css).toContain("--bg-blur-frosted: 12px;");
      expect(css).not.toContain("--blur-frosted");
    });

    it("uses --blur- prefix for LAYER_BLUR", () => {
      const styles: RawStyleData[] = [{
        id: "e3", name: "overlay", styleType: "EFFECT",
        effects: JSON.stringify([{ type: "LAYER_BLUR", radius: 8, visible: true }]),
      }];
      const css = generateCSS([], styles);
      expect(css).toContain("--blur-overlay: 8px;");
    });
  });

  describe("multiple effects", () => {
    it("combines drop shadow and inner shadow with comma", () => {
      const styles: RawStyleData[] = [{
        id: "e4", name: "combined", styleType: "EFFECT",
        effects: JSON.stringify([
          { type: "DROP_SHADOW", offset: { x: 0, y: 4 }, radius: 8, color: { r: 0, g: 0, b: 0, a: 0.25 }, visible: true },
          { type: "INNER_SHADOW", offset: { x: 0, y: 1 }, radius: 2, color: { r: 1, g: 1, b: 1, a: 0.1 }, visible: true },
        ]),
      }];
      const css = generateCSS([], styles);
      expect(css).toMatch(/--shadow-combined:.*,.*inset/);
    });
  });
});
