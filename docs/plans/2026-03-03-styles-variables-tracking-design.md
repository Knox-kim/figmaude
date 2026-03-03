# Styles & Variables Tracking Design

## Goal
Figma의 Styles(Paint/Text/Effect/Grid)와 Variables(COLOR/FLOAT/STRING/BOOLEAN)를 추적하여 CSS 토큰 파일과 동기화한다.

## Decisions
- Variables + Styles 동시 구현
- CSS/SCSS 토큰 파일로 매핑 (Tailwind보다 커버리지 높음, 프레임워크 무관)
- 통합 MappingEntry 확장 (`kind` 필드 추가)
- 단일 토큰 파일, 주석 섹션으로 구분 (Figma Collection/Style Type 기준)
- UI는 기존 컴포넌트 카드와 동일 — Variables 카드 1개, Styles 카드 1개

---

## 1. Data Model

### MappingEntry 확장
```typescript
interface MappingEntry {
  kind: 'component' | 'style' | 'variable'
  nodeId: string
  styleId?: string
  variableId?: string
  collectionName?: string
  styleType?: 'PAINT' | 'TEXT' | 'EFFECT' | 'GRID'
  linkedFile: string
  componentName: string
  figmaHash: string
  codeHash: string
  lastSyncedHash: string
  lastSyncedAt: string
  lastSyncSource: 'figma' | 'code'
  lastSyncedSnapshot?: FlatSnapshot | TokenSnapshot
}
```

### TokenSnapshot (new)
```typescript
interface VariableSnapshot {
  resolvedType: 'COLOR' | 'FLOAT' | 'STRING' | 'BOOLEAN'
  valuesByMode: Record<string, string>
  scopes: string[]
  codeSyntax?: string
}

interface StyleSnapshot {
  styleType: 'PAINT' | 'TEXT' | 'EFFECT' | 'GRID'
  paints?: string
  fontSize?: number
  fontFamily?: string
  fontWeight?: string
  lineHeight?: string
  letterSpacing?: string
  effects?: string
}

type TokenSnapshot = VariableSnapshot | StyleSnapshot
```

### GlobalConfig 확장
```typescript
interface GlobalConfig {
  // ... existing
  tokenFile: string  // e.g. "src/styles/tokens.css"
}
```

---

## 2. Figma Sandbox (Controller/Mapping)

### New Request Types
```typescript
| { type: "SCAN_STYLES" }
| { type: "SCAN_VARIABLES" }
| { type: "LINK_STYLE"; styleId: string; tokenFile: string }
| { type: "LINK_VARIABLE"; variableId: string; tokenFile: string }
| { type: "UNLINK_STYLE"; styleId: string }
| { type: "UNLINK_VARIABLE"; variableId: string }
| { type: "UPDATE_STYLE_HASH"; styleId: string }
| { type: "UPDATE_VARIABLE_HASH"; variableId: string }
```

### Scan Results
```typescript
interface ScannedStyle {
  id: string
  name: string
  type: 'PAINT' | 'TEXT' | 'EFFECT' | 'GRID'
  linked: boolean
}

interface ScannedVariable {
  id: string
  name: string
  resolvedType: 'COLOR' | 'FLOAT' | 'STRING' | 'BOOLEAN'
  collectionName: string
  linked: boolean
}
```

### Hash Computation
- Variables: 모든 variable을 이름순 정렬 → `{name}:{type}:{values}` 연결 → DJB2
- Styles: 모든 style을 이름순 정렬 → `{name}:{type}:{properties}` 연결 → DJB2
- 추가/삭제/변경 → 해시 변경

### Storage
- `figma.root.setPluginData("figma-sync-all-variables", JSON)` — 단일 엔트리
- `figma.root.setPluginData("figma-sync-all-styles", JSON)` — 단일 엔트리
- Variables/Styles를 개별로 저장할 필요 없음 (카드가 하나이므로)

---

## 3. CSS Token File

### Structure
```css
:root {
  /* === Collection: Primitives === */
  --color-blue-500: #3B82F6;
  --spacing-4: 16px;
  --radius-md: 8px;

  /* === Collection: Semantic === */
  --color-primary: #3B82F6;
  --color-background: #FFFFFF;

  /* === PaintStyles === */
  --paint-brand-primary: #3B82F6;

  /* === TextStyles === */
  --text-heading-h1-size: 32px;
  --text-heading-h1-family: "Inter";
  --text-heading-h1-weight: 700;
  --text-heading-h1-line-height: 1.2;

  /* === EffectStyles === */
  --shadow-card: 0 4px 6px rgba(0, 0, 0, 0.1);
}
```

### Naming Convention
- Variable: Figma name `/` → `-` (e.g. `color/blue-500` → `--color-blue-500`)
- PaintStyle: `--paint-{name}`
- TextStyle: `--text-{name}-size`, `-family`, `-weight`, `-line-height`
- EffectStyle: `--shadow-{name}` or `--blur-{name}`

---

## 4. UI

기존 MainView의 컴포넌트 목록에 카드 2개 추가:

```
[Button]      ● Synced
[Card]        ⚠ Figma Changed
[Variables]   ⚠ Figma Changed     ← 전체 variables 하나
[Styles]      ● Synced             ← 전체 styles 하나
```

- 컴포넌트 카드와 동일한 UX (상태 배지, Push/Pull, Diff)
- Push: CSS 토큰 파일 전체 내용 생성
- Diff: 이전 snapshot vs 현재 비교

---

## 5. Sync Flow

```
Figma Variables/Styles
    ↓ SCAN (전체를 하나로 직렬화 → DJB2 해시)
Plugin Storage (figmaHash, lastSyncedHash)
    ↓ 비교
GitHub token file SHA (codeHash)
    ↓ 판정
SyncState: synced | figma_changed | code_changed | conflict
```

### Push to Code (Figma → Code)
1. 모든 variables + styles 수집
2. CSS 파일 내용 생성 (섹션별 주석 포함)
3. 클립보드에 복사
4. 사용자가 커밋 → GitHub SHA 변경 → codeHash 업데이트

### Pull from Code (Code → Figma)
1. GitHub에서 토큰 파일 SHA 변경 감지
2. "Code Changed" 상태 표시
3. Pull 클릭 → lastSyncedHash 업데이트
