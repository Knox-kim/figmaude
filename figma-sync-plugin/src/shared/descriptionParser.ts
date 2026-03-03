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
