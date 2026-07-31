import type { MemoTextStyle } from '../types';

// 메모의 세 단계 크기. 툴바 선택기·새 메모 기본 크기·CSS 클래스가 모두
// 여기 한 곳을 본다 (표시 이름과 실제 크기가 어긋나지 않게).
export interface MemoStylePreset {
  kind: MemoTextStyle;
  label: string;
  width: number;
  height: number;
}

export const MEMO_STYLE_PRESETS: MemoStylePreset[] = [
  { kind: 'title', label: '제목', width: 320, height: 40 },
  { kind: 'subtitle', label: '소제목', width: 260, height: 30 },
  { kind: 'body', label: '본문', width: 200, height: 24 },
];

export function memoStylePreset(style: MemoTextStyle | undefined): MemoStylePreset {
  return MEMO_STYLE_PRESETS.find((p) => p.kind === style) ?? MEMO_STYLE_PRESETS[2];
}
