# Merge Both (Conflict Resolution)

Use when the plugin shows **conflict** status. Both Figma and code have changed since the last sync.

## Prompt Template

```
{componentName}에 양쪽 변경사항이 있어:

Figma 변경:
{figmaChanges}

Code 변경:
{codeChanges}

두 변경사항을 합쳐서 코드와 피그마 모두에 반영해줘.
코드는 GitHub에, 피그마는 generate_figma_design으로.
```

## Example

```
compModal에 양쪽 변경사항이 있어:

Figma 변경:
- padding: 12 → 16
- background: #6366F1 → #8B5CF6

Code 변경:
- onClose callback prop 추가
- border: none → 1px solid #E5E7EB

두 변경사항을 합쳐서 코드와 피그마 모두에 반영해줘.
코드는 GitHub에, 피그마는 generate_figma_design으로.
```

## Tips

- Copy the property-level diff from the plugin's Conflict View to populate the Figma changes
- Review the git diff or file history for code-side changes
- After Claude Code applies the merge, mark as synced in the plugin

## After Applying

Return to the Figma Sync Plugin and click **Keep Figma** or **Keep Code** depending on which side was used as the final source of truth, or **Mark as Synced** if both sides are now aligned.
