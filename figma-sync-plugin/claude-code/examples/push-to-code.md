# Push to Code (Figma -> Code)

Use when the plugin shows **figma_changed** status. Figma design has been updated and code needs to match.

## Prompt Template

```
Figma MCP로 {componentName} 컴포넌트의 design context를 가져와서
GitHub의 {codePath}에 반영해줘.

기존 코드의 비즈니스 로직(이벤트 핸들러, API 호출, 상태 관리)은
그대로 보존하고, 피그마에서 변경된 스타일/레이아웃만 업데이트해줘.

피그마 컴포넌트의 description/@태그 메타데이터도 확인해서
인터랙션 정보가 있으면 반영해줘.
```

## Example

```
Figma MCP로 compCard 컴포넌트의 design context를 가져와서
GitHub의 src/components/compCard.tsx에 반영해줘.

기존 코드의 비즈니스 로직(이벤트 핸들러, API 호출, 상태 관리)은
그대로 보존하고, 피그마에서 변경된 스타일/레이아웃만 업데이트해줘.

피그마 컴포넌트의 description/@태그 메타데이터도 확인해서
인터랙션 정보가 있으면 반영해줘.
```

## After Applying

Return to the Figma Sync Plugin and click **Mark as Synced** to update the baseline hash and snapshot.
