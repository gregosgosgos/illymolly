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

  /* ---------- 22b. 불리언 강건성 (곡선·포함·다중) ---------- */
  try {
    const rings = it => E.itemRings(app, it);
    const sum = rs => Math.abs(rs.reduce((s, r) => s + PF.area(r), 0));

    fresh();
    let L = app.doc.layers[0];
    const c1 = Mo.newEllipse(0, 0, 200, 200), c2 = Mo.newEllipse(100, 0, 200, 200);
    L.children.push(c1, c2);
    /* 두 원(r=100, 중심거리 100) 교집합 넓이 = 2r²cos⁻¹(d/2r) − (d/2)√(4r²−d²) */
    const r0 = 100, d0 = 100;
    const lens = 2 * r0 * r0 * Math.acos(d0 / (2 * r0)) - (d0 / 2) * Math.sqrt(4 * r0 * r0 - d0 * d0);
    AI.sel.set(app, [c1, c2]);
    E.pathfinder(app, 'intersect');
    ok('원∩원 면적 (해석해 비교)', near(sum(rings(app.sel[0])), lens, lens * 0.01),
      sum(rings(app.sel[0])).toFixed(1) + ' vs ' + lens.toFixed(1));

    fresh(); L = app.doc.layers[0];
    const u1 = Mo.newEllipse(0, 0, 200, 200), u2 = Mo.newEllipse(100, 0, 200, 200);
    L.children.push(u1, u2);
    AI.sel.set(app, [u1, u2]);
    E.pathfinder(app, 'unite');
    const expectU = 2 * Math.PI * 1e4 - lens;
    ok('원∪원 면적', near(sum(rings(app.sel[0])), expectU, expectU * 0.01),
      sum(rings(app.sel[0])).toFixed(1) + ' vs ' + expectU.toFixed(1));

    /* A 가 B 를 완전히 포함 -> 도넛 */
    fresh(); L = app.doc.layers[0];
    const big = Mo.newRect(0, 0, 200, 200, 0), small = Mo.newRect(80, 80, 40, 40, 0);
    L.children.push(big, small);
    AI.sel.set(app, [big, small]);
    E.pathfinder(app, 'minusFront');
    ok('포함 관계 minus -> 구멍', app.sel[0].subs.length === 2 && near(sum(rings(app.sel[0])), 40000 - 1600, 20),
      'subs=' + app.sel[0].subs.length + ' area=' + sum(rings(app.sel[0])).toFixed(0));

    /* B 가 A 를 완전히 포함 -> 빈 결과 */
    fresh(); L = app.doc.layers[0];
    const inner = Mo.newRect(80, 80, 40, 40, 0), outer = Mo.newRect(0, 0, 200, 200, 0);
    L.children.push(inner, outer);
    AI.sel.set(app, [inner, outer]);
    const before = L.children.length;
    E.pathfinder(app, 'minusFront');
    ok('완전 포함 minus -> 빈 결과', L.children.length === before, 'children=' + L.children.length);

    /* 5개 원 합치기 */
    fresh(); L = app.doc.layers[0];
    const cs = [];
    for (let i = 0; i < 5; i++) { const c = Mo.newEllipse(i * 60, 0, 120, 120); L.children.push(c); cs.push(c); }
    AI.sel.set(app, cs);
    E.pathfinder(app, 'unite');
    const merged = sum(rings(app.sel[0]));
    ok('원 5개 합치기 (단일 링)', app.sel[0].subs.length === 1 && merged > Math.PI * 3600 && merged < 5 * Math.PI * 3600,
      'subs=' + app.sel[0].subs.length + ' area=' + merged.toFixed(0));

    /* 별 ∩ 원 */
    fresh(); L = app.doc.layers[0];
    const star = Mo.newStar(100, 100, 90, 40, 7), circ = Mo.newEllipse(30, 30, 140, 140);
    L.children.push(star, circ);
    AI.sel.set(app, [star, circ]);
    E.pathfinder(app, 'intersect');
    const ia = sum(rings(app.sel[0]));
    ok('별 ∩ 원 결과 유효', app.sel.length === 1 && ia > 0 && ia < Math.PI * 70 * 70 + 1, 'area=' + ia.toFixed(0));

    /* 인접(변 공유) 사각형 합치기 -> 내부 벽 제거 */
    fresh(); L = app.doc.layers[0];
    const t1 = Mo.newRect(0, 0, 100, 100, 0), t2 = Mo.newRect(100, 0, 100, 100, 0);
    L.children.push(t1, t2);
    AI.sel.set(app, [t1, t2]);
    E.pathfinder(app, 'unite');
    ok('변을 공유한 사각형 합치기', app.sel[0].subs.length === 1 && near(sum(rings(app.sel[0])), 20000, 5),
      'subs=' + app.sel[0].subs.length + ' area=' + sum(rings(app.sel[0])).toFixed(0));
  } catch (e) { ok('불리언 강건성', false, e.message); }

  /* ---------- 23b. 효과 · 화살표 · 자르기 · 이미지 추적 ---------- */
  try {
    let L = fresh();
    const r = Mo.newRect(100, 100, 100, 100, 0);
    L.children.push(r);
    const wm = () => Mo.worldMatrix(app.doc, r);

    r.effects = [{ type: 'blur', radius: 6 }];
    let vis = Rn.boundsM(r, wm(), false, 1), geo = Rn.boundsM(r, wm(), true, 1);
    ok('흐림 효과가 기하 경계를 바꾸지 않는다', near(geo.x, 100) && near(geo.x2 - geo.x, 100),
      `${geo.x},${geo.x2 - geo.x}`);
    ok('흐림 효과 미리보기 경계 = 반경×3', near(vis.x, 100 - 18) && near(vis.x2 - vis.x, 136),
      `${vis.x},${vis.x2 - vis.x}`);

    r.effects = [{ type: 'shadow', dx: 10, dy: -4, blur: 5, color: '#000000', alpha: 0.5 }];
    vis = Rn.boundsM(r, wm(), false, 1);
    /* 그림자 여백 = blur*3 + |dx| + |dy| = 29, 사방으로 */
    ok('그림자 미리보기 경계', near(vis.x, 71) && near(vis.x2 - vis.x, 158), `${vis.x},${vis.x2 - vis.x}`);
    ok('효과 필터 문자열 (배율 반영)',
      AI.effects.filterString(r, 2) === 'drop-shadow(20px -8px 10px rgba(0,0,0,0.5))',
      AI.effects.filterString(r, 2));

    /* 그룹에 걸린 효과도 경계를 넓힌다 */
    const g = Mo.newGroup([r]);
    L.children = [g];
    g.effects = [{ type: 'glow', blur: 4, color: '#ffcc00', alpha: 1 }];
    const gb = Rn.boundsM(g, Mo.worldMatrix(app.doc, g), false, 1);
    ok('그룹 효과도 경계에 반영', near(gb.x, 71 - 12), gb.x);

    /* 회전한 상태에서도 렌더가 예외 없이 끝난다 (오프스크린 합성 경로) */
    g.m = M.mulAll(M.translate(50, 50), M.rotate(0.6));
    AI.render.scene(app.canvas.getContext('2d'), app);
    ok('효과가 걸린 회전 그룹 렌더 성공', true);
  } catch (e) { ok('효과', false, e.message); }

  try {
    const L = fresh();
    const line = Mo.newLine(50, 50, 250, 50);
    line.fill = AI.color.none();
    line.stroke = Mo.mkStroke('#000000', 4);
    line.stroke.arrowEnd = 'arrow';
    line.stroke.arrowScale = 200;
    L.children.push(line);
    AI.render.scene(app.canvas.getContext('2d'), app);
    const svg = AI.io.toSVG(app);
    ok('화살표가 SVG marker 로 나간다', /<marker /.test(svg) && /marker-end="url\(/.test(svg));
    ok('화살표 없는 쪽은 marker 를 만들지 않는다', !/marker-start="url\(/.test(svg));

    /* 닫힌 패스에는 화살표가 붙지 않는다 (일러스트레이터와 동일) */
    const rc = Mo.newRect(300, 300, 50, 50, 0);
    rc.stroke = Mo.mkStroke('#000000', 4);
    rc.stroke.arrowEnd = 'arrow';
    L.children.push(rc);
    const svg2 = AI.io.toSVG(app);
    ok('닫힌 패스에는 화살표가 붙지 않는다', (svg2.match(/marker-end="url\(/g) || []).length === 1,
      (svg2.match(/marker-end="url\(/g) || []).length);
  } catch (e) { ok('화살표', false, e.message); }

  try {
    const L = fresh();
    /* 두 번 자르면 crop 이 누적된다 */
    const c = document.createElement('canvas');
    c.width = c.height = 8;
    const cx = c.getContext('2d');
    cx.fillStyle = '#ffffff'; cx.fillRect(0, 0, 8, 8);
    const src = c.toDataURL('image/png');
    const im = Mo.newImage(src, 0, 0, 200, 200);
    L.children.push(im);
    const s1 = Mo.newRect(50, 50, 100, 100, 0);
    L.children.push(s1);
    AI.sel.set(app, [im, s1]);
    E.cropImage(app);
    const c1 = [im.crop.x, im.crop.y, im.crop.w, im.crop.h].map(v => +v.toFixed(3)).join(',');
    const s2 = Mo.newRect(75, 75, 50, 50, 0);
    L.children.push(s2);
    AI.sel.set(app, [im, s2]);
    E.cropImage(app);
    const c2 = [im.crop.x, im.crop.y, im.crop.w, im.crop.h].map(v => +v.toFixed(3)).join(',');
    const b = Rn.worldBounds(app.doc, im, true);
    ok('이미지 자르기 1회', c1 === '0.25,0.25,0.5,0.5', c1);
    ok('이미지 자르기 누적', c2 === '0.375,0.375,0.25,0.25', c2);
    ok('자른 뒤 배치가 도형과 일치', near(b.x, 75) && near(b.x2 - b.x, 50), `${b.x},${b.x2 - b.x}`);
  } catch (e) { ok('이미지 자르기', false, e.message); }

  /* ---------- 23c. 개별 변형 · 안내선 · 대지 ---------- */
  try {
    const L = fresh();
    const a = Mo.newRect(0, 0, 100, 100, 0), b = Mo.newRect(300, 0, 100, 100, 0);
    L.children.push(a, b);
    AI.sel.set(app, [a, b]);
    E.transformEach(app, { sx: 100, sy: 100, dx: 0, dy: 0, angle: 90, anchor: 4 });
    const ba = Rn.worldBounds(app.doc, a, true), bb = Rn.worldBounds(app.doc, b, true);
    ok('개별 변형 회전 — 각자의 중심 유지',
      near((ba.x + ba.x2) / 2, 50, 0.001) && near((bb.x + bb.x2) / 2, 350, 0.001),
      `${((ba.x + ba.x2) / 2).toFixed(1)}, ${((bb.x + bb.x2) / 2).toFixed(1)}`);

    /* 일반 변형(선택 전체 기준)과 다르다 */
    fresh();
    const L2 = app.doc.layers[0];
    const c = Mo.newRect(0, 0, 100, 100, 0), d = Mo.newRect(300, 0, 100, 100, 0);
    L2.children.push(c, d);
    AI.sel.set(app, [c, d]);
    const before = Rn.selectionBounds(app, true);
    E.transformSelection(app, M.around(M.scale(2, 2), (before.x + before.x2) / 2, (before.y + before.y2) / 2));
    const after = Rn.selectionBounds(app, true);
    ok('일반 변형은 선택 전체를 기준으로 한다', near(after.x2 - after.x, (before.x2 - before.x) * 2, 0.001),
      (after.x2 - after.x).toFixed(0));
  } catch (e) { ok('개별 변형', false, e.message); }

  try {
    const L = fresh();
    app.doc.guides = [{ axis: 'v', pos: 120 }, { axis: 'h', pos: 240 }];
    E.releaseGuides(app);
    ok('안내선 해제 → 선 오브젝트', app.doc.guides.length === 0 && L.children.length === 2,
      `guides=${app.doc.guides.length} items=${L.children.length}`);
    const v = L.children[0], hb = Rn.worldBounds(app.doc, L.children[1], true);
    const vb = Rn.worldBounds(app.doc, v, true);
    ok('세로 안내선은 세로 선이 된다', near(vb.x, 120) && near(vb.x2, 120) && vb.y2 - vb.y > 100,
      `${vb.x},${vb.y2 - vb.y}`);
    ok('가로 안내선은 가로 선이 된다', near(hb.y, 240) && hb.x2 - hb.x > 100, `${hb.y},${hb.x2 - hb.x}`);
  } catch (e) { ok('안내선', false, e.message); }

  try {
    const L = fresh();
    const r = Mo.newRect(500, 400, 120, 80, 0);
    L.children.push(r);
    AI.sel.set(app, [r]);
    E.fitArtboardTo(app, 'selection');
    let ab = app.doc.artboards[app.doc.activeArtboard];
    ok('대지를 선택 항목에 맞추기', [ab.x, ab.y, ab.w, ab.h].join(',') === '500,400,120,80',
      [ab.x, ab.y, ab.w, ab.h].join(','));

    app.doc.artboards.push({ id: 'AB2', name: '대지 2', x: 5000, y: 5000, w: 200, h: 100 });
    app.doc.artboards.push({ id: 'AB3', name: '대지 3', x: -900, y: 20, w: 50, h: 300 });
    E.rearrangeArtboards(app, 2, 10);
    const pos = app.doc.artboards.map(a2 => `${a2.x},${a2.y}`).join(' ');
    /* 1행: 120폭 + 10 간격 → 두 번째가 x=130. 2행은 첫 행 최대 높이(100)+10 아래 */
    ok('대지 재정렬 격자', pos === '0,0 130,0 0,110', pos);
  } catch (e) { ok('대지', false, e.message); }

  /* ---------- 23d. 모양 스택 · 오프셋 · 마스크 · 심볼 ---------- */
  try {
    var L = fresh();
    var r0 = Mo.newRect(50, 50, 100, 100, 0);
    r0.fill = AI.color.solid('#3366cc');
    r0.stroke = AI.color.none();
    L.children.push(r0);
    var AP = AI.appearance;

    ok('기본 아이템은 모양 스택을 갖지 않는다', !AP.isCustom(r0));
    ok('기본 스택 = 칠 1겹 (획 없음)', AP.list(r0).length === 1, AP.list(r0).length);

    AP.addStroke(r0, Mo.mkStroke('#ff0000', 8));
    ok('획 1겹 추가 후에도 기본형 유지', !AP.isCustom(r0) && r0.stroke.width === 8, r0.stroke.width);

    AP.addStroke(r0, Mo.mkStroke('#00ff00', 2));
    ok('획 2겹이면 사용자 스택이 된다', AP.isCustom(r0) && AP.list(r0).length === 3, AP.list(r0).length);
    ok('대표 획 = 맨 위 획', r0.stroke.color === '#00ff00', r0.stroke.color);
    ok('가장 두꺼운 획이 바운딩을 정한다', AP.maxStrokeWidth(r0) === 8, AP.maxStrokeWidth(r0));
    var vb = Rn.boundsM(r0, Mo.worldMatrix(app.doc, r0), false, 1);
    ok('미리보기 경계 = 100 + 8', near(vb.x2 - vb.x, 108, 0.01), vb.x2 - vb.x);
    var gb = Rn.boundsM(r0, Mo.worldMatrix(app.doc, r0), true, 1);
    ok('기하 경계는 그대로', near(gb.x2 - gb.x, 100, 0.01), gb.x2 - gb.x);

    /* 모양 확장 -> 겹 수만큼의 오브젝트 */
    AI.sel.set(app, [r0]);
    AI.commands.run('expandAppearance');
    var g0 = app.sel[0];
    ok('모양 확장 = 겹 수만큼의 그룹', g0.type === 'group' && g0.children.length === 3, g0.children.length);
    ok('확장 결과 바운딩 보존', near(Rn.worldBounds(app.doc, g0, false).x2 - Rn.worldBounds(app.doc, g0, false).x, 108, 0.5));
  } catch (e) { ok('모양 스택', false, e.message); }

  try {
    fresh();
    /* 오프셋: 사각형은 정확히 예측 가능하다 */
    var rect = [[{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }]];
    var out = E.offsetRings(PF.normalize(rect), 10);
    var a1 = Math.abs(PF.area(out[0]));
    ok('사각형 +10 오프셋 면적', near(a1, 120 * 120, 400), a1.toFixed(0));
    var inn = E.offsetRings(PF.normalize(rect), -20);
    var a2 = Math.abs(PF.area(inn[0]));
    ok('사각형 -20 오프셋 면적', near(a2, 60 * 60, 200), a2.toFixed(0));
    /* 원: 반지름이 정확히 늘어야 한다 */
    var circle = [];
    for (var ci = 0; ci < 128; ci++) {
      var t2 = ci / 128 * Math.PI * 2;
      circle.push({ x: 200 + Math.cos(t2) * 50, y: 200 + Math.sin(t2) * 50 });
    }
    var co = E.offsetRings(PF.normalize([circle]), 25);
    var ca = Math.abs(PF.area(co[0]));
    ok('원 r50 +25 오프셋 = r75 넓이', near(ca, Math.PI * 75 * 75, Math.PI * 75 * 75 * 0.01), ca.toFixed(0));
    /* 안쪽으로 너무 많이 줄이면 사라진다 */
    var gone = E.offsetRings(PF.normalize([circle]), -60);
    ok('반지름보다 크게 줄이면 결과 없음', gone.length === 0, gone.length);
  } catch (e) { ok('오프셋', false, e.message); }

  try {
    var L3 = fresh();
    /* 단순화가 모양을 보존하는지 — 면적으로 확인 */
    var poly = [];
    for (var pi2 = 0; pi2 < 200; pi2++) {
      var t3 = pi2 / 200 * Math.PI * 2;
      poly.push({ x: 200 + Math.cos(t3) * 80, y: 200 + Math.sin(t3) * 80 });
    }
    var it3 = Mo.newPath([{ closed: true, pts: poly }]);
    L3.children.push(it3);
    AI.sel.set(app, [it3]);
    var beforeArea = Math.abs(PF.area(G.flattenItem(it3, 0.2, Mo.worldMatrix(app.doc, it3))[0].pts));
    var res = E.simplifyPaths(app, { precision: 85, curves: true });
    var afterArea = Math.abs(PF.area(G.flattenItem(it3, 0.2, Mo.worldMatrix(app.doc, it3))[0].pts));
    ok('단순화로 앵커가 줄어든다', res.after < res.before / 2, res.before + '->' + res.after);
    ok('단순화가 면적을 보존한다', near(afterArea, beforeArea, beforeArea * 0.02),
      beforeArea.toFixed(0) + ' -> ' + afterArea.toFixed(0));
  } catch (e) { ok('단순화', false, e.message); }

  try {
    var L4 = fresh();
    /* 불투명도 마스크: 흰 마스크는 그대로, 검은 마스크는 완전 투명 */
    AI.viewT.setZoom(app, 1); app.view.tx = 0; app.view.ty = 0;
    var base = Mo.newRect(20, 20, 100, 60, 0);
    base.fill = AI.color.solid('#ff0000'); base.stroke = AI.color.none();
    var mk = Mo.newRect(20, 20, 100, 60, 0);
    mk.fill = AI.color.solid('#ffffff'); mk.stroke = AI.color.none();
    L4.children.push(base, mk);
    AI.sel.set(app, [base, mk]);
    E.makeOpacityMask(app);
    var ctx4 = app.canvas.getContext('2d');
    Rn.scene(ctx4, app);
    function pix(x, y) {
      var d = ctx4.getImageData(Math.round(x * app.dpr), Math.round(y * app.dpr), 1, 1).data;
      return [d[0], d[1], d[2]];
    }
    var white = pix(70, 50);
    app.sel[0].opacityMask.fill = AI.color.solid('#000000');
    Rn.scene(ctx4, app);
    var black = pix(70, 50);
    ok('흰 마스크 = 원본 그대로', white[0] > 200 && white[1] < 60, white.join(','));
    ok('검은 마스크 = 완전 투명', black[0] > 240 && black[1] > 240 && black[2] > 240, black.join(','));
    /* 반전하면 반대가 된다 */
    app.sel[0].maskInvert = true;
    Rn.scene(ctx4, app);
    var inv = pix(70, 50);
    ok('반전 마스크', inv[0] > 200 && inv[1] < 60, inv.join(','));
  } catch (e) { ok('불투명도 마스크', false, e.message); }

  try {
    var L5 = fresh();
    /* 심볼 인스턴스의 변환이 정의에 곱해지는지 */
    var src = Mo.newRect(0, 0, 40, 40, 0);
    L5.children.push(src);
    AI.sel.set(app, [src]);
    var def = AI.assets.defineSymbol(app, '사각');
    var inst = app.sel[0];
    inst.m = M.mulAll(M.translate(100, 100), M.scale(2, 2));
    var ib = Rn.worldBounds(app.doc, inst, true);
    ok('심볼 인스턴스에 변환이 적용된다',
      near(ib.x, 100) && near(ib.x2 - ib.x, 80), [ib.x, ib.x2 - ib.x].join(','));
    /* 히트 테스트도 정의를 따라간다 */
    AI.viewT.setZoom(app, 1); app.view.tx = 0; app.view.ty = 0;
    ok('심볼 히트 테스트', AI.hit.itemAt(app, 140, 140, false) === inst);
    ok('심볼 바깥은 미히트', AI.hit.itemAt(app, 195, 195, false) !== inst);
  } catch (e) { ok('심볼', false, e.message); }

  try {
    fresh();
    /* 가변 폭 프로파일 보간 */
    var prof = [{ t: 0, w: 1 }, { t: 0.5, w: 3 }, { t: 1, w: 1 }];
    ok('프로파일 보간 (양 끝)', Rn.profileAt(prof, 0) === 1 && Rn.profileAt(prof, 1) === 1);
    ok('프로파일 보간 (가운데)', Rn.profileAt(prof, 0.5) === 3);
    ok('프로파일 보간 (중간값)', near(Rn.profileAt(prof, 0.25), 2, 0.001), Rn.profileAt(prof, 0.25));
    ok('프로파일 범위 밖은 끝값', Rn.profileAt(prof, -1) === 1 && Rn.profileAt(prof, 2) === 1);
  } catch (e) { ok('가변 폭', false, e.message); }

  /* ---------- 23. 성능 ---------- */
  try {
    fresh();
    const L = app.doc.layers[0];
    const N = 2000;
    for (let i = 0; i < N; i++) {
      const r = Mo.newRect((i % 50) * 16, Math.floor(i / 50) * 16, 12, 12, 0);
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
    const t4 = performance.now();
    AI.hit.itemsInRect(app, { x: 0, y: 0, x2: 400, y2: 400 }, false);
    const tRect = performance.now() - t4;
    const t5 = performance.now();
    E.collectSnapTargets(app, app.sel);
    const tSnap = performance.now() - t5;
    ok('2000개 렌더 < 200ms', tRender < 200, tRender.toFixed(1) + 'ms');
    ok('히트 테스트 1회 < 10ms', tHit < 10, tHit.toFixed(2) + 'ms');
    ok('200개 이동 < 100ms', tMove < 100, tMove.toFixed(1) + 'ms');
    ok('200개 바운딩 < 60ms', tBounds < 60, tBounds.toFixed(1) + 'ms');
    ok('마퀴 검색 < 60ms', tRect < 60, tRect.toFixed(1) + 'ms');
    ok('스냅 타깃 수집 < 60ms', tSnap < 60, tSnap.toFixed(1) + 'ms');
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
