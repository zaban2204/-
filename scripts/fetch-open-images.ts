// 사진·그림 조각 보충 도구 — 명화 말고 여러 장르의 이미지를 모은다.
//
// 쓰는 곳 (셋 다 열쇠 없이 쓸 수 있고, 재배포가 허용된 것만 골라 받는다):
//   - Openverse: CC0 / 퍼블릭도메인 마크(pdm)로만 필터. 현대 사진·일러스트.
//     (CC-BY/BY-SA는 일부러 제외했다 — 저장소에 담아 정적 배포하는 앱이라
//      출처 표기 의무·동일조건변경허락이 얽히면 곤란하다.)
//   - Library of Congress FSA/OWI: 미국 정부 저작물(퍼블릭도메인) 다큐멘터리 사진.
//   - NASA: 퍼블릭도메인 우주 이미지.
//
// 쓰지 않는 곳과 이유 (다시 시도하지 말 것):
//   - Pinterest: robots.txt가 허용된 봇만 열거하는 allowlist 방식이라 우리는 대상이
//     아니고, 무엇보다 핀 대부분이 제3자의 저작물이다. 저장소에 담아 배포하면
//     라이선스 없는 재배포가 된다.
//   - artvee.com: robots.txt에서 AI 에이전트를 Disallow: / 로 전면 차단.
//   - 시카고미술관: 이미지 서버가 Cloudflare 봇 차단 뒤에 있다.
//
// 실행: npx tsx scripts/fetch-open-images.ts --count 300 --width 900

import { mkdir, writeFile, readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';

const IMAGE_DIR = path.join(process.cwd(), 'public', 'images', 'photos');
const OUT_DIR = path.join(process.cwd(), 'scripts', 'out');
const PAINTINGS_YAML = path.join(process.cwd(), 'content', 'paintings.yaml');

interface Candidate {
  source: 'openverse' | 'loc' | 'nasa';
  sourceId: string;
  title: string;
  creator: string;
  date: string;
  license: string;
  terms: string[];
  imageUrl: string;
  pageUrl: string;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const REQUEST_GAP_MS = 400;

async function politeFetch(url: string): Promise<Response> {
  let lastError = '';
  for (let attempt = 0; attempt < 4; attempt++) {
    if (attempt > 0) await sleep(1500 * 2 ** (attempt - 1));
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': 'fishing-pond/1.0 (personal creative tool; non-commercial)' },
      });
      if (res.ok) return res;
      lastError = `${res.status} ${res.statusText}`;
      if (res.status < 429 && res.status !== 403) break;
    } catch (err) {
      // LoC의 큰 이미지를 받다 보면 연결이 그냥 끊기는 일이 있다 ('terminated').
      // 상태 코드가 없는 이 실패도 물러났다 다시 시도한다.
      lastError = String(err).slice(0, 80);
    }
  }
  throw new Error(`${lastError} — ${url}`);
}

async function getJson(url: string): Promise<unknown> {
  const res = await politeFetch(url);
  await sleep(REQUEST_GAP_MS);
  return res.json();
}

function shuffle<T>(items: T[]): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

// 제목이 'DSC_0123'·'FP003070' 같은 정리번호면 무엇이 찍혔는지 알 수 없어 caption을
// 쓸 수 없다. 밈·도표·현미경 사진처럼 "아이디어 조각"으로 쓸 그림이 아닌 것도 뺀다.
const JUNK_TITLE =
  /^([a-z]{1,4}[-_ ]?\d{3,})|^\d+$|^untitled|^\W*$|meme|\.svg|svg-|lego|clipart|infographic|diagram|screenshot|logo$/i;
const JUNK_SUBJECT = /cells? with nuclei|microscop|petri dish|bar chart/i;

// Openverse 제목에는 원본 사이트의 HTML이 섞여 들어오는 일이 있다
// (예: "<div class='fn'> <i>Kitchen Table </i></div>"). 태그를 걷어내고 쓴다.
function cleanTitle(raw: string): string {
  return raw
    .replace(/<[^>]*>/g, ' ')
    .replace(/&[a-z]+;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function hasUsableTitle(title: string): boolean {
  const t = cleanTitle(title);
  return t.length >= 3 && t.length <= 90 && !JUNK_TITLE.test(t) && !JUNK_SUBJECT.test(t);
}

// ---- Openverse (CC0 · 퍼블릭도메인 마크만) ----
const OPENVERSE_QUERIES = [
  'rain window', 'night street', 'street market', 'hands', 'old book', 'coffee cup',
  'forest path', 'sea wave', 'snow field', 'desert', 'mountain fog', 'city at night',
  'train station', 'bicycle', 'bridge', 'cat', 'bird flying', 'wildflower',
  'kitchen table', 'open door', 'staircase', 'mirror', 'shadow', 'neon sign',
  'abandoned building', 'factory', 'harbor boat', 'lighthouse', 'campfire', 'umbrella rain',
  'handwritten letter', 'clock', 'piano', 'guitar', 'dancer', 'child playing',
  'elderly hands', 'wedding', 'rust texture', 'broken glass', 'laundry line', 'fog road',
];

async function collectOpenverse(want: number): Promise<Candidate[]> {
  const found: Candidate[] = [];
  const seen = new Set<string>();
  for (const q of shuffle(OPENVERSE_QUERIES)) {
    if (found.length >= want) break;
    const url =
      `https://api.openverse.org/v1/images/?q=${encodeURIComponent(q)}` +
      `&license=cc0,pdm&page_size=20&page=1`;
    let body: { results?: Record<string, unknown>[] };
    try {
      body = (await getJson(url)) as { results?: Record<string, unknown>[] };
    } catch (err) {
      console.warn(`[openverse] "${q}" 건너뜀 — ${err}`);
      continue;
    }
    for (const raw of body.results ?? []) {
      const imageUrl = raw.url as string;
      const title = cleanTitle((raw.title as string) ?? '');
      const id = raw.id as string;
      if (!imageUrl || !hasUsableTitle(title) || seen.has(id)) continue;
      seen.add(id);
      found.push({
        source: 'openverse',
        sourceId: id,
        title,
        creator: ((raw.creator as string) ?? '').trim() || 'Unknown',
        date: '',
        license: String(raw.license ?? '').toUpperCase() === 'PDM' ? 'Public Domain Mark' : 'CC0',
        terms: [q, ...((raw.tags as { name: string }[] | null) ?? []).map((t) => t.name)].slice(0, 8),
        imageUrl,
        pageUrl: (raw.foreign_landing_url as string) ?? (raw.url as string),
      });
      // 한 검색어가 결과를 독점하지 않게 (장르가 골고루 섞이도록)
      if (found.filter((f) => f.terms[0] === q).length >= 6) break;
    }
  }
  return found;
}

// ---- Library of Congress: FSA/OWI 다큐멘터리 사진 (미국 정부 저작물, PD) ----
const FSA_COLLECTION =
  'partof:farm security administration/office of war information black-and-white negatives';
const LOC_QUERIES = [
  'diner', 'gas station', 'main street', 'harvest', 'dust storm', 'barber shop',
  'general store', 'train station', 'school children', 'dance hall', 'church',
  'cotton field', 'jukebox', 'migrant camp', 'front porch', 'kitchen',
];

async function collectLoc(want: number): Promise<Candidate[]> {
  const found: Candidate[] = [];
  const seen = new Set<string>();
  for (const q of shuffle(LOC_QUERIES)) {
    if (found.length >= want) break;
    const url =
      `https://www.loc.gov/photos/?q=${encodeURIComponent(q)}` +
      `&fa=${encodeURIComponent(FSA_COLLECTION)}&fo=json&c=25`;
    let body: { results?: Record<string, unknown>[] };
    try {
      body = (await getJson(url)) as { results?: Record<string, unknown>[] };
    } catch (err) {
      console.warn(`[loc] "${q}" 건너뜀 — ${err}`);
      continue;
    }
    let takenForQuery = 0;
    for (const raw of body.results ?? []) {
      // image_url은 작은 것 → 큰 것 순. 마지막이 가장 크다. '#h=..&w=..' 앵커는 떼야 한다.
      const urls = ((raw.image_url as string[]) ?? []).filter(Boolean);
      const imageUrl = urls[urls.length - 1]?.split('#')[0];
      const title = cleanTitle((raw.title as string) ?? '');
      const id = String(raw.id ?? title);
      if (!imageUrl || !hasUsableTitle(title) || seen.has(id)) continue;
      seen.add(id);
      found.push({
        source: 'loc',
        sourceId: id,
        title,
        creator: ([raw.contributor].flat().filter(Boolean)[0] as string) ?? 'FSA/OWI',
        date: String(raw.date ?? '').slice(0, 4),
        license: 'Public Domain (U.S. Government work)',
        terms: [q],
        imageUrl,
        pageUrl: String(raw.id ?? '').startsWith('http') ? String(raw.id) : `https://www.loc.gov/`,
      });
      takenForQuery += 1;
      if (takenForQuery >= 7 || found.length >= want) break;
    }
  }
  return found;
}

// ---- NASA (퍼블릭도메인) ----
const NASA_QUERIES = [
  'nebula', 'earth from space', 'moon surface', 'mars surface', 'saturn',
  'aurora from orbit', 'galaxy', 'solar eclipse', 'star cluster', 'jupiter',
];

async function collectNasa(want: number): Promise<Candidate[]> {
  const found: Candidate[] = [];
  const seen = new Set<string>();
  for (const q of shuffle(NASA_QUERIES)) {
    if (found.length >= want) break;
    const url = `https://images-api.nasa.gov/search?q=${encodeURIComponent(q)}&media_type=image`;
    let body: { collection?: { items?: Record<string, unknown>[] } };
    try {
      body = (await getJson(url)) as { collection?: { items?: Record<string, unknown>[] } };
    } catch (err) {
      console.warn(`[nasa] "${q}" 건너뜀 — ${err}`);
      continue;
    }
    let takenForQuery = 0;
    for (const raw of body.collection?.items ?? []) {
      const meta = ((raw.data as Record<string, unknown>[]) ?? [])[0] ?? {};
      const thumb = ((raw.links as { href: string }[]) ?? [])[0]?.href;
      const title = cleanTitle(String(meta.title ?? ''));
      const id = String(meta.nasa_id ?? title);
      if (!thumb || !hasUsableTitle(title) || seen.has(id)) continue;
      seen.add(id);
      found.push({
        source: 'nasa',
        sourceId: id,
        title,
        creator: `NASA${meta.center ? ` (${meta.center})` : ''}`,
        date: String(meta.date_created ?? '').slice(0, 4),
        license: 'Public Domain (NASA)',
        terms: [q],
        // 썸네일(~medium)이 웹용으로 충분하다. 원본은 수십 MB인 경우가 있다.
        imageUrl: thumb,
        pageUrl: `https://images.nasa.gov/details/${id}`,
      });
      takenForQuery += 1;
      if (takenForQuery >= 4 || found.length >= want) break;
    }
  }
  return found;
}

function slugify(title: string, fallback: string): string {
  const base = title
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 44);
  return base.length >= 3 ? base : `photo-${fallback.slice(0, 8)}`;
}

type SavedItem = Candidate & { imageFile: string; bytes: number };

// 앞선 실행 결과를 읽어 온다. 없으면 빈 목록.
async function readPreviousRun(): Promise<SavedItem[]> {
  try {
    const raw = await readFile(path.join(OUT_DIR, 'photo-fetch.json'), 'utf8');
    const parsed = JSON.parse(raw) as { saved?: SavedItem[] };
    // 파일이 실제로 남아 있는 항목만 인정한다 (손으로 지운 것은 다시 받을 수 있게)
    const onDisk = new Set(await existingPhotoFiles());
    return (parsed.saved ?? []).filter((s) => onDisk.has(s.imageFile.replace('photos/', '')));
  } catch {
    return [];
  }
}

async function existingPhotoFiles(): Promise<string[]> {
  try {
    return await readdir(IMAGE_DIR);
  } catch {
    return [];
  }
}

function arg(name: string, fallback: number): number {
  const i = process.argv.indexOf(`--${name}`);
  if (i === -1) return fallback;
  const value = Number(process.argv[i + 1]);
  return Number.isFinite(value) ? value : fallback;
}

async function main() {
  const count = arg('count', 300);
  const width = arg('width', 900);

  // 사진 위주로, 장르가 골고루 섞이도록 배분한다
  const wantOpenverse = Math.round(count * 0.6);
  const wantLoc = Math.round(count * 0.3);
  const wantNasa = count - wantOpenverse - wantLoc;

  console.log(`[fetch] 목표 ${count}장 — Openverse ${wantOpenverse}, LoC ${wantLoc}, NASA ${wantNasa}`);
  const openverse = await collectOpenverse(wantOpenverse + 30);
  console.log(`[fetch] Openverse 후보 ${openverse.length}`);
  const loc = await collectLoc(wantLoc + 20);
  console.log(`[fetch] LoC 후보 ${loc.length}`);
  const nasa = await collectNasa(wantNasa + 10);
  console.log(`[fetch] NASA 후보 ${nasa.length}`);

  const picked = [
    ...shuffle(openverse).slice(0, wantOpenverse),
    ...shuffle(loc).slice(0, wantLoc),
    ...shuffle(nasa).slice(0, wantNasa),
  ];

  await mkdir(IMAGE_DIR, { recursive: true });
  await mkdir(OUT_DIR, { recursive: true });

  // 명화 쪽 파일명과 겹치지 않게 (명화는 public/images/paintings/에 있다)
  const yaml = await readFile(PAINTINGS_YAML, 'utf8');
  const taken = new Set([...yaml.matchAll(/imageFile:\s*(\S+)/g)].map((m) => m[1]));

  // 앞선 실행에서 이미 받아 둔 것들. 모자란 만큼 채우는(top-up) 실행을 해도
  // 같은 그림을 두 번 받지 않도록, 파일명·출처 id 둘 다로 막는다.
  const previous = await readPreviousRun();
  const seenSourceIds = new Set(previous.map((p) => `${p.source}:${p.sourceId}`));
  for (const p of previous) taken.add(p.imageFile);
  for (const name of await existingPhotoFiles()) taken.add(`photos/${name}`);

  const saved: (Candidate & { imageFile: string; bytes: number })[] = [...previous];
  const failed: { title: string; reason: string }[] = [];

  const need = Math.max(0, count - previous.length);
  if (previous.length > 0) {
    console.log(`[fetch] 이미 받아 둔 ${previous.length}장은 건너뛰고 ${need}장만 채운다`);
  }
  const fresh = picked.filter((c) => !seenSourceIds.has(`${c.source}:${c.sourceId}`)).slice(0, need);

  for (const [i, c] of fresh.entries()) {
    let name = `${slugify(c.title, c.sourceId)}.jpg`;
    if (taken.has(name) || taken.has(`photos/${name}`)) {
      name = `${slugify(c.title, c.sourceId)}-${i}-${c.sourceId.slice(-4)}.jpg`;
    }
    if (taken.has(`photos/${name}`)) continue;
    try {
      const res = await politeFetch(c.imageUrl);
      const input = Buffer.from(await res.arrayBuffer());
      const output = await sharp(input)
        .resize({ width, withoutEnlargement: true })
        .jpeg({ quality: 82, progressive: true })
        .toBuffer();
      await writeFile(path.join(IMAGE_DIR, name), output);
      taken.add(`photos/${name}`);
      saved.push({ ...c, imageFile: `photos/${name}`, bytes: output.length });
      if ((i + 1) % 25 === 0 || i === 0) {
        console.log(`[${i + 1}/${fresh.length}] ${name} (${Math.round(output.length / 1024)}KB)`);
      }
    } catch (err) {
      failed.push({ title: c.title, reason: String(err).slice(0, 90) });
    }
  }

  const outPath = path.join(OUT_DIR, 'photo-fetch.json');
  await writeFile(outPath, JSON.stringify({ saved, failed }, null, 2), 'utf8');
  const totalMb = saved.reduce((s, x) => s + x.bytes, 0) / 1024 / 1024;
  console.log(`\n[fetch] 저장 ${saved.length}장 (${totalMb.toFixed(1)}MB), 실패 ${failed.length}장`);
  console.log(`[fetch] 메타데이터: ${outPath}`);
}

if (process.argv[1] && import.meta.url.endsWith(path.basename(process.argv[1]))) {
  main().catch((err) => {
    console.error('[fetch] 중단:', err);
    process.exit(1);
  });
}
