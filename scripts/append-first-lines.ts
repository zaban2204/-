// 유명한 소설의 첫 문장(30자 이내로 다듬음)을 content/sentences.yaml에 이어 붙인다.
// 원본은 사용자가 제공한 나무위키 "첫 문장이 유명한 작품/소설" 문서 발췌본이고,
// scripts/out/first-lines.json에 {text, tags: [작가, 작품명]} 형태로 정리해 두었다.
//
// 실행: npx tsx scripts/append-first-lines.ts

import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const ROOT = process.cwd();
const LINES_JSON = path.join(ROOT, 'scripts', 'out', 'first-lines.json');
const SENTENCES_YAML = path.join(ROOT, 'content', 'sentences.yaml');

interface FirstLine {
  text: string;
  tags: string[];
}

function yamlString(value: string): string {
  const escaped = value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  return `"${escaped}"`;
}

async function main() {
  const lines = JSON.parse(await readFile(LINES_JSON, 'utf8')) as FirstLine[];
  const yaml = await readFile(SENTENCES_YAML, 'utf8');

  const existingTexts = new Set(
    [...yaml.matchAll(/^\s*text:\s*(.+)$/gm)].map((m) => m[1].trim().replace(/^["']|["']$/g, '')),
  );
  const existingIds = [...yaml.matchAll(/^- id:\s*s(\d+)/gm)].map((m) => Number(m[1]));
  let next = Math.max(0, ...existingIds) + 1;

  const outLines: string[] = [];
  const skipped: string[] = [];
  let over30 = 0;

  for (const line of lines) {
    if (line.text.length > 30) {
      over30 += 1;
      continue;
    }
    if (existingTexts.has(line.text)) {
      skipped.push(line.text);
      continue;
    }
    existingTexts.add(line.text);
    const tagList = line.tags.map((t) => yamlString(t)).join(', ');
    outLines.push(`- id: s${next}`, `  text: ${yamlString(line.text)}`, `  tags: [${tagList}]`);
    next += 1;
  }

  const header = [
    '',
    '# ---- 아래부터는 유명한 소설의 첫 문장 (2026-07-31) ----',
    '# 사용자가 제공한 "첫 문장이 유명한 작품/소설" 발췌본에서, 30자를 넘는 원문은',
    '# 자연스러운 절 경계에서 잘라 다듬었다. tags는 [작가, 작품명]이다.',
    '',
  ];

  await writeFile(
    SENTENCES_YAML,
    `${yaml.trimEnd()}\n${header.join('\n')}${outLines.join('\n')}\n`,
    'utf8',
  );

  console.log(`[append] 첫 문장 ${outLines.length / 3}개 추가, 건너뜀 ${skipped.length}개, 30자 초과 제외 ${over30}개`);
  skipped.forEach((s) => console.log('  - 중복:', s));
}

if (process.argv[1] && import.meta.url.endsWith(path.basename(process.argv[1]))) {
  main().catch((err) => {
    console.error('[append] 중단:', err);
    process.exit(1);
  });
}
