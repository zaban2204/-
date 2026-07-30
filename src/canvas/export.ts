// 캔버스 상태를 마크다운/PNG로 내보낸다 (Phase 6, PRD 5항).
// 좌표 덤프를 나열하지 않고 사람이 읽을 수 있는 순서로 재구성한다:
// 주머니별 섹션 → 낱개 조각 → 실타래 관계 → 메모. 좌표는 문서 끝 layout 주석에만 둔다.

import { toPng } from 'html-to-image';
import type { CanvasNode, Thread, Pouch, Memo, Fragment } from '../types';

interface ExportInput {
  nodes: CanvasNode[];
  threads: Thread[];
  pouches: Pouch[];
  memos: Memo[];
  fragments: Map<string, Fragment>;
}

function excerpt(fragment: Fragment | undefined, len = 20): string {
  if (!fragment) return '(알 수 없는 조각)';
  const raw = fragment.kind === 'sentence' ? (fragment.text ?? '') : (fragment.caption ?? fragment.title ?? '');
  return raw.length > len ? `${raw.slice(0, len)}…` : raw;
}

export function buildCanvasMarkdown({ nodes, threads, pouches, memos, fragments }: ExportInput): string {
  const lines: string[] = [];
  const footnoteFragments: Fragment[] = [];
  const pouchedNodeIds = new Set(pouches.flatMap((p) => p.nodeIds));
  const nodeById = new Map(nodes.map((n) => [n.id, n]));

  function renderNodeBullet(node: CanvasNode): string {
    const fragment = fragments.get(node.fragmentId);
    if (!fragment) return `- (알 수 없는 조각: ${node.fragmentId})`;
    if (fragment.kind === 'image') {
      footnoteFragments.push(fragment);
      const idx = footnoteFragments.length;
      return `- ![${fragment.caption ?? fragment.title ?? ''}](${fragment.imageUrl ?? ''})[^${idx}]`;
    }
    return `- ${fragment.text ?? ''}`;
  }

  lines.push('# 낚시터에서 엮은 것들');
  lines.push('');
  lines.push(`내보낸 날짜: ${new Date().toISOString().slice(0, 10)}`);
  lines.push('');

  // 주머니별 섹션 (주머니 라벨 → 멤버 조각 목록)
  pouches.forEach((pouch, i) => {
    lines.push(`## ${pouch.label ? pouch.label : `이름 없는 묶음 ${i + 1}`}`);
    lines.push('');
    pouch.nodeIds.forEach((nodeId) => {
      const node = nodeById.get(nodeId);
      if (node) lines.push(renderNodeBullet(node));
    });
    lines.push('');
  });

  // 주머니에 속하지 않은 낱개 조각
  const loneNodes = nodes.filter((n) => !pouchedNodeIds.has(n.id));
  if (loneNodes.length > 0) {
    lines.push('## 낱개 조각');
    lines.push('');
    loneNodes.forEach((node) => lines.push(renderNodeBullet(node)));
    lines.push('');
  }

  // 실타래 관계 목록
  if (threads.length > 0) {
    lines.push('## 실타래');
    lines.push('');
    threads.forEach((thread) => {
      const a = nodeById.get(thread.fromNodeId);
      const b = nodeById.get(thread.toNodeId);
      const aFrag = a ? fragments.get(a.fragmentId) : undefined;
      const bFrag = b ? fragments.get(b.fragmentId) : undefined;
      lines.push(`- ${excerpt(aFrag)} ↔ ${excerpt(bFrag)}`);
    });
    lines.push('');
  }

  // 메모
  if (memos.length > 0) {
    lines.push('## 메모');
    lines.push('');
    memos.forEach((memo) => lines.push(`- ${memo.text}`));
    lines.push('');
  }

  // 이미지 출처/라이선스 각주
  if (footnoteFragments.length > 0) {
    footnoteFragments.forEach((fragment, i) => {
      const label = [fragment.title, fragment.artist].filter(Boolean).join(', ');
      const src = fragment.sourceUrl ? ` 출처: ${fragment.sourceUrl}` : '';
      const lic = fragment.license ? ` (${fragment.license})` : '';
      lines.push(`[^${i + 1}]: ${label}${src}${lic}`);
    });
    lines.push('');
  }

  // 좌표·구조 정보는 재구성 가능한 스냅샷으로 여기에만 남긴다 (읽기를 방해하지 않도록)
  const layout = { nodes, threads, pouches, memos };
  lines.push('<!-- layout');
  lines.push(JSON.stringify(layout, null, 2));
  lines.push('-->');
  lines.push('');

  return lines.join('\n');
}

export function downloadTextFile(filename: string, content: string, mimeType = 'text/markdown') {
  const blob = new Blob([content], { type: `${mimeType};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

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
