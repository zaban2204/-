import { useEffect, useRef } from 'react';
import { useAppStore } from '../store';
import styles from './canvas.module.css';

// 이미지 조각을 크게 보는 창. 캔버스 위 이미지 조각을 더블클릭하면 열린다.
// 배경을 누르거나 Escape로 닫는다.
export function ImageZoom() {
  const zoomedFragmentId = useAppStore((s) => s.zoomedFragmentId);
  const fragments = useAppStore((s) => s.fragments);
  const closeImageZoom = useAppStore((s) => s.closeImageZoom);
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  const fragment = zoomedFragmentId ? fragments.get(zoomedFragmentId) : undefined;
  const isOpen = !!fragment && fragment.kind === 'image';

  useEffect(() => {
    if (!isOpen) return;
    // 창을 띄운 더블클릭이 이미 캔버스 쪽에 선택 범위를 만들어 놓았을 수 있다.
    // 남겨 두면 그 하이라이트가 그림 위까지 파랗게 번진다.
    window.getSelection()?.removeAllRanges();

    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== 'Escape') return;
      // 이 창이 열려 있는 동안 Escape는 여기서 멈춘다 (캔버스 쪽 단축키로 새지 않게)
      event.stopPropagation();
      closeImageZoom();
    }
    // 캔버스의 window 레벨 키 핸들러보다 먼저 받도록 캡처 단계에서 듣는다
    window.addEventListener('keydown', onKeyDown, true);
    closeButtonRef.current?.focus();
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [isOpen, closeImageZoom]);

  if (!isOpen || !fragment) return null;

  const credit = [fragment.title, fragment.artist].filter(Boolean).join(' — ');

  return (
    <div
      className={styles.zoomBackdrop}
      // PNG 내보내기에 이 창이 찍히면 안 된다
      data-export-hide
      role="dialog"
      aria-modal="true"
      aria-label={credit || '이미지 크게 보기'}
      // 캔버스 pane의 pointerdown(박스 선택 시작)까지 내려가지 않게 막는다
      onPointerDown={(event) => {
        event.stopPropagation();
        // 그림 자체가 아니라 배경을 눌렀을 때만 닫는다
        if (event.target === event.currentTarget) closeImageZoom();
      }}
    >
      <figure className={styles.zoomFigure}>
        <img className={styles.zoomImage} src={fragment.imageUrl} alt={credit} draggable={false} />
        <figcaption className={styles.zoomCaption}>
          {credit && <span className={styles.zoomCredit}>{credit}</span>}
          {fragment.caption && <span className={styles.zoomText}>{fragment.caption}</span>}
        </figcaption>
      </figure>

      <button
        ref={closeButtonRef}
        type="button"
        className={styles.zoomClose}
        title="닫기 (Esc)"
        aria-label="닫기"
        onPointerDown={(event) => event.stopPropagation()}
        onClick={closeImageZoom}
      >
        ✕
      </button>
    </div>
  );
}
