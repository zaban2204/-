// fetch-museum-images.ts로 받아 둔 메타데이터 + 직접 쓴 caption을
// content/paintings.yaml에 이어 붙인다.
//
// 실행: npx tsx scripts/append-paintings.ts

import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const ROOT = process.cwd();
const FETCH_JSON = path.join(ROOT, 'scripts', 'out', 'museum-fetch.json');
const CAPTIONS_JSON = path.join(ROOT, 'scripts', 'out', 'captions.json');
const PAINTINGS_YAML = path.join(ROOT, 'content', 'paintings.yaml');

interface Saved {
  source: 'cma' | 'met';
  title: string;
  artist: string;
  date: string;
  imageFile: string;
  pageUrl: string;
}

// YAML 평문 스칼라로 두면 위험한 글자들(콜론+공백, 따옴표, #, 앞뒤 공백)이 제목에
// 흔히 들어 있다. 전부 큰따옴표로 감싸고 내부를 이스케이프한다.
function yamlString(value: string): string {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

// "Théodule Ribot (French, 1823–1891)" → "Théodule Ribot"
// 국적·생몰년은 각주에 넣기엔 길다. 이름만 남긴다.
function cleanArtist(artist: string): string {
  const withoutParens = artist.replace(/\s*\([^)]*\)\s*$/, '').trim();
  return withoutParens.length > 0 ? withoutParens : artist.trim();
}

const SOURCE_LABEL: Record<Saved['source'], string> = {
  cma: 'Cleveland Museum of Art (CC0)',
  met: 'The Metropolitan Museum of Art (Public Domain)',
};

async function main() {
  const { saved } = JSON.parse(await readFile(FETCH_JSON, 'utf8')) as { saved: Saved[] };
  const captions = JSON.parse(await readFile(CAPTIONS_JSON, 'utf8')) as Record<string, string>;
  const yaml = await readFile(PAINTINGS_YAML, 'utf8');

  // 기존 id 중 가장 큰 번호 뒤부터 이어 붙인다 (p01..p12 → p13..)
  const existingIds = [...yaml.matchAll(/^- id:\s*p(\d+)/gm)].map((m) => Number(m[1]));
  let next = Math.max(0, ...existingIds) + 1;
  const existingFiles = new Set([...yaml.matchAll(/imageFile:\s*(\S+)/g)].map((m) => m[1]));

  const lines: string[] = [];
  const skipped: string[] = [];

  for (const item of saved) {
    const caption = captions[item.imageFile];
    if (!caption) {
      skipped.push(`${item.imageFile} (caption 없음)`);
      continue;
    }
    if (existingFiles.has(item.imageFile)) {
      skipped.push(`${item.imageFile} (이미 등재됨)`);
      continue;
    }
    const id = `p${String(next).padStart(2, '0')}`;
    next += 1;
    existingFiles.add(item.imageFile);
    lines.push(
      `- id: ${id}`,
      `  imageFile: ${item.imageFile}`,
      `  title: ${yamlString(item.title)}`,
      `  artist: ${yamlString(cleanArtist(item.artist))}`,
      `  sourceUrl: ${item.pageUrl}`,
      `  license: ${yamlString(SOURCE_LABEL[item.source])}`,
      `  caption: ${yamlString(caption)}`,
    );
  }

  const header = [
    '',
    '# ---- 아래부터는 공개 API에서 무작위로 보충한 100점 (2026-07-31) ----',
    '# 출처: 메트로폴리탄 미술관 Open Access(퍼블릭도메인), 클리블랜드미술관 Open Access(CC0).',
    '# 두 곳 모두 프로그램 접근을 허용하는 공식 API다. 받아오는 스크립트는',
    '# scripts/fetch-museum-images.ts, 이 항목들을 만든 스크립트는 scripts/append-paintings.ts.',
    '# title·artist는 미술관이 제공한 원문 그대로 두고(각주 표기용), caption은 작품의',
    '# 제목·주제 태그를 근거로 직접 쓴 한국어 서술이다(임베딩 대상 텍스트).',
    '',
  ];

  await writeFile(PAINTINGS_YAML, `${yaml.trimEnd()}\n${header.join('\n')}${lines.join('\n')}\n`, 'utf8');

  console.log(`[append] ${(lines.length / 7) | 0}점 추가 (id p${existingIds.length + 1
    } 이후), 건너뜀 ${skipped.length}점`);
  skipped.forEach((s) => console.log('  -', s));
}

if (process.argv[1] && import.meta.url.endsWith(path.basename(process.argv[1]))) {
  main().catch((err) => {
    console.error('[append] 중단:', err);
    process.exit(1);
  });
}
