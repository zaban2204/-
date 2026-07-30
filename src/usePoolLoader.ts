import { useEffect } from 'react';
import { useAppStore } from './store';
import type { Fragment } from './types';

// pool.json은 빌드타임 스크립트(scripts/build-pool.ts)가 생성한 정적 파일이다.
export function usePoolLoader() {
  const loadPool = useAppStore((s) => s.loadPool);

  useEffect(() => {
    let cancelled = false;
    fetch('/pool.json')
      .then((res) => res.json())
      .then((data: Fragment[]) => {
        if (!cancelled) loadPool(data);
      })
      .catch((err) => {
        console.error('[usePoolLoader] pool.json 로드 실패', err);
      });
    return () => {
      cancelled = true;
    };
  }, [loadPool]);
}
