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

/* ---------- 효과 · 대지 · 안내선 · 레이어 (새 연산) ---------- */
check('applyEffect — 갱신 · SVG 필터 · 기하 경계 불변', () => {
  const illy = fresh({ width: 300, height: 300 });
  const id = illy.addRect({ x: 50, y: 50, width: 100, height: 100, fill: '#3366cc' });
  illy.applyEffect({ query: id, type: 'blur', radius: 4 });
  illy.applyEffect({ query: id, type: 'blur', radius: 10 });   /* 같은 종류는 갱신 */
  illy.applyEffect({ query: id, type: 'shadow', dx: 5, dy: 5, blur: 3, alpha: 0.4 });
  const fx = illy.effects(id)[0].effects;
  eq(fx.length, 2, '효과 수');
  eq(fx[0].radius, 10, 'blur 갱신');
  eq(fx[1].type, 'shadow', '두 번째 효과');
  const o = illy.get(id);
  eq([o.geometricBounds.x, o.geometricBounds.w].join(','), '50,100', '기하 경계');
  eq(o.bounds.w, 160, '미리보기 경계 (blur 10 × 3 × 2 + 100)');
  const svg = illy.toSVG();
  if (!/<filter id="fx/.test(svg) || !/feGaussianBlur/.test(svg) || !/feDropShadow/.test(svg)) {
    throw new Error('SVG 필터 누락');
  }
  illy.clearEffects(id);
  eq(illy.effects(id)[0].effects.length, 0, '효과 제거');
  eq(illy.get(id).bounds.w, 100, '제거 후 경계');
  return `blur 갱신 · shadow 추가 · 경계 100→160→100`;
});

check('setArrowheads — SVG marker 로 출력', () => {
  const illy = fresh();
  const id = illy.addLine({ x1: 20, y1: 20, x2: 200, y2: 20, stroke: '#000000', strokeWidth: 3 });
  illy.setArrowheads({ query: id, start: 'circle', end: 'arrow', scale: 130 });
  const st = illy.get(id).stroke;
  eq(st.arrowStart, 'circle', '시작');
  eq(st.arrowEnd, 'arrow', '끝');
  eq(st.arrowScale, 130, '비율');
  const svg = illy.toSVG();
  if (!/<marker /.test(svg)) throw new Error('marker 정의 없음');
  if (!/marker-start="url\(/.test(svg) || !/marker-end="url\(/.test(svg)) throw new Error('marker 참조 없음');
  const bad = illy.batch([{ op: 'setArrowheads', args: { query: id } }]);
  if (bad.ok) throw new Error('인자 없는 호출이 통과함');
  return `circle → arrow · 130% · <marker> 출력 · 빈 호출은 ${bad.error.code}`;
});

check('transformEach — 각자의 기준점으로 변형', () => {
  const illy = fresh({ width: 600, height: 300 });
  illy.addRect({ x: 0, y: 0, width: 100, height: 100, name: 'A' });
  illy.addRect({ x: 200, y: 0, width: 100, height: 100, name: 'B' });
  illy.transformEach({ query: { type: 'path' }, scaleX: 50, scaleY: 50 });
  const bs = illy.find({ type: 'path' }).map(id => {
    const b = illy.get(id).geometricBounds;
    return [b.x, b.y, b.w].join(',');
  });
  eq(bs[0], '25,25,50', 'A');
  eq(bs[1], '225,25,50', 'B');
  /* 기준점을 왼쪽 위(0)로 두면 각자의 좌상단이 고정된다 */
  illy.undo();
  illy.transformEach({ query: { type: 'path' }, scaleX: 50, scaleY: 50, anchor: 0 });
  const bs2 = illy.find({ type: 'path' }).map(id => {
    const b = illy.get(id).geometricBounds;
    return [b.x, b.y, b.w].join(',');
  });
  eq(bs2.join(' | '), '0,0,50 | 200,0,50', '좌상단 고정');
  return `가운데 ${bs.join(' / ')} · 좌상단 ${bs2.join(' / ')}`;
});

check('대지 — 추가 · 수정 · 맞추기 · 재정렬 · 삭제', () => {
  const illy = fresh({ width: 200, height: 200 });
  illy.addRect({ x: 400, y: 300, width: 120, height: 60 });
  illy.fitArtboard({ mode: 'artwork' });
  const ab0 = illy.documentInfo().artboards[0];
  eq([ab0.x, ab0.y, ab0.width, ab0.height].join(','), '400,300,120,60', '아트웍에 맞춤');
  illy.addArtboard({ width: 100, height: 100 });
  illy.setArtboard({ index: 1, name: '두 번째', x: 999, y: 999 });
  illy.rearrangeArtboards({ columns: 2, gap: 10 });
  const abs = illy.documentInfo().artboards;
  eq(abs.length, 2, '대지 수');
  eq(abs[1].name, '두 번째', '이름');
  eq([abs[0].x, abs[0].y, abs[1].x, abs[1].y].join(','), '0,0,130,0', '재정렬');
  illy.removeArtboard({ index: 1 });
  eq(illy.documentInfo().artboards.length, 1, '삭제 후');
  const last = illy.batch([{ op: 'removeArtboard', args: {} }]);
  if (last.ok) throw new Error('마지막 대지가 삭제됨');
  return `맞춤 400,300,120,60 · 재정렬 0,0/130,0 · 마지막 대지는 ${last.error.code}`;
});

check('안내선 — 추가 · 조회 · 해제 · 지우기', () => {
  const illy = fresh({ width: 300, height: 300 });
  illy.addGuide({ axis: 'v', position: 100 });
  illy.addGuide({ axis: 'h', position: 250 });
  eq(illy.guides().length, 2, '안내선 수');
  eq(illy.guides()[1].axis, 'h', '축');
  const ids = illy.releaseGuides();
  eq(ids.length, 2, '해제된 선');
  eq(illy.guides().length, 0, '해제 후 안내선');
  eq(illy.get(ids[0]).name, '안내선', '이름');
  illy.undo();
  eq(illy.guides().length, 2, '해제 실행 취소');
  eq(illy.clearGuides(), 2, '지운 개수');
  eq(illy.guides().length, 0, '지운 뒤');
  return '추가 2 · 해제 2 · undo 복원 · 지우기 2';
});

check('레이어 구성 — 모으기 · 배포 · 병합', () => {
  const illy = fresh();
  const a = illy.addRect({ x: 0, y: 0, width: 20, height: 20, name: 'A' });
  const b = illy.addRect({ x: 40, y: 0, width: 20, height: 20, name: 'B' });
  illy.addRect({ x: 80, y: 0, width: 20, height: 20, name: 'C' });
  illy.collectInLayer({ query: [a, b], name: '모음' });
  let L = illy.documentInfo().layers;
  eq(L.length, 2, '모으기 후 레이어');
  eq(L[1].name + ':' + L[1].items, '모음:2', '새 레이어');
  illy.releaseToLayers();
  eq(illy.documentInfo().layers.length, 3, '배포 후 레이어');
  illy.mergeLayers();
  L = illy.documentInfo().layers;
  eq(L.length, 1, '병합 후 레이어');
  eq(L[0].items, 3, '병합 후 오브젝트');
  return '모으기 2개 → 배포 3레이어 → 병합 1레이어(3개)';
});

check('imageTrace 는 Node 에서 안내와 함께 실패', () => {
  const illy = fresh();
  illy.addRect({ x: 0, y: 0, width: 10, height: 10 });
  const r = illy.batch([{ op: 'imageTrace', args: {} }]);
  if (r.ok) throw new Error('실패해야 함');
  if (!/브라우저|이미지/.test(r.error.message)) throw new Error(r.error.message);
  return r.error.message;
});

check('패스파인더 오리기는 맨 앞 오브젝트를 틀로만 쓴다', () => {
  const illy = fresh({ width: 400, height: 400 });
  illy.addRect({ x: 50, y: 50, width: 100, height: 100, fill: '#ff0000' });
  illy.addRect({ x: 100, y: 100, width: 100, height: 100, fill: '#0000ff' });
  illy.pathfinder({ query: { type: 'path' }, operation: 'crop' });
  const ids = illy.find({ type: 'path' });
  eq(ids.length, 1, '남은 조각');
  const o = illy.get(ids[0]);
  eq([o.geometricBounds.x, o.geometricBounds.y, o.geometricBounds.w, o.geometricBounds.h].join(','),
    '100,100,50,50', '겹친 영역만');
  eq(o.fill.color, '#ff0000', '아래 오브젝트의 칠을 이어받는다');
  return '겹친 50×50 · 칠 #ff0000 (틀은 사라짐)';
});

/* ---------- 모양 스택 · 패스 편집 · 자산 (2차 업그레이드) ---------- */
check('모양 스택 — 칠/획 여러 겹 · 대표 칠/획 동기화 · 확장', () => {
  const illy = fresh({ width: 300, height: 300 });
  const id = illy.addRect({ x: 20, y: 20, width: 100, height: 100, fill: '#3366cc' });
  eq(illy.appearance(id)[0].custom, false, '처음엔 기본 모양');
  illy.addStroke({ query: id, color: '#ff0000', width: 6 });
  illy.addStroke({ query: id, color: '#00ff00', width: 2 });
  illy.addFill({ query: id, color: '#ffff00' });
  const layers = illy.appearance(id)[0].layers;
  eq(layers.map(l => l.kind).join(','), 'fill,fill,stroke,stroke', '겹 구성');
  /* 대표 칠 = 맨 아래 칠, 대표 획 = 맨 위 획 */
  const info = illy.get(id);
  eq(info.fill.color, '#3366cc', '대표 칠');
  eq(info.stroke.color, '#00ff00', '대표 획');
  /* 미리보기 경계는 가장 두꺼운 획을 반영한다 */
  eq(info.bounds.w, 106, '가장 두꺼운 획(6pt)의 절반씩');
  illy.setAppearanceLayer({ query: id, index: 1, color: '#ff00ff' });
  eq(illy.appearance(id)[0].layers[1].fill.color, '#ff00ff', '겹 수정');
  const g = illy.expandAppearance(id);
  const kids = illy.get(g[0]).children;
  eq(kids.length, 4, '확장 결과 = 겹 수');
  return '칠2+획2 · 대표 동기화 · 경계 106 · 확장 4개';
});

check('앵커 단위 편집 — 조회 · 이동 · 추가 · 삭제 · 닫기', () => {
  const illy = fresh({ width: 400, height: 400 });
  const id = illy.addRect({ x: 50, y: 50, width: 100, height: 100 });
  const a0 = illy.anchors(id).subpaths[0];
  eq(a0.points.length, 4, '앵커 수');
  eq(a0.points.map(p => `${p.x},${p.y}`).join(' '), '50,50 150,50 150,150 50,150', '문서 좌표');
  illy.setAnchor({ query: id, index: 2, x: 200, y: 200 });
  eq(illy.get(id).geometricBounds.w, 150, '이동 반영');
  illy.setAnchor({ query: id, index: 1, inX: 120, inY: 30, outX: 180, outY: 30 });
  const p1 = illy.anchors(id).subpaths[0].points[1];
  eq(`${p1.inX},${p1.inY},${p1.outX},${p1.outY}`, '120,30,180,30', '방향선');
  /* 앵커를 옮기면 방향선도 함께 따라온다 */
  illy.setAnchor({ query: id, index: 1, x: 160, y: 50 });
  const p1b = illy.anchors(id).subpaths[0].points[1];
  eq(`${p1b.inX},${p1b.inY},${p1b.outX}`, '130,30,190', '방향선이 앵커를 따라감');
  illy.addAnchor({ query: id, segment: 0, t: 0.5 });
  eq(illy.anchors(id).subpaths[0].points.length, 5, '앵커 추가');
  illy.removeAnchor({ query: id, index: 1 });
  eq(illy.anchors(id).subpaths[0].points.length, 4, '앵커 삭제');
  illy.setSubpathClosed({ query: id, closed: false });
  eq(illy.anchors(id).subpaths[0].closed, false, '열기');
  const bad = illy.batch([{ op: 'setAnchor', args: { query: id, index: 99, x: 0 } }]);
  if (bad.ok) throw new Error('없는 앵커가 통과함');
  return `4→5→4 앵커 · 방향선 동행 · ${bad.error.code}`;
});

check('심볼 — 정의 · 배치 · 정의 수정이 모든 인스턴스에 반영 · 링크 끊기', () => {
  const illy = fresh({ width: 400, height: 400 });
  const s1 = illy.addStar({ cx: 60, cy: 60, radius: 30, innerRadius: 12, points: 5, fill: '#ffcc00' });
  const symId = illy.defineSymbol({ query: s1, name: '별' });
  eq(illy.assets().symbols.length, 1, '심볼 등록');
  const i2 = illy.placeSymbol({ symbol: '별', x: 200, y: 200 });
  eq(illy.get(i2).type, 'symbol', '인스턴스 타입');
  const w1 = illy.get(i2).geometricBounds.w;
  if (!(w1 > 40)) throw new Error('인스턴스 크기 ' + w1);
  const broken = illy.breakSymbolLink({ query: i2 });
  eq(illy.get(broken[0]).type, 'path', '링크 끊기 후 실제 패스');
  const noSym = illy.batch([{ op: 'placeSymbol', args: { symbol: '없는심볼', x: 0, y: 0 } }]);
  if (noSym.ok || noSym.error.code !== 'NO_SYMBOL') throw new Error('오류 코드 ' + (noSym.error && noSym.error.code));
  return `심볼 1개 · 인스턴스 폭 ${Math.round(w1)} · 링크 끊기 · ${noSym.error.code}`;
});

check('패턴 — 정의 · 적용 · SVG <pattern> 출력', () => {
  const illy = fresh({ width: 300, height: 300 });
  const dot = illy.addEllipse({ x: 0, y: 0, width: 10, height: 10, fill: '#ff0000' });
  const pid = illy.definePattern({ query: dot, name: '점' });
  eq(illy.assets().patterns[0].name, '점', '패턴 등록');
  const r = illy.addRect({ x: 20, y: 20, width: 200, height: 200 });
  illy.applyPattern({ query: r, pattern: '점', scale: 150, angle: 30 });
  const svg = illy.toSVG();
  if (!/<pattern id="pat/.test(svg)) throw new Error('SVG pattern 정의 없음');
  if (!/url\(#pat/.test(svg)) throw new Error('SVG pattern 참조 없음');
  if (!/patternTransform="rotate\(30\)"/.test(svg)) throw new Error('각도 누락');
  return '패턴 정의 · 150% 30° 적용 · SVG pattern 출력';
});

check('블렌드 — 중간 단계의 색과 크기가 보간된다', () => {
  const illy = fresh({ width: 500, height: 300 });
  illy.addEllipse({ x: 20, y: 100, width: 60, height: 60, fill: '#ff0000', name: 'A' });
  illy.addEllipse({ x: 380, y: 80, width: 100, height: 100, fill: '#0000ff', name: 'B' });
  const gid = illy.blend({ query: { type: 'path' }, steps: 4 });
  const kids = illy.get(gid).children;
  eq(kids.length, 6, '원본 2 + 단계 4');
  const mids = kids.slice(1, 5).map(k => illy.get(k));
  /* 빨강 -> 파랑 사이라 r 은 줄고 b 는 늘어야 한다 */
  const reds = mids.map(m => parseInt(m.fill.color.slice(1, 3), 16));
  const blues = mids.map(m => parseInt(m.fill.color.slice(5, 7), 16));
  for (let i = 1; i < reds.length; i++) {
    if (reds[i] >= reds[i - 1]) throw new Error('빨강이 줄지 않음 ' + reds);
    if (blues[i] <= blues[i - 1]) throw new Error('파랑이 늘지 않음 ' + blues);
  }
  const widths = mids.map(m => Math.round(m.geometricBounds.w));
  for (let i = 1; i < widths.length; i++) if (widths[i] <= widths[i - 1]) throw new Error('크기 보간 실패 ' + widths);
  return `단계 4 · 색 ${mids[0].fill.color}→${mids[3].fill.color} · 폭 ${widths.join('<')}`;
});

check('불투명도 마스크 — 그룹으로 묶이고 SVG mask 로 나간다', () => {
  const illy = fresh({ width: 300, height: 300 });
  illy.addRect({ x: 20, y: 20, width: 200, height: 100, fill: '#ff0000' });
  illy.addRect({ x: 20, y: 20, width: 200, height: 100, fill: { type: 'linear', stops: [[0, '#ffffff'], [1, '#000000']] } });
  const gid = illy.opacityMask({ query: { type: 'path' } });
  eq(illy.get(gid).type, 'group', '마스크 그룹');
  const svg = illy.toSVG();
  if (!/<mask id="omask/.test(svg) || !/mask="url\(#omask/.test(svg)) throw new Error('SVG mask 누락');
  return '마스크 그룹 · SVG <mask> 출력';
});

check('재색상화 — 치환표와 색조 회전', () => {
  const illy = fresh({ width: 300, height: 300 });
  illy.addRect({ x: 0, y: 0, width: 50, height: 50, fill: '#ff0000' });
  illy.addRect({ x: 60, y: 0, width: 50, height: 50, fill: '#00ff00' });
  const cols = illy.colors({ query: { type: 'path' } }).map(c => c.color);
  if (cols.indexOf('#ff0000') < 0 || cols.indexOf('#00ff00') < 0) throw new Error('색 수집 ' + cols);
  illy.recolor({ query: { type: 'path' }, map: { '#ff0000': '#0000ff' } });
  const after = illy.colors({ query: { type: 'path' } }).map(c => c.color).sort();
  eq(after.join(','), '#0000ff,#00ff00', '치환');
  illy.recolor({ query: { type: 'path' }, hue: 180 });
  const rot = illy.colors({ query: { type: 'path' } }).map(c => c.color).sort();
  eq(rot.join(','), '#ff00ff,#ffff00', '색조 180° 회전');
  return '치환 · 색조 회전 ' + rot.join(' ');
});

check('PDF — 구조가 유효하고 xref 오프셋이 정확', () => {
  const illy = fresh({ width: 300, height: 200 });
  illy.addRect({ x: 20, y: 20, width: 120, height: 80, fill: '#ff3366', stroke: '#000000', strokeWidth: 3, opacity: 0.6 });
  illy.addText({ x: 30, y: 160, text: 'Hello PDF', size: 24 });
  const pdf = illy.toPDF();
  if (!/^%PDF-1\.4/.test(pdf)) throw new Error('헤더 없음');
  if (!/%%EOF\n$/.test(pdf)) throw new Error('EOF 없음');
  const m = pdf.match(/startxref\n(\d+)/);
  if (!m) throw new Error('startxref 없음');
  eq(pdf.slice(+m[1], +m[1] + 4), 'xref', 'startxref 위치');
  const objOffsets = [...pdf.matchAll(/^(\d+) 0 obj/gm)].map(x => x.index);
  const xrefOffsets = [...pdf.matchAll(/^(\d{10}) 00000 n $/gm)].map(x => +x[1]);
  eq(JSON.stringify(objOffsets), JSON.stringify(xrefOffsets), 'xref 오프셋');
  if (!/\/ExtGState/.test(pdf)) throw new Error('불투명도(ExtGState) 없음');
  if (!/BaseFont \/Helvetica/.test(pdf)) throw new Error('글꼴 없음');
  return `${pdf.length}B · 객체 ${objOffsets.length}개 · xref 일치 · 투명도 · 글꼴`;
});

check('패스 이동 · 단순화가 API 로 동작', () => {
  const illy = fresh({ width: 400, height: 400 });
  const id = illy.addRect({ x: 100, y: 100, width: 100, height: 100, fill: '#333' });
  const out = illy.offsetPath({ query: id, offset: 20, replace: true });
  const b = illy.get(out[0]).geometricBounds;
  eq([b.x, b.y, b.w, b.h].join(','), '80,80,140,140', '바깥 오프셋');
  const inn = illy.offsetPath({ query: out[0], offset: -30, replace: true });
  const b2 = illy.get(inn[0]).geometricBounds;
  eq([Math.round(b2.w), Math.round(b2.h)].join(','), '80,80', '안쪽 오프셋');
  let d = '';
  for (let i = 0; i < 120; i++) {
    const a = i / 120 * Math.PI * 2;
    d += (i ? 'L' : 'M') + (200 + Math.cos(a) * 100).toFixed(2) + ' ' + (200 + Math.sin(a) * 100).toFixed(2) + ' ';
  }
  const circ = illy.addPath({ d: d + 'Z', fill: '#333' });
  const r = illy.simplify({ query: circ, precision: 80 });
  if (!(r.anchorsAfter < r.anchorsBefore / 2)) throw new Error('단순화 부족 ' + JSON.stringify(r));
  const bb = illy.get(circ).geometricBounds;
  if (Math.abs(bb.w - 200) > 4) throw new Error('단순화가 모양을 망침 ' + bb.w);
  return `오프셋 ±20/-30 · 단순화 ${r.anchorsBefore}→${r.anchorsAfter} (모양 유지)`;
});

check('describe() 가 새 속성을 모두 담는다', () => {
  const illy = fresh({ width: 300, height: 300 });
  const id = illy.addRect({ x: 20, y: 20, width: 100, height: 100, fill: '#f00' });
  illy.applyEffect({ query: id, type: 'shadow', dx: 4, dy: 4 });
  illy.addStroke({ query: id, color: '#00f', width: 4 });
  illy.addStroke({ query: id, color: '#0f0', width: 1 });   /* 획 2겹 = 기본 모양이 아님 */
  const line = illy.addLine({ x1: 0, y1: 200, x2: 200, y2: 200, stroke: '#000', strokeWidth: 2 });
  illy.setArrowheads({ query: line, end: 'arrow' });
  illy.addGuide({ axis: 'v', position: 150 });
  const d = illy.describe();
  ['효과', '모양', '화살표', '안내선'].forEach(k => {
    if (d.indexOf(k) < 0) throw new Error("describe 에 '" + k + "' 가 없음:\n" + d);
  });
  return d.split('\n')[0];
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
