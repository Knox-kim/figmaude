# Figma Sync Plugin — 설계 문서

## 1. 개요

피그마 컴포넌트와 코드 파일을 1:1로 매핑하고, 양방향으로 동기화할 수 있는 피그마 플러그인.

**핵심 원칙:**
- 플러그인은 **중앙 허브** (매핑 + 상태 관리)
- 피그마와 코드는 **동등한 클라이언트** (양방향 push/pull)
- 실제 변환/렌더링은 **Claude Code + Figma MCP**가 처리
- 동기화는 **수동** (사용자가 직접 push/pull 트리거)

---

## 2. 아키텍처

```
[Figma] ←— push/pull —→ [Plugin (허브)] ←— push/pull —→ [Code (GitHub)]
                                ↕
                     [Claude Code + Figma MCP]
                     (변환 + 읽기/쓰기 엔진)
```

### 역할 분담

| 요소 | 역할 |
|------|------|
| Plugin | 매핑 테이블 관리, 상태 추적, 해시 비교, UI 제공 |
| Claude Code | TSX ↔ 피그마 변환, get_design_context, generate_figma_design |
| Figma MCP | 피그마 읽기 (get_design_context) + 쓰기 (generate_figma_design) |
| GitHub API | 코드 파일 읽기/쓰기 (플러그인 UI에서 직접 호출) |
| Figma Plugin API | 노드 메타데이터 읽기, pluginData 저장 |

---

## 3. 데이터 모델

### 3.1 매핑 엔트리 (pluginData per node)

```json
{
  "linkedFile": "src/components/compCard.tsx",
  "pluginVersion": {
    "hash": "a3f2c1...",
    "updatedAt": "2026-02-27T10:00:00Z",
    "source": "figma | code"
  },
  "figmaHash": "abc123",
  "codeHash": "def456",
  "metadata": {
    "interactions": {
      "onClick": "() => void",
      "animation": "scale(1.05) on hover, 150ms ease-in-out"
    },
    "description": "Primary action button"
  }
}
```

### 3.2 글로벌 매핑 테이블 (root node pluginData)

```json
{
  "repoUrl": "https://github.com/user/project",
  "basePath": "src/components",
  "mappings": [
    {
      "figmaNodeId": "1234:5678",
      "componentName": "compCard",
      "codePath": "src/components/compCard.tsx"
    },
    {
      "figmaNodeId": "2345:6789",
      "componentName": "compButton",
      "codePath": "src/components/compButton.tsx"
    }
  ],
  "settings": {
    "framework": "react",
    "styling": "tailwind",
    "githubToken": "encrypted_token_ref"
  }
}
```

### 3.3 해시 생성 방법

**피그마 해시:** 컴포넌트 노드의 주요 속성(레이아웃, 스타일, children 구조, pluginData의 metadata)을 JSON으로 직렬화 → SHA-256

**코드 해시:** GitHub API로 파일의 SHA를 가져오거나, 파일 내용의 SHA-256

---

## 4. 동기화 상태 판단

```
현재 피그마 해시  vs  pluginVersion.hash (source=figma일 때)
현재 코드 해시    vs  pluginVersion.hash (source=code일 때)
```

| 피그마 ≠ plugin | 코드 ≠ plugin | 상태 | UI 표시 |
|:-:|:-:|------|---------|
| ❌ | ❌ | synced | ✅ |
| ✅ | ❌ | figma changed | 🔵 Figma에서 push 가능 |
| ❌ | ✅ | code changed | 🟠 Code에서 push 가능 |
| ✅ | ✅ | conflict | ⚠️ 양쪽 다 변경됨 |

---

## 5. 동작 흐름

### 5.1 초기 매핑 등록

```
1. 피그마에서 컴포넌트 선택
2. 플러그인 UI에서 "Link to Code" 클릭
3. GitHub 레포 연결 (최초 1회)
4. 코드 파일 경로 입력 또는 브라우징
   - 기존 파일 선택: 매핑 생성
   - 새 파일: 빈 매핑 생성 (첫 push 시 파일 생성)
5. pluginData에 매핑 정보 저장
6. 현재 상태로 초기 해시 생성
```

### 5.2 Figma → Plugin Push

```
1. 플러그인에서 컴포넌트 목록 확인
2. "Push from Figma" 클릭
3. Plugin API로 현재 노드 상태 읽기
4. 해시 생성 → pluginVersion 업데이트
   - hash: 새 피그마 해시
   - source: "figma"
   - updatedAt: 현재 시간
5. 상태: "Ready to pull to Code"
```

### 5.3 Plugin → Code Pull (Claude Code 실행)

```
1. 플러그인에서 "Pull to Code" 상태 확인
2. 사용자가 Claude Code 터미널에서 실행:
   "compCard의 피그마 변경사항을 코드에 반영해줘"
3. Claude Code:
   a. Figma MCP get_design_context로 컴포넌트 읽기
   b. GitHub에서 기존 compCard.tsx 가져오기
   c. 변경사항 분석 → 기존 로직 보존하면서 스타일 업데이트
   d. GitHub에 커밋/PR
4. 플러그인에서 codeHash 업데이트 → "synced"
```

### 5.4 Code → Plugin Push

```
1. 플러그인에서 GitHub API로 현재 코드 파일 SHA 확인
2. pluginVersion의 codeHash와 비교
3. 변경 감지 시 "Push from Code" 클릭
4. GitHub API로 변경된 파일 내용 가져오기
5. 해시 생성 → pluginVersion 업데이트
   - hash: 새 코드 해시
   - source: "code"
   - updatedAt: 현재 시간
6. 상태: "Ready to pull to Figma"
```

### 5.5 Plugin → Figma Pull (Claude Code 실행)

```
1. 플러그인에서 "Pull to Figma" 상태 확인
2. 사용자가 Claude Code 터미널에서 실행:
   "compCard의 코드 변경사항을 피그마에 반영해줘"
3. Claude Code:
   a. GitHub에서 compCard.tsx 읽기
   b. generate_figma_design으로 피그마에 반영
4. 플러그인에서 figmaHash 업데이트 → "synced"
```

### 5.6 충돌 처리

```
1. 양쪽 다 변경 감지
2. 플러그인 UI에서 diff 표시
   - Figma 변경: padding 12→16, color 변경
   - Code 변경: onClick 추가, border 변경
3. 사용자 선택:
   a. "Keep Figma" → Figma → Plugin push → Code pull
   b. "Keep Code" → Code → Plugin push → Figma pull
   c. "Merge" → Claude Code에서 양쪽 변경사항 합치기
```

---

## 6. 플러그인 UI 설계

### 6.1 메인 화면

```
┌─────────────────────────────────────────┐
│  🔗 Figma Sync                    ⚙️    │
├─────────────────────────────────────────┤
│  Repository: user/project               │
│  Branch: main                           │
├─────────────────────────────────────────┤
│                                         │
│  📦 compButton        ✅ synced         │
│     src/components/compButton.tsx       │
│                                         │
│  📦 compCard          🔵 figma changed  │
│     src/components/compCard.tsx         │
│     padding: 12→16, borderRadius: 8→12  │
│     [ Push from Figma ]                 │
│                                         │
│  📦 compInput         🟠 code changed   │
│     src/components/compInput.tsx        │
│     + validation prop 추가              │
│     [ Push from Code ]                  │
│                                         │
│  📦 compModal         ⚠️ conflict       │
│     src/components/compModal.tsx        │
│     [ Resolve ]                         │
│                                         │
│  📦 compHeader        ⬜ not linked     │
│     [ Link to Code ]                    │
│                                         │
├─────────────────────────────────────────┤
│  [ + Link Component ]   [ Refresh All ] │
└─────────────────────────────────────────┘
```

### 6.2 매핑 등록 화면

```
┌─────────────────────────────────────────┐
│  🔗 Link Component                      │
├─────────────────────────────────────────┤
│                                         │
│  Figma Component:                       │
│  📦 compCard (1234:5678)                │
│                                         │
│  Code File Path:                        │
│  ┌─────────────────────────────────┐    │
│  │ src/components/compCard.tsx     │    │
│  └─────────────────────────────────┘    │
│  [ Browse Repo ]                        │
│                                         │
│  Metadata (optional):                   │
│  ┌─────────────────────────────────┐    │
│  │ @onClick: () => void            │    │
│  │ @animation: scale(1.05) hover   │    │
│  └─────────────────────────────────┘    │
│                                         │
│  [ Cancel ]              [ Link ]       │
└─────────────────────────────────────────┘
```

### 6.3 충돌 해결 화면

```
┌─────────────────────────────────────────┐
│  ⚠️ Conflict: compModal                 │
├─────────────────────────────────────────┤
│                                         │
│  Figma Changes:                         │
│  • padding: 12 → 16                     │
│  • background: #6366F1 → #8B5CF6       │
│                                         │
│  Code Changes:                          │
│  • + onClose callback prop              │
│  • border: none → 1px solid #E5E7EB    │
│                                         │
│  Last synced: 2026-02-27 10:00          │
│                                         │
│  [ Keep Figma ]  [ Keep Code ]          │
│            [ Merge Both ]               │
│                                         │
└─────────────────────────────────────────┘
```

### 6.4 설정 화면

```
┌─────────────────────────────────────────┐
│  ⚙️ Settings                            │
├─────────────────────────────────────────┤
│                                         │
│  GitHub Repository:                     │
│  ┌─────────────────────────────────┐    │
│  │ https://github.com/user/project │    │
│  └─────────────────────────────────┘    │
│                                         │
│  Branch:                                │
│  ┌─────────────────────────────────┐    │
│  │ main                            │    │
│  └─────────────────────────────────┘    │
│                                         │
│  Base Path:                             │
│  ┌─────────────────────────────────┐    │
│  │ src/components                  │    │
│  └─────────────────────────────────┘    │
│                                         │
│  Framework:  [React ▾]                  │
│  Styling:    [Tailwind ▾]              │
│                                         │
│  GitHub Token:                          │
│  ┌─────────────────────────────────┐    │
│  │ ghp_xxxx...                     │    │
│  └─────────────────────────────────┘    │
│                                         │
│  [ Save ]                               │
└─────────────────────────────────────────┘
```

---

## 7. 기술 스택

| 영역 | 기술 |
|------|------|
| Plugin Sandbox | TypeScript, Figma Plugin API |
| Plugin UI | React (iframe), Tailwind CSS |
| 매핑 저장 | `node.setPluginData()` (노드별), `figma.root.setPluginData()` (글로벌) |
| GitHub 연동 | GitHub REST API v3 (UI iframe에서 fetch) |
| 해시 생성 | Web Crypto API (SHA-256) |
| 변환 엔진 | Claude Code + Figma MCP (외부) |
| 인증 | GitHub Personal Access Token (플러그인 설정에서 입력) |

---

## 8. 파일 구조

```
figma-sync-plugin/
├── manifest.json
├── package.json
├── tsconfig.json
├── src/
│   ├── plugin/
│   │   ├── controller.ts        # Plugin sandbox 메인 로직
│   │   ├── mapping.ts           # 매핑 CRUD
│   │   ├── hash.ts              # 해시 생성/비교
│   │   ├── sync.ts              # 동기화 상태 판단
│   │   └── figma-reader.ts      # 피그마 노드 읽기 유틸
│   ├── ui/
│   │   ├── App.tsx              # UI 메인
│   │   ├── pages/
│   │   │   ├── MainView.tsx     # 컴포넌트 목록 + 상태
│   │   │   ├── LinkView.tsx     # 매핑 등록
│   │   │   ├── ConflictView.tsx # 충돌 해결
│   │   │   └── SettingsView.tsx # 설정
│   │   ├── components/
│   │   │   ├── ComponentCard.tsx
│   │   │   ├── DiffViewer.tsx
│   │   │   ├── StatusBadge.tsx
│   │   │   └── RepoExplorer.tsx
│   │   ├── hooks/
│   │   │   ├── useGitHub.ts     # GitHub API 호출
│   │   │   ├── useMapping.ts    # 매핑 관리
│   │   │   └── useSync.ts       # 동기화 로직
│   │   └── lib/
│   │       ├── github.ts        # GitHub API 클라이언트
│   │       ├── hash.ts          # 브라우저용 해시
│   │       └── types.ts         # 공통 타입 정의
│   └── shared/
│       └── types.ts             # Plugin ↔ UI 메시지 타입
├── claude-code/
│   ├── INSTRUCTIONS.md          # Claude Code용 프롬프트 가이드
│   └── examples/
│       ├── push-to-code.md      # Figma→Code 프롬프트 예시
│       └── pull-to-figma.md     # Code→Figma 프롬프트 예시
└── README.md
```

---

## 9. Claude Code 연동 가이드

플러그인이 매핑과 상태를 관리하고, 실제 변환은 Claude Code가 처리하므로 사용자가 Claude Code에서 사용할 프롬프트 가이드가 필요합니다.

### Push to Code (피그마 → 코드)

```
Figma MCP로 compCard 컴포넌트의 design context를 가져와서
GitHub의 src/components/compCard.tsx에 반영해줘.

기존 코드의 비즈니스 로직(이벤트 핸들러, API 호출, 상태 관리)은
그대로 보존하고, 피그마에서 변경된 스타일/레이아웃만 업데이트해줘.

피그마 컴포넌트의 description/@태그 메타데이터도 확인해서
인터랙션 정보가 있으면 반영해줘.
```

### Pull to Figma (코드 → 피그마)

```
GitHub의 src/components/compCard.tsx를 읽어서
피그마에 compCard 컴포넌트로 반영해줘.

generate_figma_design을 사용해서
코드의 레이아웃, 스타일, 컴포넌트 구조를 피그마 레이어로 변환해줘.

기존 피그마 컴포넌트의 nodeId는 1234:5678이야.
```

### Merge Both (충돌 해결)

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

---

## 10. 향후 확장

- **Auto-link**: 컴포넌트 이름 기반으로 자동 매핑 제안
- **Batch sync**: 여러 컴포넌트 한번에 push/pull
- **History**: 동기화 이력 조회
- **Webhook 연동**: GitHub push 시 플러그인에 알림 (서버 필요)
- **Design token 동기화**: Variables/Styles도 매핑 대상에 포함
- **Claude API 직접 호출**: Claude Code 없이 플러그인 내부에서 변환 처리