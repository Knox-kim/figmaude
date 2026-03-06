import { describe, it, expect } from "vitest";
import { parseDescription, serializeDescription, updateSyncNotes } from "../descriptionParser";

describe("parseDescription", () => {
  it("returns empty annotations for plain text", () => {
    const result = parseDescription("A simple button component");
    expect(result.plainDescription).toBe("A simple button component");
    expect(result.annotations).toEqual({});
    expect(result.syncNotes).toEqual([]);
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
    expect(parseDescription("")).toEqual({
      plainDescription: "",
      annotations: {},
      syncNotes: [],
    });
    expect(parseDescription(undefined as unknown as string)).toEqual({
      plainDescription: "",
      annotations: {},
      syncNotes: [],
    });
  });

  it("handles tags with empty values", () => {
    const result = parseDescription("@deprecated:");
    expect(result.annotations["deprecated"]).toBe("");
  });

  it("handles mixed plain text and tags with blank lines", () => {
    const result = parseDescription(
      "Button component\n\n@onClick: submit\n\nSome more text"
    );
    expect(result.plainDescription).toBe("Button component\nSome more text");
    expect(result.annotations["onClick"]).toBe("submit");
  });

  it("parses @sync: lines into syncNotes", () => {
    const result = parseDescription(
      "Button component\n@onClick: handleClick\n@sync: VECTOR child \"icon\" will become placeholder RECTANGLE\n@sync: gradient fill on \"bg\" skipped (SOLID only)"
    );
    expect(result.plainDescription).toBe("Button component");
    expect(result.annotations["onClick"]).toBe("handleClick");
    expect(result.syncNotes).toEqual([
      'VECTOR child "icon" will become placeholder RECTANGLE',
      'gradient fill on "bg" skipped (SOLID only)',
    ]);
  });

  it("excludes @sync from annotations", () => {
    const result = parseDescription("@sync: some note\n@onClick: handler");
    expect(result.annotations["sync"]).toBeUndefined();
    expect(result.annotations["onClick"]).toBe("handler");
    expect(result.syncNotes).toEqual(["some note"]);
  });
});

describe("serializeDescription", () => {
  it("serializes plain description only", () => {
    const result = serializeDescription({
      plainDescription: "A button",
      annotations: {},
      syncNotes: [],
    });
    expect(result).toBe("A button");
  });

  it("serializes description with annotations and syncNotes", () => {
    const result = serializeDescription({
      plainDescription: "Button component",
      annotations: { onClick: "handleClick" },
      syncNotes: ['gradient fill on "bg" skipped (SOLID only)'],
    });
    expect(result).toBe(
      'Button component\n@onClick: handleClick\n@sync: gradient fill on "bg" skipped (SOLID only)'
    );
  });

  it("roundtrips through parse/serialize", () => {
    const input = 'Button\n@onClick: handler\n@sync: VECTOR "icon" placeholder';
    const parsed = parseDescription(input);
    const serialized = serializeDescription(parsed);
    expect(serialized).toBe(input);
  });
});

describe("updateSyncNotes", () => {
  it("replaces old @sync lines with new ones", () => {
    const original = 'Button\n@onClick: handler\n@sync: old note';
    const result = updateSyncNotes(original, ["new note 1", "new note 2"]);
    expect(result).toBe("Button\n@onClick: handler\n@sync: new note 1\n@sync: new note 2");
  });

  it("preserves description and annotations when adding sync notes", () => {
    const original = "Button\n@onClick: handler";
    const result = updateSyncNotes(original, ["some limitation"]);
    expect(result).toBe("Button\n@onClick: handler\n@sync: some limitation");
  });

  it("removes sync notes when given empty array", () => {
    const original = 'Button\n@sync: old note\n@onClick: handler';
    const result = updateSyncNotes(original, []);
    expect(result).toBe("Button\n@onClick: handler");
  });
});
