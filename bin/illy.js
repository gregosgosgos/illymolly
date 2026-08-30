#!/usr/bin/env node
/* =========================================================================
   bin/illy.js — 명령줄 인터페이스 (헤드리스)
   -------------------------------------------------------------------------
     illy run <script.js> [-o out.svg|out.json] [--describe]
     illy render <doc.illy.json> -o <out.svg>
     illy info <doc.illy.json>
     illy ops [group] [--json]
   ========================================================================= */
'use strict';
const fs = require('fs');
const path = require('path');
const illymolly = require('../index.js');

const argv = process.argv.slice(2);
const cmd = argv[0];

function flag(name, short) {
  const i = argv.findIndex(a => a === '--' + name || (short && a === '-' + short));
  if (i < 0) return null;
  const v = argv[i + 1];
  return (v && !v.startsWith('-')) ? v : true;
}
function has(name) { return argv.includes('--' + name); }

function usage(code) {
  console.log(`Illymolly CLI ${illymolly.version} — 헤드리스 벡터 문서 도구

  illy run <script.js> [-o 출력파일] [--describe]
      script.js 안에서 전역 illy 로 문서를 만들고 SVG/JSON 으로 저장합니다.
      -o 확장자가 .json 이면 문서 JSON, 그 외에는 SVG 로 저장합니다.
      -o 를 생략하면 표준 출력으로 SVG 를 내보냅니다.

  illy render <문서.illy.json> -o <출력.svg>
      저장된 문서를 SVG 로 변환합니다.

  illy info <문서.illy.json>
      문서 구조를 사람이 읽는 요약으로 출력합니다.

  illy ops [그룹] [--json]
      사용 가능한 연산 목록(도구 매니페스트)을 출력합니다.
      --json 을 붙이면 LLM 함수 정의로 바로 쓸 수 있는 JSON 을 냅니다.

  PNG 출력은 캔버스가 필요해 브라우저에서만 지원합니다 (illy.toPNG()).`);
  process.exit(code || 0);
}

function write(out, text, kind) {
  if (!out || out === true) { process.stdout.write(text); return; }
  fs.writeFileSync(out, text);
  console.error(`${kind} 저장: ${out} (${Buffer.byteLength(text)} bytes)`);
}

try {
  if (!cmd || cmd === 'help' || cmd === '--help' || cmd === '-h') usage(0);

  if (cmd === 'ops') {
    const group = argv[1] && !argv[1].startsWith('-') ? argv[1] : null;
    const list = illymolly.ops(group);
    if (has('json')) { console.log(JSON.stringify(list, null, 2)); process.exit(0); }
    let cur = null;
    for (const o of list) {
      if (o.group !== cur) { cur = o.group; console.log(`\n[${cur}]`); }
      const req = o.parameters.required;
      const ps = Object.keys(o.parameters.properties)
        .map(k => (req.includes(k) ? k + '*' : k)).join(', ');
      console.log(`  ${o.name}(${ps})\n      ${o.description}`);
    }
    console.log('\n* = 필수');
    process.exit(0);
  }

  if (cmd === 'info') {
    const file = argv[1];
    if (!file) usage(1);
    const illy = illymolly.openDocument(fs.readFileSync(file, 'utf8'));
    console.log(illy.describe());
    process.exit(0);
  }

  if (cmd === 'render') {
    const file = argv[1];
    if (!file) usage(1);
    const illy = illymolly.openDocument(fs.readFileSync(file, 'utf8'));
    write(flag('out', 'o'), illy.toSVG(), 'SVG');
    process.exit(0);
  }

  if (cmd === 'run') {
    const file = argv[1];
    if (!file) usage(1);
    const code = fs.readFileSync(file, 'utf8');
    const illy = illymolly.createDocument({});
    /* 스크립트에 illy 와 표준 전역만 노출한다 */
    const fn = new Function('illy', 'console', 'require', '__filename', '__dirname', code);
    fn(illy, console, require, path.resolve(file), path.dirname(path.resolve(file)));
    if (has('describe')) console.error(illy.describe());
    const out = flag('out', 'o');
    const asJson = typeof out === 'string' && /\.json$/i.test(out);
    write(out, asJson ? illy.toJSON() : illy.toSVG(), asJson ? 'JSON' : 'SVG');
    process.exit(0);
  }

  console.error(`알 수 없는 명령: ${cmd}\n`);
  usage(1);
} catch (e) {
  console.error(`오류: ${e.message}`);
  if (process.env.ILLY_DEBUG) console.error(e.stack);
  process.exit(1);
}
