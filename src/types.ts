// 도메인 타입 — Phase 0. 로직 없음, 형태만 정의한다.

export type FragmentKind = 'sentence' | 'image';
export type FragmentOrigin = 'base' | 'personal';

export interface Fragment {
  id: string;
  kind: FragmentKind;
  text?: string;
  imageUrl?: string;
  caption?: string;
  origin: FragmentOrigin;
  neighborIds: string[];
  // 이미지 조각의 출처 표기용 (내보내기 각주에 쓰인다). 문장 조각엔 없다.
  title?: string;
  artist?: string;
  sourceUrl?: string;
  license?: string;
}

// 수면 위에 떠 있는 조각 인스턴스. Fragment 자체가 아니라 참조 + 위치/속도 상태를 갖는다.
export interface SurfaceFragment {
  fragmentId: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  rotation: number;
  spawnedAt: number;
  touched: boolean;
}

export interface CanvasNode {
  id: string;
  fragmentId: string;
  x: number;
  y: number;
  z: number;
}

// 실타래 = 두 조각을 잇는 직선
export interface Thread {
  id: string;
  fromNodeId: string;
  toNodeId: string;
}

// 주머니 = 조각 묶음
export interface Pouch {
  id: string;
  nodeIds: string[];
  label?: string;
}

// 메모 글자 크기. 자유로운 pt 값 대신 세 단계로 묶어 둔다 — 캔버스 위에서
// 무엇이 제목이고 무엇이 곁가지인지가 크기만으로 읽히면 그걸로 충분하다.
export type MemoTextStyle = 'title' | 'subtitle' | 'body';

export interface Memo {
  id: string;
  x: number;
  y: number;
  text: string;
  width: number;
  height: number;
  // 없으면 '본문'으로 본다 (이 필드가 없던 시절의 메모 호환)
  textStyle?: MemoTextStyle;
}

export type ToolKind = 'select' | 'thread' | 'pouch' | 'pencil' | 'card';
