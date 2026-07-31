// 빌드타임 콘텐츠 파이프라인. 런타임 코드(src/)는 이 스크립트에서 건드리지 않는다.
//
// content/sentences.yaml + content/paintings.yaml → 정규화 → 임베딩 → 코사인 유사도 top8
// → content/curation.yaml 수동 오버라이드 적용 → public/pool.json + public/base-vectors.bin
// + scripts/out/curation-review.md
//
// 실행: npm run build:pool

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { load as loadYamlDoc } from 'js-yaml';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const CONTENT_DIR = join(ROOT, 'content');
const PUBLIC_DIR = join(ROOT, 'public');
const OUT_DIR = join(__dirname, 'out');

const NEIGHBOR_CANDIDATE_COUNT = 8;
const FALLBACK_NGRAM_DIM = 512;

interface SentenceInput {
  id: string;
  text: string;
  tags?: string[];
}

interface PaintingInput {
  id: string;
  imageFile: string;
  title: string;
  artist: string;
  sourceUrl: string;
  license: string;
  caption: string;
}

interface CurationOverride {
  fragmentId: string;
  neighborIds: string[];
}

interface Fragment {
  id: string;
  kind: 'sentence' | 'image';
  text?: string;
  imageUrl?: string;
  caption?: string;
  origin: 'base' | 'personal';
  neighborIds: string[];
  title?: string;
  artist?: string;
  sourceUrl?: string;
  license?: string;
}

function loadYaml<T>(filename: string): T {
  const raw = readFileSync(join(CONTENT_DIR, filename), 'utf-8');
  return loadYamlDoc(raw) as T;
}

function buildFragments(): { fragments: Fragment[]; embedText: string[] } {
  const sentences = loadYaml<SentenceInput[]>('sentences.yaml');
  const paintings = loadYaml<PaintingInput[]>('paintings.yaml');

  const fragments: Fragment[] = [];
  const embedText: string[] = [];

  for (const s of sentences) {
    fragments.push({
      id: s.id,
      kind: 'sentence',
      text: s.text,
      origin: 'base',
      neighborIds: [],
    });
    embedText.push(s.text);
  }

  for (const p of paintings) {
    fragments.push({
      id: p.id,
      kind: 'image',
      // imageFile에 '/'가 있으면 images/ 아래의 경로로 그대로 쓴다 (예: photos/rain.jpg).
      // 없으면 지금까지처럼 명화 폴더를 가리킨다 (기존 12점 + 미술관 100점).
      imageUrl: p.imageFile.includes('/')
        ? `/images/${p.imageFile}`
        : `/images/paintings/${p.imageFile}`,
      caption: p.caption,
      origin: 'base',
      neighborIds: [],
      title: p.title,
      artist: p.artist,
      sourceUrl: p.sourceUrl,
      license: p.license,
    });
    // 이미지는 caption을 임베딩 대상 텍스트로 사용한다
    embedText.push(p.caption);
  }

  return { fragments, embedText };
}

// ---- 임베딩: @xenova/transformers 우선, 실패 시 문자 3-gram 해시 벡터로 폴백 ----

async function embedWithTransformer(texts: string[]): Promise<Float32Array[] | null> {
  try {
    const { pipeline } = await import('@xenova/transformers');
    const extractor = await pipeline(
      'feature-extraction',
      'Xenova/paraphrase-multilingual-MiniLM-L12-v2',
    );
    const vectors: Float32Array[] = [];
    for (const text of texts) {
      const output = await extractor(text, { pooling: 'mean', normalize: true });
      vectors.push(Float32Array.from(output.data as Float32Array));
    }
    return vectors;
  } catch (err) {
    console.warn('[build-pool] 임베딩 모델 로드/추론 실패, 3-gram 폴백으로 전환:', err);
    return null;
  }
}

export function hashToBucket(gram: string, dim: number): number {
  let h = 2166136261;
  for (let i = 0; i < gram.length; i++) {
    h ^= gram.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h) % dim;
}

export function embedWithNgramFallback(texts: string[], dim = FALLBACK_NGRAM_DIM): Float32Array[] {
  return texts.map((text) => {
    const vec = new Float32Array(dim);
    const normalized = text.replace(/\s+/g, ' ').trim();
    for (let i = 0; i < normalized.length - 2; i++) {
      const gram = normalized.slice(i, i + 3);
      vec[hashToBucket(gram, dim)] += 1;
    }
    let norm = 0;
    for (let i = 0; i < dim; i++) norm += vec[i] * vec[i];
    norm = Math.sqrt(norm) || 1;
    for (let i = 0; i < dim; i++) vec[i] /= norm;
    return vec;
  });
}

export function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  let dot = 0;
  for (let i = 0; i < a.length; i++) dot += a[i] * b[i];
  return dot; // 두 벡터 모두 이미 정규화되어 있으므로 내적이 곧 코사인 유사도
}

export function topNeighborIds(
  index: number,
  fragments: Fragment[],
  vectors: Float32Array[],
  count: number,
): string[] {
  const scored = fragments
    .map((f, i) => ({ id: f.id, score: i === index ? -Infinity : cosineSimilarity(vectors[index], vectors[i]) }))
    .filter((s) => s.id !== fragments[index].id);
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, count).map((s) => s.id);
}

function writeBaseVectorsBin(vectors: Float32Array[], dim: number) {
  const flat = new Float32Array(vectors.length * dim);
  vectors.forEach((v, i) => flat.set(v, i * dim));
  writeFileSync(join(PUBLIC_DIR, 'base-vectors.bin'), Buffer.from(flat.buffer));
  return flat.byteLength;
}

function writeCurationReview(
  fragments: Fragment[],
  autoNeighbors: Map<string, string[]>,
  byId: Map<string, Fragment>,
) {
  const excerpt = (f: Fragment) => (f.kind === 'sentence' ? f.text ?? '' : f.caption ?? '').slice(0, 40);

  const lines: string[] = [
    '# 큐레이션 리뷰',
    '',
    '자동 추천 이웃(임베딩 코사인 유사도 상위 8개)을 검토하고, 필요한 조각은',
    '`content/curation.yaml`에 `{ fragmentId, neighborIds: [...] }` 형태로 옮겨 적으세요.',
    '이 파일에 등재되면 자동 추천을 완전히 덮어씁니다.',
    '',
    '| id | kind | 조각 내용 | 자동 추천 이웃 8개 |',
    '|---|---|---|---|',
  ];

  for (const f of fragments) {
    const neighbors = autoNeighbors.get(f.id) ?? [];
    const neighborCol = neighbors
      .map((nid) => {
        const nf = byId.get(nid);
        return nf ? `${nid}(${excerpt(nf)})` : nid;
      })
      .join(', ');
    lines.push(`| ${f.id} | ${f.kind} | ${excerpt(f)} | ${neighborCol} |`);
  }

  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(join(OUT_DIR, 'curation-review.md'), lines.join('\n') + '\n', 'utf-8');
}

async function main() {
  const { fragments, embedText } = buildFragments();

  let vectors = await embedWithTransformer(embedText);
  let dim: number;
  if (vectors) {
    dim = vectors[0].length;
    console.log(`[build-pool] transformers.js 임베딩 사용 (dim=${dim})`);
  } else {
    vectors = embedWithNgramFallback(embedText);
    dim = FALLBACK_NGRAM_DIM;
    console.log(`[build-pool] 3-gram 폴백 임베딩 사용 (dim=${dim})`);
  }

  const byId = new Map(fragments.map((f) => [f.id, f]));
  const autoNeighbors = new Map<string, string[]>();
  fragments.forEach((f, i) => {
    autoNeighbors.set(f.id, topNeighborIds(i, fragments, vectors!, NEIGHBOR_CANDIDATE_COUNT));
  });

  const curationOverrides = loadYaml<CurationOverride[] | null>('curation.yaml') ?? [];
  const overrideMap = new Map(curationOverrides.map((c) => [c.fragmentId, c.neighborIds]));

  for (const f of fragments) {
    f.neighborIds = overrideMap.get(f.id) ?? autoNeighbors.get(f.id) ?? [];
  }

  mkdirSync(PUBLIC_DIR, { recursive: true });
  writeFileSync(join(PUBLIC_DIR, 'pool.json'), JSON.stringify(fragments, null, 2), 'utf-8');

  const byteLength = writeBaseVectorsBin(vectors, dim);

  writeCurationReview(fragments, autoNeighbors, byId);

  const missingNeighbors = fragments.filter((f) => f.neighborIds.length < 4);
  if (missingNeighbors.length > 0) {
    console.warn(
      `[build-pool] 경고: neighborIds가 4개 미만인 조각 ${missingNeighbors.length}개:`,
      missingNeighbors.map((f) => f.id),
    );
  }

  console.log(`[build-pool] pool.json: 조각 ${fragments.length}개`);
  console.log(`[build-pool] base-vectors.bin: ${byteLength} bytes (${fragments.length} × ${dim} × 4 = ${fragments.length * dim * 4})`);
  console.log('[build-pool] curation-review.md 생성 완료');
}

// 이 스크립트를 직접 실행했을 때만 main()을 돌린다. 단위 테스트가 순수 함수만
// 가져다 쓰려고 import할 때 실제 파일 쓰기·모델 로딩이 함께 실행되는 것을 막는다.
const isDirectRun = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isDirectRun) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
