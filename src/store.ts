import { create } from 'zustand';
import type {
  Fragment,
  SurfaceFragment,
  CanvasNode,
  Thread,
  Pouch,
  Memo,
  ToolKind,
} from './types';

// ---- poolSlice: 전체 Fragment 레코드와 소진된 id 집합 ----
export interface PoolSlice {
  fragments: Map<string, Fragment>;
  exhaustedIds: Set<string>;

  loadPool: (fragments: Fragment[]) => void; // TODO: pool.json 로드 후 채우기
  markExhausted: (fragmentId: string) => void; // TODO: 캔버스에 올라간 조각 소진 처리
}

// ---- surfaceSlice: 수면 위 조각과 재생 상태 ----
export interface SurfaceSlice {
  surfaceFragments: SurfaceFragment[];
  isPaused: boolean;

  addSurfaceFragment: (fragment: SurfaceFragment) => void; // TODO: 랜덤/관련 조각 부상
  removeSurfaceFragment: (fragmentId: string) => void; // TODO: 수명 만료/낚기 시 제거
  touchSurfaceFragment: (fragmentId: string) => void; // TODO: touched=true 처리
  setPaused: (paused: boolean) => void; // TODO: rAF/수명 타이머 정지·재개
}

// 되돌리기용 캔버스 스냅샷. 되돌리기는 캔버스 편집에만 적용되고
// 수면(우연히 흘러가는 흐름)에는 적용하지 않는다.
export interface CanvasSnapshot {
  nodes: CanvasNode[];
  threads: Thread[];
  pouches: Pouch[];
  memos: Memo[];
}

const UNDO_DEPTH = 30;

// 변경을 적용하기 직전의 캔버스 상태를 스택에 쌓는다. 깊이를 넘으면 가장 오래된 것을 버린다.
function pushSnapshot(state: CanvasSnapshot & { undoStack: CanvasSnapshot[] }): CanvasSnapshot[] {
  return [
    ...state.undoStack.slice(-(UNDO_DEPTH - 1)),
    {
      nodes: state.nodes,
      threads: state.threads,
      pouches: state.pouches,
      memos: state.memos,
    },
  ];
}

// ---- canvasSlice: 캔버스 노드, 실타래, 주머니, 메모, 활성 도구 ----
export interface CanvasSlice {
  nodes: CanvasNode[];
  threads: Thread[];
  pouches: Pouch[];
  memos: Memo[];
  activeTool: ToolKind;

  // 선택 상태
  selectedNodeIds: string[];
  selectedThreadIds: string[];
  selectedPouchIds: string[];
  selectedMemoIds: string[];

  // 진행 중인 조작 (도구를 바꾸면 깔끔하게 취소된다)
  pendingThreadFromNodeId: string | null;
  pendingPouchNodeIds: string[];

  undoStack: CanvasSnapshot[];

  addNode: (node: CanvasNode) => void;
  removeNodes: (nodeIds: string[]) => void;
  moveNodesBy: (nodeIds: string[], dx: number, dy: number) => void;

  addThreadBetween: (fromNodeId: string, toNodeId: string) => void;
  removeThreads: (threadIds: string[]) => void;

  commitPouch: () => void;
  removePouches: (pouchIds: string[]) => void;
  updatePouchLabel: (pouchId: string, label: string) => void;

  addMemo: (memo: Memo) => void;
  updateMemo: (memoId: string, text: string) => void;
  moveMemoBy: (memoId: string, dx: number, dy: number) => void;
  removeMemos: (memoIds: string[]) => void;

  setActiveTool: (tool: ToolKind) => void;
  setPendingThreadFrom: (nodeId: string | null) => void;
  togglePendingPouchNode: (nodeId: string) => void;

  setSelection: (selection: {
    nodeIds?: string[];
    threadIds?: string[];
    pouchIds?: string[];
    memoIds?: string[];
  }) => void;
  clearSelection: () => void;
  deleteSelection: () => void;

  pushUndoSnapshot: () => void;
  undo: () => void;
}

export type AppStore = PoolSlice & SurfaceSlice & CanvasSlice;

// 개발 모드에서 콘솔·테스트가 스토어를 직접 들여다볼 수 있게 한다.
// (이 환경의 브라우저 창은 백그라운드 탭으로 잡혀 rAF와 실제 클릭 검증이 어렵다.)
function exposeStoreForDev(store: unknown) {
  if (import.meta.env.DEV && typeof window !== 'undefined') {
    (window as unknown as Record<string, unknown>).__store = store;
  }
}

export const useAppStore = create<AppStore>()((set) => ({
  // poolSlice
  fragments: new Map(),
  exhaustedIds: new Set(),
  loadPool: (fragments) =>
    set({ fragments: new Map(fragments.map((f) => [f.id, f])) }),
  markExhausted: (fragmentId) =>
    set((state) => {
      const next = new Set(state.exhaustedIds);
      next.add(fragmentId);
      return { exhaustedIds: next };
    }),

  // surfaceSlice
  surfaceFragments: [],
  isPaused: false,
  addSurfaceFragment: (fragment) =>
    set((state) => {
      if (state.surfaceFragments.some((sf) => sf.fragmentId === fragment.fragmentId)) {
        return state;
      }
      return { surfaceFragments: [...state.surfaceFragments, fragment] };
    }),
  removeSurfaceFragment: (fragmentId) =>
    set((state) => ({
      surfaceFragments: state.surfaceFragments.filter((sf) => sf.fragmentId !== fragmentId),
    })),
  touchSurfaceFragment: (fragmentId) =>
    set((state) => ({
      surfaceFragments: state.surfaceFragments.map((sf) =>
        sf.fragmentId === fragmentId ? { ...sf, touched: true } : sf,
      ),
    })),
  setPaused: (paused) => set({ isPaused: paused }),

  // canvasSlice
  nodes: [],
  threads: [],
  pouches: [],
  memos: [],
  activeTool: 'select',
  selectedNodeIds: [],
  selectedThreadIds: [],
  selectedPouchIds: [],
  selectedMemoIds: [],
  pendingThreadFromNodeId: null,
  pendingPouchNodeIds: [],
  undoStack: [],

  pushUndoSnapshot: () =>
    set((state) => ({
      undoStack: [
        ...state.undoStack.slice(-(UNDO_DEPTH - 1)),
        {
          nodes: state.nodes,
          threads: state.threads,
          pouches: state.pouches,
          memos: state.memos,
        },
      ],
    })),

  undo: () =>
    set((state) => {
      const previous = state.undoStack[state.undoStack.length - 1];
      if (!previous) return state;
      return {
        ...previous,
        undoStack: state.undoStack.slice(0, -1),
        // 되돌린 뒤 사라진 요소를 계속 선택된 채로 두면 Delete가 엉뚱하게 동작한다
        selectedNodeIds: [],
        selectedThreadIds: [],
        selectedPouchIds: [],
        selectedMemoIds: [],
        pendingThreadFromNodeId: null,
        pendingPouchNodeIds: [],
      };
    }),

  addNode: (node) =>
    set((state) => ({
      undoStack: pushSnapshot(state),
      // z는 항상 마지막에 올린 노드가 위로 오도록 단조 증가시킨다
      nodes: [...state.nodes, { ...node, z: state.nodes.length }],
    })),

  // 노드를 지우면 그 노드에 걸린 실타래와 주머니 멤버십도 함께 정리한다.
  // 멤버가 1개 이하로 줄어든 주머니는 묶음으로서 의미가 없으므로 스스로 사라진다.
  removeNodes: (nodeIds) =>
    set((state) => {
      const doomed = new Set(nodeIds);
      if (doomed.size === 0) return state;
      const pouches = state.pouches
        .map((p) => ({ ...p, nodeIds: p.nodeIds.filter((id) => !doomed.has(id)) }))
        .filter((p) => p.nodeIds.length >= 2);
      return {
        undoStack: pushSnapshot(state),
        nodes: state.nodes.filter((n) => !doomed.has(n.id)),
        threads: state.threads.filter(
          (t) => !doomed.has(t.fromNodeId) && !doomed.has(t.toNodeId),
        ),
        pouches,
        selectedNodeIds: state.selectedNodeIds.filter((id) => !doomed.has(id)),
        pendingPouchNodeIds: state.pendingPouchNodeIds.filter((id) => !doomed.has(id)),
        pendingThreadFromNodeId: doomed.has(state.pendingThreadFromNodeId ?? '')
          ? null
          : state.pendingThreadFromNodeId,
      };
    }),

  // 격자에 맞추지 않는다 — 정렬을 강요하면 이 앱의 취지를 배반한다
  moveNodesBy: (nodeIds, dx, dy) =>
    set((state) => {
      const moving = new Set(nodeIds);
      return {
        nodes: state.nodes.map((n) =>
          moving.has(n.id) ? { ...n, x: n.x + dx, y: n.y + dy } : n,
        ),
      };
    }),

  // 이미 이어진 쌍을 다시 이으려 하면 해제한다 (토글)
  addThreadBetween: (fromNodeId, toNodeId) =>
    set((state) => {
      if (fromNodeId === toNodeId) return state;
      const existing = state.threads.find(
        (t) =>
          (t.fromNodeId === fromNodeId && t.toNodeId === toNodeId) ||
          (t.fromNodeId === toNodeId && t.toNodeId === fromNodeId),
      );
      if (existing) {
        return {
          undoStack: pushSnapshot(state),
          threads: state.threads.filter((t) => t.id !== existing.id),
          pendingThreadFromNodeId: null,
        };
      }
      return {
        undoStack: pushSnapshot(state),
        threads: [
          ...state.threads,
          { id: `thread-${fromNodeId}-${toNodeId}-${state.threads.length}`, fromNodeId, toNodeId },
        ],
        pendingThreadFromNodeId: null,
      };
    }),

  removeThreads: (threadIds) =>
    set((state) => {
      const doomed = new Set(threadIds);
      if (doomed.size === 0) return state;
      return {
        undoStack: pushSnapshot(state),
        threads: state.threads.filter((t) => !doomed.has(t.id)),
        selectedThreadIds: state.selectedThreadIds.filter((id) => !doomed.has(id)),
      };
    }),

  commitPouch: () =>
    set((state) => {
      // 혼자인 묶음은 묶음이 아니다
      if (state.pendingPouchNodeIds.length < 2) {
        return { pendingPouchNodeIds: [] };
      }
      return {
        undoStack: pushSnapshot(state),
        pouches: [
          ...state.pouches,
          { id: `pouch-${state.pouches.length}-${state.pendingPouchNodeIds.length}`, nodeIds: [...state.pendingPouchNodeIds] },
        ],
        pendingPouchNodeIds: [],
      };
    }),

  removePouches: (pouchIds) =>
    set((state) => {
      const doomed = new Set(pouchIds);
      if (doomed.size === 0) return state;
      return {
        undoStack: pushSnapshot(state),
        pouches: state.pouches.filter((p) => !doomed.has(p.id)),
        selectedPouchIds: state.selectedPouchIds.filter((id) => !doomed.has(id)),
      };
    }),

  updatePouchLabel: (pouchId, label) =>
    set((state) => ({
      undoStack: pushSnapshot(state),
      pouches: state.pouches.map((p) => (p.id === pouchId ? { ...p, label } : p)),
    })),

  addMemo: (memo) =>
    set((state) => ({
      undoStack: pushSnapshot(state),
      memos: [...state.memos, memo],
    })),

  updateMemo: (memoId, text) =>
    set((state) => ({
      undoStack: pushSnapshot(state),
      memos: state.memos.map((m) => (m.id === memoId ? { ...m, text } : m)),
    })),

  moveMemoBy: (memoId, dx, dy) =>
    set((state) => ({
      memos: state.memos.map((m) =>
        m.id === memoId ? { ...m, x: m.x + dx, y: m.y + dy } : m,
      ),
    })),

  removeMemos: (memoIds) =>
    set((state) => {
      const doomed = new Set(memoIds);
      if (doomed.size === 0) return state;
      return {
        undoStack: pushSnapshot(state),
        memos: state.memos.filter((m) => !doomed.has(m.id)),
        selectedMemoIds: state.selectedMemoIds.filter((id) => !doomed.has(id)),
      };
    }),

  // 도구를 바꾸면 진행 중이던 조작(주머니 선택 중 등)을 깔끔하게 취소한다
  setActiveTool: (tool) =>
    set({
      activeTool: tool,
      pendingThreadFromNodeId: null,
      pendingPouchNodeIds: [],
    }),

  setPendingThreadFrom: (nodeId) => set({ pendingThreadFromNodeId: nodeId }),

  togglePendingPouchNode: (nodeId) =>
    set((state) => ({
      pendingPouchNodeIds: state.pendingPouchNodeIds.includes(nodeId)
        ? state.pendingPouchNodeIds.filter((id) => id !== nodeId)
        : [...state.pendingPouchNodeIds, nodeId],
    })),

  setSelection: (selection) =>
    set((state) => ({
      selectedNodeIds: selection.nodeIds ?? state.selectedNodeIds,
      selectedThreadIds: selection.threadIds ?? state.selectedThreadIds,
      selectedPouchIds: selection.pouchIds ?? state.selectedPouchIds,
      selectedMemoIds: selection.memoIds ?? state.selectedMemoIds,
    })),

  clearSelection: () =>
    set({
      selectedNodeIds: [],
      selectedThreadIds: [],
      selectedPouchIds: [],
      selectedMemoIds: [],
    }),

  // Delete 키 한 번으로 선택된 모든 종류를 지운다. 스냅샷은 한 번만 쌓아
  // Ctrl+Z 한 번에 전부 되돌아오게 한다.
  deleteSelection: () =>
    set((state) => {
      const doomedNodes = new Set(state.selectedNodeIds);
      const doomedThreads = new Set(state.selectedThreadIds);
      const doomedPouches = new Set(state.selectedPouchIds);
      const doomedMemos = new Set(state.selectedMemoIds);
      if (
        doomedNodes.size + doomedThreads.size + doomedPouches.size + doomedMemos.size ===
        0
      ) {
        return state;
      }

      const pouches = state.pouches
        .filter((p) => !doomedPouches.has(p.id))
        .map((p) => ({ ...p, nodeIds: p.nodeIds.filter((id) => !doomedNodes.has(id)) }))
        .filter((p) => p.nodeIds.length >= 2);

      return {
        undoStack: pushSnapshot(state),
        nodes: state.nodes.filter((n) => !doomedNodes.has(n.id)),
        threads: state.threads.filter(
          (t) =>
            !doomedThreads.has(t.id) &&
            !doomedNodes.has(t.fromNodeId) &&
            !doomedNodes.has(t.toNodeId),
        ),
        pouches,
        memos: state.memos.filter((m) => !doomedMemos.has(m.id)),
        selectedNodeIds: [],
        selectedThreadIds: [],
        selectedPouchIds: [],
        selectedMemoIds: [],
      };
    }),
}));

exposeStoreForDev(useAppStore);
