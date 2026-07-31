import type { PointerEvent as ReactPointerEvent } from 'react';
import { useAppStore } from '../store';
import type { Memo } from '../types';
import { memoStylePreset } from './memoStyles';
import { useDeferredFocus } from './useDeferredFocus';
import styles from './canvas.module.css';

interface MemoItemProps {
  memo: Memo;
  isSelected: boolean;
  isEditing: boolean;
  onStartEditing: () => void;
  onFinishEditing: () => void;
  onPointerDown: (event: ReactPointerEvent<HTMLDivElement>, memoId: string) => void;
  onPointerMove: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onPointerUp: (event: ReactPointerEvent<HTMLDivElement>) => void;
}

// 연필 메모. 자유 드로잉이 아니라 텍스트 메모다 (PRD 4항 "메모를 할 수도").
// 조각(포스트잇)과 혼동되지 않도록 배경 없이 둔다.
export function MemoItem({
  memo,
  isSelected,
  isEditing,
  onStartEditing,
  onFinishEditing,
  onPointerDown,
  onPointerMove,
  onPointerUp,
}: MemoItemProps) {
  const updateMemo = useAppStore((s) => s.updateMemo);
  const removeMemos = useAppStore((s) => s.removeMemos);
  const { ref: textareaRef, hasFocusedRef } = useDeferredFocus<HTMLTextAreaElement>(isEditing);

  function finish(text: string) {
    const trimmed = text.trim();
    // 빈 메모는 남겨두면 캔버스에 보이지 않는 유령이 된다
    if (trimmed.length === 0) removeMemos([memo.id]);
    else if (trimmed !== memo.text) updateMemo(memo.id, trimmed);
    onFinishEditing();
  }

  // 제목/소제목/본문 — 크기 단계에 따라 글자 크기가 달라진다
  const sizeClass = styles[`memo_${memoStylePreset(memo.textStyle).kind}`];

  return (
    <div
      className={`${styles.memo} ${sizeClass} ${isSelected ? styles.memoSelected : ''}`}
      style={{ transform: `translate3d(${memo.x}px, ${memo.y}px, 0)`, width: memo.width }}
      onPointerDown={(event) => {
        if (isEditing) return;
        onPointerDown(event, memo.id);
      }}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onDoubleClick={onStartEditing}
      onContextMenu={(event) => {
        // 선택(이동) 도구에서 메모를 우클릭하면 곧바로 지운다. 브라우저 기본
        // 우클릭 메뉴가 뜨지 않도록 막는다.
        event.preventDefault();
        if (isEditing) return;
        if (useAppStore.getState().activeTool !== 'select') return;
        removeMemos([memo.id]);
      }}
    >
      {isEditing ? (
        <textarea
          ref={textareaRef}
          className={styles.memoInput}
          defaultValue={memo.text}
          placeholder={memoStylePreset(memo.textStyle).label}
          rows={1}
          onFocus={() => {
            hasFocusedRef.current = true;
          }}
          onBlur={(event) => {
            // 아직 포커스를 잡아본 적이 없다면 브라우저가 포커스를 가져간 것이다.
            // 여기서 빈 메모를 지우면 사용자에겐 아무 일도 없었던 것처럼 보이므로,
            // 입력창을 열어둔 채 두어 다시 눌러 쓸 수 있게 한다.
            if (!hasFocusedRef.current) return;
            finish(event.target.value);
          }}
          onKeyDown={(event) => {
            // Enter로 확정, Shift+Enter로 줄바꿈
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault();
              (event.target as HTMLTextAreaElement).blur();
            }
            if (event.key === 'Escape') (event.target as HTMLTextAreaElement).blur();
          }}
        />
      ) : (
        <span className={styles.memoText}>{memo.text}</span>
      )}
    </div>
  );
}
