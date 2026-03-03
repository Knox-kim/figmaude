# Component Descriptor JSON — Design Document

**Date**: 2026-03-03
**Status**: Approved

## Problem

Component sync currently uses "Copy Context" + external MCP tools (`generate_figma_design`), which creates flat layers without Figma component properties, variants, or instance relationships. This breaks cascading updates (e.g., Button change not propagating to Login's Button instance).

## Solution

Introduce a **Component Descriptor JSON** format as the intermediate representation between code and Figma. Claude Code generates JSON from code, the plugin interprets JSON into proper Figma components via Plugin API (and vice versa).

## Three Use Cases

1. **UC1 Code → Figma**: Claude Code analyzes code → generates `.figma/components/Button.json` → plugin pulls and creates Figma component
2. **UC2 Figma → Code**: Plugin extracts Figma component → pushes `.figma/components/Button.json` → Claude Code reads and generates code
3. **UC3 Bidirectional Sync**: Hash-based change detection → Push to Code or Pull from Code through JSON

## Component Descriptor JSON Schema

```json
{
  "$schema": "figma-component-descriptor/v1",
  "name": "Button",
  "description": "Primary action button",

  "properties": [
    { "name": "variant", "type": "VARIANT", "options": ["primary", "secondary", "ghost"], "default": "primary" },
    { "name": "size", "type": "VARIANT", "options": ["sm", "md", "lg"], "default": "md" },
    { "name": "disabled", "type": "BOOLEAN", "default": false },
    { "name": "label", "type": "TEXT", "default": "Button" },
    { "name": "icon", "type": "INSTANCE_SWAP", "default": null }
  ],

  "layout": {
    "mode": "HORIZONTAL",
    "padding": { "top": 8, "right": 16, "bottom": 8, "left": 16 },
    "itemSpacing": 8,
    "primaryAxisAlign": "CENTER",
    "counterAxisAlign": "CENTER"
  },

  "styles": {
    "fills": [{ "type": "SOLID", "color": "#3B82F6" }],
    "cornerRadius": 8,
    "strokes": [],
    "effects": []
  },

  "children": [
    {
      "type": "TEXT",
      "name": "label",
      "bindTo": "label",
      "styles": {
        "fontSize": 14,
        "fontFamily": "Inter",
        "fontWeight": 500,
        "fills": [{ "type": "SOLID", "color": "#FFFFFF" }]
      }
    }
  ],

  "variants": [
    {
      "props": { "variant": "secondary", "size": "md" },
      "overrides": {
        "styles": { "fills": [{ "type": "SOLID", "color": "#E5E7EB" }] },
        "children": {
          "label": { "styles": { "fills": [{ "type": "SOLID", "color": "#1F2937" }] } }
        }
      }
    }
  ]
}
```

### Schema Details

**properties**: Maps 1:1 to Figma Component Properties
- `VARIANT` — creates variant axis
- `BOOLEAN` — boolean toggle (show/hide layers)
- `TEXT` — text content override
- `INSTANCE_SWAP` — swap child instance

**layout**: Auto Layout settings

**styles**: Visual properties (fills, strokes, effects, cornerRadius)

**children**: Recursive node tree. Each child can have:
- `bindTo` — links to a component property
- `componentRef` — references another Main Component (for INSTANCE type)

**variants**: Override array. Each entry specifies variant prop combination + style/children overrides (delta from base).

**Variable binding**:
```json
{ "type": "SOLID", "color": "#3B82F6", "boundVariable": "color/brand/primary" }
```
When `boundVariable` is present, plugin binds the fill to the corresponding Figma Variable.

## Data Flow

### UC1: Code → Figma
```
Claude Code → analyzes Button.tsx
           → generates .figma/components/Button.json
           → commits to GitHub
Plugin     → user clicks "Pull from Code"
           → reads Button.json from GitHub
           → componentBuilder: JSON → Plugin API calls
           → creates/updates Main Component with properties, variants, instances
           → updates hashes
```

### UC2: Figma → Code
```
Plugin     → user clicks "Push to Code"
           → componentExtractor: traverses Figma node → Button.json
           → commits to GitHub
Claude Code → user requests code generation
           → reads Button.json
           → generates/updates Button.tsx
           → commits to GitHub
Plugin     → updates hashes
```

### UC3: Bidirectional Sync
```
Change detected via hash comparison (existing logic)
→ figma_changed: Push to Code (extract JSON, commit)
→ code_changed: Pull from Code (read JSON, apply to Figma)
→ conflict: user picks side via ConflictView
```

## Upsert Logic (Existing Node Update)

When pulling JSON and the component already exists in Figma:
1. Find existing node by nodeId
2. Diff properties: add new, delete removed, edit changed
3. Overwrite styles/layout
4. Diff children: add/delete/modify
5. Diff variants: add/delete/modify

Instance cascading is handled natively by Figma — updating a Main Component auto-propagates to all instances.

## New Files

| File | Layer | Purpose |
|------|-------|---------|
| `componentBuilder.ts` | sandbox | JSON → Figma Plugin API calls |
| `componentExtractor.ts` | sandbox | Figma node → JSON extraction |

## Modified Files

| File | Change |
|------|--------|
| `controller.ts` | Add APPLY_COMPONENT_JSON, EXTRACT_COMPONENT_JSON handlers |
| `messages.ts` | Add 2 new message types |
| `useSyncActions.ts` | Add component branches to handleForceSyncCode/handleForceSyncFigma |
| `ComponentCard.tsx` | Enable "Pull from Code" for components |
| `types.ts` | Add ComponentDescriptor type definition |

## Deleted Files

| File | Reason |
|------|--------|
| `tailwindParser.ts` | Replaced by Component Descriptor approach |
| Copy Context code | Replaced by direct JSON sync |

## Unchanged

- Token sync (Variables/Styles ↔ CSS) — untouched
- Hash comparison logic — reused (JSON file SHA = codeHash)
- Auto-linking by name — reused
- ConflictView — reused (Keep Figma = Push JSON, Keep Code = Pull JSON)

## GitHub File Structure

```
.figma/
  components/
    Button.json
    Input.json
    LoginForm.json
```

## Known Constraints

1. **Manual switch between Claude Code ↔ Plugin** — unavoidable without Claude API
2. **JSON schema won't cover 100% of Figma features** — extend incrementally
3. **componentRef resolution** — referenced component must exist in Figma first; sync in dependency order
4. **Large variant matrices** — 2-3 property combinations can produce large JSON files

## Out of Scope

- Automatic dependency resolution (auto-ordering component sync)
- Figma prototyping/interaction sync
- Automatic code generation (Claude Code handles separately)
- Auto-generating variants not specified in JSON
