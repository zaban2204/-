// 주머니(묶음)를 감싸는 부드러운 형태를 계산한다.

export interface Point {
  x: number;
  y: number;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

// Andrew's monotone chain. 반시계/시계 일관성만 있으면 되므로 하한+상한을 이어붙인다.
export function convexHull(points: Point[]): Point[] {
  if (points.length < 3) return [...points];

  const sorted = [...points].sort((a, b) => (a.x === b.x ? a.y - b.y : a.x - b.x));
  const cross = (o: Point, a: Point, b: Point) =>
    (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);

  const lower: Point[] = [];
  for (const p of sorted) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) {
      lower.pop();
    }
    lower.push(p);
  }

  const upper: Point[] = [];
  for (let i = sorted.length - 1; i >= 0; i--) {
    const p = sorted[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) {
      upper.pop();
    }
    upper.push(p);
  }

  lower.pop();
  upper.pop();
  return [...lower, ...upper];
}

// 멤버 노드들을 감싸는 hull. 사각형을 먼저 padding만큼 부풀린 뒤 그 꼭지점들의 hull을
// 구한다 — hull을 구한 다음 밖으로 밀어내는 방식보다 정확하다(길고 가는 묶음에서
// 중심 기준으로 밀면 여백이 고르지 않다).
export function pouchHull(rects: Rect[], padding: number): Point[] {
  const corners: Point[] = [];
  for (const r of rects) {
    const left = r.x - padding;
    const right = r.x + r.width + padding;
    const top = r.y - padding;
    const bottom = r.y + r.height + padding;
    corners.push({ x: left, y: top }, { x: right, y: top }, { x: right, y: bottom }, { x: left, y: bottom });
  }
  return convexHull(corners);
}

// 닫힌 Catmull-Rom 스플라인을 3차 베지에로 바꿔 코너를 둥글게 만든다.
// tension이 작을수록 각이 살고, 클수록 뭉툭해진다.
export function closedSmoothPath(points: Point[], tension = 1): string {
  if (points.length === 0) return '';
  if (points.length === 1) {
    const { x, y } = points[0];
    return `M ${x} ${y}`;
  }
  if (points.length === 2) {
    return `M ${points[0].x} ${points[0].y} L ${points[1].x} ${points[1].y} Z`;
  }

  const n = points.length;
  const at = (i: number) => points[(i + n) % n];
  const k = tension / 6;

  let path = `M ${points[0].x} ${points[0].y}`;
  for (let i = 0; i < n; i++) {
    const p0 = at(i - 1);
    const p1 = at(i);
    const p2 = at(i + 1);
    const p3 = at(i + 2);
    const c1 = { x: p1.x + (p2.x - p0.x) * k, y: p1.y + (p2.y - p0.y) * k };
    const c2 = { x: p2.x - (p3.x - p1.x) * k, y: p2.y - (p3.y - p1.y) * k };
    path += ` C ${c1.x} ${c1.y} ${c2.x} ${c2.y} ${p2.x} ${p2.y}`;
  }
  return `${path} Z`;
}

export function rectsIntersect(a: Rect, b: Rect): boolean {
  return (
    a.x < b.x + b.width &&
    a.x + a.width > b.x &&
    a.y < b.y + b.height &&
    a.y + a.height > b.y
  );
}

// 선분에서 점까지의 거리 — 실타래 hover/클릭 판정에 쓴다
export function distanceToSegment(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared === 0) return Math.hypot(p.x - a.x, p.y - a.y);
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / lengthSquared;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}
