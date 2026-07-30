import { memo } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import type { Fragment } from '../types';
import styles from './surface.module.css';

interface SurfaceCardProps {
  fragment: Fragment;
  initialX: number;
  initialY: number;
  initialRotation: number;
  registerRef: (el: HTMLDivElement | null) => void;
  onPointerDown: (event: ReactPointerEvent<HTMLDivElement>, fragmentId: string) => void;
  onPointerMove: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onPointerUp: (event: ReactPointerEvent<HTMLDivElement>) => void;
}

// 위치는 마운트 이후 부모의 rAF 루프가 DOM에 직접 쓴다 (transform/opacity).
// 이 컴포넌트 자신은 위치가 바뀔 때마다 리렌더되지 않는다.
function SurfaceCardImpl({
  fragment,
  initialX,
  initialY,
  initialRotation,
  registerRef,
  onPointerDown,
  onPointerMove,
  onPointerUp,
}: SurfaceCardProps) {
  return (
    <div
      ref={registerRef}
      className={styles.card}
      style={{
        transform: `translate3d(${initialX}px, ${initialY}px, 0) rotate(${initialRotation}deg)`,
      }}
      data-fragment-id={fragment.id}
      onPointerDown={(event) => onPointerDown(event, fragment.id)}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    >
      {fragment.kind === 'sentence' ? (
        <p className={styles.cardText}>{fragment.text}</p>
      ) : (
        <img className={styles.cardImage} src={fragment.imageUrl} alt="" draggable={false} />
      )}
    </div>
  );
}

export const SurfaceCard = memo(SurfaceCardImpl);
