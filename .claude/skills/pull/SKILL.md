---
name: pull
description: Pull component changes from GitHub and sync to code
disable-model-invocation: true
---

Run `git pull` and then check if any `.figma/components/*.json` files were added or modified.

If changed JSON files exist:
1. Read each changed JSON (ComponentDescriptor format)
2. Read the corresponding TSX file in `src/components/` (same base name, e.g. `atomBadge.json` → `atomBadge.tsx`)
3. Generate or update the TSX file based on the JSON descriptor
4. If the TSX already exists, preserve its code style and patterns; if not, follow the conventions of existing components in `src/components/`

If no component JSONs changed, just report the pull result.
