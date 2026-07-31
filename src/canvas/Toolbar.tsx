import { useAppStore } from '../store';
import type { ToolKind } from '../types';
import { MEMO_STYLE_PRESETS } from './memoStyles';
import styles from './canvas.module.css';

const TOOLS: { kind: ToolKind; icon: string; label: string; tooltip: string }[] = [
  { kind: 'select', icon: '↖', label: '선택', tooltip: '선택' },
  { kind: 'thread', icon: '⁄', label: '실타래', tooltip: '실타래: 잇기' },
  { kind: 'pouch', icon: '◯', label: '주머니', tooltip: '주머니: 묶기' },
  { kind: 'pencil', icon: '✎', label: '연필', tooltip: '연필: 메모' },
  { kind: 'card', icon: '▤', label: '카드', tooltip: '카드: 아이디어 조각 만들기' },
];

export function Toolbar() {
  const activeTool = useAppStore((s) => s.activeTool);
  const setActiveTool = useAppStore((s) => s.setActiveTool);
  const commitPouch = useAppStore((s) => s.commitPouch);
  const pendingPouchNodeIds = useAppStore((s) => s.pendingPouchNodeIds);
  const memoTextStyle = useAppStore((s) => s.memoTextStyle);
  const setMemoTextStyle = useAppStore((s) => s.setMemoTextStyle);

  return (
    <div
      className={styles.toolbar}
      data-export-hide
      // 이 pointerdown이 캔버스 pane까지 버블링되면, '선택' 도구일 때 pane이
      // 박스 선택을 시작하며 포인터를 스스로 캡처해 버린다 — 그러면 이어지는
      // mouseup/click이 버튼이 아니라 pane으로 재지정되어 버튼의 onClick이
      // 전혀 발생하지 않는다(마우스로는 항상 실패, 프로그램적 .click()만 통과).
      onPointerDown={(event) => event.stopPropagation()}
    >
      {TOOLS.map((tool) => {
        const isActive = activeTool === tool.kind;
        return (
          <button
            key={tool.kind}
            type="button"
            className={`${styles.toolButton} ${isActive ? styles.toolButtonActive : ''}`}
            title={tool.tooltip}
            aria-label={tool.tooltip}
            aria-pressed={isActive}
            onClick={() => {
              // 주머니 도구를 다시 누르면 진행 중인 묶음을 확정한다
              if (isActive && tool.kind === 'pouch') {
                commitPouch();
                return;
              }
              setActiveTool(tool.kind);
            }}
          >
            <span aria-hidden="true">{tool.icon}</span>
          </button>
        );
      })}
      {/* 연필을 누르면 먼저 크기를 고른다 — 고른 크기로 곧바로 쓰기 시작할 수 있다 */}
      {activeTool === 'pencil' && (
        <div className={styles.memoStylePicker} role="group" aria-label="메모 글자 크기">
          {MEMO_STYLE_PRESETS.map((preset) => {
            const isActive = memoTextStyle === preset.kind;
            return (
              <button
                key={preset.kind}
                type="button"
                className={`${styles.memoStyleButton} ${styles[`memoStyleButton_${preset.kind}`]} ${
                  isActive ? styles.memoStyleButtonActive : ''
                }`}
                title={`${preset.label} 크기로 메모`}
                aria-label={`${preset.label} 크기`}
                aria-pressed={isActive}
                // 메모를 쓰는 중에 크기를 바꿀 수도 있다. 기본 동작(누른 요소로 포커스 이동)을
                // 막지 않으면 입력창이 포커스를 잃고, 아직 빈 메모는 그대로 지워져 버린다.
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => setMemoTextStyle(preset.kind)}
              >
                {preset.label}
              </button>
            );
          })}
          <span className={styles.toolHint}>크기를 고르고 빈 곳을 누르세요</span>
        </div>
      )}

      {activeTool === 'pouch' && pendingPouchNodeIds.length > 0 && (
        <span className={styles.toolHint}>
          {pendingPouchNodeIds.length}개 선택 — Enter로 묶기
        </span>
      )}
      {activeTool === 'thread' && (
        <span className={styles.toolHint}>조각 둘을 차례로 누르세요</span>
      )}
      {activeTool === 'card' && (
        <span className={styles.toolHint}>빈 곳을 눌러 새 조각을 쓰세요</span>
      )}
    </div>
  );
}
