// 캔버스 상태를 PNG로 내보낸다 (Phase 6, PRD 5항).

import { toPng } from 'html-to-image';

export interface ContentBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

const PNG_PADDING = 64;
const PNG_PIXEL_RATIO = 2;

// 캔버스 DOM을 컨텐츠 바운딩 박스 + 여백만큼만 잘라 PNG로 캡처한다.
// 선택 UI·툴바처럼 [data-export-hide]가 붙은 요소는 제외한다.
export async function exportCanvasPng(paneEl: HTMLElement, bounds: ContentBounds): Promise<string> {
  const width = Math.ceil(bounds.maxX - bounds.minX) + PNG_PADDING * 2;
  const height = Math.ceil(bounds.maxY - bounds.minY) + PNG_PADDING * 2;
  const offsetX = bounds.minX - PNG_PADDING;
  const offsetY = bounds.minY - PNG_PADDING;

  return toPng(paneEl, {
    width,
    height,
    pixelRatio: PNG_PIXEL_RATIO,
    style: {
      transform: `translate(${-offsetX}px, ${-offsetY}px)`,
      transformOrigin: 'top left',
    },
    filter: (node) => {
      if (node instanceof Element && node.getAttribute('data-export-hide') !== null) {
        return false;
      }
      return true;
    },
  });
}
