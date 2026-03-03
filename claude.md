## Plugin Goals — Three Core Use Cases

This plugin enables bidirectional sync between Figma and code via GitHub. All features serve one of these three use cases:

### UC1: Code → Figma (Initial Setup)
Code-first workflow. Design system (CSS tokens) and components already exist in code, Figma is empty or has only dummy layers. The plugin maps Figma layers to code files by name, then pushes code-defined designs and tokens into Figma.

### UC2: Figma → Code (Initial Setup)
Design-first workflow. Assets exist in Figma first with no corresponding code. The plugin maps Figma components to code file paths by name, then syncs Figma data (tokens, component designs) into code via GitHub.

### UC3: Bidirectional Sync (Ongoing)
Both sides are already 1:1 mapped and roughly in sync. When one side updates:
- **Figma updated** → "Push to Code" commits changes to GitHub → local pulls latest
- **Code updated** → push to GitHub → "Pull from Code" in plugin applies changes to Figma
- **Both updated** → conflict detection → user chooses which side wins

### Sync Scope
- **Tokens (Variables/Styles)**: Fully automated bidirectional CSS ↔ Figma sync within the plugin
- **Components**: Plugin handles detection, linking, and context; Claude Code generates Figma Plugin API scripts, plugin executes them to create proper components with properties/variants/instances

### Component Sync — Key Design Decisions

**Use Figma Plugin API, NOT `generate_figma_design` for components.**
`generate_figma_design` creates flat layers — no component properties, no variants, no instance relationships. Instead, Claude Code should generate Plugin API scripts (`figma.createComponent()`, `addComponentProperty()`, etc.) that the plugin executes in its sandbox. This preserves Figma's component system.

**Instance cascading edge case:**
When Button is updated in code and pulled to Figma, Login (which contains a Button instance) must auto-update. This ONLY works if Button is a proper Main Component with instances — not flat layers. Therefore component sync MUST use Plugin API to maintain Main Component → Instance relationships. Token-level changes (colors, spacing via Variables) already cascade automatically.

**Prop addition edge case:**
When a new prop is added to Button in code and other code files reference that prop, "Pull from Code" must update the Figma Main Component's properties (not just visuals). Instances referencing the component then inherit the new property automatically via Figma's native component system.

---

## Workflow Orchestration

### 1. Plan Node Default
- Enter plan mode for ANY non-trivial task (3+ steps or architectural decisions)
- If something goes sideways, STOP and re-plan immediately - don't keep pushing
- Use plan mode for verification steps, not just building
- Write detailed specs upfront to reduce ambiguity

### 2. Subagent Strategy
- Use subagents liberally to keep main context window clean
- Offload research, exploration, and parallel analysis to subagents
- For complex problems, throw more compute at it via subagents
- One tack per subagent for focused execution

### 3. Self-Improvement Loop
- After ANY correction from the user: update `tasks/lessons.md` with the pattern
- Write rules for yourself that prevent the same mistake
- Ruthlessly iterate on these lessons until mistake rate drops
- Review lessons at session start for relevant project

### 4. Verification Before Done
- Never mark a task complete without proving it works
- Diff behavior between main and your changes when relevant
- Ask yourself: "Would a staff engineer approve this?"
- Run tests, check logs, demonstrate correctness

### 5. Demand Elegance (Balanced)
- For non-trivial changes: pause and ask "is there a more elegant way?"
- If a fix feels hacky: "Knowing everything I know now, implement the elegant solution"
- Skip this for simple, obvious fixes - don't over-engineer
- Challenge your own work before presenting it

### 6. Autonomous Bug Fixing
- When given a bug report: just fix it. Don't ask for hand-holding
- Point at logs, errors, failing tests - then resolve them
- Zero context switching required from the user
- Go fix failing CI tests without being told how

## Task Management

1. **Plan First**: Write plan to `tasks/todo.md` with checkable items
2. **Verify Plan**: Check in before starting implementation
3. **Track Progress**: Mark items complete as you go
4. **Explain Changes**: High-level summary at each step
5. **Document Results**: Add review section to `tasks/todo.md`
6. **Capture Lessons**: Update `tasks/lessons.md` after corrections

## Communication

- **작업 완료 브리핑은 한글로**: 작업이 끝난 후 최종 요약/브리핑은 반드시 한국어로 작성한다. 코드, 커밋 메시지, 주석 등은 영어 유지.

## Core Principles

- **Simplicity First**: Make every change as simple as possible. Impact minimal code.
- **No Laziness**: Find root causes. No temporary fixes. Senior developer standards.
- **Minimal Impact**: Changes should only touch what's necessary. Avoid introducing bugs.

## Figma MCP — Capabilities & Architecture Guide

**NEVER FORGET: Figma MCP has a powerful set of tools. Before building custom parsers or manual conversion logic, ALWAYS check whether an MCP tool can solve the problem first. If unsure about MCP capabilities, run `gh api repos/figma/mcp-server-guide/readme --jq '.content' | base64 -d` to fetch the latest docs.**

### Available MCP Tools

| Tool | Direction | What it does |
|------|-----------|-------------|
| `get_design_context` | Figma → Code | Reads a design node and returns React+Tailwind code + screenshot + metadata. Framework/style customizable via prompt. |
| `generate_figma_design` | Code → Figma | **Captures a web page (including localhost) and converts it into Figma layers.** Full structure, styles, text, icons included. |
| `get_variable_defs` | Figma → Data | Extracts variable/style definitions (colors, spacing, typography, etc.) |
| `get_screenshot` | Figma → Image | Captures a screenshot of a node |
| `get_metadata` | Figma → Data | Returns node structure as XML (IDs, names, types, positions, sizes) |
| `get_code_connect_map` | Figma ↔ Code | Queries Figma component ↔ code component mappings |
| `add_code_connect_map` | Code → Figma | Links a code component to a Figma node |
| `generate_diagram` | Text → FigJam | Creates FigJam diagrams from Mermaid syntax |

### Key Principles

1. **Component sync (Code → Figma)**: Claude Code analyzes code components → generates Figma Plugin API scripts → plugin executes in sandbox → proper components with properties/variants/instances. NOT `generate_figma_design` (flat layers only).
2. **Component sync (Figma → Code)**: Use `get_design_context` MCP to read designs. When Code Connect is configured, it reuses actual project components.
3. **Token sync**: Fully within plugin. CSS ↔ Figma Variables/Styles, no external tools needed.
4. **Plugin API and MCP are complementary**: MCP reads Figma data for Claude Code. Plugin API writes structured components into Figma. Plugin orchestrates both.
5. **Figma data format gotchas**:
   - `SolidPaint.color`: `{r,g,b}` (alpha goes in a separate `opacity` field)
   - `Effect.color`: `{r,g,b,a}` (alpha included)
   - `Variable (COLOR)`: `{r,g,b,a}` (alpha included)

### Architecture Direction

The plugin's role is **detection + UI hub + Plugin API executor**:
- Change detection (hash comparison)
- UI (status display, action buttons)
- GitHub integration (file read/write)
- Token sync execution (CSS ↔ Variables/Styles) directly
- Component sync execution via Plugin API scripts generated by Claude Code