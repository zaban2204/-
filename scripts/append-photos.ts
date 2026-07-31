// fetch-open-images.ts로 받아 둔 사진 메타데이터 중 선별한 100장 + 직접 쓴
// caption을 content/paintings.yaml에 이어 붙인다. (파일 이름은 paintings.yaml이지만
// 이미지 조각 전반을 담는 곳이라 사진도 여기 들어간다 — imageFile이 'photos/'로
// 시작하면 build-pool.ts가 public/images/photos/를 가리키도록 이미 되어 있다.)
//
// 입력: scripts/out/photo-fetch-100.json (선별된 100장), scripts/out/photo-captions.json
// 실행: npx tsx scripts/append-photos.ts

import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const ROOT = process.cwd();
const SELECTED_JSON = path.join(ROOT, 'scripts', 'out', 'photo-fetch-100.json');
const CAPTIONS_JSON = path.join(ROOT, 'scripts', 'out', 'photo-captions.json');
const PAINTINGS_YAML = path.join(ROOT, 'content', 'paintings.yaml');

interface Saved {
  source: 'openverse' | 'loc' | 'nasa';
  title: string;
  creator: string;
  license: string;
  imageFile: string;
  pageUrl: string;
}

function yamlString(value: string): string {
  const escaped = value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  return `"${escaped}"`;
}

async function main() {
  const { saved } = JSON.parse(await readFile(SELECTED_JSON, 'utf8')) as { saved: Saved[] };
  const captions = JSON.parse(await readFile(CAPTIONS_JSON, 'utf8')) as Record<string, string>;
  const yaml = await readFile(PAINTINGS_YAML, 'utf8');

  const existingIds = [...yaml.matchAll(/^- id:\s*p(\d+)/gm)].map((m) => Number(m[1]));
  let next = Math.max(0, ...existingIds) + 1;
  const existingFiles = new Set([...yaml.matchAll(/imageFile:\s*(\S+)/g)].map((m) => m[1]));

  const lines: string[] = [];
  const skipped: string[] = [];

  for (const item of saved) {
    const key = item.imageFile.replace('photos/', '');
    const caption = captions[key];
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
      `  artist: ${yamlString(item.creator)}`,
      `  sourceUrl: ${item.pageUrl}`,
      `  license: ${yamlString(item.license)}`,
      `  caption: ${yamlString(caption)}`,
    );
  }

  const header = [
    '',
    '# ---- 아래부터는 명화 이외의 사진·이미지 조각 100장 (2026-07-31) ----',
    '# 출처: Openverse(CC0/퍼블릭도메인 마크만 필터), 미국 의회도서관 FSA/OWI 다큐멘터리',
    '# 사진(미국 정부 저작물, 퍼블릭도메인), NASA(퍼블릭도메인). 파일은',
    '# public/images/photos/에 있다(명화는 public/images/paintings/와 구분).',
    '# 받아오는 스크립트는 scripts/fetch-open-images.ts, 이 항목을 만든 스크립트는',
    '# scripts/append-photos.ts. title·artist(creator)는 출처 원문 그대로,',
    '# caption은 제목과 검색 키워드를 근거로 직접 쓴 한국어 서술이다.',
    '',
  ];

  await writeFile(
    PAINTINGS_YAML,
    `${yaml.trimEnd()}\n${header.join('\n')}${lines.join('\n')}\n`,
    'utf8',
  );

  console.log(`[append] ${lines.length / 7}장 추가, 건너뜀 ${skipped.length}장`);
  skipped.forEach((s) => console.log('  -', s));
}

if (process.argv[1] && import.meta.url.endsWith(path.basename(process.argv[1]))) {
  main().catch((err) => {
    console.error('[append] 중단:', err);
    process.exit(1);
  });
}
