import { describe, it, expect, beforeEach } from 'vitest';
import { useAppStore } from './store';
import type { Fragment } from './types';

// 각 테스트 전에 스토어를 초기 상태로 되돌린다. 스토어는 모듈 단위 싱글턴이라
// 테스트끼리 상태가 새어나가면 실행 순서에 따라 결과가 달라진다.
beforeEach(() => {
  useAppStore.setState(useAppStore.getInitialState(), true);
});

function makeFragments(count: number): Fragment[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `f${i}`,
    kind: 'sentence' as const,
    text: `문장 ${i}`,
    origin: 'base' as const,
    neighborIds: [],
  }));
}

// ---- poolSlice ----
describe('poolSlice', () => {
  it('loadPool: Fragment 배열을 id로 찾을 수 있는 Map으로 바꾼다', () => {
    useAppStore.getState().loadPool(makeFragments(3));
    const { fragments } = useAppStore.getState();
    expect(fragments.size).toBe(3);
    expect(fragments.get('f1')?.text).toBe('문장 1');
  });

  it('markExhausted: 소진 집합에 누적된다 (중복 호출해도 하나로)', () => {
    useAppStore.getState().markExhausted('f0');
    useAppStore.getState().markExhausted('f1');
    useAppStore.getState().markExhausted('f0'); // 중복
    expect(useAppStore.getState().exhaustedIds.size).toBe(2);
    expect(useAppStore.getState().exhaustedIds.has('f0')).toBe(true);
  });
});

// ---- surfaceSlice ----
describe('surfaceSlice', () => {
  const sf = (fragmentId: string) => ({
    fragmentId,
    x: 0,
    y: 0,
    vx: -10,
    vy: 0,
    rotation: 0,
    spawnedAt: 0,
    touched: false,
  });

  it('addSurfaceFragment: 같은 fragmentId를 두 번 추가해도 하나만 남는다', () => {
    useAppStore.getState().addSurfaceFragment(sf('f0'));
    useAppStore.getState().addSurfaceFragment(sf('f0'));
    expect(useAppStore.getState().surfaceFragments).toHaveLength(1);
  });

  it('removeSurfaceFragment: 해당 fragmentId만 제거한다', () => {
    useAppStore.getState().addSurfaceFragment(sf('f0'));
    useAppStore.getState().addSurfaceFragment(sf('f1'));
    useAppStore.getState().removeSurfaceFragment('f0');
    const ids = useAppStore.getState().surfaceFragments.map((s) => s.fragmentId);
    expect(ids).toEqual(['f1']);
  });

  it('touchSurfaceFragment: 해당 항목만 touched=true로 바뀐다', () => {
    useAppStore.getState().addSurfaceFragment(sf('f0'));
    useAppStore.getState().addSurfaceFragment(sf('f1'));
    useAppStore.getState().touchSurfaceFragment('f0');
    const list = useAppStore.getState().surfaceFragments;
    expect(list.find((s) => s.fragmentId === 'f0')?.touched).toBe(true);
    expect(list.find((s) => s.fragmentId === 'f1')?.touched).toBe(false);
  });

  it('setPaused: isPaused 값을 그대로 반영한다', () => {
    useAppStore.getState().setPaused(true);
    expect(useAppStore.getState().isPaused).toBe(true);
    useAppStore.getState().setPaused(false);
    expect(useAppStore.getState().isPaused).toBe(false);
  });
});

// ---- canvasSlice: 노드 ----
describe('canvasSlice: 노드', () => {
  it('addNode: z를 추가 순서대로 단조 증가시킨다 (마지막에 올린 노드가 위)', () => {
    useAppStore.getState().addNode({ id: 'n0', fragmentId: 'f0', x: 0, y: 0, z: 999 });
    useAppStore.getState().addNode({ id: 'n1', fragmentId: 'f1', x: 0, y: 0, z: 999 });
    const nodes = useAppStore.getState().nodes;
    expect(nodes[0].z).toBe(0);
    expect(nodes[1].z).toBe(1);
  });

  it('removeNodes: 지운 노드에 걸린 실타래도 함께 사라진다', () => {
    const s = useAppStore.getState();
    s.addNode({ id: 'n0', fragmentId: 'f0', x: 0, y: 0, z: 0 });
    s.addNode({ id: 'n1', fragmentId: 'f1', x: 0, y: 0, z: 0 });
    s.addNode({ id: 'n2', fragmentId: 'f2', x: 0, y: 0, z: 0 });
    s.addThreadBetween('n0', 'n1');
    s.addThreadBetween('n1', 'n2'); // n1과 무관한 실타래도 하나 더
    s.removeNodes(['n1']);
    const after = useAppStore.getState();
    expect(after.nodes.map((n) => n.id)).toEqual(['n0', 'n2']);
    expect(after.threads).toHaveLength(0); // 둘 다 n1을 물고 있었으므로 전부 제거
  });

  it('removeNodes: 멤버가 1개 이하로 줄어든 주머니는 자동으로 사라진다', () => {
    const s = useAppStore.getState();
    ['n0', 'n1', 'n2'].forEach((id) => s.addNode({ id, fragmentId: id, x: 0, y: 0, z: 0 }));
    s.togglePendingPouchNode('n0');
    s.togglePendingPouchNode('n1');
    s.commitPouch();
    expect(useAppStore.getState().pouches).toHaveLength(1);

    s.removeNodes(['n0']);
    // 멤버가 1개(n1)만 남았으니 묶음으로서 의미가 없어 사라져야 한다
    expect(useAppStore.getState().pouches).toHaveLength(0);
  });

  it('moveNodesBy: 지정한 노드만 델타만큼 이동한다 (스냅 없음)', () => {
    const s = useAppStore.getState();
    s.addNode({ id: 'n0', fragmentId: 'f0', x: 100, y: 100, z: 0 });
    s.addNode({ id: 'n1', fragmentId: 'f1', x: 200, y: 200, z: 0 });
    s.moveNodesBy(['n0'], 13.7, -4.2);
    const nodes = useAppStore.getState().nodes;
    expect(nodes.find((n) => n.id === 'n0')).toMatchObject({ x: 113.7, y: 95.8 });
    expect(nodes.find((n) => n.id === 'n1')).toMatchObject({ x: 200, y: 200 });
  });
});

// ---- canvasSlice: 실타래 ----
describe('canvasSlice: 실타래', () => {
  beforeEach(() => {
    const s = useAppStore.getState();
    ['n0', 'n1', 'n2'].forEach((id) => s.addNode({ id, fragmentId: id, x: 0, y: 0, z: 0 }));
  });

  it('addThreadBetween: 새 쌍은 실타래를 만든다', () => {
    useAppStore.getState().addThreadBetween('n0', 'n1');
    const threads = useAppStore.getState().threads;
    expect(threads).toHaveLength(1);
    expect(threads[0]).toMatchObject({ fromNodeId: 'n0', toNodeId: 'n1' });
  });

  it('addThreadBetween: 이미 이어진 쌍을 다시 이으면 토글 해제된다 (양방향 모두)', () => {
    const s = useAppStore.getState();
    s.addThreadBetween('n0', 'n1');
    s.addThreadBetween('n1', 'n0'); // 반대 방향으로 재연결
    expect(useAppStore.getState().threads).toHaveLength(0);
  });

  it('addThreadBetween: 같은 노드를 자기 자신과 이으려 하면 무시한다', () => {
    useAppStore.getState().addThreadBetween('n0', 'n0');
    expect(useAppStore.getState().threads).toHaveLength(0);
  });

  it('removeThreads: 지정한 실타래만 제거한다', () => {
    const s = useAppStore.getState();
    s.addThreadBetween('n0', 'n1');
    s.addThreadBetween('n1', 'n2');
    const [first] = useAppStore.getState().threads;
    s.removeThreads([first.id]);
    expect(useAppStore.getState().threads).toHaveLength(1);
  });
});

// ---- canvasSlice: 주머니 ----
describe('canvasSlice: 주머니', () => {
  beforeEach(() => {
    const s = useAppStore.getState();
    ['n0', 'n1', 'n2'].forEach((id) => s.addNode({ id, fragmentId: id, x: 0, y: 0, z: 0 }));
  });

  it('commitPouch: 선택된 노드 2개 이상이면 주머니가 생긴다', () => {
    const s = useAppStore.getState();
    s.togglePendingPouchNode('n0');
    s.togglePendingPouchNode('n1');
    s.commitPouch();
    expect(useAppStore.getState().pouches).toHaveLength(1);
    expect(useAppStore.getState().pouches[0].nodeIds.sort()).toEqual(['n0', 'n1']);
    expect(useAppStore.getState().pendingPouchNodeIds).toHaveLength(0);
  });

  it('commitPouch: 혼자(1개)면 주머니가 되지 않는다', () => {
    const s = useAppStore.getState();
    s.togglePendingPouchNode('n0');
    s.commitPouch();
    expect(useAppStore.getState().pouches).toHaveLength(0);
  });

  it('togglePendingPouchNode: 같은 노드를 다시 누르면 선택에서 빠진다', () => {
    const s = useAppStore.getState();
    s.togglePendingPouchNode('n0');
    s.togglePendingPouchNode('n0');
    expect(useAppStore.getState().pendingPouchNodeIds).toHaveLength(0);
  });

  it('removePouches: 지정한 주머니만 제거한다 (멤버 노드는 그대로)', () => {
    const s = useAppStore.getState();
    s.togglePendingPouchNode('n0');
    s.togglePendingPouchNode('n1');
    s.commitPouch();
    const [pouch] = useAppStore.getState().pouches;
    s.removePouches([pouch.id]);
    expect(useAppStore.getState().pouches).toHaveLength(0);
    expect(useAppStore.getState().nodes).toHaveLength(3);
  });

  it('updatePouchLabel: 해당 주머니의 라벨만 바뀐다', () => {
    const s = useAppStore.getState();
    s.togglePendingPouchNode('n0');
    s.togglePendingPouchNode('n1');
    s.commitPouch();
    const [pouch] = useAppStore.getState().pouches;
    s.updatePouchLabel(pouch.id, '겨울 여행');
    expect(useAppStore.getState().pouches[0].label).toBe('겨울 여행');
  });
});

// ---- canvasSlice: 메모 ----
describe('canvasSlice: 메모', () => {
  const memo = (id: string, x = 0, y = 0) => ({ id, x, y, text: '', width: 200, height: 28 });

  it('addMemo: 메모가 추가된다', () => {
    useAppStore.getState().addMemo(memo('m0'));
    expect(useAppStore.getState().memos).toHaveLength(1);
  });

  it('updateMemo: 텍스트만 바뀌고 나머지는 유지된다', () => {
    const s = useAppStore.getState();
    s.addMemo(memo('m0', 10, 20));
    s.updateMemo('m0', '오늘의 메모');
    const m = useAppStore.getState().memos[0];
    expect(m.text).toBe('오늘의 메모');
    expect(m.x).toBe(10);
    expect(m.y).toBe(20);
  });

  it('moveMemoBy: 지정한 메모만 델타만큼 이동한다', () => {
    const s = useAppStore.getState();
    s.addMemo(memo('m0', 10, 10));
    s.addMemo(memo('m1', 50, 50));
    s.moveMemoBy('m0', 5, -5);
    const memos = useAppStore.getState().memos;
    expect(memos.find((m) => m.id === 'm0')).toMatchObject({ x: 15, y: 5 });
    expect(memos.find((m) => m.id === 'm1')).toMatchObject({ x: 50, y: 50 });
  });

  it('removeMemos: 지정한 메모만 제거한다', () => {
    const s = useAppStore.getState();
    s.addMemo(memo('m0'));
    s.addMemo(memo('m1'));
    s.removeMemos(['m0']);
    expect(useAppStore.getState().memos.map((m) => m.id)).toEqual(['m1']);
  });
});

// ---- canvasSlice: 도구·선택 ----
describe('canvasSlice: 도구 전환과 선택', () => {
  it('setActiveTool: 도구를 바꾸면 진행 중이던 실타래/주머니 조작이 취소된다', () => {
    const s = useAppStore.getState();
    s.setActiveTool('pouch');
    s.togglePendingPouchNode('n0');
    s.setActiveTool('thread');
    s.setPendingThreadFrom('n1');
    expect(useAppStore.getState().pendingThreadFromNodeId).toBe('n1');

    s.setActiveTool('select');
    const after = useAppStore.getState();
    expect(after.pendingPouchNodeIds).toHaveLength(0);
    expect(after.pendingThreadFromNodeId).toBeNull();
  });

  it('setSelection: 지정한 종류만 갱신하고 나머지는 그대로 둔다', () => {
    const s = useAppStore.getState();
    s.setSelection({ nodeIds: ['n0'] });
    s.setSelection({ memoIds: ['m0'] });
    const sel = useAppStore.getState();
    expect(sel.selectedNodeIds).toEqual(['n0']);
    expect(sel.selectedMemoIds).toEqual(['m0']);
  });

  it('clearSelection: 네 종류 선택을 모두 비운다', () => {
    const s = useAppStore.getState();
    s.setSelection({ nodeIds: ['n0'], threadIds: ['t0'], pouchIds: ['p0'], memoIds: ['m0'] });
    s.clearSelection();
    const sel = useAppStore.getState();
    expect(sel.selectedNodeIds).toHaveLength(0);
    expect(sel.selectedThreadIds).toHaveLength(0);
    expect(sel.selectedPouchIds).toHaveLength(0);
    expect(sel.selectedMemoIds).toHaveLength(0);
  });

  it('deleteSelection: 선택된 노드·실타래·주머니·메모를 한번에 지운다', () => {
    const s = useAppStore.getState();
    ['n0', 'n1'].forEach((id) => s.addNode({ id, fragmentId: id, x: 0, y: 0, z: 0 }));
    s.addMemo({ id: 'm0', x: 0, y: 0, text: '', width: 100, height: 20 });
    s.setSelection({ nodeIds: ['n0'], memoIds: ['m0'] });
    s.deleteSelection();
    const after = useAppStore.getState();
    expect(after.nodes.map((n) => n.id)).toEqual(['n1']);
    expect(after.memos).toHaveLength(0);
    expect(after.selectedNodeIds).toHaveLength(0);
  });

  it('deleteSelection: 아무것도 선택되지 않았으면 상태를 바꾸지 않는다', () => {
    const s = useAppStore.getState();
    s.addNode({ id: 'n0', fragmentId: 'f0', x: 0, y: 0, z: 0 });
    const before = useAppStore.getState().nodes;
    s.deleteSelection();
    expect(useAppStore.getState().nodes).toBe(before); // 참조가 그대로 — 불필요한 리렌더 방지
  });
});

// ---- canvasSlice: 되돌리기 ----
describe('canvasSlice: 되돌리기(undo)', () => {
  it('undo: 노드 삭제를 정확히 되돌린다', () => {
    const s = useAppStore.getState();
    s.addNode({ id: 'n0', fragmentId: 'f0', x: 0, y: 0, z: 0 });
    s.addNode({ id: 'n1', fragmentId: 'f1', x: 0, y: 0, z: 0 });
    const before = useAppStore.getState().nodes;
    s.removeNodes(['n0']);
    expect(useAppStore.getState().nodes).toHaveLength(1);
    s.undo();
    expect(useAppStore.getState().nodes).toEqual(before);
  });

  it('undo: 실타래 생성, 주머니 생성 각각을 되돌린다', () => {
    const s = useAppStore.getState();
    ['n0', 'n1'].forEach((id) => s.addNode({ id, fragmentId: id, x: 0, y: 0, z: 0 }));

    s.addThreadBetween('n0', 'n1');
    expect(useAppStore.getState().threads).toHaveLength(1);
    s.undo();
    expect(useAppStore.getState().threads).toHaveLength(0);

    s.togglePendingPouchNode('n0');
    s.togglePendingPouchNode('n1');
    s.commitPouch();
    expect(useAppStore.getState().pouches).toHaveLength(1);
    s.undo();
    expect(useAppStore.getState().pouches).toHaveLength(0);
  });

  it('undo: 쌓인 스냅샷이 없으면 아무 일도 일어나지 않는다', () => {
    const before = useAppStore.getState();
    useAppStore.getState().undo();
    expect(useAppStore.getState().nodes).toEqual(before.nodes);
  });

  it('undo 스택은 깊이 30을 넘기지 않는다', () => {
    const s = useAppStore.getState();
    for (let i = 0; i < 40; i++) {
      s.addNode({ id: `n${i}`, fragmentId: `f${i}`, x: 0, y: 0, z: 0 });
    }
    expect(useAppStore.getState().undoStack.length).toBe(30);
  });

  it('undo: 되돌린 뒤 선택 상태와 진행 중 조작을 초기화한다', () => {
    const s = useAppStore.getState();
    s.addNode({ id: 'n0', fragmentId: 'f0', x: 0, y: 0, z: 0 });
    s.setSelection({ nodeIds: ['n0'] });
    s.removeNodes(['n0']);
    s.setActiveTool('pouch');
    s.togglePendingPouchNode('n0'); // 이미 지워진 노드지만 상태만 검사
    s.undo();
    const after = useAppStore.getState();
    expect(after.selectedNodeIds).toHaveLength(0);
    expect(after.pendingPouchNodeIds).toHaveLength(0);
  });
});
