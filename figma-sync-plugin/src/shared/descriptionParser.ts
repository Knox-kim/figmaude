export interface ParsedDescription {
  plainDescription: string;
  annotations: Record<string, string>;
  syncNotes: string[];
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
  if (!description) return { plainDescription: "", annotations: {}, syncNotes: [] };

  const lines = description.split("\n");
  const plainLines: string[] = [];
  const annotations: Record<string, string> = {};
  const syncNotes: string[] = [];
  let currentTag: string | null = null;

  for (const line of lines) {
    // @sync: lines are collected separately
    const syncMatch = line.match(/^@sync\s*:\s*(.*)$/);
    if (syncMatch) {
      currentTag = null;
      syncNotes.push(syncMatch[1].trim());
      continue;
    }

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
    syncNotes,
  };
}

/**
 * Serialize a ParsedDescription back into a Figma description string.
 * Preserves plain description and user annotations, replaces @sync: lines.
 */
export function serializeDescription(parsed: ParsedDescription): string {
  const parts: string[] = [];

  if (parsed.plainDescription) {
    parts.push(parsed.plainDescription);
  }

  for (const [tag, value] of Object.entries(parsed.annotations)) {
    parts.push(`@${tag}: ${value}`);
  }

  for (const note of parsed.syncNotes) {
    parts.push(`@sync: ${note}`);
  }

  return parts.join("\n");
}

/**
 * Update only the @sync: lines in a description, preserving everything else.
 */
export function updateSyncNotes(description: string, syncNotes: string[]): string {
  const parsed = parseDescription(description);
  parsed.syncNotes = syncNotes;
  return serializeDescription(parsed);
}
