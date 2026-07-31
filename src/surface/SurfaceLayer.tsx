import { useEffect, useRef } from 'react';
import type { PointerEvent as ReactPointerEvent, RefObject } from 'react';
import { useAppStore } from '../store';
import { SurfaceCard } from './SurfaceCard';
import styles from './surface.module.css';

const INITIAL_COUNT = 13;
const SURFACE_MIN = 10;
const SURFACE_MAX = 14; // 소프트 상한 — 부상 때문에 넘어가면 여기까지 되돌린다
const LIFESPAN_MIN_MS = 40_000;
const LIFESPAN_MAX_MS = 50_000;
const FADE_DURATION_MS = 900;
const FADE_EXTRA_VX = 40; // 사라지는 동안 추가로 왼쪽으로 밀려나는 느낌(px/s)
// 조각이 수명(40~50초) 안에 화면을 실제로 가로질러 왼쪽 밖으로 나가야 한다
// (PRD 6항 "수면의 흐름에 따라 화면 밖으로 밀려나고"). 640px 패널 + 카드 폭을
// 45초에 지나려면 초당 18px 정도가 필요하다.
const DRIFT_VX_MIN = 15;
const DRIFT_VX_MAX = 20;
// 최초 화면을 "이미 한참 흐르고 있던 강물"로 만든다. 조각을 격자에 놓는 대신,
// 3.8초 간격으로 하나씩 흘러 들어온 것처럼 나이를 다르게 주고 그 나이만큼 왼쪽으로
// 이동시킨 위치에 놓는다. 그러면 (1) 정렬돼 보이지 않고 (2) 오른쪽 밖에 대기 중인
// 조각이 곧 들어오므로 첫 순간부터 흐름이 이어지고 (3) 수명도 저절로 어긋난다.
const STREAM_ENTRY_INTERVAL_SEC = 3.8;
const STREAM_ENTRY_JITTER_SEC = 1.2;
const MIN_REMAINING_LIFE_MS = 3_000; // 로드 직후 곧바로 사라지는 조각이 없도록

// 카드 실제 크기를 DOM에서 재기 전까지 쓰는 기본값(대략적인 포스트잇 크기)
const CARD_WIDTH_DEFAULT = 190;
const CARD_HEIGHT_DEFAULT = 150;
const WAVE_AMPLITUDE = 6;
// 충돌·튕김: 카드끼리 이 간격보다 가까워지면 매 프레임 실제 위치를 밀어내
// 겹침 자체를 없애고, 그 위에 감쇠하는 "튕김" 속도를 얹어 부딪히는 느낌을 낸다.
// (스프링으로 원래 자리에 되돌리는 방식은 서로 다른 속도로 흐르는 카드가 계속
// 재충돌해 겹침이 남았다 — 위치 보정은 영구적으로, 튕김만 감쇠시킨다.)
const COLLISION_PADDING = 8;
const BOUNCE_IMPULSE = 90; // px/s, 충돌 순간 부여하는 튕김 속도
const IMPULSE_DAMPING_BASE = 0.001; // 1초당 이만큼 감쇠 (매우 빠르게 잦아듦)
const DT_CLAMP_MS = 100; // 백그라운드 탭 복귀 등 큰 델타를 방지

// 클릭·부상 (PRD 3항)
const RELATED_RISE_COUNT = 4;
const SINK_DURATION_MS = 620;
const SINK_DISTANCE = 130;
const RISE_DURATION_MS = 820;
const RISE_STAGGER_MS = 120; // 4개가 동시에 튀어나오면 정신없다
const DRAG_CLICK_THRESHOLD_PX = 5; // 이보다 덜 움직이고 뗐으면 클릭으로 본다

interface PhysicsEntry {
  fragmentId: string;
  x: number;
  y: number;
  vx: number;
  wavePhase: number;
  waveSpeed: number;
  rotation: number;
  width: number;
  height: number;
  impulseVX: number;
  impulseVY: number;
  spawnedAtActiveMs: number;
  lifespanMs: number;
  touched: boolean;
  fadeStartActiveMs: number | null;
  // 소프트 상한을 넘겨 "개수를 줄이려고" 배출된 조각. 이건 교체하지 않는다 —
  // 교체하면 줄인 만큼 다시 채워져 상한으로 수렴하지 못한다.
  evicted: boolean;
  // 클릭해서 가라앉는 중 (애니메이션 시계 기준)
  sinkStartAnimMs: number | null;
  // 아래에서 떠오르는 중 (애니메이션 시계 기준). 시작 시각이 미래면 stagger 대기 중이다
  riseStartAnimMs: number | null;
  riseFromY: number;
  // 드래그 중이면 물리에서 분리되고 포인터가 위치를 지배한다
  dragging: boolean;
}

function randomBetween(min: number, max: number) {
  return min + Math.random() * (max - min);
}

function shuffled<T>(items: T[]): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function easeOutCubic(t: number) {
  return 1 - Math.pow(1 - t, 3);
}

interface SurfaceLayerProps {
  canvasPaneRef: RefObject<HTMLDivElement | null>;
}

export function SurfaceLayer({ canvasPaneRef }: SurfaceLayerProps) {
  const fragments = useAppStore((s) => s.fragments);
  const surfaceFragments = useAppStore((s) => s.surfaceFragments);
  const isPaused = useAppStore((s) => s.isPaused);
  const exhaustedIds = useAppStore((s) => s.exhaustedIds);
  const addSurfaceFragment = useAppStore((s) => s.addSurfaceFragment);
  const removeSurfaceFragment = useAppStore((s) => s.removeSurfaceFragment);
  const touchSurfaceFragment = useAppStore((s) => s.touchSurfaceFragment);
  const markExhausted = useAppStore((s) => s.markExhausted);
  const addNode = useAppStore((s) => s.addNode);
  const triggerSwing = useAppStore((s) => s.triggerSwing);
  const setPaused = useAppStore((s) => s.setPaused);

  const panelRef = useRef<HTMLDivElement>(null);
  const elRefs = useRef(new Map<string, HTMLDivElement>());
  const physicsRef = useRef(new Map<string, PhysicsEntry>());
  const sizeRef = useRef({ width: 0, height: 0 });
  // 수면의 흐름·수명을 재는 시계. 일시정지 중에는 멈춘다.
  const activeElapsedRef = useRef(0);
  // 가라앉기·부상 애니메이션용 시계. 일시정지 중에도 흐른다 —
  // 멈추면 정지 중에 클릭했을 때 아무 반응이 없어 고장처럼 보인다.
  const animElapsedRef = useRef(0);
  const lastTimeRef = useRef<number | null>(null);
  const rafRef = useRef<number>(0);
  const isPausedRef = useRef(isPaused);
  const initializedRef = useRef(false);
  const cardResizeObserverRef = useRef<ResizeObserver | null>(null);

  const dragRef = useRef<{
    fragmentId: string;
    pointerId: number;
    offsetX: number;
    offsetY: number;
    originX: number;
    originY: number;
    movedPx: number;
  } | null>(null);

  // 최신 스토어 값을 rAF 클로저에서 읽기 위한 ref 동기화 (매 프레임 리렌더 방지 목적)
  const fragmentsRef = useRef(fragments);
  const exhaustedIdsRef = useRef(exhaustedIds);
  useEffect(() => {
    isPausedRef.current = isPaused;
  }, [isPaused]);
  useEffect(() => {
    fragmentsRef.current = fragments;
  }, [fragments]);
  useEffect(() => {
    exhaustedIdsRef.current = exhaustedIds;
  }, [exhaustedIds]);

  useEffect(() => {
    const el = panelRef.current;
    if (!el) return;
    const update = () => {
      sizeRef.current = { width: el.clientWidth, height: el.clientHeight };
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // 카드 하나하나의 실제 렌더 크기를 계속 지켜본다. 이미지 조각은 <img>가 비동기로
  // 디코딩되기 때문에 마운트 시점 한 번만 읽으면 로드 전 크기(0 또는 깨진 이미지 기본
  // 크기)로 충돌 판정 박스가 고정돼버려 실제 렌더 크기와 어긋나 겹침이 생긴다.
  useEffect(() => {
    const ro = new ResizeObserver((observedEntries) => {
      observedEntries.forEach((obsEntry) => {
        const el = obsEntry.target as HTMLDivElement;
        const fragmentId = el.dataset.fragmentId;
        if (!fragmentId) return;
        const entry = physicsRef.current.get(fragmentId);
        if (entry) {
          entry.width = el.offsetWidth || entry.width;
          entry.height = el.offsetHeight || entry.height;
        }
      });
    });
    cardResizeObserverRef.current = ro;
    return () => ro.disconnect();
  }, []);

  function pickRandomFragmentId(excludeActive: Set<string>): string | null {
    const candidates: string[] = [];
    fragmentsRef.current.forEach((_f, id) => {
      if (!excludeActive.has(id) && !exhaustedIdsRef.current.has(id)) {
        candidates.push(id);
      }
    });
    if (candidates.length === 0) return null;
    return candidates[Math.floor(Math.random() * candidates.length)];
  }

  // 이미 놓인 조각들과 세로로 가장 멀리 떨어진 y를 고른다. 가로로 겹치지 않는
  // 조각은 애초에 부딪히지 않으므로 고려 대상에서 뺀다 — 그래서 격자처럼 줄이
  // 맞지 않으면서도 실제로 겹치는 일은 없다.
  function pickSpaciousY(obstacles: { x: number; y: number }[], x: number, h: number): number {
    const pick = () => 16 + Math.random() * Math.max(h - CARD_HEIGHT_DEFAULT - 32, 40);
    let best = pick();
    let bestClearance = -Infinity;
    for (let attempt = 0; attempt < 24; attempt++) {
      const candidate = attempt === 0 ? best : pick();
      let clearance = Infinity;
      for (const other of obstacles) {
        if (Math.abs(other.x - x) >= CARD_WIDTH_DEFAULT + COLLISION_PADDING) continue;
        clearance = Math.min(clearance, Math.abs(other.y - candidate));
      }
      if (clearance > bestClearance) {
        bestClearance = clearance;
        best = candidate;
      }
      if (clearance > CARD_HEIGHT_DEFAULT + COLLISION_PADDING) break;
    }
    return best;
  }

  function currentObstacles(): { x: number; y: number }[] {
    return Array.from(physicsRef.current.values()).map((e) => ({ x: e.x, y: e.y }));
  }

  // 최초 배치: 조각들이 3.8초 간격으로 하나씩 흘러 들어와 지금에 이른 것처럼 만든다.
  // 나이가 많은 조각일수록 그만큼 더 왼쪽에 있고 수명도 그만큼 남아 있지 않다.
  function computeInitialStream(count: number, w: number, h: number) {
    const placed: { x: number; y: number }[] = [];
    return Array.from({ length: count }, (_, i) => {
      const ageSec = Math.max(
        0,
        i * STREAM_ENTRY_INTERVAL_SEC + (Math.random() - 0.5) * STREAM_ENTRY_JITTER_SEC,
      );
      const vx = randomBetween(DRIFT_VX_MIN, DRIFT_VX_MAX);
      const x = w + 12 - vx * ageSec;
      const y = pickSpaciousY(placed, x, h);
      placed.push({ x, y });
      const ageMs = ageSec * 1000;
      return {
        x,
        y,
        vx: -vx,
        ageMs,
        // 나이만큼 이미 살았으니, 최소한 몇 초는 더 떠 있도록 수명 하한을 보장한다
        lifespanMs: Math.max(
          randomBetween(LIFESPAN_MIN_MS, LIFESPAN_MAX_MS),
          ageMs + MIN_REMAINING_LIFE_MS,
        ),
      };
    });
  }

  // 오른쪽 밖에서 들어올 y를 고른다. 이미 우측 끝에 있는 카드와 겹치는 자리를 피해야
  // 들어오는 순간 남의 카드를 밀어버리지 않는다.
  function findEdgeSpawnY(h: number): number {
    const nearRightEdge = Array.from(physicsRef.current.values())
      .filter((e) => e.x >= sizeRef.current.width - e.width - 40)
      .map((e) => ({ x: e.x, y: e.y }));
    return pickSpaciousY(nearRightEdge, sizeRef.current.width + 12, h);
  }

  interface SpawnOptions {
    x?: number;
    y?: number;
    vx?: number;
    lifespanMs?: number;
    ageMs?: number; // 이미 이만큼 흘러온 것으로 취급한다 (최초 배치용)
    riseFromY?: number; // 지정하면 이 y에서 위로 떠오른다 (부상)
    riseDelayMs?: number; // 부상 stagger
  }

  function spawnFragment(fragmentId: string, options: SpawnOptions = {}) {
    const { width, height } = sizeRef.current;
    const w = width || 800;
    const h = height || 600;
    const x = options.x ?? w + 12 + Math.random() * 20;
    const y = options.y ?? findEdgeSpawnY(h);
    const vx = options.vx ?? -randomBetween(DRIFT_VX_MIN, DRIFT_VX_MAX);
    const rotation = randomBetween(-3, 3);
    const lifespanMs = options.lifespanMs ?? randomBetween(LIFESPAN_MIN_MS, LIFESPAN_MAX_MS);
    const rising = options.riseFromY !== undefined;

    const entry: PhysicsEntry = {
      fragmentId,
      x,
      y,
      vx,
      wavePhase: Math.random() * Math.PI * 2,
      waveSpeed: randomBetween(0.25, 0.55),
      rotation,
      width: CARD_WIDTH_DEFAULT,
      height: CARD_HEIGHT_DEFAULT,
      impulseVX: 0,
      impulseVY: 0,
      // 부상 조각은 실제로 화면에 나타나는 순간부터 수명을 센다 (stagger 대기시간 제외)
      spawnedAtActiveMs:
        activeElapsedRef.current - (options.ageMs ?? 0) + (options.riseDelayMs ?? 0),
      lifespanMs,
      touched: false,
      fadeStartActiveMs: null,
      evicted: false,
      sinkStartAnimMs: null,
      riseStartAnimMs: rising ? animElapsedRef.current + (options.riseDelayMs ?? 0) : null,
      riseFromY: options.riseFromY ?? y,
      dragging: false,
    };
    physicsRef.current.set(fragmentId, entry);
    addSurfaceFragment({
      fragmentId,
      x,
      y: rising ? entry.riseFromY : y,
      vx,
      vy: 0,
      rotation,
      spawnedAt: entry.spawnedAtActiveMs,
      touched: false,
    });
  }

  function despawnFragment(fragmentId: string) {
    physicsRef.current.delete(fragmentId);
    elRefs.current.delete(fragmentId);
    removeSurfaceFragment(fragmentId);
  }

  // 관련 조각 4개를 고른다. 직접 이웃(유사도 순) → 이웃의 이웃 → 랜덤으로 채워
  // 무조건 요청한 개수를 맞춘다. 이미 수면에 있거나 소진된 조각은 제외한다.
  function pickRelatedFragmentIds(sourceFragmentId: string, count: number): string[] {
    const chosen: string[] = [];
    const blocked = new Set<string>([sourceFragmentId]);
    physicsRef.current.forEach((_e, id) => blocked.add(id));
    exhaustedIdsRef.current.forEach((id) => blocked.add(id));

    const take = (ids: string[]) => {
      for (const id of ids) {
        if (chosen.length >= count) return;
        if (blocked.has(id) || !fragmentsRef.current.has(id)) continue;
        blocked.add(id);
        chosen.push(id);
      }
    };

    const direct = fragmentsRef.current.get(sourceFragmentId)?.neighborIds ?? [];
    // 직접 이웃은 유사도 순서를 지킨다 — "관련 있는 조각"이 핵심이다
    take(direct);

    if (chosen.length < count) {
      const secondHop: string[] = [];
      for (const neighborId of direct) {
        const neighbor = fragmentsRef.current.get(neighborId);
        if (neighbor) secondHop.push(...neighbor.neighborIds);
      }
      take(shuffled(secondHop));
    }

    if (chosen.length < count) {
      const all: string[] = [];
      fragmentsRef.current.forEach((_f, id) => all.push(id));
      take(shuffled(all));
    }

    return chosen;
  }

  // 관련 조각을 수면 하단에서 떠오르게 한다 (클릭·낚기 공통)
  function riseRelatedFragments(sourceFragmentId: string) {
    const { width, height } = sizeRef.current;
    const w = width || 800;
    const h = height || 600;
    const ids = pickRelatedFragmentIds(sourceFragmentId, RELATED_RISE_COUNT);
    const placed = currentObstacles();

    ids.forEach((id, index) => {
      const x = 20 + Math.random() * Math.max(w - CARD_WIDTH_DEFAULT - 40, 40);
      const targetY = pickSpaciousY(placed, x, h);
      placed.push({ x, y: targetY });
      spawnFragment(id, {
        x,
        y: targetY,
        riseFromY: h + 30,
        riseDelayMs: index * RISE_STAGGER_MS,
      });
    });
  }

  // 이미 스토어에 있는 항목을 물리 엔트리로 되살린다. (React StrictMode의 개발 모드
  // 이중 마운트, 혹은 그 밖의 이유로 이 컴포넌트가 재마운트될 때 이미 스토어에 쌓인
  // surfaceFragments를 무시하고 또 새로 스폰하면 개수가 배로 불어난다.)
  function hydrateFromExistingStore(existing: typeof surfaceFragments) {
    existing.forEach((sf) => {
      if (physicsRef.current.has(sf.fragmentId)) return;
      physicsRef.current.set(sf.fragmentId, {
        fragmentId: sf.fragmentId,
        x: sf.x,
        y: sf.y,
        vx: sf.vx,
        wavePhase: Math.random() * Math.PI * 2,
        waveSpeed: randomBetween(0.25, 0.55),
        rotation: sf.rotation,
        width: CARD_WIDTH_DEFAULT,
        height: CARD_HEIGHT_DEFAULT,
        impulseVX: 0,
        impulseVY: 0,
        spawnedAtActiveMs: sf.spawnedAt,
        lifespanMs: randomBetween(LIFESPAN_MIN_MS, LIFESPAN_MAX_MS),
        touched: sf.touched,
        fadeStartActiveMs: null,
        evicted: false,
        sinkStartAnimMs: null,
        riseStartAnimMs: null,
        riseFromY: sf.y,
        dragging: false,
      });
    });
  }

  // 최초 배치 (풀 로드 완료 후 1회. 이미 스토어에 있으면 그걸 재사용한다)
  useEffect(() => {
    if (initializedRef.current) return;
    if (fragments.size === 0) return;
    initializedRef.current = true;

    const existing = useAppStore.getState().surfaceFragments;
    if (existing.length > 0) {
      hydrateFromExistingStore(existing);
      return;
    }

    const { width, height } = sizeRef.current;
    const stream = computeInitialStream(INITIAL_COUNT, width || 800, height || 600);
    const active = new Set<string>();
    for (const spot of stream) {
      const id = pickRandomFragmentId(active);
      if (!id) break;
      spawnFragment(id, spot);
      active.add(id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fragments]);

  // 카드 하나의 화면 위치·투명도를 계산한다 (물결·가라앉기·부상 반영)
  function resolveVisual(e: PhysicsEntry) {
    if (e.dragging) {
      return { x: e.x, y: e.y, opacity: 1 };
    }

    if (e.sinkStartAnimMs !== null) {
      const t = Math.min(1, (animElapsedRef.current - e.sinkStartAnimMs) / SINK_DURATION_MS);
      return {
        x: e.x,
        y: e.y + easeOutCubic(t) * SINK_DISTANCE,
        opacity: 1 - t,
      };
    }

    if (e.riseStartAnimMs !== null) {
      const elapsed = animElapsedRef.current - e.riseStartAnimMs;
      if (elapsed < 0) {
        // stagger 대기 중 — 아직 물 밑에 있다
        return { x: e.x, y: e.riseFromY, opacity: 0 };
      }
      const t = Math.min(1, elapsed / RISE_DURATION_MS);
      const eased = easeOutCubic(t);
      return {
        x: e.x,
        y: e.riseFromY + (e.y - e.riseFromY) * eased,
        opacity: Math.min(1, t * 1.6),
      };
    }

    const wobble = Math.sin(e.wavePhase) * WAVE_AMPLITUDE;
    let opacity = 1;
    if (e.fadeStartActiveMs !== null) {
      const fadeElapsed = activeElapsedRef.current - e.fadeStartActiveMs;
      opacity = Math.max(0, 1 - fadeElapsed / FADE_DURATION_MS);
    }
    return { x: e.x, y: e.y + wobble, opacity };
  }

  function writeVisual(e: PhysicsEntry) {
    const el = elRefs.current.get(e.fragmentId);
    if (!el) return;
    const { x, y, opacity } = resolveVisual(e);
    el.style.transform = `translate3d(${x}px, ${y}px, 0) rotate(${e.rotation}deg)`;
    el.style.opacity = String(opacity);
  }

  // 시뮬레이션 한 스텝. 위치/수명/개수/충돌을 전부 이 한 곳에서 처리한다.
  // rAF가 매 프레임 호출한다. 개발 모드에서는 테스트가 직접 호출할 수도 있다
  // (아래 window.__surfaceStep 참고 — 백그라운드 탭에서 rAF가 멈추면 검증이 불가능하다).
  function stepSimulation(dt: number, paused: boolean) {
    animElapsedRef.current += dt;
    const entries = physicsRef.current;

    // 가라앉기가 끝난 조각은 내보낸다. 클릭으로 빠진 자리는 부상하는 4개가 메우므로
    // 랜덤 조각으로 보충하지 않는다.
    const sunk: string[] = [];
    entries.forEach((e) => {
      if (e.sinkStartAnimMs === null) return;
      if (animElapsedRef.current - e.sinkStartAnimMs >= SINK_DURATION_MS) sunk.push(e.fragmentId);
    });

    // 부상이 끝난 조각은 평소 상태로 돌려보낸다 (이제 흐름·충돌·수명에 참여한다)
    entries.forEach((e) => {
      if (e.riseStartAnimMs === null) return;
      if (animElapsedRef.current - e.riseStartAnimMs >= RISE_DURATION_MS) e.riseStartAnimMs = null;
    });

    if (paused) {
      // 정지 중에도 가라앉기·부상·드래그는 진행한다. 흐름과 수명만 멈춘다.
      // 드래그 중인 카드는 여기서도 건드리지 않는다 — 화면 갱신은 handlePointerMove 전담.
      entries.forEach((e) => {
        if (!e.dragging) writeVisual(e);
      });
      sunk.forEach((id) => despawnFragment(id));
      return;
    }

    activeElapsedRef.current += dt;
    const dtSec = dt / 1000;

    // 소프트 상한 초과 시 가장 오래된 미접촉 조각부터 조기 배출 시작.
    // 부상·가라앉기·드래그 중인 조각은 건드리지 않는다.
    //
    // 판단 기준은 현재 개수가 아니라 "이대로 두면 남을 개수"다. 배출된 조각도
    // 페이드가 끝나기까지 900ms 동안은 목록에 남아 있어서, 현재 개수로 判단하면
    // 매 프레임 아직 초과라고 보고 계속 추가 배출해 상한보다 훨씬 아래로 떨어진다.
    // (수명이 다한 조각은 1:1로 교체되므로 개수에서 빠지지 않는다.)
    let leavingForGood = 0;
    entries.forEach((e) => {
      if (e.evicted || e.sinkStartAnimMs !== null) leavingForGood++;
    });
    const projectedCount = entries.size - leavingForGood;
    if (projectedCount > SURFACE_MAX) {
      const overflow = projectedCount - SURFACE_MAX;
      const evictable = Array.from(entries.values())
        .filter(
          (e) =>
            !e.touched &&
            e.fadeStartActiveMs === null &&
            e.sinkStartAnimMs === null &&
            e.riseStartAnimMs === null &&
            !e.dragging,
        )
        .sort((a, b) => a.spawnedAtActiveMs - b.spawnedAtActiveMs);
      evictable.slice(0, overflow).forEach((e) => {
        e.fadeStartActiveMs = activeElapsedRef.current;
        e.evicted = true;
      });
    }

    const toRemoveAndReplace: string[] = [];
    const removedWithoutReplacement: string[] = [];
    const impulseDamping = Math.pow(IMPULSE_DAMPING_BASE, dtSec);
    const panelHeightForBounds = sizeRef.current.height || 600;

    // 세로 위치를 패널 안으로 붙잡아 둔다. 충돌 때 밀린 힘이 누적되면 조각이 위아래로
    // 화면을 완전히 벗어나 보이지 않게 되고, 그만큼 화면에 보이는 개수가 줄어든다.
    // 가로는 흐름의 방향이므로 제한하지 않는다. 충돌 판정보다 먼저 적용해서,
    // 충돌 로직이 이미 제한된 위치를 기준으로 분리 축을 고르게 한다.
    const clampY = (e: PhysicsEntry) => {
      if (e.dragging || e.sinkStartAnimMs !== null || e.riseStartAnimMs !== null) return;
      const maxY = Math.max(panelHeightForBounds - e.height - 8, 8);
      if (e.y < 8) {
        e.y = 8;
        if (e.impulseVY < 0) e.impulseVY = 0;
      } else if (e.y > maxY) {
        e.y = maxY;
        if (e.impulseVY > 0) e.impulseVY = 0;
      }
    };

    // Pass 1: 표류(드리프트)·물결·수명, 충돌 튕김 속도의 감쇠를 적분.
    // 튕김(impulseVX/VY)은 감쇠하지만 위치(x/y) 자체는 절대 원상복귀시키지 않는다 —
    // 스프링으로 되돌리면 서로 다른 속도로 흐르는 카드가 끊임없이 재충돌해 겹침이
    // 남기 때문에, 위치 보정은 Pass 2에서 영구적으로 적용한다.
    entries.forEach((e) => {
      if (e.dragging || e.sinkStartAnimMs !== null || e.riseStartAnimMs !== null) return;

      e.wavePhase += dtSec * e.waveSpeed;
      e.x += (e.vx + e.impulseVX) * dtSec;
      e.y += e.impulseVY * dtSec;
      e.impulseVX *= impulseDamping;
      e.impulseVY *= impulseDamping;

      if (!e.touched && e.fadeStartActiveMs === null) {
        if (activeElapsedRef.current - e.spawnedAtActiveMs >= e.lifespanMs) {
          e.fadeStartActiveMs = activeElapsedRef.current;
        }
      }
      if (e.fadeStartActiveMs !== null) {
        e.x -= FADE_EXTRA_VX * dtSec;
      }
    });

    entries.forEach(clampY);

    // Pass 2: 카드끼리 겹치지 않도록 실제 위치를 서로 밀어내고, 튕김 속도를 부여한다.
    // 사라지는 중 / 가라앉는 중 / 떠오르는 중 / 드래그 중인 카드는 충돌에서 제외한다
    // (연출된 움직임을 물리가 방해하면 어색해진다).
    const active: { entry: PhysicsEntry; x: number; y: number }[] = [];
    entries.forEach((e) => {
      if (
        e.fadeStartActiveMs !== null ||
        e.sinkStartAnimMs !== null ||
        e.riseStartAnimMs !== null ||
        e.dragging
      ) {
        return;
      }
      active.push({ entry: e, x: e.x, y: e.y });
    });

    for (let i = 0; i < active.length; i++) {
      for (let j = i + 1; j < active.length; j++) {
        const a = active[i];
        const b = active[j];
        const gapX = Math.max(a.x, b.x) - Math.min(a.x + a.entry.width, b.x + b.entry.width);
        const gapY = Math.max(a.y, b.y) - Math.min(a.y + a.entry.height, b.y + b.entry.height);
        if (gapX >= COLLISION_PADDING || gapY >= COLLISION_PADDING) continue;

        const overlapX = COLLISION_PADDING - gapX;
        const overlapY = COLLISION_PADDING - gapY;
        const aCenterX = a.x + a.entry.width / 2;
        const bCenterX = b.x + b.entry.width / 2;
        const aCenterY = a.y + a.entry.height / 2;
        const bCenterY = b.y + b.entry.height / 2;

        // 겹침이 얕은 축으로 밀어내는 게 기본이다. 단 세로로 밀어야 하는데 어느 한쪽이
        // 패널 위아래 경계에 걸려 더 못 밀리면, 그대로 두면 겹친 채 남으므로 제한이 없는
        // 가로로 분리한다.
        let separateOnX = overlapX < overlapY;
        if (!separateOnX) {
          const signY = aCenterY <= bCenterY ? -1 : 1;
          const pushY = overlapY / 2;
          const aNextY = a.y + signY * pushY;
          const bNextY = b.y - signY * pushY;
          const aMaxY = Math.max(panelHeightForBounds - a.entry.height - 8, 8);
          const bMaxY = Math.max(panelHeightForBounds - b.entry.height - 8, 8);
          if (aNextY < 8 || aNextY > aMaxY || bNextY < 8 || bNextY > bMaxY) {
            separateOnX = true;
          }
        }

        if (separateOnX) {
          const sign = aCenterX <= bCenterX ? -1 : 1;
          const push = overlapX / 2;
          a.entry.x += sign * push;
          b.entry.x -= sign * push;
          a.entry.impulseVX += sign * BOUNCE_IMPULSE;
          b.entry.impulseVX -= sign * BOUNCE_IMPULSE;
          a.x += sign * push;
          b.x -= sign * push;
        } else {
          const sign = aCenterY <= bCenterY ? -1 : 1;
          const push = overlapY / 2;
          a.entry.y += sign * push;
          b.entry.y -= sign * push;
          a.entry.impulseVY += sign * BOUNCE_IMPULSE;
          b.entry.impulseVY -= sign * BOUNCE_IMPULSE;
          a.y += sign * push;
          b.y -= sign * push;
        }
      }
    }

    // 충돌 보정이 다시 경계를 넘겼을 수 있으니 한 번 더 붙잡는다
    entries.forEach(clampY);

    // Pass 3: 화면 반영 + 제거 판정
    entries.forEach((e) => {
      // 드래그 중인 카드는 건드리지 않는다. entry.x/y는 지금 패널 기준 상대좌표를
      // 담고 있는데(handlePointerMove 참고), 드래그 중엔 카드가 position:fixed라
      // 화면엔 뷰포트 절대좌표를 써야 한다 — 여기서 그대로 쓰면 패널 오프셋만큼
      // 왼쪽으로 어긋난다. 드래그 중 화면 갱신은 오직 handlePointerMove가 맡는다.
      if (e.dragging) return;

      writeVisual(e);

      if (e.sinkStartAnimMs !== null || e.riseStartAnimMs !== null) return;

      // 왼쪽으로 완전히 빠져나갔으면 곧바로 내보낸다. 안 보이는 조각이 자리를
      // 차지하고 있으면 화면에 보이는 개수가 10개 아래로 떨어진다.
      const goneOffScreen = e.x < -(e.width + 24);
      const fadeFinished =
        e.fadeStartActiveMs !== null &&
        activeElapsedRef.current - e.fadeStartActiveMs >= FADE_DURATION_MS;
      if (!goneOffScreen && !fadeFinished) return;

      if (e.evicted) removedWithoutReplacement.push(e.fragmentId);
      else toRemoveAndReplace.push(e.fragmentId);
    });

    sunk.forEach((id) => despawnFragment(id));
    removedWithoutReplacement.forEach((id) => despawnFragment(id));

    // 수명이 끝나 흘러 나간 조각은 곧바로 랜덤 하나로 교체해 흐름을 잇는다
    toRemoveAndReplace.forEach((id) => {
      despawnFragment(id);
      const activeIds = new Set(physicsRef.current.keys());
      const replacementId = pickRandomFragmentId(activeIds);
      if (replacementId) spawnFragment(replacementId);
    });

    // 안전망: 교체로도 못 채웠을 경우(예: 소진되지 않은 후보가 부족) 최소치까지 보충
    if (physicsRef.current.size < SURFACE_MIN) {
      const activeIds = new Set(physicsRef.current.keys());
      const need = SURFACE_MIN - physicsRef.current.size;
      for (let i = 0; i < need; i++) {
        const id = pickRandomFragmentId(activeIds);
        if (!id) break;
        spawnFragment(id);
        activeIds.add(id);
      }
    }
  }

  // 항상 최신 렌더의 stepSimulation을 rAF가 쓰도록 ref에 담아둔다.
  const stepRef = useRef(stepSimulation);
  useEffect(() => {
    stepRef.current = stepSimulation;
  });

  useEffect(() => {
    function frame(now: number) {
      if (lastTimeRef.current === null) lastTimeRef.current = now;
      let dt = now - lastTimeRef.current;
      lastTimeRef.current = now;
      dt = Math.min(Math.max(dt, 0), DT_CLAMP_MS);

      stepRef.current(dt, isPausedRef.current);

      rafRef.current = requestAnimationFrame(frame);
    }

    rafRef.current = requestAnimationFrame(frame);

    if (import.meta.env.DEV) {
      const w = window as unknown as Record<string, unknown>;
      w.__surfaceStep = (dtMs: number, times = 1) => {
        for (let i = 0; i < times; i++) stepRef.current(dtMs, isPausedRef.current);
      };
      w.__surfaceStats = () => ({
        count: physicsRef.current.size,
        activeElapsedMs: Math.round(activeElapsedRef.current),
        entries: Array.from(physicsRef.current.values()).map((e) => ({
          id: e.fragmentId,
          x: Math.round(e.x),
          y: Math.round(e.y),
          width: e.width,
          height: e.height,
          fading: e.fadeStartActiveMs !== null,
          sinking: e.sinkStartAnimMs !== null,
          rising: e.riseStartAnimMs !== null,
          touched: e.touched,
          ageMs: Math.round(activeElapsedRef.current - e.spawnedAtActiveMs),
          lifespanMs: Math.round(e.lifespanMs),
        })),
      });
      w.__surfaceClick = (fragmentId: string) => handleFragmentClick(fragmentId);
    }

    return () => cancelAnimationFrame(rafRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---- 인터랙션 ----

  // 클릭: 조각이 아래로 가라앉고, 관련 조각 4개가 떠오른다 (PRD 3항).
  // 클릭만 한 조각은 소진 집합에 넣지 않는다 — 다시 만날 수 있다.
  function handleFragmentClick(fragmentId: string) {
    const entry = physicsRef.current.get(fragmentId);
    if (!entry || entry.sinkStartAnimMs !== null) return;
    entry.sinkStartAnimMs = animElapsedRef.current;
    entry.touched = true;
    touchSurfaceFragment(fragmentId);
    riseRelatedFragments(fragmentId);
  }

  function handlePointerDown(event: ReactPointerEvent<HTMLDivElement>, fragmentId: string) {
    const entry = physicsRef.current.get(fragmentId);
    const el = elRefs.current.get(fragmentId);
    if (!entry || !el || entry.sinkStartAnimMs !== null) return;

    const rect = el.getBoundingClientRect();
    dragRef.current = {
      fragmentId,
      pointerId: event.pointerId,
      offsetX: event.clientX - rect.left,
      offsetY: event.clientY - rect.top,
      originX: entry.x,
      originY: entry.y,
      movedPx: 0,
    };

    // 드래그 시작 시점에 수면 애니메이션에서 분리한다 (PRD 2항)
    entry.dragging = true;
    entry.vx = 0;
    entry.impulseVX = 0;
    entry.impulseVY = 0;
    entry.touched = true;
    entry.riseStartAnimMs = null; // 부상 중이었다면 즉시 확정
    touchSurfaceFragment(fragmentId);

    // setPointerCapture는 이미 눌림이 끝난 pointerId면 NotFoundError를 던진다.
    // 캡처 없이도 패널 레벨 핸들러가 이동을 계속 받으므로 드래그는 이어진다.
    try {
      el.setPointerCapture(event.pointerId);
    } catch {
      // 무시
    }
    // position: fixed로 띄워 패널의 overflow:hidden을 벗어나 캔버스 위까지 끌고 갈 수 있게 한다
    el.classList.add(styles.cardDragging);
    el.style.position = 'fixed';
    el.style.left = '0';
    el.style.top = '0';
    el.style.transform = `translate3d(${rect.left}px, ${rect.top}px, 0) rotate(${entry.rotation}deg)`;
  }

  function handlePointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    const drag = dragRef.current;
    if (!drag || event.pointerId !== drag.pointerId) return;
    const entry = physicsRef.current.get(drag.fragmentId);
    const el = elRefs.current.get(drag.fragmentId);
    if (!entry || !el) return;

    drag.movedPx += Math.abs(event.movementX) + Math.abs(event.movementY);

    const left = event.clientX - drag.offsetX;
    const top = event.clientY - drag.offsetY;
    // 포인터가 위치를 지배한다. rAF와 무관하므로 일시정지 중에도 정확히 따라온다.
    el.style.transform = `translate3d(${left}px, ${top}px, 0) rotate(${entry.rotation}deg)`;

    const panelRect = panelRef.current?.getBoundingClientRect();
    if (panelRect) {
      entry.x = left - panelRect.left;
      entry.y = top - panelRect.top;
    }
  }

  function restoreCardToSurface(el: HTMLDivElement) {
    el.classList.remove(styles.cardDragging);
    el.style.position = '';
    el.style.left = '';
    el.style.top = '';
  }

  function handlePointerUp(event: ReactPointerEvent<HTMLDivElement>) {
    const drag = dragRef.current;
    if (!drag || event.pointerId !== drag.pointerId) return;
    dragRef.current = null;

    const entry = physicsRef.current.get(drag.fragmentId);
    const el = elRefs.current.get(drag.fragmentId);
    if (!entry || !el) return;

    if (el.hasPointerCapture(event.pointerId)) el.releasePointerCapture(event.pointerId);
    entry.dragging = false;

    // 거의 움직이지 않았으면 클릭으로 취급한다
    if (drag.movedPx < DRAG_CLICK_THRESHOLD_PX) {
      restoreCardToSurface(el);
      entry.x = drag.originX;
      entry.y = drag.originY;
      entry.vx = -randomBetween(DRIFT_VX_MIN, DRIFT_VX_MAX);
      handleFragmentClick(drag.fragmentId);
      return;
    }

    const canvasRect = canvasPaneRef.current?.getBoundingClientRect();
    const droppedOnCanvas =
      !!canvasRect &&
      event.clientX >= canvasRect.left &&
      event.clientX <= canvasRect.right &&
      event.clientY >= canvasRect.top &&
      event.clientY <= canvasRect.bottom;

    if (droppedOnCanvas && canvasRect) {
      // 낚기 성공: 캔버스 로컬 좌표로 변환해 노드를 만들고, 조각을 소진 처리한다
      addNode({
        id: `node-${drag.fragmentId}-${Math.round(entry.x)}-${Math.round(entry.y)}`,
        fragmentId: drag.fragmentId,
        x: event.clientX - drag.offsetX - canvasRect.left,
        y: event.clientY - drag.offsetY - canvasRect.top,
        z: 0, // 스토어가 단조 증가로 다시 매긴다
      });
      markExhausted(drag.fragmentId);
      restoreCardToSurface(el);
      despawnFragment(drag.fragmentId);
      riseRelatedFragments(drag.fragmentId);
      triggerSwing();
      return;
    }

    // 캔버스 밖에 놓았으면 원래 수면 위치로 복귀한다 (touched=true는 유지)
    restoreCardToSurface(el);
    entry.x = drag.originX;
    entry.y = drag.originY;
    entry.vx = -randomBetween(DRIFT_VX_MIN, DRIFT_VX_MAX);
    writeVisual(entry);
  }

  return (
    <div className={styles.panel} ref={panelRef}>
      <button
        type="button"
        className={styles.pauseButton}
        onClick={() => setPaused(!isPaused)}
      >
        {isPaused ? '재생' : '일시정지'}
      </button>
      {surfaceFragments.map((sf) => {
        const fragment = fragments.get(sf.fragmentId);
        if (!fragment) return null;
        return (
          <SurfaceCard
            key={sf.fragmentId}
            fragment={fragment}
            initialX={sf.x}
            initialY={sf.y}
            initialRotation={sf.rotation}
            registerRef={(el) => {
              if (el) {
                elRefs.current.set(sf.fragmentId, el);
                const entry = physicsRef.current.get(sf.fragmentId);
                if (entry) {
                  entry.width = el.offsetWidth || entry.width;
                  entry.height = el.offsetHeight || entry.height;
                }
                cardResizeObserverRef.current?.observe(el);
              } else {
                const prevEl = elRefs.current.get(sf.fragmentId);
                if (prevEl) cardResizeObserverRef.current?.unobserve(prevEl);
                elRefs.current.delete(sf.fragmentId);
              }
            }}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
          />
        );
      })}
    </div>
  );
}
