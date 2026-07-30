import { useRef } from 'react';
import styles from './App.module.css';
import { useIsDesktop } from './useIsDesktop';
import { usePoolLoader } from './usePoolLoader';
import { SurfaceLayer } from './surface/SurfaceLayer';
import { CanvasLayer } from './canvas/CanvasLayer';

function App() {
  const isDesktop = useIsDesktop();
  const canvasPaneRef = useRef<HTMLDivElement>(null);
  usePoolLoader();

  if (!isDesktop) {
    return (
      <div className={styles.desktopOnly}>
        <p>데스크톱에서 이용해주세요.</p>
      </div>
    );
  }

  return (
    <div className={styles.layout}>
      <div className={styles.canvasPane}>
        <CanvasLayer ref={canvasPaneRef} />
      </div>
      <div className={styles.surfacePane}>
        <SurfaceLayer canvasPaneRef={canvasPaneRef} />
      </div>
    </div>
  );
}

export default App;
