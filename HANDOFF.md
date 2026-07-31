# 인수인계 문서 — 낚시터 (fishing-pond)

이 문서는 **아무 사전 지식이 없는 새 Claude Code 에이전트**가, 이 문서와 `fishing-pond/` 저장소 파일만 보고 이전 작업을 그대로 이어받을 수 있도록 쓴 것이다. 문서 뒷부분에는 **사람(프로젝트 소유자)을 위한 실행법·수동 큐레이션 매뉴얼**이 별도로 붙어 있다.

---

## 0. 이 프로젝트가 무엇인가

"낚시터"는 창작자(주로 글쓰기)를 위한 웹 도구다. 핵심 아이디어: 완벽한 첫 문장을 써야 한다는 강박 때문에 백지 앞에서 막히는 사람들에게, **우연히 떠다니는 아이디어 조각(문장·명화)을 낚아서 캔버스 위에 느슨하게 배치·연결**하게 함으로써 착수를 돕는다.

- 화면 왼쪽: **캔버스** — 낚아온 조각을 자유 배치, 실타래(연결선)·주머니(묶음)·연필(메모)·카드(직접 쓴 조각)로 편집
- 화면 오른쪽: **수면** — 문장/명화 조각 10~14개가 항상 천천히 흘러다님. 클릭하면 가라앉고 관련 조각 4개가 떠오름. 드래그해서 캔버스로 옮기면 "낚기" 성공
- **완전 정적 배포, 백엔드 없음.** 모든 조각·연관관계는 빌드타임에 미리 계산되어 정적 JSON으로 서빙됨
- 반드시 참고할 두 문서(저장소 밖, 대화 맥락에만 있었을 수 있음 — 없다면 아래 요약이 곧 스펙이다):
  - `창작자를 위한 낚시터 PRD.md` — 제품 요구사항
  - `낚시터_단계별_개발_프롬프트.md` — Phase 0~7 단계별 개발 프롬프트

**중요**: 이 두 문서가 저장소에 없을 수 있다(원래 `fishing-pond/` 상위 폴더에 있었음). 없다면 이 HANDOFF.md의 내용을 그대로 스펙으로 취급하고 사용자에게 물어봐도 된다.

---

## 1. 지금까지 진행 상황 (Phase별)

확정된 기술 스택: Vite + React 18 + TypeScript, Zustand 단일 스토어, CSS Modules, DOM+rAF 애니메이션, 빌드타임 임베딩, html-to-image PNG 내보내기. 전부 이미 적용되어 있다.

| Phase | 내용 | 상태 |
|---|---|---|
| 0 | 스캐폴딩, 도메인 타입, Zustand 스토어 골격, 좌우 분할 레이아웃 | ✅ 완료 |
| 1 | 콘텐츠 파이프라인(sentences/paintings → 임베딩 → pool.json) | ✅ 완료 |
| 2 | 수면: 부유·순환·충돌·튕김 물리 | ✅ 완료 |
| 3 | 인터랙션: 클릭(가라앉기+부상), 드래그(낚기) | ✅ 완료 |
| 4 | 캔버스 편집: 실타래·주머니·연필·카드, undo, 선택 | ✅ 완료 |
| 5 | 내 이야기 던지기 (txt 업로드 → 개인 조각화) | ❌ **미착수** — 사용자가 토큰 비용 이유로 보류 요청. 진행하려면 사용자에게 먼저 확인할 것 |
| 6 | 내보내기 (PNG만 — 마크다운 내보내기는 사용자 요청으로 제거함) | ✅ 완료 (PNG만) |
| 7 | 첫인상·마감(온보딩 연출, 접근성, 성능 최적화) | ❌ **미착수** |

**실제 명화 이미지**: Phase 1에서는 placeholder였으나, 이후 Wikimedia Commons에서 12점 전부 실제 이미지(사용자 승인 받아 다운로드)로 교체 완료. `public/images/paintings/*.jpg`에 저장되어 있고 `content/paintings.yaml`이 이를 가리킨다. **2026-07-31에 공개 API에서 100점을 무작위 보충해 현재 명화 112점 · 문장 45개 · 총 조각 157개**(아래 "명화 조각 보충" 참고).

**단위 테스트**: Vitest로 74개 작성됨 (geometry.ts 17개, store.ts 49개, build-pool.ts 8개). `npm test`로 실행. 자세한 내용은 저장소 루트의 `테스트결과.md` 참고.

### Phase 4 이후 추가된 것 (2026-07-31)

| 기능 | 내용 | 관련 파일 |
|---|---|---|
| 메모 글자 크기 | 연필 아이콘을 누르면 툴바에 **제목·소제목·본문** 선택기가 나오고, 고른 크기로 메모를 쓴다. 쓰는 중에 크기를 바꿔도 즉시 반영된다. | `memoStyles.ts`, `Toolbar.tsx`, `MemoItem.tsx`, `store.ts`(`memoTextStyle`, `updateMemoTextStyle`) |
| 글꼴 통일 | 앱 전체를 Noto Sans(KR)로 통일. `index.css` `:root`에서만 지정하고 나머지 개별 `font-family`는 제거. **단 `textarea`는 부모 글꼴을 자동 상속하지 않으므로 `font-family: inherit`을 반드시 명시해야 한다** (안 하면 한글 Windows에서 굴림으로 되돌아간다). | `index.html`, `src/index.css`, 각 `*.module.css` |
| 이미지 크게 보기 | 캔버스 위 **이미지 조각을 더블클릭하면 화면 전체를 덮는 창에 크게 열린다.** 배경 클릭·Escape·닫기 버튼으로 닫는다. 문장 조각은 열리지 않는다. `data-export-hide`가 붙어 PNG 내보내기에는 찍히지 않는다. `position: fixed`로 뷰포트를 덮으므로 **`.pane`에 `transform`을 추가하면 이 창이 pane 안에 갇힌다 — 주의.** | `ImageZoom.tsx`, `store.ts`(`zoomedFragmentId`, `openImageZoom`, `closeImageZoom`) |
| 카드 도구 (`▤`) | 수면 위 조각과 **같은 모양의 아이디어 카드를 캔버스에서 직접 만든다.** 아이콘 누르고 빈 곳을 클릭 → 입력창이 열리고, Ctrl+Enter/Escape로 확정. 빈 채로 확정하면 조각과 노드가 함께 정리된다. 직접 쓴 카드는 더블클릭으로 다시 고칠 수 있고, 낚아 온 조각은 원문 보호를 위해 고칠 수 없다. | `CardNodeText.tsx`, `CanvasLayer.tsx`, `store.ts`(`createIdeaCard`, `addPersonalFragment`, `updateFragmentText`, `removePersonalFragment`) |

**카드 도구의 설계 원칙 (이어서 작업할 때 지킬 것)**: 카드를 위한 새 타입을 만들지 않았다. 카드 = `origin: 'personal'` **조각 + 그 조각을 담은 노드** 한 쌍이다. 그래서 실타래·주머니·박스 선택·드래그·Delete·되돌리기·PNG 내보내기가 낚아 온 조각과 **완전히 같은 코드 경로**를 탄다. Phase 5(txt 업로드 → 개인 조각화)도 같은 `addPersonalFragment` 경로를 재사용하면 된다.

**알려진 문제 (미해결)**: 글꼴을 Google Fonts CDN에서 불러오기 때문에, PNG 내보내기 시 `html-to-image`가 교차 출처 스타일시트를 읽지 못해 `SecurityError`를 콘솔에 남기고 **내보낸 이미지의 글꼴이 화면과 달라진다.** 또 PRD의 "네트워크 없이도 동작" 기준이 글꼴에 대해 깨진다. 해결책은 Noto Sans woff2를 `public/fonts/`에 담아 같은 출처로 서빙하는 것(저장소에 1~3MB 추가). 사용자 판단 대기 중.

**배포**: GitHub(`https://github.com/zaban2204/-.git`) → Vercel 연동, `main` push 시 자동 배포 중. DB 없음, 서버 없음.

---

## 2. 저장소 구조 (실제 파일 전부)

```
fishing-pond/
├── content/                       # 사람이 직접 편집하는 콘텐츠 원본 (빌드 입력)
│   ├── sentences.yaml             # 문장 조각 (현재 사용자가 직접 명대사로 교체 중)
│   ├── paintings.yaml             # 명화 조각 메타데이터 (실제 이미지 파일명 가리킴)
│   └── curation.yaml              # 수동 큐레이션 오버라이드 (자동 추천 이웃을 덮어씀)
├── scripts/
│   ├── build-pool.ts              # 빌드타임 파이프라인 본체 (핵심 파일)
│   ├── build-pool.test.ts         # 위 스크립트의 순수 함수 단위 테스트
│   └── out/curation-review.md     # build:pool 실행 시 자동 생성되는 큐레이션 참고표
├── public/
│   ├── pool.json                  # build:pool의 출력물. 런타임이 fetch해서 씀
│   ├── base-vectors.bin           # 기본 풀 임베딩 벡터 (Float32Array 평탄화)
│   └── images/paintings/*.jpg     # 실제 명화 이미지 12개 (Wikimedia Commons, PD)
├── src/
│   ├── types.ts                   # 도메인 타입 전체 (Fragment, CanvasNode, Thread, Pouch, Memo 등)
│   ├── store.ts                   # Zustand 단일 스토어 (poolSlice+surfaceSlice+canvasSlice)
│   ├── store.test.ts
│   ├── App.tsx / App.module.css   # 최상위 레이아웃 (좌우 분할)
│   ├── main.tsx, index.css
│   ├── useIsDesktop.ts            # 1024px 미만이면 안내 문구만 표시
│   ├── usePoolLoader.ts           # pool.json fetch → store.loadPool
│   ├── surface/
│   │   ├── SurfaceLayer.tsx       # 수면 rAF 물리 루프 + 드래그(낚기) — 가장 복잡한 파일
│   │   ├── SurfaceCard.tsx        # 개별 포스트잇 카드 (memo)
│   │   └── surface.module.css
│   └── canvas/
│       ├── CanvasLayer.tsx        # 캔버스 편집 전체 (선택/실타래/주머니/메모/카드/내보내기)
│       ├── Toolbar.tsx            # 도구 5개 버튼 + 연필 크기 선택기
│       ├── MemoItem.tsx           # 연필 메모 컴포넌트
│       ├── memoStyles.ts          # 메모 크기 3단계 프리셋 (제목/소제목/본문) — 단일 출처
│       ├── CardNodeText.tsx       # 카드 도구로 만든 조각의 본문 표시·편집
│       ├── useDeferredFocus.ts    # 새로 띄운 입력창에 안전하게 포커스 주는 훅 (메모·카드 공용)
│       ├── geometry.ts            # convex hull, Catmull-Rom 스무딩 등 순수 기하 함수
│       ├── geometry.test.ts
│       ├── export.ts              # PNG 내보내기 (html-to-image)
│       └── canvas.module.css
├── 테스트결과.md                   # 단위+UI 테스트 결과 종합 문서
├── vitest.config.ts, package.json, tsconfig*.json, vite.config.ts
```

---

## 3. 핵심 개념과 데이터 흐름

### 3-1. Fragment (조각)
`src/types.ts`의 `Fragment`가 모든 아이디어 조각의 최종 형태다:
```ts
interface Fragment {
  id: string;
  kind: 'sentence' | 'image';
  text?: string;          // kind==='sentence'
  imageUrl?: string;      // kind==='image'
  caption?: string;       // 이미지의 한국어 서술 캡션 (임베딩 대상 텍스트)
  origin: 'base' | 'personal';   // 'personal'은 Phase5용, 아직 안 씀
  neighborIds: string[];  // 관련 조각 id 목록 (부상 로직이 이걸 씀)
  title?: string; artist?: string; sourceUrl?: string; license?: string; // 이미지 출처 표기용
}
```

### 3-2. 빌드타임 파이프라인 (`scripts/build-pool.ts`)
1. `content/sentences.yaml` + `content/paintings.yaml` 읽어서 Fragment 배열로 정규화
2. `@xenova/transformers`(Xenova/paraphrase-multilingual-MiniLM-L12-v2)로 각 Fragment 임베딩. **실패 시(오프라인 등) 문자 3-gram 해시 코사인 유사도로 조용히 폴백** — `hashToBucket`/`embedWithNgramFallback`/`cosineSimilarity`/`topNeighborIds` 함수, 전부 `export`되어 있어 단위 테스트 대상
3. 코사인 유사도 상위 8개를 자동 `neighborIds` 후보로 계산
4. `content/curation.yaml`에 등재된 fragmentId는 자동 추천을 **완전히 덮어씀**
5. 출력: `public/pool.json`(임베딩 벡터 제외), `public/base-vectors.bin`(Float32Array 평탄화, 개인조각 유사도 비교용), `scripts/out/curation-review.md`(사람이 자동 추천을 훑어보고 curation.yaml에 옮겨 적기 위한 표)
6. **중요**: `main()`은 `import.meta.url`이 직접 실행된 진입점과 같을 때만 실행된다(파일 하단 가드). 이 스크립트를 테스트에서 import만 해도 실제 파일 쓰기가 실행되는 버그를 고친 것 — 이 가드를 절대 제거하지 말 것.
7. 실행: `npm run build:pool`

### 3-3. 런타임 스토어 (`src/store.ts`)
Zustand 스토어 하나에 3개 슬라이스:
- **poolSlice**: `fragments: Map<id, Fragment>`, `exhaustedIds: Set<id>` (캔버스에 올라간 조각은 소진되어 재부상 안 함)
- **surfaceSlice**: `surfaceFragments: SurfaceFragment[]`(수면 위 인스턴스, `touched` 플래그), `isPaused`
- **canvasSlice**: `nodes/threads/pouches/memos`, 선택 상태 4종, 진행중 조작(pendingThreadFromNodeId/pendingPouchNodeIds), **undoStack(깊이 30, 캔버스 편집에만 적용, 수면 흐름엔 적용 안 됨)**

개발 모드에서 `window.__store`로 스토어 전체가 노출된다(`exposeStoreForDev`, store.ts 최하단). **이게 이 프로젝트를 테스트하는 핵심 도구다** — 아래 6번 항목 참고.

### 3-4. 수면 물리 (`SurfaceLayer.tsx`, 가장 까다로운 파일)
- 위치는 **React state가 아니라 물리 엔진 ref(`physicsRef`)가 직접 DOM에 `el.style.transform`을 써서** 갱신한다. React 리렌더는 구조 변화(추가/제거)에만 관여
- `stepSimulation(dt, paused)` 함수가 매 rAF 프레임 호출됨. 개발 모드에서 `window.__surfaceStep(dtMs, 횟수)`로 직접 여러 프레임을 진행시킬 수 있다(테스트용)
- 드래그 중인 카드(`entry.dragging`)는 **rAF 루프의 모든 패스에서 반드시 제외**해야 한다 — 과거 여기서 실제 버그가 2번 났었다(아래 5번 "이미 겪은 버그" 참고)
- 초기 13개는 "이미 한참 흐르고 있던 강물"처럼 배치(각기 다른 나이로 계산해 위치·수명 결정) — 격자 배치나 전부 동시 스폰은 절대 하지 말 것 (겹침·부자연스러운 뭉텅이 등장 버그로 이어졌었다)

### 3-5. 캔버스 편집 (`CanvasLayer.tsx`)
- 4개 도구: select(기본)/thread/pouch/pencil. `activeTool`은 store에 있고, **핸들러는 항상 `useAppStore.getState().activeTool`로 최신값을 직접 읽는다** (렌더 클로저에 담긴 값을 쓰면 안 됨 — 과거 실타래 연결이 한 박자 늦게 반응하는 버그의 원인이었음)
- 캔버스 pane 자체에 `onPointerDown={handlePanePointerDown}`이 있어서, **select 도구일 때 pointerdown이 오면 박스 선택을 시작하며 포인터를 스스로 캡처한다.** 이 때문에 pane의 자식 요소(툴바, 주머니 라벨 등)는 반드시 자기 `onPointerDown`에서 `event.stopPropagation()`을 호출해야 한다 — 안 하면 그 요소의 클릭이 실제 마우스로는 씹힌다(합성 이벤트 테스트로는 안 잡힘, 아래 버그 이력 참고)

---

## 4. 실행·테스트 명령어

```bash
cd fishing-pond
npm install              # 최초 1회
npm run dev               # 개발 서버 (기본 5173, 점유시 자동으로 다음 포트)
npm run build              # tsc 타입체크 + vite 빌드 (dist/ 생성)
npm run build:pool         # content/*.yaml → public/pool.json 재생성
npm test                   # vitest 58개 단위 테스트
npm run lint                # oxlint
```

브라우저 최소 폭 1024px 필요(그 미만은 안내 문구만 뜸, `useIsDesktop.ts`).

---

## 5. 이미 겪은 버그와 교훈 (반드시 읽을 것)

같은 실수를 반복하지 않도록, 실제로 발생했고 고쳐진 버그들을 원인과 함께 남긴다.

1. **수면 개수가 소프트 상한(14)으로 수렴 못 하고 16에 갇힘** — 상한 초과로 배출한 조각을 "수명 만료"와 같은 경로로 처리해서 랜덤 조각으로 재교체해버렸음. `evicted` 플래그로 분리해서 해결.
2. **반대로 10까지 과도하게 줄어듦** — 배출 판정을 "현재 개수"로 했더니, 페이드 중(900ms)인 조각도 아직 배열에 남아있어 매 프레임 "아직 초과"로 오판해 계속 추가 배출함. "떠나는 중인 조각을 뺀 예상 최종 개수"로 판단하도록 수정.
3. **조각이 화면 위아래로 완전히 벗어남** — 충돌로 세로로 밀리는데 경계 제한이 없었음. 제한을 걸었더니 이번엔 경계에 막힌 조각이 분리를 못해 겹침이 급증 → 세로로 못 밀 때는 가로로 분리하도록 수정.
4. **드래그 중 카드가 마우스보다 한참 왼쪽에 나타남** — `handlePointerMove`가 `entry.x`를 "패널 기준 상대좌표"로 저장하는데, 드래그 중엔 `position:fixed`라 화면엔 뷰포트 절대좌표가 필요함. 그런데 rAF 루프가 매 프레임 드래그 중인 카드까지 포함해서 그 상대좌표를 절대좌표인 것처럼 다시 그려버려, 패널 오프셋(~640px)만큼 계속 왼쪽으로 튕겨나갔음. **rAF 루프는 드래그 중인 엔트리를 절대 건드리면 안 된다** — 화면 갱신은 오직 pointermove 핸들러가 전담.
5. **툴바 아이콘을 실제 마우스로 클릭해도 반응 없음 (프로그램적 클릭으론 재현 안 됨)** — 캔버스 pane의 pointerdown 핸들러가 select 도구일 때 박스 선택을 시작하며 `setPointerCapture`로 포인터를 스스로 가져감. 툴바가 `stopPropagation`을 안 해서 이벤트가 pane까지 버블링되고, 캡처 때문에 뒤이은 mouseup/click이 버튼이 아니라 pane으로 재지정되어 버튼의 onClick이 아예 발생 안 함. **`dispatchEvent`로 만든 합성 이벤트(isTrusted:false)는 이 캡처 재지정을 그대로 재현하지 않아서, 실제 마우스로만 재현되던 버그였다.** 툴바·주머니 라벨 등 pane의 자식 UI는 전부 `onPointerDown`에서 `stopPropagation` 필수.
6. **연필 메모: 아이콘 클릭은 되는데 빈 캔버스 클릭해도 메모가 안 생김** — 실제 클릭은 `pointerdown→mousedown→pointerup→click` 순서. pointerdown에서 메모를 만들고 입력창에 즉시 focus()했는데, 곧이어 오는 진짜 mousedown의 기본 동작이 클릭 지점(포커스 불가한 배경)으로 포커스를 옮기며 입력창을 blur시켰고, blur 핸들러가 "빈 메모는 삭제"를 실행해 생기자마자 사라졌음. **합성 이벤트는 포커스 이동 같은 브라우저 기본 동작을 수행하지 않아서 테스트로는 절대 안 잡힌다.** `event.preventDefault()`로 뒤따르는 mousedown 자체를 막아서 해결(+ `requestAnimationFrame`으로 한 프레임 늦게 focus 잡는 이중 방어).
7. **`build-pool.ts`를 테스트에서 import만 해도 실제 파일 쓰기 실행됨** — 파일 최하단에 `main().catch(...)`가 무조건 실행되고 있었음. `import.meta.url === pathToFileURL(process.argv[1]).href`로 "직접 실행됐을 때만" 가드 추가.
8. **`store.ts`가 Node 테스트 환경에서 크래시** — 모듈 로드시 무조건 `window.__store = ...`를 실행해서 `window`가 없는 환경(Vitest 기본 node environment)에서 `ReferenceError`. `typeof window !== 'undefined'` 가드 추가.

**공통 교훈**: 이 프로젝트에서 발생한 버그 대부분은 **"프로그램적으로 합성한 이벤트(dispatchEvent)로는 재현되지 않고 실제 마우스/키보드에서만 나타나는 것들**이었다. `isTrusted:false` 이벤트는 브라우저의 암묵적 기본 동작(포커스 이동, 클릭 이벤트 합성 자체, 텍스트 선택 등)을 수행하지 않는다. 실제 사용자가 "안 된다"고 보고하면, 합성 이벤트 테스트가 통과하더라도 절대 안심하지 말고 이 가능성부터 의심할 것.

---

## 6. 검증 방법 (이 환경에서 실제로 통했던 방식)

이 프로젝트가 개발된 환경(코딩 에이전트의 내장 브라우저 도구)은 **탭이 항상 백그라운드로 취급되어 `document.hidden=true`, `requestAnimationFrame`이 전혀 돌지 않고 `screenshot`도 실패**했다. 새 에이전트가 같은 종류의 환경에서 작업한다면 아래 방식이 유효했다:

1. **`window.__store`로 스토어 직접 조작·검증**: `window.__store.getState().addNode(...)` 등으로 상태를 세팅하고 결과를 assert
2. **`window.__surfaceStep(dtMs, 횟수)`로 rAF 없이 물리 시뮬레이션 진행**: `SurfaceLayer.tsx`가 개발 모드에서 노출함 (`stepRef`를 통해 매 프레임 로직을 직접 호출 가능하게 만들어둠)
3. **실제 이벤트 재현은 `element.dispatchEvent(new PointerEvent(...))`로, 반드시 `movementX/movementY`도 채워서** 보내야 함(안 채우면 드래그가 클릭으로 오판됨 — 실제 버그 아니고 테스트 실수였던 사례 있음)
4. **단, 위 5번 항목의 6·7번 버그처럼 브라우저 기본 동작(포커스 이동, pointer capture 재지정)에 의존하는 버그는 합성 이벤트로 재현이 안 된다.** 사용자가 "실제로는 안 된다"고 하면 코드를 더 의심하고, `preventDefault`/`stopPropagation` 관련 로직을 먼저 점검할 것
5. `location.reload()`로 브라우저 상태를 실제로 초기화할 것 (이 도구의 `navigate`는 같은 URL이면 종종 소프트 네비게이션으로 처리되어 JS 상태가 안 지워짐 — 반드시 `reload()` 사용)
6. 개발 서버가 여러 개 뜬 채 남아있을 수 있다 (포트 5173, 5174, 5175...). HMR이 반복 실패하면("Failed to reload" 로그) 브라우저 새로고침만으론 안 고쳐지고 **dev 서버 프로세스 자체를 완전히 재시작**해야 했다.

---

## 7. 다음에 할 만한 일 (우선순위 순 추정)

1. **Phase 5 (내 이야기 던지기)** — 사용자가 토큰 비용 때문에 명시적으로 보류시킨 것. 재개 전 반드시 사용자에게 확인. 계획은 있었음: txt 업로드 → 인코딩 감지(UTF-8 실패시 EUC-KR) → 한국어 문장 분리 → Web Worker에서 transformers.js 임베딩(실패시 3-gram 폴백) → base-vectors.bin과 비교해 이웃 계산 → 기본 풀에도 역주입 → 개인 조각 3개 즉시 부상. **서버 전송 절대 금지**(완전 브라우저 내 처리).
2. **Phase 7 (마감)** — 온보딩 연출(모달 없이 조각 하나가 스스로 캔버스로 이동하는 3초 시연), 접근성(prefers-reduced-motion, 콘트라스트), 에러 바운더리, 성능(LCP).
3. 사용자가 현재 `content/sentences.yaml`을 직접 명대사(문학 인용구) 위주로 교체하는 중이었다 — 이건 사용자가 직접 하는 콘텐츠 작업이므로 AI가 나서서 되돌리거나 손대지 말 것.

---
---

# 사람을 위한 매뉴얼

## A. 로컬에서 브라우저로 실행하기

```powershell
cd "C:\Users\yaong\OneDrive\Desktop\Python Workspace\fishing-pond"
npm run dev
```
터미널에 뜨는 `http://localhost:5173` (포트가 겹치면 5174 등으로 자동 변경) 주소를 **일반 브라우저(크롬/엣지 등, VS Code 내장 브라우저 아님)** 로 열면 됩니다. 창 너비는 1024px 이상이어야 정상 화면이 뜹니다. 종료는 터미널에서 `Ctrl+C`.

## B. 수정 후 배포(업데이트) 방법

```powershell
cd "C:\Users\yaong\OneDrive\Desktop\Python Workspace\fishing-pond"
git add .
git commit -m "변경 내용 설명"
git push
```
push하면 Vercel이 자동으로 감지해서 1~2분 안에 새 버전을 배포합니다. 별도 조작 필요 없습니다.

## C. 수동 큐레이션 매뉴얼

### C-1. 문장 조각 추가/수정 — `content/sentences.yaml`

```yaml
- id: s41
  text: 새로 추가할 문장 내용.
  tags: [태그1, 태그2]
```
- `id`는 서로 겹치면 안 됩니다(겹치면 나중 항목이 앞 항목을 덮어씁니다).
- `text` 문장만 바꾸면 기존 문장 수정.
- `tags`는 참고용이라 없어도(`tags: []`) 동작합니다.
- 들여쓰기(공백 2칸)를 정확히 맞춰야 합니다. YAML은 들여쓰기가 문법입니다.

### C-2. 명화 조각 추가/교체 — `content/paintings.yaml` + 이미지 파일

1. 새 이미지 파일을 `public/images/paintings/`에 넣습니다 (파일명은 영문/숫자/하이픈 권장, 예: `my-painting.jpg`).
2. `content/paintings.yaml`에 항목 추가:
```yaml
- id: p13
  imageFile: my-painting.jpg
  title: 작품명
  artist: 작가명
  sourceUrl: https://commons.wikimedia.org/wiki/File:...
  license: Public Domain
  caption: 그림 내용을 설명하는 한국어 문장 (이 문장으로 연관 조각을 계산합니다)
```
- **반드시 퍼블릭도메인(저작권 없음) 이미지만 쓰세요.** Wikimedia Commons에서 "Public Domain" 표기된 것 위주로.
- `caption`이 실제로 연관성 계산에 쓰이는 텍스트라서, 그림을 잘 설명하는 문장일수록 연관 조각이 잘 나옵니다.

### C-3. 특정 조각끼리 강제로 연결하기 — `content/curation.yaml`

자동으로 계산된 연관 조각이 마음에 안 들 때 씁니다.

1. 먼저 `npm run build:pool`을 한 번 돌리면 `scripts/out/curation-review.md`가 생기는데, 여기 각 조각별 자동 추천 이웃 8개가 표로 정리되어 있습니다. 이걸 참고하세요.
2. 마음에 안 드는 연결이 있으면 `content/curation.yaml`에 이렇게 적습니다:
```yaml
- fragmentId: s01
  neighborIds: [p04, s12, s30, s07]
```
여기 등재된 조각은 자동 추천을 **완전히 무시하고** 이 목록으로 덮어씁니다. **최소 4개 이상** 넣으세요(관련 조각이 부상할 때 4개를 요구합니다).

### C-4. 반영하기 (셋 다 공통)

```powershell
cd "C:\Users\yaong\OneDrive\Desktop\Python Workspace\fishing-pond"
npm run build:pool
```
`sentences.yaml` + `paintings.yaml` + `curation.yaml`을 전부 읽어서 `public/pool.json`(과 `base-vectors.bin`)을 다시 만듭니다. 이 명령을 실행해야 변경사항이 실제로 반영됩니다. `npm run dev`로 띄워둔 화면은 새로고침하면 보입니다.

**최종 배포까지 하려면** B번(git add/commit/push)까지 이어서 하면 됩니다.

### C-5. 자주 하는 실수

- `id`를 겹치게 적음 → 하나가 사라진 것처럼 보임 (파일 안에서 같은 id를 검색해서 확인)
- YAML 들여쓰기를 틀림 → `npm run build:pool` 실행 시 에러 메시지가 뜸, 에러 메시지에 몇 번째 줄인지 나옵니다
- `paintings.yaml`에 `imageFile`을 적었는데 실제 파일을 `public/images/paintings/`에 안 넣음 → 그림이 깨진 아이콘으로 보임
- `npm run build:pool`을 깜빡하고 바로 `git push`함 → 배포된 사이트엔 옛날 내용 그대로 → 항상 build:pool 먼저, 그다음 add/commit/push
