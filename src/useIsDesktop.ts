import { useEffect, useState } from 'react';

const MIN_DESKTOP_WIDTH = 1024;

export function useIsDesktop(): boolean {
  const [isDesktop, setIsDesktop] = useState(
    () => window.innerWidth >= MIN_DESKTOP_WIDTH,
  );

  useEffect(() => {
    const onResize = () => setIsDesktop(window.innerWidth >= MIN_DESKTOP_WIDTH);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  return isDesktop;
}
