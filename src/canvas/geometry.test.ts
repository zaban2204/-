import { describe, it, expect } from 'vitest';
import { convexHull, pouchHull, closedSmoothPath, rectsIntersect, distanceToSegment } from './geometry';

describe('convexHull', () => {
  it('내부 점을 제외하고 사각형 4점만 남긴다', () => {
    const hull = convexHull([
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
      { x: 0, y: 10 },
      { x: 5, y: 5 }, // 내부 점
    ]);
    expect(hull).toHaveLength(4);
    expect(hull).not.toContainEqual({ x: 5, y: 5 });
  });

  it('점이 2개 이하면 그대로 반환한다 (축퇴 케이스)', () => {
    expect(convexHull([])).toEqual([]);
    expect(convexHull([{ x: 1, y: 1 }])).toEqual([{ x: 1, y: 1 }]);
    expect(convexHull([{ x: 0, y: 0 }, { x: 1, y: 1 }])).toHaveLength(2);
  });

  it('일직선 위의 점들은 양 끝만 남긴다', () => {
    const hull = convexHull([{ x: 0, y: 0 }, { x: 5, y: 0 }, { x: 10, y: 0 }]);
    expect(hull).toHaveLength(2);
  });

  it('삼각형은 3점 모두 유지한다', () => {
    const hull = convexHull([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 5, y: 10 }]);
    expect(hull).toHaveLength(3);
  });
});

describe('pouchHull', () => {
  it('노드 사각형을 padding만큼 정확히 부풀린 뒤 hull을 구한다', () => {
    const rects = [
      { x: 100, y: 100, width: 190, height: 150 },
      { x: 400, y: 300, width: 190, height: 150 },
    ];
    const hull = pouchHull(rects, 24);
    const xs = hull.map((p) => p.x);
    const ys = hull.map((p) => p.y);
    // 첫 번째 사각형 좌상단(100,100)과 두 번째 사각형 우하단(590,450)에서
    // 패딩 24px만큼 바깥으로 나간 경계와 정확히 일치해야 한다
    expect(Math.min(...xs)).toBe(76); // 100 - 24
    expect(Math.max(...xs)).toBe(614); // 400 + 190 + 24
    expect(Math.min(...ys)).toBe(76); // 100 - 24
    expect(Math.max(...ys)).toBe(474); // 300 + 150 + 24
  });

  it('사각형이 하나뿐이면 그 padding된 4개 꼭짓점을 그대로 감싼다', () => {
    const hull = pouchHull([{ x: 0, y: 0, width: 100, height: 50 }], 10);
    expect(hull).toHaveLength(4);
    const xs = hull.map((p) => p.x);
    const ys = hull.map((p) => p.y);
    expect(Math.min(...xs)).toBe(-10);
    expect(Math.max(...xs)).toBe(110);
    expect(Math.min(...ys)).toBe(-10);
    expect(Math.max(...ys)).toBe(60);
  });
});

describe('closedSmoothPath', () => {
  it('점이 없으면 빈 문자열을 반환한다', () => {
    expect(closedSmoothPath([])).toBe('');
  });

  it('점 1개는 이동 명령만 낸다', () => {
    expect(closedSmoothPath([{ x: 1, y: 2 }])).toBe('M 1 2');
  });

  it('점 2개는 직선으로 닫는다', () => {
    const path = closedSmoothPath([{ x: 0, y: 0 }, { x: 10, y: 10 }]);
    expect(path).toBe('M 0 0 L 10 10 Z');
  });

  it('점 3개 이상은 M으로 시작해 Z로 닫히고 NaN이 없다', () => {
    const hull = pouchHull(
      [
        { x: 0, y: 0, width: 50, height: 50 },
        { x: 200, y: 150, width: 50, height: 50 },
      ],
      24,
    );
    const path = closedSmoothPath(hull, 1);
    expect(path.startsWith('M')).toBe(true);
    expect(path.endsWith('Z')).toBe(true);
    expect(path).not.toContain('NaN');
    // 점 개수만큼 3차 베지에 곡선 구간(C)이 있어야 한다
    expect((path.match(/C/g) ?? []).length).toBe(hull.length);
  });
});

describe('rectsIntersect', () => {
  const base = { x: 0, y: 0, width: 100, height: 100 };

  it('겹치는 사각형은 true', () => {
    expect(rectsIntersect(base, { x: 50, y: 50, width: 100, height: 100 })).toBe(true);
  });

  it('완전히 떨어진 사각형은 false', () => {
    expect(rectsIntersect(base, { x: 200, y: 200, width: 50, height: 50 })).toBe(false);
  });

  it('경계선만 맞닿으면(면적 0) false — 실제로 겹치는 것은 아니다', () => {
    expect(rectsIntersect(base, { x: 100, y: 0, width: 50, height: 50 })).toBe(false);
  });
});

describe('distanceToSegment', () => {
  it('점이 선분 중간 위쪽에 있으면 수직 거리를 반환한다', () => {
    expect(distanceToSegment({ x: 5, y: 5 }, { x: 0, y: 0 }, { x: 10, y: 0 })).toBe(5);
  });

  it('점이 선분 연장선 밖이면 가장 가까운 끝점까지의 거리를 반환한다', () => {
    expect(distanceToSegment({ x: 20, y: 0 }, { x: 0, y: 0 }, { x: 10, y: 0 })).toBe(10);
  });

  it('선분 길이가 0이면(점) 그 점까지의 직선 거리를 반환한다', () => {
    expect(distanceToSegment({ x: 3, y: 4 }, { x: 0, y: 0 }, { x: 0, y: 0 })).toBe(5);
  });

  it('점이 선분 위에 정확히 있으면 0을 반환한다', () => {
    expect(distanceToSegment({ x: 5, y: 0 }, { x: 0, y: 0 }, { x: 10, y: 0 })).toBe(0);
  });
});
