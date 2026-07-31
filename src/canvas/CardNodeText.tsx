import { useAppStore } from '../store';
import type { Fragment } from '../types';
import { useDeferredFocus } from './useDeferredFocus';
import styles from './canvas.module.css';

interface CardNodeTextProps {
  fragment: Fragment;
  nodeId: string;
  isEditing: boolean;
  onFinishEditing: () => void;
}

// 카드 도구로 만든 조각의 본문. 수면에서 낚아 온 조각과 겉모습은 같고,
// 직접 쓴 조각(personal)일 때만 글을 고칠 수 있다.
export function CardNodeText({ fragment, nodeId, isEditing, onFinishEditing }: CardNodeTextProps) {
  const updateFragmentText = useAppStore((s) => s.updateFragmentText);
  const removeNodes = useAppStore((s) => s.removeNodes);
  const removePersonalFragment = useAppStore((s) => s.removePersonalFragment);
  const { ref, hasFocusedRef } = useDeferredFocus<HTMLTextAreaElement>(isEditing);

  function finish(text: string) {
    const trimmed = text.trim();
    // 빈 카드는 캔버스에 아무 말도 하지 않는 흰 종이로 남는다 — 조각과 노드를 함께 거둔다
    if (trimmed.length === 0) {
      removeNodes([nodeId]);
      removePersonalFragment(fragment.id);
    } else if (trimmed !== fragment.text) {
      updateFragmentText(fragment.id, trimmed);
    }
    onFinishEditing();
  }

  if (!isEditing) return <p className={styles.nodeText}>{fragment.text}</p>;

  return (
    <textarea
      ref={ref}
      className={styles.cardInput}
      defaultValue={fragment.text}
      placeholder="떠오른 생각"
      rows={3}
      onFocus={() => {
        hasFocusedRef.current = true;
      }}
      onBlur={(event) => {
        if (!hasFocusedRef.current) return;
        finish(event.target.value);
      }}
      onKeyDown={(event) => {
        // 카드 본문은 여러 줄이 자연스럽다 — Enter는 줄바꿈, 확정은 Ctrl+Enter나 Escape
        if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
          event.preventDefault();
          (event.target as HTMLTextAreaElement).blur();
        }
        if (event.key === 'Escape') (event.target as HTMLTextAreaElement).blur();
      }}
      // 편집 중에는 노드 드래그·박스 선택이 끼어들지 않게 한다
      onPointerDown={(event) => event.stopPropagation()}
    />
  );
}
