# Pull to Figma (Code -> Figma)

Use when the plugin shows **code_changed** status. Code has been updated and Figma design needs to match.

## Prompt Template

```
GitHub의 {codePath}를 읽어서
피그마에 {componentName} 컴포넌트로 반영해줘.

generate_figma_design을 사용해서
코드의 레이아웃, 스타일, 컴포넌트 구조를 피그마 레이어로 변환해줘.

기존 피그마 컴포넌트의 nodeId는 {nodeId}이야.
```

## Example

```
GitHub의 src/components/compCard.tsx를 읽어서
피그마에 compCard 컴포넌트로 반영해줘.

generate_figma_design을 사용해서
코드의 레이아웃, 스타일, 컴포넌트 구조를 피그마 레이어로 변환해줘.

기존 피그마 컴포넌트의 nodeId는 1234:5678이야.
```

## After Applying

Return to the Figma Sync Plugin and click **Mark as Synced** to update the baseline hash and snapshot.
