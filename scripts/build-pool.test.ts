import { describe, it, expect } from 'vitest';
import { hashToBucket, embedWithNgramFallback, cosineSimilarity, topNeighborIds } from './build-pool';
import type { Fragment } from '../src/types';

describe('hashToBucket', () => {
  it('항상 [0, dim) 범위 안의 정수를 반환한다', () => {
    const grams = ['가나다', '폭풍우', 'abc', '   ', '가'];
    for (const g of grams) {
      const bucket = hashToBucket(g, 64);
      expect(Number.isInteger(bucket)).toBe(true);
      expect(bucket).toBeGreaterThanOrEqual(0);
      expect(bucket).toBeLessThan(64);
    }
  });

  it('같은 입력은 항상 같은 버킷으로 해시된다 (결정적)', () => {
    expect(hashToBucket('가나다', 128)).toBe(hashToBucket('가나다', 128));
  });
});

describe('embedWithNgramFallback', () => {
  it('임베딩 모델 없이도 정규화된(길이 1) 벡터를 만든다', () => {
    const [vec] = embedWithNgramFallback(['안녕하세요 반갑습니다'], 64);
    let norm = 0;
    for (let i = 0; i < vec.length; i++) norm += vec[i] * vec[i];
    expect(Math.sqrt(norm)).toBeCloseTo(1, 5);
  });

  it('같은 문장은 코사인 유사도 1(자기 자신)이 나온다', () => {
    const [a, b] = embedWithNgramFallback(['오늘은 비가 온다', '오늘은 비가 온다'], 64);
    expect(cosineSimilarity(a, b)).toBeCloseTo(1, 5);
  });

  it('전혀 다른 문장보다 비슷한 문장의 유사도가 더 높다', () => {
    const [base, similar, different] = embedWithNgramFallback(
      ['바다 위 작은 배가 흔들린다', '바다 위 작은 배가 출렁인다', '고양이가 창가에서 낮잠을 잔다'],
      128,
    );
    const simToSimilar = cosineSimilarity(base, similar);
    const simToDifferent = cosineSimilarity(base, different);
    expect(simToSimilar).toBeGreaterThan(simToDifferent);
  });

  it('빈 문자열이 섞여도 NaN 없이 0벡터 근처로 처리된다', () => {
    const [vec] = embedWithNgramFallback([''], 32);
    expect(Array.from(vec).some((v) => Number.isNaN(v))).toBe(false);
  });
});

describe('topNeighborIds', () => {
  function frag(id: string): Fragment {
    return { id, kind: 'sentence', text: id, origin: 'base', neighborIds: [] };
  }

  it('자기 자신은 이웃 후보에서 제외한다', () => {
    const fragments = [frag('a'), frag('b'), frag('c')];
    const vectors = [
      Float32Array.from([1, 0]),
      Float32Array.from([1, 0]), // a와 완전히 동일 (가장 유사)
      Float32Array.from([0, 1]), // a와 직교 (가장 다름)
    ];
    const neighbors = topNeighborIds(0, fragments, vectors, 2);
    expect(neighbors).not.toContain('a');
    expect(neighbors).toEqual(['b', 'c']); // 유사도 높은 순
  });

  it('요청한 개수만큼 정확히 반환한다 (풀이 충분할 때)', () => {
    const fragments = Array.from({ length: 10 }, (_, i) => frag(`f${i}`));
    const vectors = fragments.map((_, i) => Float32Array.from([Math.cos(i), Math.sin(i)]));
    const neighbors = topNeighborIds(0, fragments, vectors, 4);
    expect(neighbors).toHaveLength(4);
  });
});
