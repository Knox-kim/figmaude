# Figma Sync Plugin — MVP Phase 1 Design

## 1. Overview

Figma 컴포넌트와 코드 파일을 1:1로 매핑하고, 해시 기반으로 변경 상태를 추적하는 Figma 플러그인.

**MVP 스코프**: 매핑 등록 + 상태 표시. 실제 코드 변환(push/pull)은 Claude Code에서 수동 처리.

### 핵심 결정 사항

| 항목 | 결정 |
|------|------|
| 아키텍처 | Sandbox 중심 (Sandbox = 데이터/로직, UI = 프레젠테이션) |
| UI 빌드 | Vite + vite-plugin-singlefile |
| Sandbox 빌드 | esbuild |
| UI 스타일링 | Tailwind CSS |
| 토큰 저장 | figma.clientStorage (로컬 기기 전용) |
| MVP 제외 | 충돌 해결 UI, DiffViewer, RepoExplorer, 실제 push/pull 실행, metadata/interactions |

---

## 2. Architecture

```
Sandbox (controller.ts)                    UI iframe (React + Tailwind)
┌────────────────────────┐                ┌─────────────────────────────┐
│ Figma Plugin API       │  postMessage   │ React 렌더링                │
│ - 노드 읽기            │ ◄───────────► │ - 컴포넌트 목록/상태        │
│ - pluginData CRUD      │                │ - 매핑 등록 폼              │
│ - 해시 생성            │                │ - 설정 화면                 │
│ - 선택 감지            │                │                             │
└────────────────────────┘                │ GitHub REST API (fetch)     │
                                          │ - 파일 SHA 조회             │
                                          │ - 레포/브랜치 정보          │
                                          │                             │
                                          │ clientStorage               │
                                          │ - GitHub 토큰 (로컬 전용)   │
                                          └─────────────────────────────┘
```

---

## 3. Project Structure

```
figma-sync-plugin/
├── manifest.json
├── package.json
├── tsconfig.json
├── tsconfig.sandbox.json        # Sandbox용 (no DOM)
├── vite.config.ts               # UI 빌드
├── esbuild.sandbox.mjs          # Sandbox 빌드 (별도)
├── src/
│   ├── shared/
│   │   ├── messages.ts          # 타입 안전한 메시지 정의
│   │   └── types.ts             # Mapping, SyncStatus 등 공통 타입
│   ├── sandbox/
│   │   ├── controller.ts        # 메인 진입점
│   │   ├── mapping.ts           # pluginData CRUD
│   │   ├── hash.ts              # 노드 → 해시
│   │   └── messenger.ts         # postMessage 핸들러 (Sandbox쪽)
│   └── ui/
│       ├── index.html
│       ├── main.tsx
│       ├── App.tsx
│       ├── lib/
│       │   ├── messenger.ts     # postMessage 핸들러 (UI쪽)
│       │   ├── github.ts        # GitHub REST API 클라이언트
│       │   └── storage.ts       # clientStorage 래퍼
│       ├── pages/
│       │   ├── MainView.tsx     # 컴포넌트 목록 + 상태
│       │   ├── LinkView.tsx     # 매핑 등록
│       │   └── SettingsView.tsx # GitHub 연결 설정
│       └── components/
│           ├── ComponentCard.tsx
│           └── StatusBadge.tsx
```

---

## 4. Message System

타입 안전한 요청-응답 패턴으로 Sandbox ↔ UI 통신.

### Sandbox → UI (일방향 이벤트)

```typescript
type PluginEvent =
  | { type: 'MAPPINGS_LOADED'; mappings: MappingEntry[] }
  | { type: 'STATUS_UPDATED'; statuses: SyncStatus[] }
  | { type: 'SELECTION_CHANGED'; nodeId: string | null; nodeName: string | null }
  | { type: 'ERROR'; message: string }
```

### UI → Sandbox (요청-응답)

```typescript
type PluginRequest =
  | { type: 'GET_MAPPINGS' }
  | { type: 'LINK_COMPONENT'; nodeId: string; codePath: string; componentName: string }
  | { type: 'UNLINK_COMPONENT'; nodeId: string }
  | { type: 'UPDATE_FIGMA_HASH'; nodeId: string }
  | { type: 'GET_SELECTED_NODE' }

type ResponseMap = {
  GET_MAPPINGS: { mappings: MappingEntry[] }
  LINK_COMPONENT: { success: boolean }
  UNLINK_COMPONENT: { success: boolean }
  UPDATE_FIGMA_HASH: { hash: string }
  GET_SELECTED_NODE: { nodeId: string | null; nodeName: string | null }
}
```

### 사용 패턴

```typescript
// UI에서 Sandbox로 요청
const { mappings } = await requestToPlugin('GET_MAPPINGS');

// Sandbox에서 UI로 이벤트 푸시
emitToUI({ type: 'SELECTION_CHANGED', nodeId: '1234:5678', nodeName: 'compCard' });
```

내부적으로 requestId를 생성하고 Promise로 응답을 매칭.

---

## 5. Data Model

### 개별 노드 pluginData (MappingEntry)

```typescript
interface MappingEntry {
  linkedFile: string;              // "src/components/compCard.tsx"
  componentName: string;           // "compCard"
  figmaHash: string;               // 현재 피그마 상태 해시
  codeHash: string;                // GitHub 파일 SHA
  lastSyncedHash: string;          // 마지막 동기화 시점의 해시
  lastSyncedAt: string;            // ISO timestamp
  lastSyncSource: 'figma' | 'code';
}
```

### Root pluginData (GlobalConfig)

```typescript
interface GlobalConfig {
  repoOwner: string;               // "user"
  repoName: string;                // "project"
  branch: string;                  // "main"
  basePath: string;                // "src/components"
  framework: 'react' | 'vue';
  styling: 'tailwind' | 'css-modules';
}
```

### 런타임 동기화 상태

```typescript
type SyncState = 'synced' | 'figma_changed' | 'code_changed' | 'conflict' | 'not_linked';

interface SyncStatus {
  nodeId: string;
  componentName: string;
  codePath: string;
  state: SyncState;
  figmaHash: string;
  codeHash: string;
}
```

### GitHub 토큰

`figma.clientStorage`에 별도 저장 (pluginData에 포함하지 않음).

---

## 6. Hash Strategy

### Figma 해시

노드의 시각적 속성을 재귀적으로 추출 → JSON 직렬화 → 해시.

```typescript
function extractVisualProperties(node: SceneNode) {
  return {
    width: node.width,
    height: node.height,
    padding: [paddingTop, paddingRight, paddingBottom, paddingLeft],
    fills: node.fills,
    strokes: node.strokes,
    cornerRadius: node.cornerRadius,
    layoutMode: node.layoutMode,
    itemSpacing: node.itemSpacing,
    children: node.children?.map(extractVisualProperties) ?? []
  };
}
```

Sandbox에는 Web Crypto API가 없으므로 간단한 해시 함수(djb2 등) 사용 또는 JSON 문자열 자체를 비교용 키로 활용.

### 코드 해시

GitHub REST API의 파일 SHA를 그대로 사용:

```
GET /repos/{owner}/{repo}/contents/{path}?ref={branch}
→ response.sha
```

### 동기화 판단

| figmaHash ≠ lastSynced | codeHash ≠ lastSynced | 상태 |
|:-:|:-:|------|
| No | No | `synced` |
| Yes | No | `figma_changed` |
| No | Yes | `code_changed` |
| Yes | Yes | `conflict` |

---

## 7. Sandbox Logic (controller.ts)

```typescript
figma.showUI(__html__, { width: 400, height: 600 });

// 선택 변경 감지
figma.on('selectionchange', () => {
  const node = figma.currentPage.selection[0];
  emitToUI({
    type: 'SELECTION_CHANGED',
    nodeId: node?.id ?? null,
    nodeName: node?.name ?? null
  });
});

// 요청 핸들링
onRequestFromUI('GET_MAPPINGS', async () => {
  // root pluginData에서 매핑 목록 읽기
  // 각 노드의 pluginData에서 상세 정보
  // figmaHash 재계산해서 반환
});

onRequestFromUI('LINK_COMPONENT', async ({ nodeId, codePath, componentName }) => {
  // 노드 찾기 → figmaHash 생성 → pluginData 저장 → 글로벌 목록에 추가
});

onRequestFromUI('UPDATE_FIGMA_HASH', async ({ nodeId }) => {
  // 현재 노드 상태로 해시 재생성 → pluginData 업데이트
});
```

---

## 8. UI Flow

```
App.tsx
├── SettingsView  (GitHub 미연결 시)
│   └── 레포 URL, 브랜치, 토큰 입력 → clientStorage 저장
│
├── MainView  (메인 화면)
│   ├── 컴포넌트 목록 렌더링
│   │   └── ComponentCard × N
│   │       ├── StatusBadge (synced / figma_changed / code_changed / conflict)
│   │       └── 액션 버튼 (상태에 따라)
│   ├── [+ Link Component] → LinkView
│   └── [Refresh All] → 전체 상태 재확인
│
└── LinkView  (매핑 등록)
    ├── 선택된 Figma 컴포넌트 표시
    ├── 코드 파일 경로 입력 (수동)
    └── [Link] → Sandbox에 LINK_COMPONENT 요청
```

### Refresh 플로우

1. Sandbox에 `GET_MAPPINGS` → 매핑 목록 + 현재 figmaHash
2. 각 매핑에 대해 GitHub API로 파일 SHA 조회 (UI에서 병렬 fetch)
3. figmaHash vs lastSyncedHash, codeHash vs lastSyncedHash 비교
4. SyncState 결정 → UI 렌더링

---

## 9. manifest.json

```json
{
  "name": "Figma Sync",
  "id": "figma-sync-plugin",
  "api": "1.0.0",
  "main": "dist/sandbox.js",
  "ui": "dist/ui.html",
  "editorType": ["figma"],
  "documentAccess": "dynamic-page",
  "networkAccess": {
    "allowedDomains": ["https://api.github.com"]
  }
}
```

---

## 10. Build Pipeline

```json
{
  "dev": "concurrently \"npm:dev:sandbox\" \"npm:dev:ui\"",
  "dev:sandbox": "esbuild src/sandbox/controller.ts --bundle --outfile=dist/sandbox.js --watch",
  "dev:ui": "vite build --watch",
  "build": "npm run build:sandbox && npm run build:ui",
  "build:sandbox": "esbuild src/sandbox/controller.ts --bundle --outfile=dist/sandbox.js --minify",
  "build:ui": "vite build"
}
```

Sandbox: esbuild로 단순 번들링 (DOM 타입 없음)
UI: Vite + vite-plugin-singlefile → 단일 HTML 파일 (inline JS/CSS)

---

## 11. MVP 제외 항목 (Phase 2+)

- ConflictView (충돌 해결 UI)
- DiffViewer (변경사항 시각화)
- RepoExplorer (GitHub 파일 브라우징)
- Push/Pull 실행 (실제 코드 변환)
- metadata/interactions 필드
- Batch sync (여러 컴포넌트 동시 처리)
- Auto-link (이름 기반 자동 매핑 제안)
- claude-code/ 프롬프트 가이드
