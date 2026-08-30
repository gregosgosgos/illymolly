/* =========================================================================
   index.js — Node 진입점 (헤드리스)
   -------------------------------------------------------------------------
   브라우저 없이 문서를 만들고 SVG/JSON 으로 내보낸다.

     const illymolly = require('illymolly');
     const illy = illymolly.createDocument({ width: 400, height: 300 });
     illy.addRect({ x: 20, y: 20, width: 200, height: 120, fill: '#f06' });
     console.log(illy.toSVG());

   PNG 출력과 GUI 연동(setTool/zoom)은 브라우저에서만 동작한다.
   ========================================================================= */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

/* 브라우저와 같은 소스를 그대로 읽어 들인다 — 빌드 단계도, 코드 사본도 없다 */
const CORE = [
  'util', 'color', 'model', 'geom', 'pathfinder', 'history',
  'appearance', 'assets', 'distort', 'threed', 'effects', 'render', 'hit', 'view', 'edit', 'styles', 'docs', 'autosave', 'trace', 'pdf', 'io', 'api'
];

function load() {
  if (globalThis.AI && globalThis.AI.api) return globalThis.AI;
  for (const name of CORE) {
    const file = path.join(__dirname, 'src', name + '.js');
    vm.runInThisContext(fs.readFileSync(file, 'utf8'), { filename: file });
  }
  return globalThis.AI;
}

const AI = load();

module.exports = {
  AI,
  version: AI.api.VERSION,

  /** 새 헤드리스 문서를 만들고 illy API 를 반환한다. */
  createDocument(opts) {
    return AI.api.create(AI.api.headless(opts || {}));
  },

  /** 저장 파일(JSON 문자열 또는 객체)에서 문서를 연다. */
  openDocument(json) {
    const illy = module.exports.createDocument({});
    illy.loadJSON({ json: typeof json === 'string' ? json : JSON.stringify(json) });
    return illy;
  },

  /** 도구 매니페스트 (LLM 함수 정의로 그대로 사용 가능) */
  ops(group) {
    return AI.api.create(AI.api.headless({})).ops(group);
  },

  /** 결정적 id 를 위해 카운터를 리셋 — 재현 가능한 스크립트를 만들 때 */
  resetIds(n) { AI.util.resetIds(n || 0); }
};
