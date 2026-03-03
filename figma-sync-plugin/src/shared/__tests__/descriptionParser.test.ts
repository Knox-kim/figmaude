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
    expect(parseDescription("")).toEqual({
      plainDescription: "",
      annotations: {},
    });
    expect(parseDescription(undefined as unknown as string)).toEqual({
      plainDescription: "",
      annotations: {},
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
});
