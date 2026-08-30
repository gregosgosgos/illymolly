/* 심층 검증: 페이지 안에서 기하/모델/IO 불변식을 직접 확인 */
import { chromium } from 'playwright';
import { serve } from './server.mjs';

const PORT = 8131;
const server = await serve(PORT);
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
const errs = [];
page.on('pageerror', e => errs.push('PAGEERROR: ' + e.message));
page.on('console', m => { if (m.type() === 'error') errs.push('CONSOLE: ' + m.text()); });
await page.goto(`http://127.0.0.1:${PORT}/index.html`, { waitUntil: 'load' });
await page.waitForTimeout(300);

const out = await page.evaluate(() => {
  const R = [];
  const ok = (name, cond, detail) => R.push([name, !!cond, detail === undefined ? '' : String(detail)]);
  const near = (a, b, t) => Math.abs(a - b) <= (t == null ? 0.01 : t);
  const app = AI.app, Mo = AI.model, M = AI.mat, Rn = AI.render, E = AI.edit, PF = AI.pathfinder, G = AI.geom;

  function fresh() {
    app.setDoc(Mo.newDoc(800, 600));
    app.history.reset(app.doc, 'x');
    AI.sel.clear(app);
    return app.doc.layers[0];
  }
  const area = it => {
    const rings = E.itemRings(app, it);
    return rings.reduce((s, r) => s + PF.area(r), 0);
  };

  /* ---------- 1. 중첩 그룹 변환 ---------- */
  try {
    const L = fresh();
    const child = Mo.newRect(0, 0, 100, 100, 0);
    const g1 = Mo.newGroup([child]);
    g1.m = M.mulAll(M.translate(200, 100), M.rotate(Math.PI / 2));
    const g2 = Mo.newGroup([g1]);
    g2.m = M.translate(50, 50);
    L.children.push(g2);
    const wm = Mo.worldMatrix(app.doc, child);
    const p = M.apply(wm, 100, 0);          /* 로컬(100,0) -> 회전90 -> (0,100) -> +200,100 -> +50,50 */
    ok('중첩 그룹 worldMatrix', near(p.x, 250, .01) && near(p.y, 250, .01), `(${p.x.toFixed(2)},${p.y.toFixed(2)}) 기대 (250,250)`);
  } catch (e) { ok('중첩 그룹 worldMatrix', false, e.message); }

  /* ---------- 2. 그룹/그룹풀기 위치 보존 ---------- */
  try {
    const L = fresh();
    const a = Mo.newRect(10, 20, 100, 50, 0), b = Mo.newEllipse(200, 40, 80, 80);
    L.children.push(a, b);
    AI.sel.set(app, [a, b]);
    const before = Rn.selectionBounds(app, true);
    E.group(app);
    const mid = Rn.selectionBounds(app, true);
    E.ungroup(app);
    const after = Rn.selectionBounds(app, true);
    ok('그룹 후 바운딩 유지', near(before.x, mid.x, .01) && near(before.y2, mid.y2, .01), `${before.x}/${mid.x}`);
    ok('그룹풀기 후 바운딩 유지', near(before.x, after.x, .01) && near(before.y2, after.y2, .01), `${before.x}/${after.x}`);
  } catch (e) { ok('그룹/그룹풀기 위치 보존', false, e.message); }

  /* ---------- 3. 변환된 그룹 풀기 ---------- */
  try {
    const L = fresh();
    const a = Mo.newRect(0, 0, 100, 100, 0);
    const g = Mo.newGroup([a]);
    g.m = M.mulAll(M.translate(300, 200), M.rotate(0.7), M.scale(1.5, 0.5));
    L.children.push(g);
    AI.sel.set(app, [g]);
    const before = Rn.selectionBounds(app, true);
    E.ungroup(app);
    const after = Rn.selectionBounds(app, true);
    ok('회전/스케일 그룹 풀기 위치 유지',
      near(before.x, after.x, .01) && near(before.y, after.y, .01) && near(before.x2, after.x2, .01),
      `${before.x.toFixed(2)},${before.y.toFixed(2)} -> ${after.x.toFixed(2)},${after.y.toFixed(2)}`);
  } catch (e) { ok('회전/스케일 그룹 풀기', false, e.message); }

  /* ---------- 4. 실행 취소 완전 복원 ---------- */
  try {
    const L = fresh();
    L.children.push(Mo.newRect(10, 10, 50, 50, 0));
    app.history.reset(app.doc, 'base');
    const snap0 = JSON.stringify(app.doc);
    app.history.begin('t', app.doc);
    app.doc.layers[0].children.push(Mo.newEllipse(100, 100, 40, 40));
    app.history.commit();
    const snap1 = JSON.stringify(app.doc);
    app.setDoc(app.history.undo(app.doc));
    ok('undo 완전 복원', JSON.stringify(app.doc) === snap0, JSON.stringify(app.doc).length + ' vs ' + snap0.length);
    app.setDoc(app.history.redo(app.doc));
    ok('redo 완전 복원', JSON.stringify(app.doc) === snap1);
  } catch (e) { ok('실행 취소 복원', false, e.message); }

  /* ---------- 5. 다중 undo/redo 체인 ---------- */
  try {
    const L = fresh();
    const snaps = [JSON.stringify(app.doc)];
    for (let i = 0; i < 5; i++) {
      app.history.begin('s' + i, app.doc);
      app.doc.layers[0].children.push(Mo.newRect(i * 20, 0, 10, 10, 0));
      app.history.commit();
      snaps.push(JSON.stringify(app.doc));
    }
    let good = true;
    for (let i = 4; i >= 0; i--) {
      app.setDoc(app.history.undo(app.doc));
      if (JSON.stringify(app.doc) !== snaps[i]) { good = false; break; }
    }
    ok('5단계 연속 undo', good);
    let good2 = true;
    for (let i = 1; i <= 5; i++) {
      app.setDoc(app.history.redo(app.doc));
      if (JSON.stringify(app.doc) !== snaps[i]) { good2 = false; break; }
    }
    ok('5단계 연속 redo', good2);
  } catch (e) { ok('다중 undo/redo', false, e.message); }

  /* ---------- 6. 도형 면적 정확도 ---------- */
  try {
    fresh();
    const c = Mo.newEllipse(0, 0, 200, 200);
    app.doc.layers[0].children.push(c);
    const a = Math.abs(area(c));
    ok('원 면적 ≈ πr²', near(a, Math.PI * 100 * 100, 60), a.toFixed(1) + ' vs ' + (Math.PI * 1e4).toFixed(1));
    const r = Mo.newRect(0, 0, 120, 80, 20);
    app.doc.layers[0].children.push(r);
    const ar = Math.abs(area(r));
    const expect = 120 * 80 - (4 - Math.PI) * 400;
    ok('둥근 사각형 면적', near(ar, expect, 25), ar.toFixed(1) + ' vs ' + expect.toFixed(1));
  } catch (e) { ok('도형 면적', false, e.message); }

  /* ---------- 7. 베지어 바운딩 vs 샘플링 ---------- */
  try {
    const sub = { closed: false, pts: [{ x: 0, y: 0, ox: 120, oy: -160 }, { x: 100, y: 100, ix: -40, iy: 220 }] };
    const it = Mo.newPath([sub]);
    const b = G.pathBounds(it, null);
    const poly = G.flattenSub(sub, 0.05, null);
    let s = AI.rect.empty();
    poly.forEach(p => AI.rect.add(s, p.x, p.y));
    ok('3차 베지어 바운딩 정확', near(b.x, s.x, .5) && near(b.y, s.y, .5) && near(b.x2, s.x2, .5) && near(b.y2, s.y2, .5),
      `bounds(${b.x.toFixed(1)},${b.y.toFixed(1)},${b.x2.toFixed(1)},${b.y2.toFixed(1)}) sample(${s.x.toFixed(1)},${s.y.toFixed(1)},${s.x2.toFixed(1)},${s.y2.toFixed(1)})`);
  } catch (e) { ok('베지어 바운딩', false, e.message); }

  /* ---------- 8. 패스파인더 케이스 ---------- */
  try {
    fresh();
    const L = app.doc.layers[0];
    const mk = (x, y, w, h) => { const r = Mo.newRect(x, y, w, h, 0); L.children.push(r); return r; };
    /* 겹치지 않는 두 사각형 unite -> 링 2개 */
    let a = mk(0, 0, 50, 50), b = mk(200, 200, 50, 50);
    AI.sel.set(app, [a, b]);
    E.pathfinder(app, 'unite');
    ok('분리된 도형 unite -> 링 2개', app.sel[0].subs.length === 2, 'subs=' + app.sel[0].subs.length);
    ok('분리된 도형 unite 면적', near(Math.abs(area(app.sel[0])), 5000, 5), Math.abs(area(app.sel[0])).toFixed(1));

    fresh();
    const L2 = app.doc.layers[0];
    const mk2 = (x, y, w, h) => { const r = Mo.newRect(x, y, w, h, 0); L2.children.push(r); return r; };
    a = mk2(0, 0, 100, 100); b = mk2(0, 0, 100, 100);
    AI.sel.set(app, [a, b]);
    E.pathfinder(app, 'intersect');
    ok('동일 도형 intersect 면적 보존', app.sel[0] && near(Math.abs(area(app.sel[0])), 10000, 20), app.sel[0] ? Math.abs(area(app.sel[0])).toFixed(1) : 'none');

    /* 도넛(컴파운드) - 사각형 */
    fresh();
    const L3 = app.doc.layers[0];
    const donut = Mo.newPath([
      { closed: true, pts: [{ x: 0, y: 0 }, { x: 200, y: 0 }, { x: 200, y: 200 }, { x: 0, y: 200 }] },
      { closed: true, pts: [{ x: 150, y: 50 }, { x: 50, y: 50 }, { x: 50, y: 150 }, { x: 150, y: 150 }] }
    ]);
    L3.children.push(donut);
    const da = Math.abs(area(donut));
    ok('컴파운드(도넛) 면적', near(da, 40000 - 10000, 5), da.toFixed(1) + ' 기대 30000');
    const cut = Mo.newRect(0, 0, 200, 100, 0);
    L3.children.push(cut);
    AI.sel.set(app, [donut, cut]);
    E.pathfinder(app, 'minusFront');
    ok('도넛 - 사각형 면적', app.sel[0] && near(Math.abs(area(app.sel[0])), 15000, 30), app.sel[0] ? Math.abs(area(app.sel[0])).toFixed(1) + ' 기대 15000' : 'none');
  } catch (e) { ok('패스파인더 케이스', false, e.message); }

  /* ---------- 9. 나누기(divide) ---------- */
  try {
    fresh();
    const L = app.doc.layers[0];
    const a = Mo.newRect(0, 0, 100, 100, 0), b = Mo.newRect(50, 50, 100, 100, 0);
    L.children.push(a, b);
    AI.sel.set(app, [a, b]);
    E.pathfinder(app, 'divide');
    const g = app.sel[0];
    const n = g && g.type === 'group' ? g.children.length : 0;
    const total = g && g.children ? g.children.reduce((s, c) => s + Math.abs(area(c)), 0) : 0;
    ok('divide 조각 3개', n === 3, 'n=' + n);
    ok('divide 총면적 보존', near(total, 17500, 40), total.toFixed(1) + ' 기대 17500');
  } catch (e) { ok('divide', false, e.message); }

  /* ---------- 10. 가위 / 연결 ---------- */
  try {
    fresh();
    const L = app.doc.layers[0];
    const r = Mo.newRect(0, 0, 100, 100, 0);
    L.children.push(r);
    Mo.expandShape(r);
    const before = r.subs[0].pts.length;
    /* 세그먼트 0 중간을 자름 */
    const np = G.insertAnchor(r.subs[0], 0, 0.5);
    const pi = r.subs[0].pts.indexOf(np);
    r.subs[0].closed = false;
    const rot = r.subs[0].pts.slice(pi).concat(r.subs[0].pts.slice(0, pi));
    rot.push(JSON.parse(JSON.stringify(rot[0])));
    r.subs[0].pts = rot;
    ok('가위: 닫힌 패스 -> 열린 패스', !r.subs[0].closed && r.subs[0].pts.length === before + 2, `${before} -> ${r.subs[0].pts.length}`);
  } catch (e) { ok('가위', false, e.message); }

  try {
    fresh();
    const L = app.doc.layers[0];
    const p1 = Mo.newPath([{ closed: false, pts: [{ x: 0, y: 0 }, { x: 50, y: 0 }] }]);
    const p2 = Mo.newPath([{ closed: false, pts: [{ x: 100, y: 0 }, { x: 150, y: 0 }] }]);
    L.children.push(p1, p2);
    AI.sel.set(app, [p1, p2]);
    const r = E.joinPath(app);
    ok('두 열린 패스 연결', r === true && app.sel[0].subs[0].pts.length === 4, 'pts=' + (app.sel[0] && app.sel[0].subs[0].pts.length));
  } catch (e) { ok('패스 연결', false, e.message); }

  /* ---------- 11. 컴파운드 패스 만들기/해제 ---------- */
  try {
    fresh();
    const L = app.doc.layers[0];
    const a = Mo.newRect(0, 0, 200, 200, 0), b = Mo.newRect(50, 50, 100, 100, 0);
    L.children.push(a, b);
    AI.sel.set(app, [a, b]);
    AI.commands.run('compoundMake');
    const it = app.sel[0];
    ok('컴파운드 subs 2개', it.subs && it.subs.length === 2, 'subs=' + (it.subs && it.subs.length));
    ok('컴파운드 면적(구멍)', near(Math.abs(area(it)), 30000, 20), Math.abs(area(it)).toFixed(1));
    AI.commands.run('compoundRelease');
    ok('컴파운드 해제 -> 2개', app.sel.length === 2, 'sel=' + app.sel.length);
  } catch (e) { ok('컴파운드 패스', false, e.message); }

  /* ---------- 12. 정렬 / 배분 ---------- */
  try {
    fresh();
    const L = app.doc.layers[0];
    const rs = [Mo.newRect(0, 0, 50, 50, 0), Mo.newRect(100, 30, 30, 30, 0), Mo.newRect(300, 60, 80, 20, 0)];
    rs.forEach(r => L.children.push(r));
    AI.sel.set(app, rs);
    E.align(app, 'left', 'selection');
    const xs = rs.map(r => Rn.worldBounds(app.doc, r, true).x);
    ok('왼쪽 정렬', xs.every(x => near(x, xs[0], .01)), xs.map(v => v.toFixed(1)).join(','));
    E.distribute(app, 'h');
    const cxs = rs.map(r => { const b = Rn.worldBounds(app.doc, r, true); return (b.x + b.x2) / 2; }).sort((a, b) => a - b);
    ok('가로 균등 배분(중심 간격 동일)', near(cxs[1] - cxs[0], cxs[2] - cxs[1], .05), cxs.map(v => v.toFixed(1)).join(','));
  } catch (e) { ok('정렬/배분', false, e.message); }

  /* ---------- 13. 순서 ---------- */
  try {
    fresh();
    const L = app.doc.layers[0];
    const a = Mo.newRect(0, 0, 10, 10, 0), b = Mo.newRect(0, 0, 10, 10, 0), c = Mo.newRect(0, 0, 10, 10, 0);
    L.children.push(a, b, c);
    AI.sel.set(app, [a]);
    E.arrange(app, 'front');
    ok('맨 앞으로', L.children[2] === a, L.children.indexOf(a));
    E.arrange(app, 'back');
    ok('맨 뒤로', L.children[0] === a, L.children.indexOf(a));
    E.arrange(app, 'forward');
    ok('앞으로 한 칸', L.children[1] === a, L.children.indexOf(a));
  } catch (e) { ok('순서', false, e.message); }

  /* ---------- 14. 히트 테스트 ---------- */
  try {
    fresh();
    const L = app.doc.layers[0];
    AI.viewT.setZoom(app, 1);
    app.view.tx = 0; app.view.ty = 0;
    const filled = Mo.newRect(100, 100, 100, 100, 0);
    filled.fill = AI.color.solid('#ff0000'); filled.stroke = Mo.defaultStroke();
    L.children.push(filled);
    ok('칠 내부 히트', AI.hit.itemAt(app, 150, 150, false) === filled);
    ok('바깥 미히트', AI.hit.itemAt(app, 400, 400, false) === null);
    const hollow = Mo.newRect(300, 100, 100, 100, 0);
    hollow.fill = AI.color.none(); hollow.stroke = Mo.mkStroke('#000', 2);
    L.children.push(hollow);
    ok('칠 없는 도형 내부 미히트', AI.hit.itemAt(app, 350, 150, false) === null);
    ok('칠 없는 도형 획 히트', AI.hit.itemAt(app, 300, 150, false) === hollow);
    hollow.locked = true;
    ok('잠긴 오브젝트 미히트', AI.hit.itemAt(app, 300, 150, false) === null);
    hollow.locked = false;
    L.locked = true;
    ok('잠긴 레이어 미히트', AI.hit.itemAt(app, 150, 150, false) === null);
    L.locked = false;
  } catch (e) { ok('히트 테스트', false, e.message); }

  /* ---------- 15. 변환 왕복 ---------- */
  try {
    fresh();
    const L = app.doc.layers[0];
    const r = Mo.newRect(50, 50, 100, 60, 0);
    L.children.push(r);
    AI.sel.set(app, [r]);
    const b0 = Rn.worldBounds(app.doc, r, true);
    for (let i = 0; i < 4; i++) E.rotate(app, 90);
    const b1 = Rn.worldBounds(app.doc, r, true);
    ok('90° 4회전 = 원위치', near(b0.x, b1.x, .01) && near(b0.y, b1.y, .01) && near(b0.x2, b1.x2, .01),
      `${b0.x.toFixed(2)},${b0.y.toFixed(2)} -> ${b1.x.toFixed(2)},${b1.y.toFixed(2)}`);
    E.scale(app, 2, 2); E.scale(app, .5, .5);
    const b2 = Rn.worldBounds(app.doc, r, true);
    ok('2배 후 0.5배 = 원위치', near(b0.x, b2.x, .01) && near(b0.x2, b2.x2, .01));
    E.reflect(app, 'v'); E.reflect(app, 'v');
    const b3 = Rn.worldBounds(app.doc, r, true);
    ok('반사 2회 = 원위치', near(b0.x, b3.x, .01) && near(b0.x2, b3.x2, .01));
  } catch (e) { ok('변환 왕복', false, e.message); }

  /* ---------- 16. setBounds ---------- */
  try {
    fresh();
    const L = app.doc.layers[0];
    const r = Mo.newEllipse(10, 20, 100, 50);
    L.children.push(r);
    AI.sel.set(app, [r]);
    E.setBounds(app, 200, 300, 400, 100);
    const b = Rn.worldBounds(app.doc, r, true);
    ok('W/H/X/Y 정확 반영',
      near(b.x, 200, .01) && near(b.y, 300, .01) && near(b.x2 - b.x, 400, .01) && near(b.y2 - b.y, 100, .01),
      `${b.x.toFixed(1)},${b.y.toFixed(1)},${(b.x2 - b.x).toFixed(1)},${(b.y2 - b.y).toFixed(1)}`);
  } catch (e) { ok('setBounds', false, e.message); }

  /* ---------- 17. JSON 저장/열기 왕복 ---------- */
  try {
    fresh();
    const L = app.doc.layers[0];
    const r = Mo.newRect(10, 20, 100, 50, 8);
    r.fill = AI.color.gradient('linear', '#ff0000', '#0000ff');
    const t = Mo.newText(30, 40, '한글 Text\n둘째 줄');
    const g = Mo.newGroup([Mo.newEllipse(0, 0, 30, 30)]);
    g.clip = true;
    L.children.push(r, t, g);
    const json = JSON.stringify({ format: 'illymolly', version: 1, doc: app.doc });
    const parsed = JSON.parse(json).doc;
    AI.io.normalizeDoc(parsed);
    const before = JSON.stringify(app.doc);
    app.setDoc(parsed);
    ok('JSON 저장/열기 왕복 동일', JSON.stringify(app.doc) === before);
  } catch (e) { ok('JSON 왕복', false, e.message); }

  /* ---------- 18. SVG 내보내기/가져오기 왕복 ---------- */
  try {
    fresh();
    const L = app.doc.layers[0];
    const r = Mo.newRect(10, 20, 100, 50, 0);
    r.fill = AI.color.solid('#3366cc'); r.stroke = Mo.mkStroke('#ff0000', 3);
    const p = Mo.newPath([{ closed: true, pts: [{ x: 200, y: 20, ox: 260, oy: 0 }, { x: 300, y: 80, ix: 320, iy: 40 }, { x: 220, y: 120 }] }]);
    p.fill = AI.color.solid('#00aa55');
    L.children.push(r, p);
    const areaBefore = Math.abs(area(p));
    const svg = AI.io.toSVG(app);
    AI.io.importSVG(app, svg, 'roundtrip.svg');
    const items = app.doc.layers[0].children;
    ok('SVG 왕복 오브젝트 수', items.length === 2, 'n=' + items.length);
    const p2 = items[1];
    ok('SVG 왕복 곡선 면적 유지', p2 && near(Math.abs(area(p2)), areaBefore, 2), `${areaBefore.toFixed(1)} -> ${p2 ? Math.abs(area(p2)).toFixed(1) : '-'}`);
    ok('SVG 왕복 칠 색상', items[0].fill.color === '#3366cc', items[0].fill.color);
    ok('SVG 왕복 획 두께', near(items[0].stroke.width, 3, .01), items[0].stroke.width);
  } catch (e) { ok('SVG 왕복', false, e.message); }

  /* ---------- 19. 텍스트 계측 ---------- */
  try {
    fresh();
    const t = Mo.newText(0, 0, 'AAA\nBB');
    app.doc.layers[0].children.push(t);
    const m = Rn.measureText(t);
    const b = Rn.localBounds(t);
    ok('여러 줄 텍스트 높이', b.y2 - b.y > t.text.size, (b.y2 - b.y).toFixed(1));
    t.text.align = 'center';
    const bc = Rn.localBounds(t);
    ok('가운데 정렬 바운딩', near((bc.x + bc.x2) / 2, 0, .5), ((bc.x + bc.x2) / 2).toFixed(2));
  } catch (e) { ok('텍스트 계측', false, e.message); }

  /* ---------- 20. 복사/붙여넣기 제자리 ---------- */
  try {
    fresh();
    const L = app.doc.layers[0];
    const g = Mo.newGroup([Mo.newRect(0, 0, 50, 50, 0)]);
    g.m = M.translate(120, 90);
    L.children.push(g);
    AI.sel.set(app, [g]);
    AI.commands.run('copy');
    AI.commands.run('pasteInPlace');
    const b1 = Rn.worldBounds(app.doc, L.children[0], true);
    const b2 = Rn.worldBounds(app.doc, L.children[1], true);
    ok('제자리 붙여넣기 위치 동일', near(b1.x, b2.x, .01) && near(b1.y, b2.y, .01), `${b1.x},${b2.x}`);
    ok('붙여넣기 id 재발급', L.children[0].id !== L.children[1].id);
  } catch (e) { ok('복사/붙여넣기', false, e.message); }

  /* ---------- 21. 그룹 내부 아이템 이동 ---------- */
  try {
    fresh();
    const L = app.doc.layers[0];
    const child = Mo.newRect(0, 0, 50, 50, 0);
    const g = Mo.newGroup([child]);
    g.m = M.mulAll(M.translate(100, 100), M.rotate(Math.PI / 2));
    L.children.push(g);
    AI.sel.set(app, [child]);
    const b0 = Rn.worldBounds(app.doc, child, true);
    E.move(app, 30, 0);      /* 월드 기준 +30 이동이어야 함 */
    const b1 = Rn.worldBounds(app.doc, child, true);
    ok('회전 그룹 내부 아이템 월드 이동', near(b1.x - b0.x, 30, .01) && near(b1.y - b0.y, 0, .01),
      `d=(${(b1.x - b0.x).toFixed(2)},${(b1.y - b0.y).toFixed(2)})`);
  } catch (e) { ok('그룹 내부 이동', false, e.message); }

  /* ---------- 22. 앵커 이동(직접 선택) 월드 정확도 ---------- */
  try {
    fresh();
    const L = app.doc.layers[0];
    const p = Mo.newPath([{ closed: false, pts: [{ x: 0, y: 0 }, { x: 100, y: 0 }] }]);
    p.m = M.mulAll(M.translate(50, 50), M.rotate(Math.PI / 2), M.scale(2, 2));
    L.children.push(p);
    AI.sel.set(app, [p]); AI.sel.clearPts(app); AI.sel.addPt(app, p, 0, 1);
    const wm = Mo.worldMatrix(app.doc, p);
    const w0 = M.apply(wm, p.subs[0].pts[1].x, p.subs[0].pts[1].y);
    E.movePoints(app, 17, -9);
    const w1 = M.apply(Mo.worldMatrix(app.doc, p), p.subs[0].pts[1].x, p.subs[0].pts[1].y);
    ok('앵커 월드 이동 정확', near(w1.x - w0.x, 17, .01) && near(w1.y - w0.y, -9, .01),
      `d=(${(w1.x - w0.x).toFixed(2)},${(w1.y - w0.y).toFixed(2)})`);
  } catch (e) { ok('앵커 이동', false, e.message); }

  /* ---------- 23. 성능 ---------- */
  try {
    fresh();
    const L = app.doc.layers[0];
    for (let i = 0; i < 600; i++) {
      const r = Mo.newRect((i % 30) * 25, Math.floor(i / 30) * 25, 20, 20, 0);
      r.fill = AI.color.solid('#88aaff');
      L.children.push(r);
    }
    const t0 = performance.now();
    AI.render.scene(app.canvas.getContext('2d'), app);
    const tRender = performance.now() - t0;
    const t1 = performance.now();
    for (let i = 0; i < 40; i++) AI.hit.itemAt(app, 300 + i, 300, false);
    const tHit = (performance.now() - t1) / 40;
    const t2 = performance.now();
    AI.sel.set(app, L.children.slice(0, 200));
    E.move(app, 1, 0);
    const tMove = performance.now() - t2;
    const t3 = performance.now();
    Rn.selectionBounds(app, true);
    const tBounds = performance.now() - t3;
    ok('600개 렌더 < 200ms', tRender < 200, tRender.toFixed(1) + 'ms');
    ok('히트 테스트 1회 < 20ms', tHit < 20, tHit.toFixed(2) + 'ms');
    ok('200개 이동 < 150ms', tMove < 150, tMove.toFixed(1) + 'ms');
    ok('200개 바운딩 < 100ms', tBounds < 100, tBounds.toFixed(1) + 'ms');
  } catch (e) { ok('성능', false, e.message); }

  fresh();
  return R;
});

console.log('\n=== 심층 검증 ===');
let fail = 0;
for (const [n, pass, d] of out) {
  if (!pass) fail++;
  console.log(`${pass ? '✔' : '✘'} ${n}${d ? ' — ' + d : ''}`);
}
console.log(`\n${out.length - fail}/${out.length} 통과, 콘솔 오류 ${errs.length}건`);
errs.slice(0, 10).forEach(e => console.log('  ' + e));
await browser.close();
server.close();
process.exit(fail || errs.length ? 1 : 0);
