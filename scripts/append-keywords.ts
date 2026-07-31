// 짧은 키워드 조각을 content/sentences.yaml에 이어 붙인다.
// 창작 프롬프트 목록('연성 100제' 류)에서 흔히 쓰는 짧은 소재의 결을 참고해
// 직접 만든 목록이다 (scripts/out/keywords.json).
//
// 실행: npx tsx scripts/append-keywords.ts

import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const ROOT = process.cwd();
const KEYWORDS_JSON = path.join(ROOT, 'scripts', 'out', 'keywords.json');
const SENTENCES_YAML = path.join(ROOT, 'content', 'sentences.yaml');

function yamlString(value: string): string {
  const escaped = value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  return `"${escaped}"`;
}

async function main() {
  const groups = JSON.parse(await readFile(KEYWORDS_JSON, 'utf8')) as Record<string, string[]>;
  const yaml = await readFile(SENTENCES_YAML, 'utf8');

  // 이미 있는 문장·키워드와 겹치지 않게, 그리고 id는 마지막 번호 뒤부터
  const existingTexts = new Set(
    [...yaml.matchAll(/^\s*text:\s*(.+)$/gm)].map((m) => m[1].trim().replace(/^["']|["']$/g, '')),
  );
  const existingIds = [...yaml.matchAll(/^- id:\s*s(\d+)/gm)].map((m) => Number(m[1]));
  let next = Math.max(0, ...existingIds) + 1;

  const lines: string[] = [];
  const skipped: string[] = [];

  for (const [category, keywords] of Object.entries(groups)) {
    for (const keyword of keywords) {
      if (existingTexts.has(keyword)) {
        skipped.push(keyword);
        continue;
      }
      existingTexts.add(keyword);
      lines.push(
        `- id: s${next}`,
        `  text: ${yamlString(keyword)}`,
        `  tags: [키워드, ${category}]`,
      );
      next += 1;
    }
  }

  const header = [
    '',
    '# ---- 아래부터는 짧은 키워드 조각 100개 (2026-07-31) ----',
    '# 위쪽 문장 조각이 "완성된 한 문장"이라면, 이쪽은 두 단어 내외의 소재다.',
    '# 창작 프롬프트 목록(연성 100제 류)에서 쓰는 짧은 소재의 결을 참고해 직접 만들었다.',
    '# tags의 두 번째 값은 계열(계절과 시간/사물/장소/관계와 감정/몸짓/상태)이다 —',
    '# 임베딩에는 text만 쓰이고 tags는 나중에 큐레이션할 때 보기 위한 표시다.',
    '',
  ];

  await writeFile(SENTENCES_YAML, `${yaml.trimEnd()}\n${header.join('\n')}${lines.join('\n')}\n`, 'utf8');
  console.log(`[append] 키워드 ${lines.length / 3}개 추가, 건너뜀 ${skipped.length}개`);
  skipped.forEach((s) => console.log('  -', s));
}

if (process.argv[1] && import.meta.url.endsWith(path.basename(process.argv[1]))) {
  main().catch((err) => {
    console.error('[append] 중단:', err);
    process.exit(1);
  });
}
