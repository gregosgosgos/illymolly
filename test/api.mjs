/* =========================================================================
   test/api.mjs — 자동화 API (헤드리스 Node) 검증
   ========================================================================= */
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const illymolly = require('../index.js');

const results = [];
const check = (name, fn) => {
  try { results.push([name, true, fn() ?? '']); }
  catch (e) { results.push([name, false, e.message]); }
};
const eq = (a, b, msg) => { if (a !== b) throw new Error(`${msg || ''} ${JSON.stringify(a)} ≠ ${JSON.stringify(b)}`); };
const near = (a, b, t, msg) => { if (Math.abs(a - b) > (t ?? 0.01)) throw new Error(`${msg || ''} ${a} ≠ ${b}`); };

const fresh = (o) => { illymolly.resetIds(0); return illymolly.createDocument(o || { width: 400, height: 300 }); };

/* ---------- 결정적 동작 ---------- */
check('같은 스크립트는 같은 결과 (결정적 id)', () => {
  const build = () => {
    const illy = fresh();
    illy.addRect({ x: 10, y: 10, width: 100, height: 50, fill: '#f00' });
    illy.addEllipse({ x: 40, y: 40, width: 80, height: 80, fill: '#00f' });
    illy.addText({ x: 20, y: 200, text: '가나다 abc', size: 20 });
    return illy.toSVG();
  };
  const a = build(), b = build();
  eq(a, b, 'SVG 가 다름');
  if (!/path-3/.test(a)) { /* id 는 SVG 에 안 실림 — 아래에서 별도 확인 */ }
  const i1 = fresh(); i1.addRect({ x: 0, y: 0, width: 1, height: 1 });
  const i2 = fresh(); i2.addRect({ x: 0, y: 0, width: 1, height: 1 });
  eq(i1.find({ type: 'path' })[0], i2.find({ type: 'path' })[0], 'id 가 다름');
  return `${a.length}B 동일 · id ${i1.find({ type: 'path' })[0]}`;
});

/* ---------- 생성 · 조회 ---------- */
check('생성 후 get() 이 정확한 정보를 준다', () => {
  const illy = fresh();
  const id = illy.addRect({ x: 10, y: 20, width: 100, height: 50, radius: 8, fill: '#ff0000', stroke: '#000000', strokeWidth: 4, name: '박스' });
  const o = illy.get({ query: id });
  eq(o.id, id); eq(o.type, 'path'); eq(o.name, '박스');
  eq(o.shape.kind, 'rect'); eq(o.shape.r, 8);
  eq(o.fill.type, 'solid'); eq(o.fill.color, '#ff0000');
  eq(o.stroke.width, 4);
  near(o.geometricBounds.x, 10); near(o.geometricBounds.w, 100);
  near(o.bounds.x, 8, 0.01, '획 포함 바운딩');   /* 획 4pt 가운데 정렬 → 2pt 확장 */
  return `${o.type}/${o.shape.kind} bounds ${JSON.stringify(o.geometricBounds)}`;
});

check('선택자 — 타입 · 이름 · 정규식 · 칠 · 좌표', () => {
  const illy = fresh();
  illy.addRect({ x: 0, y: 0, width: 50, height: 50, fill: '#ff0000', name: 'box-1' });
  illy.addRect({ x: 100, y: 0, width: 50, height: 50, fill: '#00ff00', name: 'box-2' });
  illy.addText({ x: 10, y: 200, text: '안녕', name: 'label' });
  eq(illy.find({ type: 'text' }).length, 1, '타입 (축약 형태)');
  eq(illy.find({ query: { name: 'box-2' } }).length, 1, '이름');
  eq(illy.find({ query: { name: '/^box-/' } }).length, 2, '정규식');
  eq(illy.find({ query: { fill: 'red' } }).length, 1, '색 이름');
  eq(illy.find({ query: { at: { x: 25, y: 25 } } }).length, 1, '좌표');
  eq(illy.find({ query: { within: { x: -5, y: -5, w: 60, h: 60 } } }).length, 1, '영역 포함');
  eq(illy.find({ query: { text: '안녕' } }).length, 1, '텍스트 포함');
  eq(illy.find('*').length, 3, '전체 (문자열 축약)');
  return '7가지 질의 모두 정확';
});

check('인자 축약 형태를 모두 받는다', () => {
  const illy = fresh();
  illy.addRect({ x: 0, y: 0, width: 40, height: 40, name: '가' });
  illy.addRect({ x: 60, y: 0, width: 40, height: 40, name: '나' });
  eq(illy.find({ name: '가' }).length, 1, '선택자 객체만');
  eq(illy.get('가').name, '가', '문자열 선택자');
  illy.set('가', { fill: '#111111' });
  eq(illy.get('가').fill.color, '#111111', '(선택자, 인자)');
  illy.select('나');
  illy.move({ dx: 5, dy: 0 });
  near(illy.get('나').geometricBounds.x, 65, 0.01, '선택자 생략 = 현재 선택');
  const ids = illy.find(['가']);
  eq(ids.length, 1, '배열 선택자');
  return '객체 · 문자열 · (선택자,인자) · 생략 · 배열';
});

check('읽기 전용 연산은 실행 취소 스택을 건드리지 않는다', () => {
  const illy = fresh();
  illy.addRect({ x: 0, y: 0, width: 10, height: 10 });
  const before = illy.history().depth;
  illy.find('*'); illy.describe(); illy.snapshot(); illy.get('*'); illy.select('*'); illy.toSVG();
  eq(illy.history().depth, before, '조회로 깊이가 늘어남');
  illy.undo();
  eq(illy.find('*').length, 0, '한 번의 undo 로 도형이 사라져야 함');
  return `깊이 ${before} 유지 · undo 정상`;
});

/* ---------- 수정 ---------- */
check('set() 은 지정한 속성만 바꾼다', () => {
  const illy = fresh();
  const id = illy.addRect({ x: 0, y: 0, width: 50, height: 50, fill: '#ff0000', stroke: '#0000ff', strokeWidth: 5, opacity: 0.5 });
  illy.set({ query: id, fill: '#00ff00' });
  const o = illy.get({ query: id });
  eq(o.fill.color, '#00ff00');
  eq(o.stroke.color, '#0000ff', '획 색 유지');
  eq(o.stroke.width, 5, '획 두께 유지');
  eq(o.opacity, 0.5, '불투명도 유지');
  return '칠만 변경, 나머지 보존';
});

check('변형 — move / setBounds / rotate / scale', () => {
  const illy = fresh();
  const id = illy.addRect({ x: 100, y: 100, width: 100, height: 50 });
  illy.move({ query: id, dx: 20, dy: -10 });
  near(illy.get({ query: id }).geometricBounds.x, 120, 0.01, 'move x');
  illy.setBounds({ query: id, x: 0, y: 0, width: 200, height: 100, anchor: 0 });
  const b = illy.get({ query: id }).geometricBounds;
  near(b.x, 0); near(b.y, 0); near(b.w, 200); near(b.h, 100);
  illy.rotate({ query: id, angle: 90 });
  const r = illy.get({ query: id }).geometricBounds;
  near(r.w, 100, 0.01, '90도 회전 후 폭'); near(r.h, 200, 0.01, '높이');
  illy.scale({ query: id, sx: 0.5 });
  near(illy.get({ query: id }).geometricBounds.w, 50, 0.01, '축소');
  return '4가지 변형 정확';
});

check('setBounds anchor 가 기준점으로 동작', () => {
  const illy = fresh();
  const id = illy.addRect({ x: 100, y: 100, width: 100, height: 100 });
  illy.setBounds({ query: id, width: 50, height: 50, anchor: 8 });   /* 우하단 고정 */
  const b = illy.get({ query: id }).geometricBounds;
  near(b.x + b.w, 200, 0.01, '오른쪽 유지'); near(b.y + b.h, 200, 0.01, '아래 유지');
  return `x${b.x} y${b.y} w${b.w}`;
});

/* ---------- 패스파인더 ---------- */
check('패스파인더 unite 면적', () => {
  const illy = fresh();
  const a = illy.addRect({ x: 0, y: 0, width: 100, height: 100 });
  const b = illy.addRect({ x: 50, y: 50, width: 100, height: 100 });
  illy.pathfinder({ query: [a, b], operation: 'unite' });
  const o = illy.get({ query: { type: 'path' } });
  const area = o.geometricBounds.w * o.geometricBounds.h;
  eq(illy.find({ query: '*' }).length, 1, '결과가 1개');
  near(area, 150 * 150, 1, '바운딩');
  return `합쳐진 바운딩 ${o.geometricBounds.w}×${o.geometricBounds.h}`;
});

/* ---------- 원자적 배치 ---------- */
check('batch() 성공 시 결과 배열', () => {
  const illy = fresh();
  const r = illy.batch([
    { op: 'addRect', args: { x: 0, y: 0, width: 10, height: 10 } },
    { op: 'addRect', args: { x: 20, y: 0, width: 10, height: 10 } },
    { op: 'find', args: { query: '*' } }
  ]);
  if (!r.ok) throw new Error(JSON.stringify(r.error));
  eq(r.results[2].length, 2);
  return `${r.results.length}개 연산`;
});

check('batch() 실패 시 전부 롤백', () => {
  const illy = fresh();
  illy.addRect({ x: 0, y: 0, width: 10, height: 10 });
  const before = illy.find({ query: '*' }).length;
  const r = illy.batch([
    { op: 'addRect', args: { x: 50, y: 0, width: 10, height: 10 } },
    { op: 'addEllipse', args: { x: 60, y: 0, width: 10, height: 10 } },
    { op: 'align', args: { query: '*', mode: '없는모드' } }
  ]);
  if (r.ok) throw new Error('실패해야 하는데 성공함');
  eq(r.failedAt, 2, '실패 지점');
  eq(r.failedOp, 'align');
  eq(r.rolledBack, true);
  eq(illy.find({ query: '*' }).length, before, '롤백 후 개수');
  return `${r.failedOp} 에서 실패 → ${before}개로 복원`;
});

check('transaction() 은 하나의 실행 취소 단위', () => {
  const illy = fresh();
  illy.transaction('3개 추가', (a) => {
    a.addRect({ x: 0, y: 0, width: 10, height: 10 });
    a.addRect({ x: 20, y: 0, width: 10, height: 10 });
    a.addRect({ x: 40, y: 0, width: 10, height: 10 });
  });
  eq(illy.find({ query: '*' }).length, 3);
  illy.undo();
  eq(illy.find({ query: '*' }).length, 0, 'undo 한 번에 전부 취소');
  illy.redo();
  eq(illy.find({ query: '*' }).length, 3, 'redo');
  return '3개 추가 → undo 1회 → 0개';
});

/* ---------- 오류 메시지 ---------- */
check('오류가 원인을 정확히 알려 준다', () => {
  const illy = fresh();
  const r1 = illy.run('addRekt', {});
  if (r1.ok || r1.error.code !== 'NO_OP') throw new Error('알 수 없는 연산 처리 실패');
  if (!/addRect/.test(r1.error.message)) throw new Error('비슷한 이름 제안 없음: ' + r1.error.message);

  const r2 = illy.run('addRect', { x: 0, y: 0, width: 10 });
  if (r2.ok || r2.error.code !== 'MISSING_ARG') throw new Error('필수 인자 검사 실패');
  if (!/height/.test(r2.error.message)) throw new Error(r2.error.message);

  const r3 = illy.run('addRect', { x: 0, y: 0, width: 10, height: 10, colour: 'red' });
  if (r3.ok || r3.error.code !== 'UNKNOWN_ARG') throw new Error('오타 인자 검사 실패');
  if (!/fill/.test(r3.error.message)) throw new Error('사용 가능 인자 안내 없음');

  const r4 = illy.run('align', { query: '*', mode: 'diagonal' });
  if (r4.ok || !/left/.test(r4.error.message)) throw new Error('enum 안내 없음: ' + JSON.stringify(r4.error));

  const r5 = illy.run('addRect', { x: 0, y: 0, width: 10, height: 10, fill: 'notacolor' });
  if (r5.ok || r5.error.code !== 'BAD_COLOR') throw new Error('색상 검증 실패');

  const r6 = illy.run('move', { query: { name: '없는이름' }, dx: 1 });
  if (r6.ok || r6.error.code !== 'NO_TARGET') throw new Error('빈 대상 처리 실패');
  return '알 수 없는 연산 · 누락 · 오타 · enum · 색상 · 빈 대상';
});

check('실패한 연산은 문서를 건드리지 않는다', () => {
  const illy = fresh();
  illy.addRect({ x: 0, y: 0, width: 10, height: 10 });
  const before = illy.toJSON();
  illy.run('addRect', { x: 0, y: 0, width: 10, height: 10, bogus: 1 });
  eq(illy.toJSON(), before, '실패 후 문서 변경됨');
  return '변경 없음';
});

/* ---------- 스냅샷 · 매니페스트 ---------- */
check('snapshot() · describe() 가 상태를 그대로 담는다', () => {
  const illy = fresh();
  illy.addLayer({ name: '전경' });
  illy.addRect({ x: 0, y: 0, width: 10, height: 10, name: 'A', layer: '전경' });
  illy.select({ query: { name: 'A' } });
  const s = illy.snapshot();
  eq(s.document.layers.length, 2);
  eq(s.layers[1].name, '전경');
  eq(s.layers[1].items[0].name, 'A');
  eq(s.selection.length, 1);
  const d = illy.describe();
  if (!/전경/.test(d) || !/▶/.test(d)) throw new Error('describe 내용 부족:\n' + d);
  return `레이어 ${s.document.layers.length}개 · describe ${d.split('\n').length}줄`;
});

check('ops() 매니페스트가 실제 구현과 일치', () => {
  const illy = fresh();
  const ops = illy.ops();
  if (ops.length < 30) throw new Error('연산 수 ' + ops.length);
  for (const o of ops) {
    if (!o.description) throw new Error(o.name + ': 설명 없음');
    if (!o.parameters || o.parameters.type !== 'object') throw new Error(o.name + ': 파라미터 스키마 없음');
    for (const k of o.parameters.required) {
      if (!o.parameters.properties[k]) throw new Error(o.name + ': required 에 없는 속성 ' + k);
    }
    if (typeof illy[o.name] !== 'function') throw new Error(o.name + ': 메서드 미노출');
    if (typeof o.undoable !== 'boolean') throw new Error(o.name + ': undoable 표시 없음');
  }
  const h = illy.help('addRect');
  if (!/width/.test(h)) throw new Error('help 내용 부족');
  return `${ops.length}개 연산 · 모두 스키마/메서드 일치`;
});

/* ---------- 입출력 ---------- */
check('JSON 왕복', () => {
  const illy = fresh();
  illy.addRect({ x: 10, y: 20, width: 100, height: 50, fill: '#123456', radius: 4 });
  illy.addText({ x: 5, y: 90, text: '왕복\n두 줄', size: 18 });
  const json = illy.toJSON();
  const re = illymolly.openDocument(json);
  eq(re.toJSON(), json, 'JSON 이 다름');
  eq(re.find({ query: '*' }).length, 2);
  return `${json.length}B 동일`;
});

check('SVG 출력이 유효하고 내용을 담는다', () => {
  const illy = fresh();
  illy.addRect({ x: 0, y: 0, width: 100, height: 100, fill: '#abcdef' });
  illy.addText({ x: 10, y: 50, text: 'SVG', size: 20, fill: '#123' });
  const svg = illy.toSVG();
  if (!/^<\?xml/.test(svg)) throw new Error('XML 선언 없음');
  if (!/<svg[^>]+width="400"/.test(svg)) throw new Error('크기 없음');
  if (!/#abcdef/.test(svg)) throw new Error('칠 색 없음');
  if (!/<text/.test(svg) || !/SVG<\/tspan>/.test(svg)) throw new Error('텍스트 없음');
  return `${svg.length}B`;
});

check('Node 에서 toPNG 는 안내와 함께 실패', () => {
  const illy = fresh();
  const r = illy.run('toPNG', {});
  if (r.ok) throw new Error('Node 에서 성공하면 안 됨');
  eq(r.error.code, 'NO_CANVAS');
  if (!/toSVG/.test(r.error.message)) throw new Error('대안 안내 없음');
  return r.error.message;
});

check('캔버스 없이도 텍스트 바운딩을 계산한다', () => {
  const illy = fresh();
  const id = illy.addText({ x: 0, y: 100, text: '가나다 ABC', size: 40 });
  const b = illy.get({ query: id }).geometricBounds;
  if (!(b.w > 40) || !(b.h > 20)) throw new Error(JSON.stringify(b));
  return `근사 폭 ${b.w}, 높이 ${b.h}`;
});

/* ---------- 결과 ---------- */
console.log('\n=== 자동화 API (Node 헤드리스) ===');
let fail = 0;
for (const [n, ok, d] of results) {
  if (!ok) fail++;
  console.log(`${ok ? '✔' : '✘'} ${n}${d ? ' — ' + d : ''}`);
}
console.log(`\n${results.length - fail}/${results.length} 통과`);
process.exit(fail ? 1 : 0);
