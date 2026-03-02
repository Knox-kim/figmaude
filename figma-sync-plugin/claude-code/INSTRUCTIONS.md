# Figma Sync Plugin — Claude Code Integration Guide

This plugin manages component mappings and sync state between Figma designs and your codebase. The actual code/design transformations are performed by Claude Code using the Figma MCP server.

## Prerequisites

- Figma Sync Plugin installed and configured (repo, branch, base path)
- Claude Code with Figma MCP server connected
- GitHub token configured in the plugin

## Workflow Overview

1. **Link** components in the plugin (Figma node <-> code file)
2. **Detect** changes via the plugin's sync status (synced, figma_changed, code_changed, conflict)
3. **Transform** using Claude Code with prompts below
4. **Mark as synced** in the plugin after changes are applied

## Available Workflows

- [Push to Code](examples/push-to-code.md) — Apply Figma design changes to code
- [Pull to Figma](examples/pull-to-figma.md) — Apply code changes to Figma design
- [Merge Both](examples/merge-both.md) — Resolve conflicts with changes on both sides

## Tips

- Always check the plugin's diff view to understand what changed before running a prompt
- The plugin stores property-level snapshots, so you can see exactly which properties (padding, fills, layout) changed
- After Claude Code applies changes, return to the plugin and click "Mark as Synced" to update the baseline
