/* =========================================================================
   test/e2e.mjs — Playwright 통합 스모크 테스트
   실행:  npm run test        (playwright 필요:  npm i -D playwright)
   ========================================================================= */
import { chromium } from 'playwright';
import { serve } from './server.mjs';

const PORT = 8129;
const server = await serve(PORT);
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

const errors = [];
page.on('console', m => { if (m.type() === 'error') errors.push('CONSOLE: ' + m.text()); });
page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));

await page.goto(`http://127.0.0.1:${PORT}/index.html`, { waitUntil: 'load' });
await page.waitForTimeout(400);

const box = await (await page.$('#view')).boundingBox();
const at = (fx, fy) => ({ x: box.x + box.width * fx, y: box.y + box.height * fy });
const ev = f => page.evaluate(f);
const count = () => ev(() => AI.app.doc.layers.reduce((n, l) => n + l.children.length, 0));

async function drag(a, b, mods = []) {
  for (const m of mods) await page.keyboard.down(m);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move((a.x + b.x) / 2, (a.y + b.y) / 2, { steps: 4 });
  await page.mouse.move(b.x, b.y, { steps: 4 });
  await page.mouse.up();
  for (const m of mods) await page.keyboard.up(m);
}

const results = [];
const check = async (name, fn) => {
  try { results.push([name, 'OK', (await fn()) ?? '']); }
  catch (e) { results.push([name, 'FAIL', e.message]); }
};

/* ---------------- 도구 & 그리기 ---------------- */
await check('초기 로드', () => ev(() => AI.app.doc.name + ' / tool=' + AI.app.tool));

await check('M -> 사각형 도구, 드래그 생성', async () => {
  await page.keyboard.press('KeyM');
  if (await ev(() => AI.app.tool) !== 'rect') throw new Error('도구 전환 실패');
  await drag(at(0.25, 0.25), at(0.45, 0.45));
  const n = await count();
  if (n !== 1) throw new Error('items=' + n);
  return 'items=1';
});

await check('L -> 원형 도구, 드래그 생성', async () => {
  await page.keyboard.press('KeyL');
  await drag(at(0.5, 0.3), at(0.7, 0.5));
  const n = await count();
  if (n !== 2) throw new Error('items=' + n);
  return 'items=2';
});

await check('P -> 펜 도구로 3점 패스', async () => {
  await page.keyboard.press('KeyP');
  for (const p of [at(0.2, 0.7), at(0.3, 0.85), at(0.45, 0.7)]) {
    await page.mouse.click(p.x, p.y);
    await page.waitForTimeout(30);
  }
  await page.keyboard.press('Escape');
  const pts = await ev(() => { let r = 0; AI.model.walk(AI.app.doc, it => { if (it.name === '패스') r = it.subs[0].pts.length; }); return r; });
  if (pts !== 3) throw new Error('pts=' + pts);
  return 'pts=3';
});

await check('T -> 문자 도구 입력', async () => {
  await page.keyboard.press('KeyT');
  const p = at(0.25, 0.15);
  await page.mouse.click(p.x, p.y);
  await page.waitForTimeout(120);
  await page.keyboard.type('안녕 Illymolly');
  await page.waitForTimeout(80);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(80);
  const t = await ev(() => { let s = null; AI.model.walk(AI.app.doc, it => { if (it.type === 'text') s = it.text.content; }); return s; });
  if (t !== '안녕 Illymolly') throw new Error('text=' + t);
  return t;
});

/* ---------------- 선택 & 변형 ---------------- */
await check('V + 마퀴 선택', async () => {
  await page.keyboard.press('KeyV');
  await drag(at(0.15, 0.55), at(0.85, 0.95));
  const s = await ev(() => AI.app.sel.length);
  if (!s) throw new Error('sel=0');
  return 'sel=' + s;
});

await check('Ctrl+A 전체 선택', async () => {
  await page.keyboard.press('Control+KeyA');
  const s = await ev(() => AI.app.sel.length);
  if (s !== 4) throw new Error('sel=' + s);
  return 'sel=4';
});

await check('Ctrl+G 그룹 / Ctrl+Shift+G 그룹 풀기', async () => {
  await page.keyboard.press('Control+KeyG');
  if (await ev(() => AI.app.sel[0].type) !== 'group') throw new Error('그룹 생성 실패');
  await page.keyboard.press('Control+Shift+KeyG');
  const s = await ev(() => AI.app.sel.length);
  if (s !== 4) throw new Error('해제 후 sel=' + s);
  return 'ok';
});

await check('화살표 이동 (1pt / Shift 10pt)', async () => {
  await ev(() => AI.sel.set(AI.app, [AI.app.doc.layers[0].children[0]]));
  const x0 = await ev(() => AI.render.selectionBounds(AI.app, true).x);
  await page.keyboard.press('ArrowRight');
  const x1 = await ev(() => AI.render.selectionBounds(AI.app, true).x);
  await page.keyboard.press('Shift+ArrowRight');
  const x2 = await ev(() => AI.render.selectionBounds(AI.app, true).x);
  if (Math.abs(x1 - x0 - 1) > 0.01 || Math.abs(x2 - x1 - 10) > 0.01) throw new Error(`${x0}/${x1}/${x2}`);
  return '+1, +10';
});

await check('Alt+드래그 복제', async () => {
  const before = await count();
  const c = await ev(() => { const b = AI.render.selectionBounds(AI.app, true); return AI.viewT.toScreen(AI.app, (b.x + b.x2) / 2, (b.y + b.y2) / 2); });
  await drag({ x: box.x + c.x, y: box.y + c.y }, { x: box.x + c.x, y: box.y + c.y + 90 }, ['Alt']);
  const after = await count();
  if (after !== before + 1) throw new Error(`${before} -> ${after}`);
  await ev(() => AI.commands.run('undo'));
  await ev(() => AI.sel.set(AI.app, [AI.app.doc.layers[0].children[0]]));
  return `${before} -> ${after}`;
});

await check('바운딩 박스 핸들 크기 조절', async () => {
  const w0 = await ev(() => { const b = AI.render.selectionBounds(AI.app, true); return b.x2 - b.x; });
  const f = await ev(() => { const fr = AI.render.bboxFrame(AI.app); return { x: fr.pts[4].x, y: fr.pts[4].y }; });
  await drag({ x: box.x + f.x, y: box.y + f.y }, { x: box.x + f.x + 60, y: box.y + f.y + 60 });
  const w1 = await ev(() => { const b = AI.render.selectionBounds(AI.app, true); return b.x2 - b.x; });
  if (!(w1 > w0 + 10)) throw new Error(`${w0} -> ${w1}`);
  return `${Math.round(w0)} -> ${Math.round(w1)}`;
});

await check('R 회전 도구', async () => {
  await ev(() => AI.sel.set(AI.app, [AI.app.doc.layers[0].children[0]]));
  await page.keyboard.press('KeyR');
  const a0 = await ev(() => AI.mat.angle(AI.model.worldMatrix(AI.app.doc, AI.app.sel[0])));
  await drag(at(0.5, 0.3), at(0.6, 0.45));
  const a1 = await ev(() => AI.mat.angle(AI.model.worldMatrix(AI.app.doc, AI.app.sel[0])));
  if (Math.abs(a1 - a0) < 1) throw new Error(`${a0} -> ${a1}`);
  await page.keyboard.press('KeyV');
  return `${Math.round(a0)}° -> ${Math.round(a1)}°`;
});

await check('A 직접 선택으로 앵커 이동', async () => {
  await ev(() => {
    const it = AI.app.doc.layers[0].children[0];
    AI.sel.set(AI.app, [it]); AI.sel.clearPts(AI.app); AI.sel.addPt(AI.app, it, 0, 0); AI.app.invalidate();
  });
  await page.keyboard.press('KeyA');
  const p = await ev(() => {
    const it = AI.app.sel[0];
    const wm = AI.mat.mul(AI.viewT.matrix(AI.app), AI.model.worldMatrix(AI.app.doc, it));
    return AI.mat.apply(wm, it.subs[0].pts[0].x, it.subs[0].pts[0].y);
  });
  const before = await ev(() => AI.app.sel[0].subs[0].pts[0].x);
  await drag({ x: box.x + p.x, y: box.y + p.y }, { x: box.x + p.x - 40, y: box.y + p.y - 10 });
  const after = await ev(() => AI.app.sel[0].subs[0].pts[0].x);
  if (Math.abs(after - before) < 5) throw new Error('앵커가 움직이지 않음');
  await page.keyboard.press('KeyV');
  return `${Math.round(before)} -> ${Math.round(after)}`;
});

/* ---------------- 히스토리 / 패스파인더 ---------------- */
await check('Ctrl+Z / Ctrl+Shift+Z', async () => {
  const n0 = await count();
  await ev(() => {
    AI.app.history.begin('테스트 도형', AI.app.doc);
    AI.app.doc.layers[0].children.push(AI.model.newRect(600, 600, 50, 50, 0));
    AI.app.history.commit();
  });
  await page.keyboard.press('Control+KeyZ');
  const n1 = await count();
  await page.keyboard.press('Control+Shift+KeyZ');
  const n2 = await count();
  if (n1 !== n0 || n2 !== n0 + 1) throw new Error(`${n0}/${n1}/${n2}`);
  await page.keyboard.press('Control+KeyZ');
  return '취소/재실행 정상';
});

await check('패스파인더 합치기', async () => {
  const ok = await ev(() => {
    const app = AI.app, L = app.doc.layers[0];
    const a = AI.model.newRect(50, 50, 200, 200, 0), b = AI.model.newRect(150, 150, 200, 200, 0);
    a.fill = AI.color.solid('#ff0000'); b.fill = AI.color.solid('#00ff00');
    L.children.push(a, b);
    AI.sel.set(app, [a, b]);
    return AI.commands.run('pf_unite');
  });
  const area = await ev(() => {
    const it = AI.app.sel[0];
    const rings = AI.edit.itemRings(AI.app, it);
    return Math.round(rings.reduce((s, r) => s + Math.abs(AI.pathfinder.area(r)), 0));
  });
  /* 200×200 두 개가 100×100 겹침 → 40000+40000-10000 = 70000 */
  if (!ok || Math.abs(area - 70000) > 700) throw new Error('area=' + area);
  return '면적 ' + area + ' (기대 70000)';
});

await check('패스파인더 앞면 제외', async () => {
  await ev(() => AI.commands.run('undo'));
  const area = await ev(() => {
    const app = AI.app, L = app.doc.layers[0];
    const a = AI.model.newRect(50, 50, 200, 200, 0), b = AI.model.newRect(150, 150, 200, 200, 0);
    L.children.push(a, b);
    AI.sel.set(app, [a, b]);
    AI.commands.run('pf_minusFront');
    const rings = AI.edit.itemRings(app, app.sel[0]);
    return Math.round(rings.reduce((s, r) => s + Math.abs(AI.pathfinder.area(r)), 0));
  });
  if (Math.abs(area - 30000) > 500) throw new Error('area=' + area);
  return '면적 ' + area + ' (기대 30000)';
});

await check('지우개로 도형 분리', async () => {
  const geo = await ev(() => {
    const app = AI.app;
    const it = AI.model.newRect(120, 120, 300, 300, 0);
    it.fill = AI.color.solid('#3399ff');
    it.name = '지우개대상';
    app.doc.layers[0].children.push(it);
    AI.sel.clear(app); app.eraserWidth = 40; app.invalidate();
    return { s: app.view.scale, tx: app.view.tx, ty: app.view.ty };
  });
  const S = (x, y) => ({ x: box.x + x * geo.s + geo.tx, y: box.y + y * geo.s + geo.ty });
  await page.keyboard.press('Shift+KeyE');
  await drag(S(270, 90), S(270, 450));
  const subs = await ev(() => { let r = 0; AI.model.walk(AI.app.doc, it => { if (it.name === '지우개대상') r = it.subs.length; }); return r; });
  if (subs !== 2) throw new Error('subs=' + subs);
  await page.keyboard.press('KeyV');
  return '2조각으로 분리';
});

/* ---------------- 보기 / UI ---------------- */
await check('확대·축소 단축키', async () => {
  const s0 = await ev(() => AI.app.view.scale);
  await page.keyboard.press('Control+Equal');
  const s1 = await ev(() => AI.app.view.scale);
  await page.keyboard.press('Control+Digit1');
  const s2 = await ev(() => AI.app.view.scale);
  if (!(s1 > s0) || s2 !== 1) throw new Error(`${s0}/${s1}/${s2}`);
  return '확대 후 100% 복귀';
});

await check('Space 임시 손 도구', async () => {
  await page.keyboard.down('Space');
  const t1 = await ev(() => AI.app.tool);
  await page.keyboard.up('Space');
  const t2 = await ev(() => AI.app.tool);
  if (t1 !== 'hand' || t2 !== 'select') throw new Error(`${t1}/${t2}`);
  return 'hand -> select';
});

await check('눈금자 드래그로 안내선 생성', async () => {
  const rh = await (await page.$('#ruler-h')).boundingBox();
  await page.mouse.move(rh.x + 300, rh.y + 10);
  await page.mouse.down();
  await page.mouse.move(box.x + 400, box.y + 300, { steps: 5 });
  await page.mouse.up();
  const g = await ev(() => AI.app.doc.guides.length);
  if (!g) throw new Error('guides=0');
  return g + '개';
});

await check('메뉴 / 컨텍스트 메뉴', async () => {
  await page.click('#menus .menu-title');
  await page.waitForTimeout(100);
  const n = await page.evaluate(() => document.querySelectorAll('.menu-pop .mi').length);
  await page.keyboard.press('Escape');
  const p = at(0.5, 0.5);
  await page.mouse.click(p.x, p.y, { button: 'right' });
  await page.waitForTimeout(100);
  const c = await page.evaluate(() => document.querySelectorAll('#contextmenu .mi').length);
  await page.mouse.click(box.x + 5, box.y + 5);
  if (!n || !c) throw new Error(`menu=${n} context=${c}`);
  return `메뉴 ${n}개 / 컨텍스트 ${c}개`;
});

await check('레이어 패널 · 견본 패널', async () => {
  const rows = await page.evaluate(() => document.querySelectorAll('#p-layers .lyr').length);
  await ev(() => AI.sel.set(AI.app, [AI.app.doc.layers[0].children[0]]));
  await page.evaluate(() => document.querySelectorAll('#p-swatches .sw')[5].click());
  const c = await ev(() => AI.app.sel[0].fill.color);
  if (rows < 2 || !c) throw new Error(`rows=${rows} color=${c}`);
  return `레이어 ${rows}행 / 칠 ${c}`;
});

await check('SVG · PNG 내보내기', async () => {
  const svg = await ev(() => AI.io.toSVG(AI.app));
  if (!/<svg[\s\S]*<\/svg>/.test(svg)) throw new Error('SVG 형식 오류');
  const bytes = await page.evaluate(() => {
    const ab = AI.app.doc.artboards[0];
    const cv = document.createElement('canvas');
    cv.width = ab.w; cv.height = ab.h;
    AI.render.scene(cv.getContext('2d'), {
      doc: AI.app.doc, dpr: 1, exporting: true, exportBg: true,
      view: { scale: 1, tx: -ab.x, ty: -ab.y }, prefs: {}, canvas: cv, sel: [], selPts: []
    });
    return cv.toDataURL().length;
  });
  return `SVG ${svg.length}B / PNG ${bytes}B`;
});

await check('고해상도(DPR 1.5/2) 레이아웃', async () => {
  const out = [];
  for (const dsf of [1.5, 2]) {
    const p2 = await browser.newPage({ viewport: { width: 1200, height: 800 }, deviceScaleFactor: dsf });
    await p2.goto(`http://127.0.0.1:${PORT}/index.html`, { waitUntil: 'load' });
    await p2.waitForTimeout(300);
    const px = await p2.evaluate(() => {
      const c = AI.app.canvas, ctx = c.getContext('2d');
      return [...ctx.getImageData(Math.round(c.width / 2), Math.round(c.height / 2), 1, 1).data];
    });
    await p2.close();
    if (px[3] !== 255) throw new Error(`dpr ${dsf} 에서 캔버스가 비어 있음`);
    out.push(dsf + '×');
  }
  return out.join(', ') + ' 정상 렌더';
});

/* ---------------- 결과 ---------------- */
console.log('\n=== Illymolly E2E ===');
for (const [n, s, d] of results) console.log(`${s === 'OK' ? '✔' : '✘'} ${n}${d ? ' — ' + d : ''}`);
const failed = results.filter(r => r[1] === 'FAIL').length;
console.log(`\n${results.length - failed}/${results.length} 통과, 콘솔 오류 ${errors.length}건`);
errors.slice(0, 10).forEach(e => console.log('  ' + e));

await browser.close();
server.close();
process.exit(failed || errors.length ? 1 : 0);
