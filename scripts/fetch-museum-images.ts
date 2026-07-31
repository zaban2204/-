// 명화 조각 보충 도구 — 퍼블릭도메인 작품을 공개 API에서 받아온다.
//
// 두 곳만 쓴다. 둘 다 프로그램 접근을 위해 공개한 공식 API이고, 퍼블릭도메인
// 여부가 데이터에 플래그로 들어 있다.
//   - 메트로폴리탄(Met): isPublicDomain 플래그. web-large 이미지를 받아 직접 줄인다.
//   - 클리블랜드미술관(CMA): share_license_status=CC0. web 이미지를 받아 줄인다.
//
// 쓰지 않는 곳과 이유 (다시 시도하지 말 것):
//   - artvee.com: robots.txt에서 AI 에이전트(Claude·Anthropic 포함)를 Disallow: / 로
//     전면 차단해 두었다. 사이트 운영자의 명시적 거부다.
//   - 시카고미술관(AIC): 메타데이터 API는 열려 있지만 이미지 서버(www.artic.edu/iiif)가
//     Cloudflare 봇 차단 뒤에 있어 자동 다운로드가 403이다. 우회하지 않는다.
//
// 이 스크립트는 이미지와 메타데이터만 받아 둔다. caption(임베딩에 쓰이는 한국어
// 서술)은 사람이 작품을 보고 쓰는 것이므로 여기서 만들지 않는다 — scripts/out/
// museum-fetch.json에 메타데이터를 남기고, 그걸 보고 paintings.yaml을 채운다.
//
// 실행: npx tsx scripts/fetch-museum-images.ts --count 100 --width 900

import { mkdir, writeFile, readFile } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';

const IMAGE_DIR = path.join(process.cwd(), 'public', 'images', 'paintings');
const OUT_DIR = path.join(process.cwd(), 'scripts', 'out');
const PAINTINGS_YAML = path.join(process.cwd(), 'content', 'paintings.yaml');

interface Candidate {
  source: 'cma' | 'met';
  sourceId: string;
  title: string;
  artist: string;
  date: string;
  medium: string;
  // 주제 키워드. caption을 쓸 때 근거가 된다 (없는 것을 상상해 쓰지 않도록).
  terms: string[];
  imageUrl: string;
  pageUrl: string;
  // 미술관이 붙여 둔 설명의 앞부분. caption을 쓸 때 무엇이 그려졌는지 알기 위한
  // 참고용으로만 남긴다 (yaml에는 직접 쓴 한국어 caption만 들어간다).
  descriptionHint?: string;
}

// 글자만 있는 사본 낱장·서예 같은 것은 "아이디어 조각"으로 쓸 그림이 아니다.
// (수면에 떠오른 조각을 보고 무언가 떠올라야 하는데, 읽을 수 없는 텍스트 페이지는
// 아무것도 주지 않는다.)
const EXCLUDE_TITLE = /text page|calligraph|page from|leaf from|folio|inscription|colophon/i;

function isUsable(c: Candidate): boolean {
  return !EXCLUDE_TITLE.test(c.title);
}

function arg(name: string, fallback: number): number {
  const i = process.argv.indexOf(`--${name}`);
  if (i === -1) return fallback;
  const value = Number(process.argv[i + 1]);
  return Number.isFinite(value) ? value : fallback;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// 남의 API를 쓰는 스크립트다. 요청 간격을 두고, 일시적인 거절(403/429/5xx)은
// 물러났다 다시 시도한다 — 빠르게 몰아붙이면 실제로 403이 돌아온다.
const REQUEST_GAP_MS = 350;

async function politeFetch(url: string, init?: RequestInit): Promise<Response> {
  const headers = {
    'User-Agent': 'fishing-pond/1.0 (personal creative tool; non-commercial)',
    ...(init?.headers ?? {}),
  };
  let lastError = '';
  for (let attempt = 0; attempt < 4; attempt++) {
    if (attempt > 0) await sleep(1200 * 2 ** (attempt - 1));
    const res = await fetch(url, { ...init, headers });
    if (res.ok) return res;
    lastError = `${res.status} ${res.statusText}`;
    // 400·404처럼 다시 시도해도 같은 답이 오는 것은 즉시 포기한다
    if (res.status < 429 && res.status !== 403) break;
  }
  throw new Error(`${lastError} — ${url}`);
}

async function getJson(url: string): Promise<unknown> {
  const res = await politeFetch(url);
  await sleep(REQUEST_GAP_MS);
  return res.json();
}

// 순서를 섞는다 (Fisher-Yates). "무작위 100점"이 특정 소장 번호대에 쏠리지 않게.
function shuffle<T>(items: T[]): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

// ---- 클리블랜드미술관 ----
async function collectCma(want: number): Promise<Candidate[]> {
  const found: Candidate[] = [];
  const PAGE = 100;
  const fields = [
    'id', 'title', 'creators', 'creation_date', 'technique', 'type', 'culture',
    'images', 'url', 'share_license_status', 'wall_description', 'digital_description',
  ].join(',');

  // 전체 개수를 먼저 물어보고, 그 안에서 무작위 구간을 골라 훑는다
  const head = (await getJson(
    'https://openaccess-api.clevelandart.org/api/artworks/?cc0=1&type=Painting&has_image=1&limit=1',
  )) as { info?: { total?: number } };
  const total = head.info?.total ?? 1000;
  const skips = shuffle(
    Array.from({ length: Math.max(1, Math.floor(total / PAGE)) }, (_, i) => i * PAGE),
  ).slice(0, 8);

  for (const skip of skips) {
    if (found.length >= want) break;
    const url =
      `https://openaccess-api.clevelandart.org/api/artworks/?cc0=1&type=Painting&has_image=1` +
      `&fields=${fields}&limit=${PAGE}&skip=${skip}`;
    const body = (await getJson(url)) as { data?: Record<string, unknown>[] };
    for (const raw of body.data ?? []) {
      const images = raw.images as { web?: { url?: string } } | null;
      const imageUrl = images?.web?.url;
      const title = (raw.title as string) ?? '';
      if (!imageUrl || !title || raw.share_license_status !== 'CC0') continue;
      const creators = (raw.creators as { description?: string }[] | null) ?? [];
      found.push({
        source: 'cma',
        sourceId: String(raw.id),
        title,
        artist: creators[0]?.description ?? 'Unknown artist',
        date: (raw.creation_date as string) ?? '',
        medium: (raw.technique as string) ?? '',
        terms: [raw.type, raw.culture].flat().filter((t): t is string => typeof t === 'string'),
        imageUrl,
        pageUrl: (raw.url as string) ?? `https://www.clevelandart.org/art/${raw.id}`,
        descriptionHint: (
          ((raw.digital_description as string) || (raw.wall_description as string)) ?? ''
        ).slice(0, 220),
      });
      if (found.length >= want) break;
    }
  }
  return found;
}

// ---- 메트로폴리탄 ----
async function collectMet(want: number): Promise<Candidate[]> {
  // Met 검색은 질의어가 필요하다. 주제를 흩어 놓아 한 장르로 쏠리지 않게 한다.
  const queries = [
    'landscape', 'portrait', 'sea', 'night', 'garden', 'winter', 'river',
    'still life', 'street', 'mountain', 'window', 'forest', 'harbor', 'dance',
  ];
  const ids: number[] = [];
  for (const q of shuffle(queries).slice(0, 8)) {
    const url =
      `https://collectionapi.metmuseum.org/public/collection/v1/search` +
      `?isPublicDomain=true&hasImages=true&medium=Paintings&q=${encodeURIComponent(q)}`;
    const body = (await getJson(url)) as { objectIDs?: number[] };
    ids.push(...(body.objectIDs ?? []).slice(0, 400));
  }

  const found: Candidate[] = [];
  const seen = new Set<number>();
  for (const id of shuffle([...new Set(ids)])) {
    if (found.length >= want) break;
    if (seen.has(id)) continue;
    seen.add(id);
    let raw: Record<string, unknown>;
    try {
      raw = (await getJson(
        `https://collectionapi.metmuseum.org/public/collection/v1/objects/${id}`,
      )) as Record<string, unknown>;
    } catch {
      continue; // 개별 작품 조회 실패는 건너뛴다 (전체를 멈추지 않는다)
    }
    const image = raw.primaryImageSmall as string;
    const title = raw.title as string;
    if (!image || !title || raw.isPublicDomain !== true) continue;
    found.push({
      source: 'met',
      sourceId: String(id),
      title,
      artist: (raw.artistDisplayName as string) || 'Unknown artist',
      date: (raw.objectDate as string) ?? '',
      medium: (raw.medium as string) ?? '',
      terms: (((raw.tags as { term: string }[] | null) ?? []).map((t) => t.term)).slice(0, 10),
      imageUrl: image,
      pageUrl: (raw.objectURL as string) ?? '',
    });
  }
  return found;
}

// 파일명은 제목에서 만든다. 한글·악센트가 섞여도 안전한 ascii 슬러그로.
function slugify(title: string, fallback: string): string {
  const base = title
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 48);
  return base.length >= 3 ? base : `artwork-${fallback}`;
}

async function existingFileNames(): Promise<Set<string>> {
  // 기존 12점의 파일명과 겹치면 덮어써 버린다 — 미리 읽어 피한다
  const yaml = await readFile(PAINTINGS_YAML, 'utf8');
  return new Set([...yaml.matchAll(/imageFile:\s*(\S+)/g)].map((m) => m[1]));
}

const WIDTH = arg('width', 900);

async function main() {
  const count = arg('count', 100);
  const perSource = Math.ceil(count / 2);

  console.log(`[fetch] 후보 수집 — 클리블랜드 ${perSource}점, Met ${perSource}점`);
  // 두 API를 동시에 두드리지 않는다 (동시 요청이 곧 403으로 돌아온다)
  const cma = await collectCma(perSource + 20);
  const met = await collectMet(perSource + 20);
  console.log(`[fetch] 후보: 클리블랜드 ${cma.length}, Met ${met.length}`);

  // 두 곳을 반씩 섞어 정확히 count개 (그림이 아닌 낱장은 걸러낸 뒤)
  const picked = [
    ...shuffle(cma.filter(isUsable)).slice(0, perSource),
    ...shuffle(met.filter(isUsable)).slice(0, count - perSource),
  ].slice(0, count);

  await mkdir(IMAGE_DIR, { recursive: true });
  await mkdir(OUT_DIR, { recursive: true });

  const taken = await existingFileNames();
  const saved: (Candidate & { imageFile: string; bytes: number })[] = [];
  const failed: { title: string; reason: string }[] = [];

  for (const [i, c] of picked.entries()) {
    let name = `${slugify(c.title, c.sourceId)}.jpg`;
    // 같은 제목의 작품이 여러 점 있을 수 있다
    if (taken.has(name)) name = `${slugify(c.title, c.sourceId)}-${c.sourceId}.jpg`;
    if (taken.has(name)) {
      failed.push({ title: c.title, reason: '파일명 충돌' });
      continue;
    }

    try {
      const res = await politeFetch(c.imageUrl);
      const input = Buffer.from(await res.arrayBuffer());
      // 폭을 맞추고(이미 맞으면 그대로) 웹용으로 다시 압축한다
      const output = await sharp(input)
        .resize({ width: WIDTH, withoutEnlargement: true })
        .jpeg({ quality: 82, progressive: true })
        .toBuffer();
      await writeFile(path.join(IMAGE_DIR, name), output);
      taken.add(name);
      saved.push({ ...c, imageFile: name, bytes: output.length });
      console.log(`[${i + 1}/${picked.length}] ${name} (${Math.round(output.length / 1024)}KB)`);
    } catch (err) {
      failed.push({ title: c.title, reason: String(err) });
      console.warn(`[${i + 1}/${picked.length}] 실패: ${c.title} — ${err}`);
    }
  }

  const outPath = path.join(OUT_DIR, 'museum-fetch.json');
  await writeFile(outPath, JSON.stringify({ saved, failed }, null, 2), 'utf8');

  const totalMb = saved.reduce((sum, s) => sum + s.bytes, 0) / 1024 / 1024;
  console.log(
    `\n[fetch] 저장 ${saved.length}점 (${totalMb.toFixed(1)}MB), 실패 ${failed.length}점`,
  );
  console.log(`[fetch] 메타데이터: ${outPath}`);
  console.log('[fetch] 다음 단계: 메타데이터를 보고 content/paintings.yaml에 caption과 함께 추가');
}

// import만 해도 실행되지 않도록 (build-pool.ts와 같은 이유)
if (process.argv[1] && import.meta.url.endsWith(path.basename(process.argv[1]))) {
  main().catch((err) => {
    console.error('[fetch] 중단:', err);
    process.exit(1);
  });
}
