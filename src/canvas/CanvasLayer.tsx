import { forwardRef, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { useAppStore } from '../store';
import { Toolbar } from './Toolbar';
import { MemoItem } from './MemoItem';
import { CardNodeText } from './CardNodeText';
import { ImageZoom } from './ImageZoom';
import { memoStylePreset } from './memoStyles';
import { closedSmoothPath, pouchHull, rectsIntersect } from './geometry';
import type { Rect } from './geometry';
import { exportCanvasPng } from './export';
import type { ContentBounds } from './export';
import styles from './canvas.module.css';

// setPointerCapture는 이미 눌림이 끝난 pointerId로 호출되면 NotFoundError를 던진다
// (예: 아주 짧은 클릭 뒤 이 핸들러가 실행되기 전에 pointerup이 먼저 도착한 경우).
// 이 예외가 잡히지 않으면 React가 해당 렌더를 통째로 어긋내 버려서, 이 클릭 하나
// 때문에 실타래·주머니·연필 등 다른 도구까지 전부 먹통이 된 것처럼 보인다.
function safelySetPointerCapture(el: Element, pointerId: number) {
  try {
    el.setPointerCapture(pointerId);
  } catch {
    // 캡처에 실패해도 pane 레벨 핸들러가 pointermove/up을 계속 받으므로 드래그 자체는 이어진다
  }
}

const NODE_WIDTH = 190;
// 카드(조각)의 실제 너비 — canvas.module.css의 .node와 짝을 이룬다
const CARD_WIDTH = NODE_WIDTH;
const CARD_GRAB_OFFSET_Y = 20;
const POUCH_PADDING = 24;
const DRAG_THRESHOLD_PX = 4;

type DragState =
  | { kind: 'node'; nodeIds: string[]; lastX: number; lastY: number; movedPx: number }
  | { kind: 'pouch'; nodeIds: string[]; lastX: number; lastY: number; movedPx: number }
  | { kind: 'memo'; memoId: string; lastX: number; lastY: number; movedPx: number }
  | { kind: 'box'; startX: number; startY: number; currentX: number; currentY: number };

export const CanvasLayer = forwardRef<HTMLDivElement>(function CanvasLayer(_props, ref) {
  const nodes = useAppStore((s) => s.nodes);
  const threads = useAppStore((s) => s.threads);
  const pouches = useAppStore((s) => s.pouches);
  const memos = useAppStore((s) => s.memos);
  const fragments = useAppStore((s) => s.fragments);
  const activeTool = useAppStore((s) => s.activeTool);
  const selectedNodeIds = useAppStore((s) => s.selectedNodeIds);
  const selectedThreadIds = useAppStore((s) => s.selectedThreadIds);
  const selectedPouchIds = useAppStore((s) => s.selectedPouchIds);
  const selectedMemoIds = useAppStore((s) => s.selectedMemoIds);
  const pendingThreadFromNodeId = useAppStore((s) => s.pendingThreadFromNodeId);
  const pendingPouchNodeIds = useAppStore((s) => s.pendingPouchNodeIds);

  const removeNodes = useAppStore((s) => s.removeNodes);
  const moveNodesBy = useAppStore((s) => s.moveNodesBy);
  const addThreadBetween = useAppStore((s) => s.addThreadBetween);
  const setPendingThreadFrom = useAppStore((s) => s.setPendingThreadFrom);
  const togglePendingPouchNode = useAppStore((s) => s.togglePendingPouchNode);
  const commitPouch = useAppStore((s) => s.commitPouch);
  const updatePouchLabel = useAppStore((s) => s.updatePouchLabel);
  const createIdeaCard = useAppStore((s) => s.createIdeaCard);
  const addMemo = useAppStore((s) => s.addMemo);
  const moveMemoBy = useAppStore((s) => s.moveMemoBy);
  const memoTextStyle = useAppStore((s) => s.memoTextStyle);
  const updateMemoTextStyle = useAppStore((s) => s.updateMemoTextStyle);
  const openImageZoom = useAppStore((s) => s.openImageZoom);
  const setSelection = useAppStore((s) => s.setSelection);
  const clearSelection = useAppStore((s) => s.clearSelection);
  const deleteSelection = useAppStore((s) => s.deleteSelection);
  const pushUndoSnapshot = useAppStore((s) => s.pushUndoSnapshot);
  const undo = useAppStore((s) => s.undo);

  const paneRef = useRef<HTMLDivElement | null>(null);
  const nodeSizesRef = useRef(new Map<string, { width: number; height: number }>());
  const dragRef = useRef<DragState | null>(null);
  const [boxRect, setBoxRect] = useState<Rect | null>(null);
  const [hoveredThreadId, setHoveredThreadId] = useState<string | null>(null);
  const [editingMemoId, setEditingMemoId] = useState<string | null>(null);
  const [editingPouchId, setEditingPouchId] = useState<string | null>(null);
  const [editingCardNodeId, setEditingCardNodeId] = useState<string | null>(null);

  const setPaneRef = useCallback(
    (el: HTMLDivElement | null) => {
      paneRef.current = el;
      if (typeof ref === 'function') ref(el);
      else if (ref) (ref as { current: HTMLDivElement | null }).current = el;
    },
    [ref],
  );

  const nodeById = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes]);

  function measuredRect(nodeId: string): Rect | null {
    const node = nodeById.get(nodeId);
    if (!node) return null;
    const size = nodeSizesRef.current.get(nodeId);
    return {
      x: node.x,
      y: node.y,
      width: size?.width ?? NODE_WIDTH,
      height: size?.height ?? 120,
    };
  }

  function nodeCenter(nodeId: string) {
    const rect = measuredRect(nodeId);
    if (!rect) return null;
    return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
  }

  // ---- 키보드: Delete 삭제 / Ctrl+Z 되돌리기 / Enter로 주머니 확정 ----
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      // 메모·라벨을 입력하는 중이면 키를 가로채지 않는다
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return;

      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
        event.preventDefault();
        undo();
        return;
      }
      if (event.key === 'Delete' || event.key === 'Backspace') {
        event.preventDefault();
        deleteSelection();
        return;
      }
      if (event.key === 'Enter' && useAppStore.getState().activeTool === 'pouch') {
        event.preventDefault();
        commitPouch();
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [undo, deleteSelection, commitPouch]);

  // 쓰는 중에 툴바에서 크기를 바꾸면 그 메모에 곧바로 반영한다
  useEffect(() => {
    if (!editingMemoId) return;
    const preset = memoStylePreset(memoTextStyle);
    updateMemoTextStyle(editingMemoId, preset.kind, preset.width);
  }, [memoTextStyle, editingMemoId, updateMemoTextStyle]);

  // ---- 노드 ----
  function handleNodePointerDown(event: ReactPointerEvent<HTMLDivElement>, nodeId: string) {
    event.stopPropagation();

    // 진행 중인 조작 상태는 스토어에서 바로 읽는다. 렌더 클로저에 담긴 값을 쓰면
    // 상태를 바꾼 직후 들어온 입력이 한 박자 뒤처진 값을 보게 된다.
    const state = useAppStore.getState();
    const tool = state.activeTool;

    if (tool === 'thread') {
      if (state.pendingThreadFromNodeId === null) setPendingThreadFrom(nodeId);
      else addThreadBetween(state.pendingThreadFromNodeId, nodeId);
      return;
    }

    if (tool === 'pouch') {
      togglePendingPouchNode(nodeId);
      return;
    }

    if (tool !== 'select') return;

    const currentSelection = state.selectedNodeIds;
    const alreadySelected = currentSelection.includes(nodeId);
    let nextSelection: string[];
    if (event.shiftKey) {
      nextSelection = alreadySelected
        ? currentSelection.filter((id) => id !== nodeId)
        : [...currentSelection, nodeId];
    } else {
      nextSelection = alreadySelected ? currentSelection : [nodeId];
    }
    setSelection({ nodeIds: nextSelection, threadIds: [], pouchIds: [], memoIds: [] });

    if (nextSelection.length === 0) return;

    // 드래그 시작 전에 스냅샷을 한 번 쌓는다 (매 프레임 쌓으면 스택이 순식간에 넘친다)
    pushUndoSnapshot();
    dragRef.current = {
      kind: 'node',
      nodeIds: nextSelection,
      lastX: event.clientX,
      lastY: event.clientY,
      movedPx: 0,
    };
    safelySetPointerCapture(event.currentTarget, event.pointerId);
  }

  // ---- 주머니 배경: 드래그하면 멤버 전체가 함께 움직인다 ----
  function handlePouchPointerDown(event: ReactPointerEvent<SVGPathElement>, pouchId: string) {
    if (useAppStore.getState().activeTool !== 'select') return;
    event.stopPropagation();
    const pouch = pouches.find((p) => p.id === pouchId);
    if (!pouch) return;

    setSelection({ pouchIds: [pouchId], nodeIds: [], threadIds: [], memoIds: [] });
    pushUndoSnapshot();
    dragRef.current = {
      kind: 'pouch',
      nodeIds: [...pouch.nodeIds],
      lastX: event.clientX,
      lastY: event.clientY,
      movedPx: 0,
    };
    safelySetPointerCapture(event.currentTarget, event.pointerId);
  }

  // ---- 메모 ----
  function handleMemoPointerDown(event: ReactPointerEvent<HTMLDivElement>, memoId: string) {
    if (useAppStore.getState().activeTool !== 'select') return;
    event.stopPropagation();
    setSelection({ memoIds: [memoId], nodeIds: [], threadIds: [], pouchIds: [] });
    pushUndoSnapshot();
    dragRef.current = {
      kind: 'memo',
      memoId,
      lastX: event.clientX,
      lastY: event.clientY,
      movedPx: 0,
    };
    safelySetPointerCapture(event.currentTarget, event.pointerId);
  }

  // ---- 빈 캔버스 ----
  function handlePanePointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    const paneRect = paneRef.current?.getBoundingClientRect();
    if (!paneRect) return;
    const tool = useAppStore.getState().activeTool;

    if (tool === 'card') {
      // 연필과 같은 이유로 기본 동작을 막는다 — 그대로 두면 뒤따르는 mousedown이
      // 방금 띄운 입력창의 포커스를 빼앗고, 빈 카드라 곧바로 지워진다.
      event.preventDefault();
      const stamp = Date.now();
      const nodeId = `card-node-${stamp}`;
      createIdeaCard({
        fragmentId: `personal-${stamp}`,
        nodeId,
        // 누른 지점이 카드의 중심이 되도록 살짝 당긴다
        x: event.clientX - paneRect.left - CARD_WIDTH / 2,
        y: event.clientY - paneRect.top - CARD_GRAB_OFFSET_Y,
      });
      setEditingCardNodeId(nodeId);
      return;
    }

    if (tool === 'pencil') {
      // pointerdown의 기본 동작을 막아 뒤따르는 mousedown이 발생하지 않게 한다.
      // 그대로 두면 mousedown이 "클릭한 요소로 포커스 이동"을 수행하면서 방금 띄운
      // 메모 입력창의 포커스를 빼앗고, 빈 메모라 곧바로 지워져 사용자에게는
      // "클릭했는데 아무 일도 안 일어남"으로 보인다.
      event.preventDefault();
      const memoId = `memo-${Date.now()}`;
      // 툴바에서 고른 크기 단계로 시작한다
      const preset = memoStylePreset(useAppStore.getState().memoTextStyle);
      addMemo({
        id: memoId,
        x: event.clientX - paneRect.left,
        y: event.clientY - paneRect.top,
        text: '',
        width: preset.width,
        height: preset.height,
        textStyle: preset.kind,
      });
      setEditingMemoId(memoId);
      return;
    }

    if (tool !== 'select') {
      clearSelection();
      return;
    }

    clearSelection();
    const startX = event.clientX - paneRect.left;
    const startY = event.clientY - paneRect.top;
    dragRef.current = { kind: 'box', startX, startY, currentX: startX, currentY: startY };
    safelySetPointerCapture(event.currentTarget, event.pointerId);
  }

  function handlePointerMove(event: ReactPointerEvent<HTMLElement | SVGElement>) {
    const drag = dragRef.current;
    if (!drag) return;

    if (drag.kind === 'box') {
      const paneRect = paneRef.current?.getBoundingClientRect();
      if (!paneRect) return;
      drag.currentX = event.clientX - paneRect.left;
      drag.currentY = event.clientY - paneRect.top;
      setBoxRect({
        x: Math.min(drag.startX, drag.currentX),
        y: Math.min(drag.startY, drag.currentY),
        width: Math.abs(drag.currentX - drag.startX),
        height: Math.abs(drag.currentY - drag.startY),
      });
      return;
    }

    const dx = event.clientX - drag.lastX;
    const dy = event.clientY - drag.lastY;
    drag.lastX = event.clientX;
    drag.lastY = event.clientY;
    drag.movedPx += Math.abs(dx) + Math.abs(dy);

    if (drag.kind === 'memo') moveMemoBy(drag.memoId, dx, dy);
    else moveNodesBy(drag.nodeIds, dx, dy);
  }

  function handlePointerUp(event: ReactPointerEvent<HTMLElement | SVGElement>) {
    const drag = dragRef.current;
    dragRef.current = null;
    if (!drag) return;

    if (drag.kind === 'box') {
      setBoxRect(null);
      const selection: Rect = {
        x: Math.min(drag.startX, drag.currentX),
        y: Math.min(drag.startY, drag.currentY),
        width: Math.abs(drag.currentX - drag.startX),
        height: Math.abs(drag.currentY - drag.startY),
      };
      if (selection.width < DRAG_THRESHOLD_PX && selection.height < DRAG_THRESHOLD_PX) return;
      const hitNodeIds = nodes
        .filter((n) => {
          const rect = measuredRect(n.id);
          return rect && rectsIntersect(rect, selection);
        })
        .map((n) => n.id);
      const hitMemoIds = memos
        .filter((m) => rectsIntersect({ x: m.x, y: m.y, width: m.width, height: m.height }, selection))
        .map((m) => m.id);
      setSelection({ nodeIds: hitNodeIds, memoIds: hitMemoIds, threadIds: [], pouchIds: [] });
      return;
    }

    if (drag.kind === 'node' || drag.kind === 'pouch') {
      // 캔버스 밖(수면 쪽)으로 끌어냈으면 놓아준다
      const paneRect = paneRef.current?.getBoundingClientRect();
      const droppedOutside =
        !!paneRect &&
        (event.clientX < paneRect.left ||
          event.clientX > paneRect.right ||
          event.clientY < paneRect.top ||
          event.clientY > paneRect.bottom);
      if (droppedOutside) removeNodes(drag.nodeIds);
    }
  }

  // ---- 실타래 클릭 판정 ----
  function handleThreadPointerDown(event: ReactPointerEvent<SVGLineElement>, threadId: string) {
    event.stopPropagation();
    if (useAppStore.getState().activeTool !== 'select') return;
    setSelection({ threadIds: [threadId], nodeIds: [], pouchIds: [], memoIds: [] });
  }

  // ---- 내보내기 ----
  function computeContentBounds(): ContentBounds | null {
    const rects: Rect[] = [];
    nodes.forEach((n) => {
      const r = measuredRect(n.id);
      if (r) rects.push(r);
    });
    memos.forEach((m) => rects.push({ x: m.x, y: m.y, width: m.width, height: m.height }));
    if (rects.length === 0) return null;
    return {
      minX: Math.min(...rects.map((r) => r.x)),
      minY: Math.min(...rects.map((r) => r.y)),
      maxX: Math.max(...rects.map((r) => r.x + r.width)),
      maxY: Math.max(...rects.map((r) => r.y + r.height)),
    };
  }

  function dateStamp() {
    return new Date().toISOString().slice(0, 10);
  }

  async function handleExportPng() {
    const bounds = computeContentBounds();
    if (!bounds || !paneRef.current) return;
    const dataUrl = await exportCanvasPng(paneRef.current, bounds);
    const a = document.createElement('a');
    a.href = dataUrl;
    a.download = `fishing-pond-${dateStamp()}.png`;
    a.click();
  }

  const isCanvasEmpty = nodes.length === 0 && memos.length === 0;

  const pouchShapes = useMemo(
    () =>
      pouches.map((pouch) => {
        const rects = pouch.nodeIds
          .map((id) => measuredRect(id))
          .filter((r): r is Rect => r !== null);
        const hull = pouchHull(rects, POUCH_PADDING);
        const centerX = hull.reduce((sum, p) => sum + p.x, 0) / (hull.length || 1);
        const topY = Math.min(...hull.map((p) => p.y));
        return { pouch, path: closedSmoothPath(hull, 1), labelX: centerX, labelY: topY };
      }),
    // 노드 위치가 바뀌면 hull도 즉시 다시 계산돼야 한다
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [pouches, nodes],
  );

  return (
    <div
      className={styles.pane}
      ref={setPaneRef}
      data-canvas-pane
      data-tool={activeTool}
      onPointerDown={handlePanePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
    >
      <Toolbar />

      <div
        className={styles.exportBar}
        data-export-hide
        onPointerDown={(event) => event.stopPropagation()}
      >
        <button type="button" disabled={isCanvasEmpty} onClick={handleExportPng}>
          PNG로 내보내기
        </button>
      </div>

      {nodes.length === 0 && memos.length === 0 && (
        <p className={styles.emptyHint}>마음에 드는 조각을 여기로 끌어오세요</p>
      )}

      {/* 레이어 순서 (아래→위): 주머니 배경 → 실타래 → 노드 → 메모 → 선택 UI */}
      <svg className={styles.overlay}>
        {pouchShapes.map(({ pouch, path }) => (
          <path
            key={pouch.id}
            d={path}
            className={`${styles.pouchShape} ${
              selectedPouchIds.includes(pouch.id) ? styles.pouchShapeSelected : ''
            }`}
            onPointerDown={(event) => handlePouchPointerDown(event, pouch.id)}
          />
        ))}

        {threads.map((thread) => {
          const from = nodeCenter(thread.fromNodeId);
          const to = nodeCenter(thread.toNodeId);
          if (!from || !to) return null;
          const isActive =
            selectedThreadIds.includes(thread.id) || hoveredThreadId === thread.id;
          return (
            <g key={thread.id}>
              {/* 클릭·hover 판정을 넉넉하게 받기 위한 투명한 두꺼운 선 */}
              <line
                x1={from.x}
                y1={from.y}
                x2={to.x}
                y2={to.y}
                className={styles.threadHitArea}
                onPointerDown={(event) => handleThreadPointerDown(event, thread.id)}
                onPointerEnter={() => setHoveredThreadId(thread.id)}
                onPointerLeave={() =>
                  setHoveredThreadId((current) => (current === thread.id ? null : current))
                }
              />
              <line
                x1={from.x}
                y1={from.y}
                x2={to.x}
                y2={to.y}
                className={`${styles.thread} ${isActive ? styles.threadActive : ''}`}
              />
            </g>
          );
        })}
      </svg>

      {/* 주머니 라벨은 SVG 밖에 둔다 — 입력을 붙이기 쉽다 */}
      {pouchShapes.map(({ pouch, labelX, labelY }) => (
        <div
          key={`label-${pouch.id}`}
          className={styles.pouchLabel}
          style={{ transform: `translate3d(${labelX}px, ${labelY - 26}px, 0)` }}
          onDoubleClick={() => setEditingPouchId(pouch.id)}
          onPointerDown={(event) => event.stopPropagation()}
        >
          {editingPouchId === pouch.id ? (
            <input
              autoFocus
              className={styles.pouchLabelInput}
              defaultValue={pouch.label ?? ''}
              placeholder="묶음 이름"
              onBlur={(event) => {
                updatePouchLabel(pouch.id, event.target.value.trim());
                setEditingPouchId(null);
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter') (event.target as HTMLInputElement).blur();
                if (event.key === 'Escape') setEditingPouchId(null);
              }}
            />
          ) : (
            pouch.label && <span className={styles.pouchLabelText}>{pouch.label}</span>
          )}
        </div>
      ))}

      {nodes.map((node) => {
        const fragment = fragments.get(node.fragmentId);
        if (!fragment) return null;
        const isSelected = selectedNodeIds.includes(node.id);
        const isPending =
          pendingPouchNodeIds.includes(node.id) || pendingThreadFromNodeId === node.id;
        return (
          <div
            key={node.id}
            className={`${styles.node} ${isSelected ? styles.nodeSelected : ''} ${
              isPending ? styles.nodePending : ''
            }`}
            style={{ transform: `translate3d(${node.x}px, ${node.y}px, 0)`, zIndex: node.z }}
            ref={(el) => {
              if (el) {
                nodeSizesRef.current.set(node.id, {
                  width: el.offsetWidth,
                  height: el.offsetHeight,
                });
              } else {
                nodeSizesRef.current.delete(node.id);
              }
            }}
            onPointerDown={(event) => handleNodePointerDown(event, node.id)}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            // 더블클릭: 이미지는 크게 보고, 직접 쓴 조각은 다시 고친다
            // (풀에서 낚아 온 문장은 원문 그대로 둔다)
            onDoubleClick={() => {
              if (fragment.kind === 'image') openImageZoom(fragment.id);
              else if (fragment.origin === 'personal') setEditingCardNodeId(node.id);
            }}
          >
            {fragment.kind === 'sentence' ? (
              <CardNodeText
                fragment={fragment}
                nodeId={node.id}
                isEditing={editingCardNodeId === node.id}
                onFinishEditing={() => setEditingCardNodeId(null)}
              />
            ) : (
              <img className={styles.nodeImage} src={fragment.imageUrl} alt="" draggable={false} />
            )}
          </div>
        );
      })}

      {memos.map((memo) => (
        <MemoItem
          key={memo.id}
          memo={memo}
          isSelected={selectedMemoIds.includes(memo.id)}
          isEditing={editingMemoId === memo.id}
          onStartEditing={() => setEditingMemoId(memo.id)}
          onFinishEditing={() => setEditingMemoId(null)}
          onPointerDown={handleMemoPointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
        />
      ))}

      <ImageZoom />

      {boxRect && (
        <div
          className={styles.selectionBox}
          data-export-hide
          style={{
            transform: `translate3d(${boxRect.x}px, ${boxRect.y}px, 0)`,
            width: boxRect.width,
            height: boxRect.height,
          }}
        />
      )}
    </div>
  );
});
