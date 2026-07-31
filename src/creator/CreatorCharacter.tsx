import { useAppStore } from '../store';
import styles from './CreatorCharacter.module.css';

// 화면 가운데 위쪽에 자리한 '창작자' 캐릭터.
// 조각을 캔버스에 낚아 올릴 때마다 store.swingSignal이 증가하고,
// 그 값을 key로 써서 낚싯대 휘두르는 CSS 애니메이션을 매번 처음부터 재생시킨다.
export function CreatorCharacter() {
  const swingSignal = useAppStore((s) => s.swingSignal);

  return (
    <div className={styles.wrap} aria-hidden="true">
      <svg
        key={swingSignal}
        className={styles.figure}
        viewBox="0 0 160 160"
        width="160"
        height="160"
      >
        {/* 몸 */}
        <circle cx="80" cy="58" r="26" className={styles.stroke} />
        <path d="M52 96 Q80 78 108 96 L104 140 Q80 152 56 140 Z" className={styles.stroke} />
        {/* 표정 */}
        <circle cx="71" cy="55" r="2.4" className={styles.fillDark} />
        <circle cx="89" cy="55" r="2.4" className={styles.fillDark} />
        <path d="M70 65 Q80 71 90 65" className={styles.strokeThin} />
        {/* 낚싯대 팔 (휘두르는 그룹) */}
        <g className={styles.rodArm}>
          <path d="M100 88 Q118 84 128 66" className={styles.stroke} />
          <line x1="128" y1="66" x2="150" y2="18" className={styles.rod} />
          <path d="M150 18 Q140 46 118 58" className={styles.line} />
        </g>
        {/* 반대쪽 팔 */}
        <path d="M60 90 Q44 96 40 112" className={styles.stroke} />
      </svg>
    </div>
  );
}
