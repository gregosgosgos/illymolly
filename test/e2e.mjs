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

let box = await (await page.$('#view')).boundingBox();
/* 문서 탭 줄이 나타나거나 사라지면 캔버스 위치가 달라지므로 다시 잰다 */
const refreshBox = async () => { box = await (await page.$('#view')).boundingBox(); };
const at = (fx, fy) => ({ x: box.x + box.width * fx, y: box.y + box.height * fy });
const ev = f => page.evaluate(f);
const count = () => ev(() => AI.app.doc.layers.reduce((n, l) => n + l.children.length, 0));
/* 패널은 탭으로 묶여 있으므로 만지기 전에 앞으로 꺼낸다 (사용자가 탭을 누르는 것과 같다) */
const showPanel = name => page.evaluate(n => AI.ui.showPanel(n), name);

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
  const n = await page.evaluate(() => document.querySelectorAll('.menubar-pop .mi').length);
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
  await showPanel('swatches');
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

/* ---------------- 신규 기능 ---------------- */
const PNG1x1 = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAQAAAAECAYAAACp8Z5+AAAAF0lEQVR42mNk+M/wn4EIwDiqkL4KAcT9A/0k030hAAAAAElFTkSuQmCC';

await check('이미지 배치 · 렌더 · 히트 · 저장', async () => {
  const r = await page.evaluate(async (src) => {
    const app = AI.app;
    app.setDoc(AI.model.newDoc(400, 300));
    AI.viewT.setZoom(app, 1); app.view.tx = 0; app.view.ty = 0;
    const it = AI.model.newImage(src, 50, 50, 120, 90);
    app.doc.layers[0].children.push(it);
    app.invalidate();
    await new Promise(res => { const im = AI.render.getImage(src, res); if (im.complete) res(); });
    AI.render.scene(app.canvas.getContext('2d'), app);
    const b = AI.render.worldBounds(app.doc, it, true);
    const hit = AI.hit.itemAt(app, 100, 90, false) === it;
    const svg = AI.io.toSVG(app);
    const json = JSON.parse(JSON.stringify({ doc: app.doc })).doc;
    AI.io.normalizeDoc(json);
    return {
      bounds: [b.x, b.y, b.x2 - b.x, b.y2 - b.y], hit,
      svgHasImage: /<image[^>]+href="data:image\/png/.test(svg),
      jsonOk: json.layers[0].children[0].type === 'image' && json.layers[0].children[0].src === src
    };
  }, PNG1x1);
  if (!r.hit) throw new Error('히트 실패');
  if (String(r.bounds) !== '50,50,120,90') throw new Error('bounds=' + r.bounds);
  if (!r.svgHasImage) throw new Error('SVG image 누락');
  if (!r.jsonOk) throw new Error('JSON 왕복 실패');
  return '배치/히트/SVG/JSON 모두 정상';
});

await check('문자 패널로 글꼴·크기·정렬 변경', async () => {
  await ev(() => {
    const app = AI.app;
    app.setDoc(AI.model.newDoc(800, 600));
    const t = AI.model.newText(100, 100, '가나다 ABC');
    app.doc.layers[0].children.push(t);
    AI.sel.set(app, [t]);
    AI.ui.syncAll(app);
  });
  await showPanel('type');
  await page.selectOption('#ty-font', 'Georgia, serif');
  await page.fill('#ty-size', '48');
  await page.press('#ty-size', 'Enter');
  await page.click('[data-talign="center"]');
  const t = await ev(() => { let r = null; AI.model.walk(AI.app.doc, it => { if (it.type === 'text') r = it.text; }); return r; });
  if (t.family !== 'Georgia, serif' || t.size !== 48 || t.align !== 'center') throw new Error(JSON.stringify(t));
  return `${t.family} / ${t.size}px / ${t.align}`;
});

await check('그레이디언트 패널 정지점 추가·이동·반전', async () => {
  await ev(() => {
    const app = AI.app;
    app.setDoc(AI.model.newDoc(800, 600));
    const r = AI.model.newRect(50, 50, 200, 150, 0);
    r.fill = AI.color.gradient('linear', '#ff0000', '#0000ff');
    app.doc.layers[0].children.push(r);
    AI.sel.set(app, [r]);
    app.fillFocus = true;
    AI.ui.syncAll(app);
  });
  await showPanel('gradient');
  await page.waitForTimeout(50);
  const bar = await (await page.$('#gr-bar')).boundingBox();
  await page.mouse.click(bar.x + bar.width * 0.5, bar.y + bar.height / 2);
  await page.waitForTimeout(60);
  const n1 = await ev(() => AI.app.sel[0].fill.stops.length);
  if (n1 !== 3) throw new Error('정지점 추가 실패 n=' + n1);
  const firstBefore = await ev(() => AI.app.sel[0].fill.stops[0].color);
  await page.click('#gr-rev');
  const firstAfter = await ev(() => AI.app.sel[0].fill.stops[0].color);
  if (firstBefore === firstAfter) throw new Error('반전 실패');
  await page.selectOption('#gr-type', 'radial');
  const ty = await ev(() => AI.app.sel[0].fill.type);
  if (ty !== 'radial') throw new Error('type=' + ty);
  return `정지점 ${n1}개 / 반전 / ${ty}`;
});

await check('컨트롤 바 도구 옵션 (모퉁이·별·브러시)', async () => {
  await ev(() => {
    const app = AI.app;
    app.setDoc(AI.model.newDoc(800, 600));
    const r = AI.model.newRect(50, 50, 200, 150, 0);
    app.doc.layers[0].children.push(r);
    AI.sel.set(app, [r]);
    AI.ui.syncAll(app);
  });
  await page.keyboard.press('KeyM');
  await page.fill('#to-r', '24');
  await page.press('#to-r', 'Enter');
  const rr = await ev(() => AI.app.sel[0].shape.r);
  if (rr !== 24) throw new Error('모퉁이 반경=' + rr);
  await ev(() => { AI.tools.setTool(AI.app, 'star', true); AI.ui.syncTool(AI.app); });
  const hasN = await page.evaluate(() => !!document.getElementById('to-n'));
  await ev(() => { AI.tools.setTool(AI.app, 'brush', true); AI.ui.syncTool(AI.app); });
  await page.fill('#to-bw', '9');
  await page.press('#to-bw', 'Enter');
  const bw = await ev(() => AI.app.brushWidth);
  await page.keyboard.press('KeyV');
  if (!hasN || bw !== 9) throw new Error(`hasN=${hasN} brushWidth=${bw}`);
  return '모퉁이 24 / 별 옵션 / 브러시 폭 9';
});

await check('패스파인더 나누기·병합', async () => {
  const r = await ev(() => {
    const app = AI.app;
    app.setDoc(AI.model.newDoc(800, 600));
    const L = app.doc.layers[0];
    const a = AI.model.newRect(0, 0, 100, 100, 0), b = AI.model.newRect(50, 50, 100, 100, 0);
    a.fill = AI.color.solid('#ff0000'); b.fill = AI.color.solid('#ff0000');
    L.children.push(a, b);
    AI.sel.set(app, [a, b]);
    AI.commands.run('pf_divide');
    const pieces = app.sel[0].children ? app.sel[0].children.length : 0;
    AI.commands.run('undo');
    const a2 = app.doc.layers[0].children[0], b2 = app.doc.layers[0].children[1];
    AI.sel.set(app, [a2, b2]);
    AI.commands.run('pf_merge');
    const it = app.sel[0];
    const rings = AI.edit.itemRings(app, it.type === 'group' ? it.children[0] : it);
    const area = Math.round(rings.reduce((s, x) => s + Math.abs(AI.pathfinder.area(x)), 0));
    return { pieces, mergedArea: area };
  });
  if (r.pieces !== 3) throw new Error('divide 조각=' + r.pieces);
  if (Math.abs(r.mergedArea - 17500) > 40) throw new Error('merge 면적=' + r.mergedArea);
  return `나누기 ${r.pieces}조각 / 병합 면적 ${r.mergedArea}`;
});

/* ---------------- Illustrator 재현도 ---------------- */
await check('새 문서 대화상자 (사전 설정 · 방향)', async () => {
  await page.keyboard.press('Control+KeyN');
  await page.waitForSelector('.dlg', { timeout: 2000 });
  const title = await page.textContent('.dlg-title');
  await page.selectOption('#dlgf-preset', 'fhd');
  const w1 = await page.inputValue('#dlgf-w');
  const autoOrient = await page.isChecked('input[name="dlgf-orient"][value="l"]');
  await page.click('input[name="dlgf-orient"][value="p"]');
  const w2 = await page.inputValue('#dlgf-w');
  if (!autoOrient) throw new Error('가로 사전 설정인데 방향 라디오가 가로로 바뀌지 않음');
  await page.fill('#dlgf-name', '테스트 문서');
  await page.click('.dlg-btn.primary');
  await page.waitForTimeout(120);
  const doc = await ev(() => ({ n: AI.app.doc.name, w: AI.app.doc.artboards[0].w, h: AI.app.doc.artboards[0].h }));
  if (title !== '새 문서') throw new Error('제목=' + title);
  if (w1 !== '1920') throw new Error('FHD 폭=' + w1);
  if (w2 !== '1080') throw new Error('세로 전환 폭=' + w2);
  if (doc.n !== '테스트 문서' || doc.w !== 1080) throw new Error(JSON.stringify(doc));
  const tabs = await ev(() => illy.documents().length);
  if (tabs !== 2) throw new Error('새 문서가 새 탭으로 열리지 않음=' + tabs);
  await refreshBox();      /* 탭 줄이 생겨 캔버스가 아래로 밀렸다 */
  return `${title} · FHD ${w1} → 세로 ${w2} · ${doc.w}×${doc.h} · 새 탭`;
});

await check('회전 대화상자 — 미리 보기 · 복사', async () => {
  await ev(() => {
    const app = AI.app;
    app.setDoc(AI.model.newDoc(600, 600));
    const r = AI.model.newRect(100, 100, 200, 100, 0);
    app.doc.layers[0].children.push(r);
    AI.sel.set(app, [r]);
  });
  await ev(() => AI.commands.run('rotateDialog'));
  await page.waitForSelector('.dlg');
  await page.fill('#dlgf-angle', '90');
  await page.press('#dlgf-angle', 'Tab');
  await page.waitForTimeout(80);
  const previewW = await ev(() => { const b = AI.render.selectionBounds(AI.app, true); return Math.round(b.x2 - b.x); });
  const buttons = await page.$$eval('.dlg-btn', els => els.map(e => e.textContent));
  await page.click('.dlg-btn:has-text("복사")');
  await page.waitForTimeout(100);
  const n = await count();
  if (previewW !== 100) throw new Error('미리보기 폭=' + previewW);
  if (n !== 2) throw new Error('복사 후 개수=' + n);
  if (buttons.join() !== '복사,취소,확인') throw new Error('버튼=' + buttons);
  return `미리보기 회전 반영 · 버튼 ${buttons.join('/')} · 복사로 ${n}개`;
});

await check('도형 도구 클릭 → 크기 대화상자', async () => {
  await ev(() => { AI.app.setDoc(AI.model.newDoc(600, 600)); });
  await page.keyboard.press('KeyM');
  const p = at(0.5, 0.5);
  await page.mouse.click(p.x, p.y);
  await page.waitForSelector('.dlg', { timeout: 2000 });
  const t = await page.textContent('.dlg-title');
  await page.fill('#dlgf-w', '240');
  await page.fill('#dlgf-h', '160');
  await page.fill('#dlgf-r', '20');
  await page.click('.dlg-btn.primary');
  await page.waitForTimeout(100);
  const sh = await ev(() => AI.app.sel[0] && AI.app.sel[0].shape);
  await page.keyboard.press('KeyV');
  if (t !== '사각형') throw new Error('제목=' + t);
  if (!sh || sh.w !== 240 || sh.h !== 160 || sh.r !== 20) throw new Error(JSON.stringify(sh));
  return `${t} 240×160 r20`;
});

await check('도구 아이콘 더블클릭 → 도구 옵션', async () => {
  await ev(() => { AI.tools.setTool(AI.app, 'star', true); });
  await page.dblclick('#toolbar .tool.active');
  await page.waitForSelector('.dlg', { timeout: 2000 });
  const t = await page.textContent('.dlg-title');
  await page.click('.dlg-btn:has-text("취소")');
  await page.keyboard.press('KeyV');
  if (t !== '별모양') throw new Error('제목=' + t);
  return t + ' 옵션 열림';
});

await check('격리 모드 — 브레드크럼 바 · 외부 흐리게', async () => {
  await ev(() => {
    const app = AI.app;
    app.setDoc(AI.model.newDoc(600, 600));
    AI.viewT.setZoom(app, 1); app.view.tx = 0; app.view.ty = 0;
    const L = app.doc.layers[0];
    const a = AI.model.newRect(50, 50, 100, 100, 0);
    a.fill = AI.color.solid('#ff0000');
    const g = AI.model.newGroup([AI.model.newRect(200, 50, 100, 100, 0)]);
    g.children[0].fill = AI.color.solid('#0000ff');
    g.name = '내부 그룹';
    L.children.push(a, g);
    app.isolation = [g];
    AI.sel.set(app, [g.children[0]]);
    app.invalidate();
    AI.ui.syncAll(app);
    AI.render.scene(app.canvas.getContext('2d'), app);
  });
  await page.waitForTimeout(80);
  const bar = await page.evaluate(() => {
    const b = document.getElementById('iso-bar');
    return { hidden: b.hidden, crumbs: [...b.querySelectorAll('.crumb')].map(c => c.textContent) };
  });
  const px = await ev(() => {
    const c = AI.app.canvas, ctx = c.getContext('2d'), d = AI.app.dpr;
    const out = ctx.getImageData(Math.round(100 * d), Math.round(100 * d), 1, 1).data;   /* 격리 밖 빨강 */
    const ins = ctx.getImageData(Math.round(250 * d), Math.round(100 * d), 1, 1).data;   /* 격리 안 파랑 */
    return { out: [...out], ins: [...ins] };
  });
  if (bar.hidden) throw new Error('격리 바가 표시되지 않음');
  if (bar.crumbs.length !== 2) throw new Error('브레드크럼=' + JSON.stringify(bar.crumbs));
  if (px.out[0] < 200) throw new Error('격리 밖 픽셀=' + px.out);
  if (px.out[1] < 150) throw new Error('흐리게 처리되지 않음: ' + px.out);
  if (px.ins[2] < 200 || px.ins[0] > 60) throw new Error('격리 안 픽셀=' + px.ins);
  await ev(() => { AI.app.isolation = []; AI.ui.syncAll(AI.app); });
  return `${bar.crumbs.join(' › ')} · 외부 흐리게 rgb(${px.out.slice(0, 3)})`;
});

await check('획 정렬 — 가운데 / 안쪽 / 바깥쪽', async () => {
  const sample = await page.evaluate(async () => {
    const app = AI.app;
    app.setDoc(AI.model.newDoc(400, 400));
    AI.viewT.setZoom(app, 1); app.view.tx = 0; app.view.ty = 0;
    const r = AI.model.newRect(100, 100, 200, 200, 0);
    r.fill = AI.color.solid('#ffffff');
    r.stroke = AI.model.mkStroke('#ff0000', 20);
    app.doc.layers[0].children.push(r);
    const ctx = app.canvas.getContext('2d'), d = app.dpr;
    function probe(align) {
      r.stroke.align = align;
      AI.render.scene(ctx, app);
      /* 도형 바깥 6px 지점 / 안쪽 6px 지점 */
      const outside = [...ctx.getImageData(Math.round(94 * d), Math.round(200 * d), 1, 1).data];
      const inside = [...ctx.getImageData(Math.round(106 * d), Math.round(200 * d), 1, 1).data];
      return { outside, inside };
    }
    return { center: probe('center'), inside: probe('inside'), outside: probe('outside') };
  });
  const isRed = p => p[0] > 200 && p[1] < 80;
  if (!isRed(sample.center.outside) || !isRed(sample.center.inside)) throw new Error('가운데 정렬 실패');
  if (isRed(sample.inside.outside) || !isRed(sample.inside.inside)) throw new Error('안쪽 정렬 실패');
  if (!isRed(sample.outside.outside) || isRed(sample.outside.inside)) throw new Error('바깥쪽 정렬 실패');
  return '세 정렬 모두 픽셀로 확인';
});

await check('변형 패널 기준점 (오른쪽 아래 고정 크기 조절)', async () => {
  await ev(() => {
    const app = AI.app;
    app.setDoc(AI.model.newDoc(600, 600));
    const r = AI.model.newRect(100, 100, 200, 100, 0);
    app.doc.layers[0].children.push(r);
    AI.sel.set(app, [r]);
    AI.ui.syncAll(app);
  });
  await showPanel('transform');
  await page.click('#tf-ref .rp[data-i="8"]');          /* 오른쪽 아래 */
  await page.fill('#tf-w', '100');
  await page.press('#tf-w', 'Enter');
  await page.waitForTimeout(80);
  const b = await ev(() => { const x = AI.render.selectionBounds(AI.app, true); return [x.x, x.y, x.x2, x.y2].map(Math.round); });
  if (b[2] !== 300 || b[3] !== 200 || b[0] !== 200) throw new Error('bounds=' + b);
  const xy = await page.inputValue('#tf-x');
  return `오른쪽 아래 고정 · bounds ${b} · X필드=${xy}`;
});

await check('라이브 모퉁이 위젯 드래그', async () => {
  const geo = await ev(() => {
    const app = AI.app;
    app.setDoc(AI.model.newDoc(600, 600));
    AI.viewT.setZoom(app, 1); app.view.tx = 0; app.view.ty = 0;
    const r = AI.model.newRect(100, 100, 300, 200, 0);
    app.doc.layers[0].children.push(r);
    AI.sel.set(app, [r]);
    AI.tools.setTool(app, 'select', true);
    app.invalidate();
    const cw = AI.render.cornerWidgets(app);
    return cw ? { x: cw.pts[0].x, y: cw.pts[0].y } : null;
  });
  if (!geo) throw new Error('모퉁이 위젯이 없음');
  await drag({ x: box.x + geo.x, y: box.y + geo.y }, { x: box.x + geo.x + 40, y: box.y + geo.y + 40 });
  const r = await ev(() => AI.app.sel[0].shape.r);
  if (!(r > 30)) throw new Error('반경=' + r);
  return '반경 0 → ' + Math.round(r);
});

await check('Ctrl+Space 임시 확대 도구', async () => {
  await page.keyboard.press('KeyV');
  await page.keyboard.down('Control');
  await page.keyboard.down('Space');
  const t1 = await ev(() => AI.app.tool);
  await page.keyboard.up('Space');
  await page.keyboard.up('Control');
  const t2 = await ev(() => AI.app.tool);
  if (t1 !== 'zoom' || t2 !== 'select') throw new Error(`${t1}/${t2}`);
  return 'zoom → select 복귀';
});

await check('도구별 커서 적용', async () => {
  const res = {};
  for (const [key, tool] of [['KeyV', 'select'], ['KeyP', 'pen'], ['KeyT', 'type'], ['KeyZ', 'zoom']]) {
    await page.keyboard.press(key);
    res[tool] = await page.evaluate(() => document.getElementById('view').style.cursor);
  }
  await page.keyboard.press('KeyV');
  const allSvg = Object.values(res).every(v => v.startsWith('url("data:image/svg+xml'));
  const distinct = new Set(Object.values(res)).size;
  if (!allSvg) throw new Error(Object.keys(res).join() + ' 중 SVG 커서가 아닌 것이 있음');
  if (distinct !== 4) throw new Error('커서가 중복됨 ' + distinct);
  return '4개 도구 모두 고유 SVG 커서';
});

await check('편집 메뉴가 실행 취소 동작 이름을 표시', async () => {
  await ev(() => {
    const app = AI.app;
    app.setDoc(AI.model.newDoc(600, 600));
    const r = AI.model.newRect(50, 50, 100, 100, 0);
    app.doc.layers[0].children.push(r);
    AI.sel.set(app, [r]);
    app.history.reset(app.doc, 'base');
    app.history.begin('이동', app.doc);
    AI.edit.move(app, 10, 0);
    app.history.commit();
  });
  await page.click('#menus .menu-title:has-text("편집")');
  await page.waitForTimeout(100);
  const first = await page.textContent('.menubar-pop .mi span:nth-child(2)');
  await page.keyboard.press('Escape');
  if (first !== '실행 취소 이동') throw new Error('메뉴=' + first);
  return first;
});

await check('환경 설정 대화상자 (키보드 증감)', async () => {
  await page.keyboard.press('Control+KeyK');
  await page.waitForSelector('.dlg');
  await page.fill('#dlgf-inc', '5');
  await page.click('.dlg-btn.primary');
  await page.waitForTimeout(80);
  await ev(() => {
    const app = AI.app;
    app.setDoc(AI.model.newDoc(600, 600));
    const r = AI.model.newRect(50, 50, 100, 100, 0);
    app.doc.layers[0].children.push(r);
    AI.sel.set(app, [r]);
  });
  const x0 = await ev(() => AI.render.selectionBounds(AI.app, true).x);
  await page.keyboard.press('ArrowRight');
  const x1 = await ev(() => AI.render.selectionBounds(AI.app, true).x);
  await ev(() => { AI.app.prefs.keyIncrement = 1; });
  if (Math.abs(x1 - x0 - 5) > 0.01) throw new Error(`${x0} -> ${x1}`);
  return '증감 5pt 적용';
});

await check('문서 단위 (mm) — 패널 · 눈금자 · 상태바', async () => {
  await ev(() => {
    const app = AI.app;
    app.setDoc(AI.model.newDoc(595.28, 841.89));
    const r = AI.model.newRect(0, 0, 283.4646, 141.7323, 0);   /* 100mm × 50mm */
    app.doc.layers[0].children.push(r);
    AI.sel.set(app, [r]);
    AI.commands.setUnit(app, 'mm');
  });
  await page.waitForTimeout(100);
  const w = await page.inputValue('#tf-w');
  const h = await page.inputValue('#tf-h');
  /* mm 로 입력 -> pt 로 저장되는지 */
  await page.fill('#tf-w', '200');
  await page.press('#tf-w', 'Enter');
  await page.waitForTimeout(80);
  const pt = await ev(() => { const b = AI.render.selectionBounds(AI.app, true); return b.x2 - b.x; });
  /* 단위 접미사를 직접 적으면 그 단위로 해석 */
  await page.fill('#tf-w', '72pt');
  await page.press('#tf-w', 'Enter');
  await page.waitForTimeout(80);
  const pt2 = await ev(() => { const b = AI.render.selectionBounds(AI.app, true); return b.x2 - b.x; });
  await ev(() => AI.commands.setUnit(AI.app, 'pt'));
  if (Math.abs(+w - 100) > 0.05 || Math.abs(+h - 50) > 0.05) throw new Error(`표시 ${w}×${h} (기대 100×50)`);
  if (Math.abs(pt - 566.93) > 0.5) throw new Error('200mm -> ' + pt + 'pt');
  if (Math.abs(pt2 - 72) > 0.01) throw new Error('72pt -> ' + pt2);
  return `${w}×${h} mm · 200mm=${Math.round(pt)}pt · "72pt" 그대로 해석`;
});

await check('대지 추가 · 네비게이션', async () => {
  await ev(() => { AI.app.setDoc(AI.model.newDoc(400, 300)); AI.ui.syncAll(AI.app); });
  const disabled0 = await page.isDisabled('#ab-next');
  await ev(() => AI.commands.run('newArtboard'));
  await ev(() => AI.commands.run('newArtboard'));
  await page.waitForTimeout(80);
  const label = await page.textContent('#st-artboard');
  await page.click('#ab-first');
  await page.waitForTimeout(60);
  const idx = await ev(() => AI.app.doc.activeArtboard);
  const n = await ev(() => AI.app.doc.artboards.length);
  if (!disabled0) throw new Error('대지 1개일 때 다음 버튼이 활성 상태');
  if (n !== 3 || idx !== 0) throw new Error(`n=${n} idx=${idx}`);
  if (!/3\/3/.test(label)) throw new Error('상태바=' + label);
  return `${n}개 · 상태바 "${label}" · 첫 대지 이동`;
});

await check('눈금자 우클릭 단위 메뉴', async () => {
  const rh = await (await page.$('#ruler-h')).boundingBox();
  await page.mouse.click(rh.x + 200, rh.y + 10, { button: 'right' });
  await page.waitForTimeout(120);
  const items = await page.$$eval('#contextmenu .mi', els => els.map(e => e.textContent.replace('✓', '').trim()));
  await page.click('#contextmenu .mi:has-text("밀리미터")');
  await page.waitForTimeout(80);
  const u = await ev(() => AI.app.prefs.unit);
  await ev(() => AI.commands.setUnit(AI.app, 'pt'));
  if (items.length !== 5) throw new Error('항목=' + items);
  if (u !== 'mm') throw new Error('단위=' + u);
  return items.join('/');
});

await check('환경 설정의 격자 간격이 실제 격자에 반영', async () => {
  const px = await page.evaluate(() => {
    const app = AI.app;
    app.setDoc(AI.model.newDoc(400, 400));
    AI.viewT.setZoom(app, 1); app.view.tx = 0; app.view.ty = 0;
    app.prefs.grid = true;
    const ctx = app.canvas.getContext('2d'), d = app.dpr;
    function lineCount(size, div) {
      app.prefs.gridSize = size; app.prefs.gridDiv = div;
      AI.render.scene(ctx, app);
      let n = 0, prev = false;
      for (let x = 0; x < 300; x++) {
        const p = ctx.getImageData(Math.round(x * d), Math.round(50 * d), 1, 1).data;
        const isLine = p[2] > p[0] + 6;
        if (isLine && !prev) n++;
        prev = isLine;
      }
      return n;
    }
    const a = lineCount(72, 8);    /* 9pt 간격 */
    const b = lineCount(72, 4);    /* 18pt 간격 */
    app.prefs.grid = false;
    return { a, b };
  });
  if (!(px.a > px.b * 1.6)) throw new Error(JSON.stringify(px));
  return `분할 8 → ${px.a}줄, 분할 4 → ${px.b}줄`;
});

/* ---------------- 자동화 API (브라우저) ---------------- */
await check('window.illy 가 GUI 와 같은 문서를 공유', async () => {
  const r = await ev(() => {
    AI.app.setDoc(AI.model.newDoc(400, 300));
    const id = illy.addRect({ x: 20, y: 20, width: 120, height: 80, fill: '#ff3366', name: 'API 사각형' });
    return {
      id,
      selected: AI.app.sel.map(i => i.id),
      inDoc: !!AI.model.find(AI.app.doc, id),
      layerRows: document.querySelectorAll('#p-layers .lyr').length,
      panelName: document.getElementById('pr-info').textContent
    };
  });
  if (!r.inDoc) throw new Error('문서에 없음');
  if (r.selected[0] !== r.id) throw new Error('선택 반영 안 됨');
  if (r.layerRows < 2) throw new Error('레이어 패널 미갱신 ' + r.layerRows);
  if (!/API 사각형/.test(r.panelName)) throw new Error('속성 패널 미갱신: ' + r.panelName);
  return `${r.id} · 패널 "${r.panelName}"`;
});

await check('API 변경을 GUI 단축키로 실행 취소', async () => {
  const before = await count();
  await ev(() => illy.addEllipse({ x: 200, y: 100, width: 80, height: 80, fill: 'blue' }));
  const mid = await count();
  await page.keyboard.press('Control+KeyZ');
  await page.waitForTimeout(80);
  const after = await count();
  if (mid !== before + 1 || after !== before) throw new Error(`${before}/${mid}/${after}`);
  return `${before} → ${mid} → Ctrl+Z → ${after}`;
});

await check('GUI 조작을 API 로 되돌리기', async () => {
  await ev(() => { AI.app.setDoc(AI.model.newDoc(400, 300)); });
  await page.keyboard.press('KeyM');
  await drag(at(0.3, 0.3), at(0.5, 0.5));
  const n1 = await count();
  const r = await ev(() => illy.undo());
  const n2 = await count();
  await page.keyboard.press('KeyV');
  if (n1 !== 1 || n2 !== 0 || !r.ok) throw new Error(`${n1}/${n2}/${JSON.stringify(r)}`);
  return 'GUI 로 그린 도형을 illy.undo() 로 제거';
});

await check('브라우저에서 toPNG 가 실제 이미지를 만든다', async () => {
  const r = await ev(async () => {
    AI.app.setDoc(AI.model.newDoc(100, 60));
    illy.addRect({ x: 0, y: 0, width: 100, height: 60, fill: '#00ff00' });
    const url = illy.toPNG({ scale: 2 });
    const im = new Image();
    await new Promise(res => { im.onload = res; im.src = url; });
    const cv = document.createElement('canvas');
    cv.width = im.width; cv.height = im.height;
    cv.getContext('2d').drawImage(im, 0, 0);
    const px = [...cv.getContext('2d').getImageData(100, 60, 1, 1).data];
    return { w: im.width, h: im.height, px };
  });
  if (r.w !== 200 || r.h !== 120) throw new Error(`크기 ${r.w}×${r.h}`);
  if (r.px[1] < 200 || r.px[0] > 60) throw new Error('픽셀 ' + r.px);
  return `${r.w}×${r.h} · 중앙 픽셀 rgb(${r.px.slice(0, 3)})`;
});

await check('postMessage 브리지로 외부에서 제어', async () => {
  const host = await browser.newPage();
  await host.setContent(`<!doctype html><iframe id="f" src="http://127.0.0.1:${PORT}/index.html" width="900" height="600"></iframe>`);
  await host.waitForTimeout(900);
  const out = await host.evaluate(async () => {
    const f = document.getElementById('f').contentWindow;
    let seq = 0;
    function rpc(op, args) {
      return new Promise((resolve, reject) => {
        const id = 'r' + (++seq);
        const t = setTimeout(() => reject(new Error('timeout ' + op)), 4000);
        function on(e) {
          if (!e.data || e.data.illy !== 1 || e.data.id !== id) return;
          clearTimeout(t);
          window.removeEventListener('message', on);
          resolve(e.data.response);
        }
        window.addEventListener('message', on);
        f.postMessage({ illy: 1, id, op, args }, '*');
      });
    }
    const ping = await rpc('__ping');
    const ops = await rpc('__ops');
    await rpc('newDocument', { width: 200, height: 100, name: '브리지' });
    const made = await rpc('addRect', { x: 10, y: 10, width: 80, height: 50, fill: '#0088ff' });
    const bad = await rpc('addRect', { x: 0 });
    const batch = await rpc('__batch', [
      { op: 'addEllipse', args: { x: 100, y: 10, width: 60, height: 60, fill: 'red' } },
      { op: 'find', args: '*' }
    ]);
    const svg = await rpc('toSVG');
    return {
      ping: ping.result, opCount: ops.result.length, madeId: made.result,
      badOk: bad.ok, badCode: bad.error && bad.error.code,
      batchOk: batch.ok, batchCount: batch.results && batch.results[1].length,
      svgHasRect: /#0088ff/.test(svg.result), svgLen: svg.result.length
    };
  });
  await host.close();
  if (!out.ping.ready) throw new Error('__ping 실패');
  if (out.opCount < 30) throw new Error('__ops ' + out.opCount);
  if (!out.madeId) throw new Error('생성 실패');
  if (out.badOk || out.badCode !== 'MISSING_ARG') throw new Error('오류 전달 실패 ' + out.badCode);
  if (!out.batchOk || out.batchCount !== 2) throw new Error('배치 실패');
  if (!out.svgHasRect) throw new Error('SVG 내용 불일치');
  return `ping v${out.ping.version} · ${out.opCount}개 연산 · ${out.madeId} · 배치 ${out.batchCount}개 · SVG ${out.svgLen}B`;
});

/* ---------------- 일러스트레이터 메뉴 기능 (효과 · 대지 · 안내선 · 추적) ---------------- */

await check('효과 > 흐림 효과 > 가우시안 흐림 — 미리 보기 · 바운딩 확장', async () => {
  await ev(() => {
    const app = AI.app;
    app.setDoc(AI.model.newDoc(400, 400));
    const r = AI.model.newRect(100, 100, 100, 100, 0);
    r.fill = AI.color.solid('#3366cc');
    app.doc.layers[0].children.push(r);
    AI.sel.set(app, [r]);
  });
  await ev(() => AI.commands.run('fxBlur'));
  await page.waitForSelector('.dlg');
  const title = await page.textContent('.dlg-title');
  await page.fill('#dlgf-radius', '10');
  await page.press('#dlgf-radius', 'Tab');
  await page.waitForTimeout(60);
  const preview = await ev(() => AI.effects.list(AI.app.sel[0]).length);
  await page.click('.dlg-btn:has-text("확인")');
  await page.waitForTimeout(80);
  const r2 = await ev(() => {
    const it = AI.app.sel[0];
    const wm = AI.model.worldMatrix(AI.app.doc, it);
    const vis = AI.render.boundsM(it, wm, false, 1);     /* 미리보기(효과 포함) 경계 */
    const geo = AI.render.boundsM(it, wm, true, 1);      /* 기하 경계 — 효과에 영향받지 않는다 */
    return {
      n: AI.effects.list(it).length,
      type: AI.effects.list(it)[0].type,
      radius: AI.effects.list(it)[0].radius,
      grew: Math.round((vis.x2 - vis.x) - (geo.x2 - geo.x)),
      geoW: Math.round(geo.x2 - geo.x),
      label: AI.effects.label(AI.effects.list(it)[0]),
      panel: document.querySelectorAll('#fx-list .list-row').length
    };
  });
  if (title !== '가우시안 흐림') throw new Error('제목=' + title);
  if (preview !== 1) throw new Error('미리보기 효과 수=' + preview);
  if (r2.n !== 1 || r2.type !== 'blur' || r2.radius !== 10) throw new Error('효과=' + JSON.stringify(r2));
  if (r2.grew !== 60) throw new Error('바운딩 확장=' + r2.grew);   /* radius*3 양쪽 = 60 */
  if (r2.geoW !== 100) throw new Error('기하 경계가 바뀜=' + r2.geoW);
  if (r2.panel !== 1) throw new Error('패널 행=' + r2.panel);
  return `${r2.label} · 바운딩 +${r2.grew}pt · 효과 패널 ${r2.panel}행`;
});

await check('효과 취소는 원래 모양을 되돌린다', async () => {
  await ev(() => AI.commands.run('fxShadow'));
  await page.waitForSelector('.dlg');
  await page.fill('#dlgf-dy', '20');
  await page.press('#dlgf-dy', 'Tab');
  await page.waitForTimeout(60);
  const during = await ev(() => AI.effects.list(AI.app.sel[0]).length);
  await page.click('.dlg-btn:has-text("취소")');
  await page.waitForTimeout(60);
  const after = await ev(() => AI.effects.list(AI.app.sel[0]).map(e => e.type).join(','));
  if (during !== 2) throw new Error('미리보기 중 효과 수=' + during);
  if (after !== 'blur') throw new Error('취소 후=' + after);
  return '미리보기 2개 → 취소 후 blur 만 남음';
});

await check('마지막 효과 적용 (Ctrl+Shift+E) · 효과 패널 삭제', async () => {
  await ev(() => {
    const app = AI.app;
    const r = AI.model.newRect(250, 250, 60, 60, 0);
    app.doc.layers[0].children.push(r);
    AI.sel.set(app, [r]);
  });
  await ev(() => { AI.app.lastEffect = { type: 'glow', blur: 8, color: '#ffcc00', alpha: 0.8 }; });
  await ev(() => AI.commands.run('fxLast'));
  await page.waitForTimeout(60);
  const applied = await ev(() => AI.effects.list(AI.app.sel[0]).map(e => e.type).join(','));
  await showPanel('effects');
  await page.waitForSelector('#fx-list [data-del]');
  await page.click('#fx-list [data-del]');
  await page.waitForTimeout(80);
  const left = await ev(() => AI.effects.list(AI.app.sel[0]).length);
  const undone = await ev(() => { AI.commands.run('undo'); return AI.effects.list(AI.app.sel[0]).length; });
  if (applied !== 'glow') throw new Error('적용=' + applied);
  if (left !== 0) throw new Error('삭제 후=' + left);
  if (undone !== 1) throw new Error('삭제 취소 후=' + undone);
  return 'glow 반복 적용 · 패널에서 삭제 · 실행 취소로 복원';
});

await check('효과가 SVG 필터로 내보내진다', async () => {
  const svg = await ev(() => AI.io.toSVG(AI.app));
  if (!/<filter id="fx/.test(svg)) throw new Error('filter 정의 없음');
  if (!/filter="url\(#fx/.test(svg)) throw new Error('filter 참조 없음');
  if (!/feDropShadow|feGaussianBlur/.test(svg)) throw new Error('필터 원소 없음');
  return 'filter 정의 · 참조 · feGaussianBlur/feDropShadow 포함';
});

await check('획 패널 화살표 — 시작/끝/비율 · 뒤바꾸기 · SVG marker', async () => {
  await ev(() => {
    const app = AI.app;
    app.setDoc(AI.model.newDoc(400, 400));
    const l = AI.model.newLine(50, 200, 350, 200);
    l.fill = AI.color.none();
    l.stroke = AI.model.mkStroke('#000000', 4);
    app.doc.layers[0].children.push(l);
    AI.sel.set(app, [l]);
    AI.ui.syncAll(app);
  });
  await showPanel('stroke');
  await page.selectOption('#sk-a2', 'arrow');
  await page.waitForTimeout(60);
  await page.fill('#sk-ascale', '150');
  await page.press('#sk-ascale', 'Enter');
  await page.waitForTimeout(60);
  await page.click('#p-stroke [data-swap]');
  await page.waitForTimeout(60);
  const r = await ev(() => {
    const st = AI.app.sel[0].stroke;
    return { start: st.arrowStart, end: st.arrowEnd, scale: st.arrowScale, svg: AI.io.toSVG(AI.app) };
  });
  if (r.start !== 'arrow' || r.end !== 'none') throw new Error('뒤바꾸기 실패 ' + r.start + '/' + r.end);
  if (r.scale !== 150) throw new Error('비율=' + r.scale);
  if (!/<marker /.test(r.svg) || !/marker-start="url\(/.test(r.svg)) throw new Error('SVG marker 누락');
  return '끝→시작 뒤바꾸기 · 비율 150% · SVG <marker> 출력';
});

await check('개별 변형 (Ctrl+Alt+Shift+D) — 각자의 중심 기준', async () => {
  await ev(() => {
    const app = AI.app;
    app.setDoc(AI.model.newDoc(600, 400));
    const a = AI.model.newRect(50, 50, 100, 100, 0);
    const b = AI.model.newRect(300, 50, 100, 100, 0);
    app.doc.layers[0].children.push(a, b);
    AI.sel.set(app, [a, b]);
  });
  await ev(() => AI.commands.run('transformEach'));
  await page.waitForSelector('.dlg');
  const t = await page.textContent('.dlg-title');
  await page.fill('#dlgf-sx', '200');
  await page.fill('#dlgf-sy', '200');
  await page.press('#dlgf-sy', 'Tab');
  await page.waitForTimeout(80);
  await page.click('.dlg-btn:has-text("확인")');
  await page.waitForTimeout(80);
  const r = await ev(() => AI.app.doc.layers[0].children.map(it => {
    const b = AI.render.worldBounds(AI.app.doc, it, true);
    return [Math.round(b.x), Math.round(b.y), Math.round(b.x2 - b.x)].join(',');
  }));
  if (t !== '개별 변형') throw new Error('제목=' + t);
  /* 각자 자기 중심(100,100)/(350,100)에서 2배 → 각각 200폭, 중심 유지 */
  if (r[0] !== '0,0,200') throw new Error('첫째=' + r[0]);
  if (r[1] !== '250,0,200') throw new Error('둘째=' + r[1]);
  return `각자 중심에서 200% — ${r.join(' / ')}`;
});

await check('이미지 자르기 (크롭)', async () => {
  const r = await page.evaluate(async (src) => {
    const app = AI.app;
    app.setDoc(AI.model.newDoc(400, 400));
    const im = AI.model.newImage(src, 0, 0, 200, 200);
    const clip = AI.model.newRect(50, 50, 100, 100, 0);
    app.doc.layers[0].children.push(im, clip);
    await new Promise(res => { const x = AI.render.getImage(src, res); if (x.complete) res(); });
    AI.sel.set(app, [im, clip]);
    AI.commands.run('cropImage');
    const it = app.doc.layers[0].children[0];
    const b = AI.render.worldBounds(app.doc, it, true);
    return {
      n: app.doc.layers[0].children.length,
      crop: it.crop && [it.crop.x, it.crop.y, it.crop.w, it.crop.h].map(v => +v.toFixed(3)).join(','),
      bounds: [b.x, b.y, b.x2 - b.x, b.y2 - b.y].join(','),
      svgClip: /clip-path="url\(/.test(AI.io.toSVG(app))
    };
  }, PNG1x1);
  if (r.n !== 1) throw new Error('자른 뒤 개수=' + r.n);
  if (r.crop !== '0.25,0.25,0.5,0.5') throw new Error('crop=' + r.crop);
  if (r.bounds !== '50,50,100,100') throw new Error('bounds=' + r.bounds);
  if (!r.svgClip) throw new Error('SVG clip-path 누락');
  return `crop=${r.crop} · 배치 ${r.bounds} · SVG clip-path 포함`;
});

await check('이미지 추적 — 사전 설정 · 미리 보기 · 확장', async () => {
  const src = await ev(() => {
    const c = document.createElement('canvas');
    c.width = c.height = 96;
    const x = c.getContext('2d');
    x.fillStyle = '#ffffff'; x.fillRect(0, 0, 96, 96);
    x.fillStyle = '#000000';
    x.beginPath(); x.arc(48, 48, 30, 0, Math.PI * 2); x.fill();
    return c.toDataURL('image/png');
  });
  await page.evaluate(async (s) => {
    const app = AI.app;
    app.setDoc(AI.model.newDoc(300, 300));
    const im = AI.model.newImage(s, 0, 0, 96, 96);
    app.doc.layers[0].children.push(im);
    await new Promise(res => { const x = AI.render.getImage(s, res); if (x.complete) res(); });
    AI.sel.set(app, [im]);
  }, src);
  await ev(() => AI.commands.run('imageTrace'));
  await page.waitForSelector('.dlg');
  await page.selectOption('#dlgf-preset', 'bwLogo');
  await page.waitForTimeout(60);
  await page.check('#dlgf-preview');
  await page.waitForTimeout(400);
  const during = await ev(() => ({
    n: AI.app.doc.layers[0].children.length,
    imgHidden: AI.app.doc.layers[0].children[0].visible === false,
    info: document.querySelector('.dlg-info').textContent
  }));
  await page.click('.dlg-btn:has-text("확인")');
  await page.waitForTimeout(500);
  const after = await ev(() => {
    const ch = AI.app.doc.layers[0].children;
    const g = ch[0];
    const b = AI.render.worldBounds(AI.app.doc, g, true);
    return {
      n: ch.length, type: g.type, name: g.name, kids: g.children.length,
      bounds: [b.x, b.y, b.x2 - b.x, b.y2 - b.y].map(v => Math.round(v)).join(',')
    };
  });
  if (during.n !== 2 || !during.imgHidden) throw new Error('미리 보기 상태=' + JSON.stringify(during));
  if (!/패스 \d+/.test(during.info)) throw new Error('정보 없음: ' + during.info);
  if (after.n !== 1 || after.type !== 'group') throw new Error('확장 결과=' + JSON.stringify(after));
  if (after.kids < 1) throw new Error('패스 없음');
  /* 원(지름 60)이 96×96 안 가운데 — 대략 (18,18,60,60) */
  const [bx, by, bw, bh] = after.bounds.split(',').map(Number);
  if (Math.abs(bw - 60) > 8 || Math.abs(bh - 60) > 8) throw new Error('추적 바운딩=' + after.bounds);
  if (Math.abs(bx - 18) > 8 || Math.abs(by - 18) > 8) throw new Error('추적 위치=' + after.bounds);
  return `${during.info} · 그룹 "${after.name}" 패스 ${after.kids}개 · 바운딩 ${after.bounds}`;
});

await check('대지 패널 — 목록 · 추가 · 선택에 맞추기 · 재정렬', async () => {
  await ev(() => {
    const app = AI.app;
    app.setDoc(AI.model.newDoc(200, 200));
    const r = AI.model.newRect(400, 400, 120, 60, 0);
    app.doc.layers[0].children.push(r);
    AI.sel.set(app, [r]);
    AI.ui.syncAll(app);
  });
  await showPanel('artboards');
  const rows0 = await ev(() => document.querySelectorAll('#p-artboards .list-row').length);
  await page.click('#p-artboards [data-cmd="newArtboard"]');
  await page.waitForTimeout(80);
  const rows1 = await ev(() => document.querySelectorAll('#p-artboards .list-row').length);
  await ev(() => { AI.sel.set(AI.app, [AI.app.doc.layers[0].children[0]]); });
  await page.click('#p-artboards [data-cmd="fitArtboardToSelection"]');
  await page.waitForTimeout(80);
  const fit = await ev(() => {
    const ab = AI.app.doc.artboards[AI.app.doc.activeArtboard];
    return [ab.x, ab.y, ab.w, ab.h].map(v => Math.round(v)).join(',');
  });
  await ev(() => { AI.edit.rearrangeArtboards(AI.app, 2, 20); });
  const arranged = await ev(() => AI.app.doc.artboards.map(a => Math.round(a.x) + ',' + Math.round(a.y)).join(' '));
  const active = await ev(() => document.querySelectorAll('#p-artboards .list-row.on').length);
  if (rows0 !== 1 || rows1 !== 2) throw new Error(`행 ${rows0} → ${rows1}`);
  if (fit !== '400,400,120,60') throw new Error('맞추기=' + fit);
  if (!/^0,0 /.test(arranged)) throw new Error('재정렬=' + arranged);
  if (active !== 1) throw new Error('활성 표시=' + active);
  return `대지 ${rows0}→${rows1}개 · 선택에 맞춤 ${fit} · 재정렬 ${arranged}`;
});

await check('안내선 — 잠금 해제 후 캔버스에서 이동 · 안내선 해제', async () => {
  await ev(() => {
    const app = AI.app;
    app.setDoc(AI.model.newDoc(400, 400));
    AI.viewT.setZoom(app, 1);
    app.view.tx = 0; app.view.ty = 0;
    app.prefs.guides = true;
    app.doc.guides = [{ axis: 'v', pos: 100 }];
  });
  const lockedDefault = await ev(() => AI.app.prefs.guidesLocked !== false);
  await ev(() => AI.commands.run('lockGuides'));
  const p0 = await ev(() => AI.viewT.toScreen(AI.app, 100, 0));
  await drag({ x: box.x + p0.x, y: box.y + 100 }, { x: box.x + p0.x + 60, y: box.y + 100 });
  const moved = await ev(() => Math.round(AI.app.doc.guides[0].pos));
  await ev(() => AI.commands.run('undo'));
  const back = await ev(() => Math.round(AI.app.doc.guides[0].pos));
  await ev(() => AI.commands.run('releaseGuides'));
  const rel = await ev(() => ({
    guides: AI.app.doc.guides.length,
    lines: AI.app.doc.layers[0].children.filter(i => i.name === '안내선').length
  }));
  if (!lockedDefault) throw new Error('기본값이 잠김이 아님');
  if (moved !== 160) throw new Error('이동 후=' + moved);
  if (back !== 100) throw new Error('실행 취소 후=' + back);
  if (rel.guides !== 0 || rel.lines !== 1) throw new Error('해제=' + JSON.stringify(rel));
  return `기본 잠김 · 해제 후 100 → ${moved} · undo 복원 · 안내선 해제 → 선 ${rel.lines}개`;
});

await check('레이어 — 새 레이어로 모으기 · 레이어로 배포 · 병합', async () => {
  const r = await ev(() => {
    const app = AI.app;
    app.setDoc(AI.model.newDoc(400, 400));
    const a = AI.model.newRect(10, 10, 50, 50, 0);
    const b = AI.model.newRect(80, 10, 50, 50, 0);
    const c = AI.model.newRect(150, 10, 50, 50, 0);
    app.doc.layers[0].children.push(a, b, c);
    AI.sel.set(app, [a, b]);
    AI.commands.run('collectInNewLayer');
    const afterCollect = app.doc.layers.map(l => l.children.length).join('/');
    AI.commands.run('releaseToLayers');
    const afterRelease = app.doc.layers.length;
    AI.commands.run('mergeLayers');
    return {
      afterCollect, afterRelease,
      merged: app.doc.layers.length,
      items: app.doc.layers[0].children.length
    };
  });
  if (r.afterCollect !== '1/2') throw new Error('모으기=' + r.afterCollect);
  if (r.afterRelease !== 3) throw new Error('배포 후 레이어=' + r.afterRelease);
  if (r.merged !== 1 || r.items !== 3) throw new Error('병합=' + JSON.stringify(r));
  return `모으기 ${r.afterCollect} · 배포 ${r.afterRelease}개 레이어 · 병합 1개(오브젝트 ${r.items})`;
});

await check('정렬 — 키 오브젝트 · 대지 기준', async () => {
  const r = await ev(() => {
    const app = AI.app;
    app.setDoc(AI.model.newDoc(400, 400));
    const a = AI.model.newRect(10, 10, 50, 50, 0);
    const b = AI.model.newRect(200, 100, 80, 80, 0);
    app.doc.layers[0].children.push(a, b);
    AI.sel.set(app, [a, b]);
    app.alignTo = 'artboard';
    AI.commands.run('alignHCenter');
    const cx = app.doc.layers[0].children.map(it => {
      const bb = AI.render.worldBounds(app.doc, it, true);
      return Math.round((bb.x + bb.x2) / 2);
    }).join(',');
    app.alignTo = 'key';
    app.keyObject = b;
    AI.commands.run('alignTop');
    const tops = app.doc.layers[0].children.map(it => Math.round(AI.render.worldBounds(app.doc, it, true).y)).join(',');
    app.alignTo = 'selection';
    app.keyObject = null;
    return { cx, tops };
  });
  if (r.cx !== '200,200') throw new Error('대지 가운데=' + r.cx);
  if (r.tops !== '100,100') throw new Error('키 오브젝트 위쪽=' + r.tops);
  return `대지 가운데 ${r.cx} · 키 오브젝트 위쪽 ${r.tops}`;
});

await check('패스파인더 오리기 · 자르기 · 뒷면 제외', async () => {
  const r = await ev(() => {
    const app = AI.app;
    function area() {
      let s = 0;
      AI.model.walk(app.doc, it => {
        if (it.type !== 'path') return;
        const m = AI.model.worldMatrix(app.doc, it);
        it.subs.forEach(sub => {
          const pts = AI.geom.flattenSub(sub, 0.2).map(p => AI.mat.apply(m, p.x, p.y));
          s += Math.abs(AI.pathfinder.area(pts));
        });
      });
      return Math.round(s);
    }
    const out = {};
    ['crop', 'trim', 'minusBack'].forEach(op => {
      app.setDoc(AI.model.newDoc(400, 400));
      const a = AI.model.newRect(50, 50, 100, 100, 0);
      const b = AI.model.newRect(100, 100, 100, 100, 0);
      app.doc.layers[0].children.push(a, b);
      AI.sel.set(app, [a, b]);
      AI.commands.run('pf_' + op);
      out[op] = area();
    });
    return out;
  });
  /* crop: 두 사각형의 교집합(50×50) / trim: 겹치는 부분을 앞면이 가져감 → 총 17500 / minusBack: 앞면 - 뒷면 = 7500 */
  if (r.crop !== 2500) throw new Error('crop=' + r.crop);
  if (r.trim !== 17500) throw new Error('trim=' + r.trim);
  if (r.minusBack !== 7500) throw new Error('minusBack=' + r.minusBack);
  return `오리기 ${r.crop} · 자르기 ${r.trim} · 뒷면 제외 ${r.minusBack}`;
});

await check('새 연산이 API 로도 노출된다', async () => {
  const r = await ev(() => {
    const doc = illy.newDocument({ width: 300, height: 300 });
    const id = illy.rect({ x: 20, y: 20, width: 100, height: 100, fill: '#ff0000' });
    illy.applyEffect({ query: id, type: 'shadow', dx: 6, dy: 6, blur: 4, color: '#000000', alpha: 0.6 });
    const fx = illy.effects(id);
    illy.setArrowheads({ query: id, end: 'triangle', scale: 120 });
    illy.addGuide({ axis: 'v', position: 150 });
    illy.transformEach({ query: id, scaleX: 50, scaleY: 50 });
    const info = illy.get(id);
    const b = info.geometricBounds;   /* bounds 는 효과를 포함한 미리보기 경계 */
    const vis = info.bounds;
    illy.fitArtboard({ mode: 'artwork' });
    const ab = illy.documentInfo().artboards[0];
    const names = illy.ops().map(o => o.name);
    return {
      fx: fx[0].effects[0],
      bounds: [b.x, b.y, b.w, b.h].join(','),
      visualGrew: Math.round(vis.w - b.w),
      artboard: [ab.width, ab.height].map(Math.round).join(','),
      guides: illy.guides().length,
      has: ['applyEffect', 'clearEffects', 'effects', 'imageTrace', 'cropImage', 'transformEach',
        'setArrowheads', 'mergeLayers', 'releaseToLayers', 'collectInLayer',
        'fitArtboard', 'rearrangeArtboards', 'addGuide', 'guides', 'clearGuides', 'releaseGuides',
        'setArtboard', 'removeArtboard'].every(n => names.indexOf(n) >= 0),
      count: names.length
    };
  });
  if (!r.has) throw new Error('누락된 연산이 있습니다');
  if (r.fx.type !== 'shadow' || r.fx.dy !== 6) throw new Error('효과=' + JSON.stringify(r.fx));
  if (r.bounds !== '45,45,50,50') throw new Error('개별 변형 bounds=' + r.bounds);
  if (r.visualGrew !== 48) throw new Error('효과 경계 확장=' + r.visualGrew);   /* (blur*3+|dx|+|dy|)*2 */
  if (r.guides !== 1) throw new Error('안내선=' + r.guides);
  if (r.artboard !== '98,98') throw new Error('대지 맞춤=' + r.artboard);
  return `${r.count}개 연산 · shadow · 개별변형 ${r.bounds} · 대지 ${r.artboard}`;
});

/* ---------------- 2차 업그레이드: 모양 · 도구 · 자산 ---------------- */

await check('모양 패널 — 겹 추가 · 순서 · 겹 단위 색 적용', async () => {
  await ev(() => {
    const app = AI.app;
    app.setDoc(AI.model.newDoc(400, 400));
    AI.viewT.setZoom(app, 1); app.view.tx = 0; app.view.ty = 0;
    const r = AI.model.newRect(50, 50, 200, 200, 0);
    r.fill = AI.color.solid('#3366cc');
    r.stroke = AI.color.none();
    app.doc.layers[0].children.push(r);
    AI.sel.set(app, [r]);
    AI.ui.syncAll(app);
  });
  await showPanel('appearance');
  await page.click('#p-appearance [data-apcmd="addStroke"]');
  await page.waitForTimeout(60);
  await page.click('#p-appearance [data-apcmd="addStroke"]');
  await page.waitForTimeout(60);
  const rows = await ev(() => document.querySelectorAll('#p-appearance .list-row').length);
  /* 위쪽 행 = 스택의 끝 */
  await page.click('#p-appearance .list-row');
  await page.waitForTimeout(60);
  const picked = await ev(() => AI.app.apIndex);
  await ev(() => { AI.app.history.begin('t', AI.app.doc); AI.edit.applyPaint(AI.app, AI.color.solid('#ff0000'), 'stroke'); AI.app.history.commit(); });
  const r2 = await ev(() => {
    const it = AI.app.sel[0];
    const L = AI.appearance.list(it);
    return { n: L.length, kinds: L.map(e => e.kind).join(','), top: L[L.length - 1].stroke.color, custom: AI.appearance.isCustom(it) };
  });
  /* 순서 바꾸기 */
  await page.click('#p-appearance [data-apcmd="down"]');
  await page.waitForTimeout(60);
  const after = await ev(() => AI.appearance.list(AI.app.sel[0]).map(e => e.kind).join(','));
  if (rows !== 3) throw new Error('행 수=' + rows);
  if (picked !== 2) throw new Error('고른 겹=' + picked);
  if (r2.kinds !== 'fill,stroke,stroke') throw new Error('구성=' + r2.kinds);
  if (r2.top !== '#ff0000') throw new Error('겹 색=' + r2.top);
  if (after !== 'fill,stroke,stroke') throw new Error('순서 후=' + after);
  return `겹 ${r2.kinds} · 맨 위 획만 빨강 · 순서 이동`;
});

await check('도형 구성 도구 — 영역 합치기 · Alt 로 지우기', async () => {
  const setup = async () => ev(() => {
    const app = AI.app, Mo = AI.model, Col = AI.color;
    app.setDoc(Mo.newDoc(400, 400));
    AI.viewT.setZoom(app, 1); app.view.tx = 0; app.view.ty = 0;
    const a = Mo.newRect(50, 50, 150, 150, 0); a.fill = Col.solid('#ff0000'); a.stroke = Col.none();
    const b = Mo.newRect(150, 50, 150, 150, 0); b.fill = Col.solid('#0000ff'); b.stroke = Col.none();
    app.doc.layers[0].children.push(a, b);
    AI.sel.set(app, [a, b]);
    AI.tools.setTool(app, 'shapebuilder', true);
    app.invalidate();
  });
  await setup();
  const faces = await ev(() => { AI.tools.current(AI.app).onDown(AI.app, { x: -999, y: -999, alt: false, down: true }); return 1; });
  /* 왼쪽 영역 → 겹침 영역 으로 드래그해 둘을 합친다 */
  await drag({ x: box.x + 90, y: box.y + 120 }, { x: box.x + 175, y: box.y + 120 });
  await page.waitForTimeout(120);
  const merged = await ev(() => {
    const kids = AI.app.doc.layers[0].children;
    return { n: kids.length, areas: kids.map(k => Math.round(Math.abs(AI.pathfinder.area(AI.geom.flattenItem(k, 0.2, AI.model.worldMatrix(AI.app.doc, k))[0].pts)))) };
  });
  /* Alt 드래그로 영역 삭제 */
  await setup();
  await drag({ x: box.x + 175, y: box.y + 120 }, { x: box.x + 180, y: box.y + 125 }, ['Alt']);
  await page.waitForTimeout(120);
  const deleted = await ev(() => AI.app.doc.layers[0].children.length);
  await ev(() => AI.tools.setTool(AI.app, 'select', true));
  /* 합치기: 왼쪽(7500) + 겹침(7500) = 15000 이 한 조각, 나머지 오른쪽 7500 */
  if (merged.n !== 2) throw new Error('합친 뒤 개수=' + merged.n + ' ' + merged.areas);
  if (merged.areas.indexOf(15000) < 0) throw new Error('합쳐진 면적=' + merged.areas);
  if (deleted !== 2) throw new Error('삭제 뒤 개수=' + deleted);
  return `합치기 ${merged.areas.join('+')} · Alt 삭제 후 ${deleted}조각`;
});

await check('폭 도구 — 획 두께가 지점마다 달라진다', async () => {
  await ev(() => {
    const app = AI.app, Mo = AI.model, Col = AI.color;
    app.setDoc(Mo.newDoc(400, 400));
    AI.viewT.setZoom(app, 1); app.view.tx = 0; app.view.ty = 0;
    const l = Mo.newLine(50, 200, 350, 200);
    l.fill = Col.none();
    l.stroke = Mo.mkStroke('#000000', 10);
    app.doc.layers[0].children.push(l);
    AI.sel.set(app, [l]);
    AI.tools.setTool(app, 'width', true);
  });
  await drag({ x: box.x + 200, y: box.y + 200 }, { x: box.x + 200, y: box.y + 230 });
  await page.waitForTimeout(80);
  const r = await ev(() => {
    const st = AI.app.sel[0].stroke;
    return {
      prof: st.widthProfile ? st.widthProfile.length : 0,
      mid: st.widthProfile ? AI.render.profileAt(st.widthProfile, 0.5) : 1,
      end: st.widthProfile ? AI.render.profileAt(st.widthProfile, 0) : 1,
      svg: AI.io.toSVG(AI.app)
    };
  });
  await ev(() => AI.tools.setTool(AI.app, 'select', true));
  if (r.prof < 3) throw new Error('프로파일 지점=' + r.prof);
  if (!(r.mid > 3)) throw new Error('가운데 배율=' + r.mid);
  if (Math.abs(r.end - 1) > 0.05) throw new Error('끝 배율=' + r.end);
  /* SVG 는 리본(채운 패스)으로 나간다 */
  if (!/<g[^>]*><path[^>]*\/><path[^>]*fill="#000000"/.test(r.svg)) throw new Error('SVG 리본 없음');
  return `지점 ${r.prof}개 · 가운데 ${r.mid.toFixed(1)}배 · SVG 리본`;
});

await check('그레이디언트 주석자 — 손잡이 드래그로 각도·길이', async () => {
  await ev(() => {
    const app = AI.app, Mo = AI.model, Col = AI.color;
    app.setDoc(Mo.newDoc(400, 400));
    AI.viewT.setZoom(app, 1); app.view.tx = 0; app.view.ty = 0;
    const r = Mo.newRect(50, 50, 200, 200, 0);
    r.fill = Col.gradient('linear', '#ffffff', '#000000');
    r.stroke = Col.none();
    app.doc.layers[0].children.push(r);
    AI.sel.set(app, [r]);
    AI.tools.setTool(app, 'width', true);
    AI.tools.setTool(app, 'gradient', true);
    app.invalidate();
  });
  await page.waitForTimeout(60);
  /* 패널 레이아웃이 바뀌면 캔버스 위치도 달라지므로 그때그때 다시 잰다 */
  const gbox = await (await page.$('#view')).boundingBox();
  /* 캔버스를 가로질러 그으면 시작·끝점이 그대로 기록된다 */
  await drag({ x: gbox.x + 60, y: gbox.y + 60 }, { x: gbox.x + 240, y: gbox.y + 240 });
  await page.waitForTimeout(80);
  const g = await ev(() => {
    const f = AI.app.sel[0].fill;
    return { p0: f.p0 && [Math.round(f.p0.x), Math.round(f.p0.y)].join(','), p1: f.p1 && [Math.round(f.p1.x), Math.round(f.p1.y)].join(','), angle: Math.round(f.angle) };
  });
  /* 끝점 손잡이를 잡아 옮긴다 */
  await drag({ x: gbox.x + 240, y: gbox.y + 240 }, { x: gbox.x + 240, y: gbox.y + 60 });
  await page.waitForTimeout(80);
  const g2 = await ev(() => {
    const f = AI.app.sel[0].fill;
    return { p1: [Math.round(f.p1.x), Math.round(f.p1.y)].join(','), svg: AI.io.toSVG(AI.app) };
  });
  await ev(() => AI.tools.setTool(AI.app, 'select', true));
  /* p0/p1 은 아이템 로컬 좌표 — 사각형이 (50,50)에 있으므로 화면 60,60 은 로컬 10,10 */
  if (g.p0 !== '10,10' || g.p1 !== '190,190') throw new Error('드래그 기하=' + JSON.stringify(g));
  if (g.angle !== 45) throw new Error('각도=' + g.angle);
  if (g2.p1 !== '190,10') throw new Error('손잡이 이동=' + g2.p1);
  if (!/gradientUnits="userSpaceOnUse"/.test(g2.svg)) throw new Error('SVG 기하 누락');
  return `로컬 p0 ${g.p0} → p1 ${g.p1} (45°) · 손잡이로 ${g2.p1} · SVG userSpaceOnUse`;
});

await check('영역 문자 — 도형 안으로 흐르고 넘치면 표시', async () => {
  const r = await ev(() => {
    const app = AI.app, Mo = AI.model, Rn = AI.render;
    app.setDoc(Mo.newDoc(500, 400));
    const L = app.doc.layers[0];
    const t = Mo.newText(20, 20, '가나다라마바사아자차카타파하 The quick brown fox jumps over the lazy dog 자동 줄바꿈 확인');
    t.text.size = 16;
    t.text.area = { w: 200, h: 120 };
    L.children.push(t);
    const box1 = Rn.layoutText(t);

    const circleText = Mo.newText(260, 20, '동그란 도형 안으로 글이 흘러 들어갑니다 '.repeat(4));
    circleText.text.size = 13;
    circleText.text.area = { w: 200, h: 200 };
    const c = Mo.newEllipse(0, 0, 200, 200);
    circleText.text.areaShape = JSON.parse(JSON.stringify(c.subs));
    L.children.push(circleText);
    const shaped = Rn.layoutText(circleText);

    const over = Mo.newText(20, 250, 'x'.repeat(500));
    over.text.size = 14;
    over.text.area = { w: 120, h: 40 };
    L.children.push(over);
    const ov = Rn.layoutText(over);

    Rn.scene(app.canvas.getContext('2d'), app);
    const svg = AI.io.toSVG(app);
    /* 원 안에서는 줄마다 시작 x 가 달라야 한다 */
    const xs = shaped.xs.map(v => Math.round(v));
    return {
      boxLines: box1.lines.length, boxOverflow: box1.overflow,
      shapedLines: shaped.lines.length, distinctXs: new Set(xs).size,
      overflow: ov.overflow,
      tspans: (svg.match(/<tspan/g) || []).length,
      bounds: (function () { const b = Rn.localBounds(circleText); return [b.x, b.y, b.x2, b.y2].join(','); })()
    };
  });
  if (r.boxLines < 3) throw new Error('상자 줄 수=' + r.boxLines);
  if (r.boxOverflow) throw new Error('상자가 넘치면 안 됨');
  if (r.shapedLines < 5) throw new Error('도형 줄 수=' + r.shapedLines);
  if (r.distinctXs < 3) throw new Error('도형 안 x 오프셋이 일정함=' + r.distinctXs);
  if (!r.overflow) throw new Error('넘침 감지 실패');
  if (r.bounds !== '0,0,200,200') throw new Error('영역 경계=' + r.bounds);
  return `상자 ${r.boxLines}줄 · 원 ${r.shapedLines}줄(x ${r.distinctXs}종) · 넘침 · tspan ${r.tspans}`;
});

await check('텍스트 윤곽선 만들기 (Ctrl+Shift+O)', async () => {
  const r = await ev(() => {
    const app = AI.app, Mo = AI.model, Rn = AI.render;
    app.setDoc(Mo.newDoc(400, 300));
    const t = Mo.newText(40, 150, 'AO');
    t.text.size = 90; t.text.family = 'sans-serif';
    app.doc.layers[0].children.push(t);
    AI.sel.set(app, [t]);
    const before = Rn.worldBounds(app.doc, t, true);
    AI.commands.run('createOutlines');
    const made = app.sel[0];
    const after = made ? Rn.worldBounds(app.doc, made, true) : null;
    return {
      type: made && made.type,
      subs: made && made.subs ? made.subs.length : 0,
      before: [Math.round(before.x), Math.round(before.x2 - before.x)].join(','),
      after: after ? [Math.round(after.x), Math.round(after.x2 - after.x)].join(',') : null,
      texts: app.doc.layers[0].children.filter(c => c.type === 'text').length
    };
  });
  if (r.type !== 'path') throw new Error('타입=' + r.type);
  /* A 는 바깥+구멍, O 는 바깥+구멍 = 4개 이상 */
  if (r.subs < 4) throw new Error('서브패스=' + r.subs);
  if (r.texts !== 0) throw new Error('텍스트가 남음');
  const [bx, bw] = r.before.split(',').map(Number);
  const [ax, aw] = r.after.split(',').map(Number);
  if (Math.abs(aw - bw) > bw * 0.15) throw new Error(`폭이 크게 달라짐 ${bw} -> ${aw}`);
  return `path · 서브패스 ${r.subs}개 · 폭 ${bw}→${aw}`;
});

await check('심볼 — 정의를 고치면 모든 인스턴스가 바뀐다', async () => {
  const r = await ev(() => {
    const app = AI.app, Mo = AI.model, Rn = AI.render, Col = AI.color;
    app.setDoc(Mo.newDoc(400, 200));
    AI.viewT.setZoom(app, 1); app.view.tx = 0; app.view.ty = 0;
    const s = Mo.newRect(20, 20, 60, 60, 0);
    s.fill = Col.solid('#ffcc00'); s.stroke = Col.none();
    app.doc.layers[0].children.push(s);
    AI.sel.set(app, [s]);
    AI.commands.run('newSymbol');
    const def = app.doc.symbols[0];
    AI.assets.placeSymbol(app, def.id, 200, 20);
    const ctx = app.canvas.getContext('2d');
    Rn.scene(ctx, app);
    const px = (x, y) => { const d = ctx.getImageData(Math.round(x*app.dpr), Math.round(y*app.dpr),1,1).data; return d[0]+','+d[1]+','+d[2]; };
    const before = [px(50, 50), px(230, 50)];
    def.item.fill = Col.solid('#00ccff');
    Rn.scene(ctx, app);
    const after = [px(50, 50), px(230, 50)];
    const svg = AI.io.toSVG(app);
    return {
      instances: app.doc.layers[0].children.filter(c => c.type === 'symbol').length,
      before, after, svgLen: svg.length,
      svgHasBoth: (svg.match(/00ccff/g) || []).length >= 2
    };
  });
  if (r.instances !== 2) throw new Error('인스턴스=' + r.instances);
  if (r.before[0] !== r.before[1]) throw new Error('두 인스턴스가 다름 ' + r.before);
  if (r.after[0] === r.before[0]) throw new Error('정의 수정이 반영 안 됨');
  if (r.after[0] !== r.after[1]) throw new Error('한쪽만 반영됨 ' + r.after);
  if (!r.svgHasBoth) throw new Error('SVG 에 두 인스턴스가 없음');
  return `인스턴스 2개 · ${r.before[0]} → ${r.after[0]} 동시 반영`;
});

await check('패턴 칠 — 실제로 타일이 그려진다', async () => {
  const r = await ev(() => {
    const app = AI.app, Mo = AI.model, Rn = AI.render, Col = AI.color;
    app.setDoc(Mo.newDoc(300, 300));
    AI.viewT.setZoom(app, 1); app.view.tx = 0; app.view.ty = 0;
    const L = app.doc.layers[0];
    const dot = Mo.newRect(0, 0, 20, 20, 0);
    dot.fill = Col.solid('#ff0000'); dot.stroke = Col.none();
    const hole = Mo.newRect(10, 10, 10, 10, 0);
    hole.fill = Col.solid('#0000ff'); hole.stroke = Col.none();
    L.children.push(dot, hole);
    AI.sel.set(app, [dot, hole]);
    AI.commands.run('newPattern');
    L.children.length = 0;
    const big = Mo.newRect(0, 0, 200, 200, 0);
    big.stroke = Col.none();
    L.children.push(big);
    AI.sel.set(app, [big]);
    AI.edit.applyPaint(app, AI.assets.patternPaint(app.doc.patterns[0]), 'fill');
    const ctx = app.canvas.getContext('2d');
    Rn.scene(ctx, app);
    const px = (x, y) => { const d = ctx.getImageData(Math.round(x*app.dpr), Math.round(y*app.dpr),1,1).data; return d[0]+','+d[1]+','+d[2]; };
    return { red: px(3, 3), blue: px(15, 15), red2: px(23, 3), blue2: px(35, 35) };
  });
  if (!/^2[0-9][0-9],/.test(r.red)) throw new Error('타일 빨강 없음 ' + r.red);
  if (r.blue !== '0,0,255') throw new Error('타일 파랑 없음 ' + r.blue);
  if (r.red2 !== r.red || r.blue2 !== r.blue) throw new Error('타일 반복 안 됨 ' + JSON.stringify(r));
  return `타일 반복 확인 (빨강 ${r.red} / 파랑 ${r.blue})`;
});

await check('화면 회전 — 두 손가락 비틀기와 같은 변환', async () => {
  const r = await ev(() => {
    const app = AI.app;
    app.setDoc(AI.model.newDoc(400, 400));
    AI.viewT.setZoom(app, 1); app.view.tx = 0; app.view.ty = 0;
    const cx = app.canvas.clientWidth / 2, cy = app.canvas.clientHeight / 2;
    const p0 = AI.viewT.toScreen(app, 100, 0);
    /* 화면 중심을 축으로 돌리면 초기화했을 때 정확히 제자리로 돌아온다 */
    AI.viewT.rotateView(app, Math.PI / 2, cx, cy);
    const p1 = AI.viewT.toScreen(app, 100, 0);
    const d = AI.viewT.toDoc(app, p1.x, p1.y);   /* 왕복 변환 */
    AI.viewT.resetRotation(app);
    const p2 = AI.viewT.toScreen(app, 100, 0);
    return {
      before: [Math.round(p0.x), Math.round(p0.y)].join(','),
      rotated: [Math.round(p1.x), Math.round(p1.y)].join(','),
      roundTrip: [Math.round(d.x), Math.round(d.y)].join(','),
      reset: [Math.round(p2.x), Math.round(p2.y)].join(','),
      rot: AI.app.view.rot
    };
  });
  if (r.before !== '100,0') throw new Error('회전 전=' + r.before);
  /* 중심을 축으로 90° 돌면 (100,0) 은 중심 기준으로 90° 돈 자리에 온다 */
  if (r.rotated === r.before) throw new Error('회전이 반영되지 않음');
  if (r.roundTrip !== '100,0') throw new Error('왕복=' + r.roundTrip);
  if (r.reset !== '100,0' || r.rot !== 0) throw new Error('초기화=' + r.reset + ' rot=' + r.rot);
  return `(100,0) → 90° → ${r.rotated} → 초기화 ${r.reset} (왕복 ${r.roundTrip})`;
});

await check('PDF 내보내기 — 유효한 벡터 PDF', async () => {
  const r = await page.evaluate(async (src) => {
    const app = AI.app, Mo = AI.model, Col = AI.color;
    app.setDoc(Mo.newDoc(300, 200));
    const L = app.doc.layers[0];
    const rect = Mo.newRect(20, 20, 120, 80, 8);
    rect.fill = Col.solid('#ff3366'); rect.stroke = Mo.mkStroke('#000000', 3);
    rect.opacity = 0.7;
    const t = Mo.newText(30, 170, 'Hello PDF');
    t.text.size = 24; t.fill = Col.solid('#003366');
    const im = Mo.newImage(src, 180, 30, 80, 60);
    L.children.push(rect, t, im);
    await new Promise(res => { const x = AI.render.getImage(src, res); if (x.complete) res(); });
    const str = AI.pdf.toPDF(app);
    const bytes = AI.pdf.toBytes(str);
    return {
      len: bytes.length,
      header: str.slice(0, 8),
      hasImage: /\/Subtype \/Image/.test(str),
      hasDCT: /DCTDecode/.test(str),
      hasAlpha: /\/ExtGState/.test(str),
      hasFont: /BaseFont \/Helvetica/.test(str),
      xrefOK: (function () {
        const m = str.match(/startxref\n(\d+)/);
        if (!m) return false;
        if (str.slice(+m[1], +m[1] + 4) !== 'xref') return false;
        const objs = [...str.matchAll(/^(\d+) 0 obj/gm)].map(x => x.index);
        const xr = [...str.matchAll(/^(\d{10}) 00000 n $/gm)].map(x => +x[1]);
        return JSON.stringify(objs) === JSON.stringify(xr) && objs.length > 4;
      })()
    };
  }, PNG1x1);
  if (r.header !== '%PDF-1.4') throw new Error('헤더=' + r.header);
  if (!r.xrefOK) throw new Error('xref 불일치');
  if (!r.hasImage || !r.hasDCT) throw new Error('이미지 누락');
  if (!r.hasAlpha) throw new Error('투명도 누락');
  if (!r.hasFont) throw new Error('글꼴 누락');
  return `${r.len}B · 이미지(DCT) · 투명도 · 글꼴 · xref 일치`;
});

await check('눈금자 원점 드래그 · 하위 레이어 · 레이어 부분 병합', async () => {
  const r = await ev(() => {
    const app = AI.app;
    app.setDoc(AI.model.newDoc(400, 400));
    /* 눈금자 원점 */
    app.doc.rulerOrigin = { x: -100, y: -50 };
    AI.viewT.drawRulers(app);
    /* 하위 레이어 (isLayer 그룹) */
    const g = AI.model.newGroup([]);
    g.isLayer = true; g.name = '하위 레이어 1'; g.color = '#ff8800';
    app.doc.layers[0].children.push(g);
    AI.ui.buildLayers(app);
    const subRow = [...document.querySelectorAll('#p-layers .lyr')].some(r2 => r2.textContent.indexOf('하위 레이어 1') >= 0);
    /* 부분 병합: 3개 중 위 2개만 */
    app.doc.layers.push(AI.model.newLayer('L2', 1), AI.model.newLayer('L3', 2));
    app.doc.layers[1].children.push(AI.model.newRect(0, 0, 10, 10, 0));
    app.doc.layers[2].children.push(AI.model.newRect(20, 0, 10, 10, 0));
    app.selLayers = [1, 2];
    AI.commands.run('mergeLayers');
    return {
      origin: [app.doc.rulerOrigin.x, app.doc.rulerOrigin.y].join(','),
      subRow,
      layers: app.doc.layers.length,
      mergedItems: app.doc.layers[1].children.length,
      names: app.doc.layers.map(l => l.name).join(',')
    };
  });
  if (r.origin !== '-100,-50') throw new Error('원점=' + r.origin);
  if (!r.subRow) throw new Error('하위 레이어 행 없음');
  if (r.layers !== 2) throw new Error('병합 후 레이어=' + r.layers + ' (' + r.names + ')');
  if (r.mergedItems !== 2) throw new Error('병합 항목=' + r.mergedItems);
  return `원점 ${r.origin} · 하위 레이어 표시 · 3→${r.layers}레이어(항목 ${r.mergedItems})`;
});

/* ---------------- UI 구조 · 버튼 상태 ---------------- */

await check('패널 탭 도크 — 전환 · 접기 · 윈도우 메뉴', async () => {
  const r0 = await ev(() => {
    const groups = document.querySelectorAll('.pgroup').length;
    const panels = document.querySelectorAll('.panel').length;
    /* 그룹마다 정확히 하나만 보인다 */
    const bad = [...document.querySelectorAll('.pgroup')].filter(g =>
      [...g.querySelectorAll('.panel')].filter(p => !p.classList.contains('tab-hidden')).length !== 1);
    return { groups, panels, badGroups: bad.length };
  });
  /* 탭을 눌러 전환 */
  await page.click('.pgroup[data-group="1"] .ptab[data-tab="swatches"]');
  await page.waitForTimeout(50);
  const r1 = await ev(() => ({
    shown: !document.querySelector('.panel[data-panel="swatches"]').classList.contains('tab-hidden'),
    hidden: document.querySelector('.panel[data-panel="color"]').classList.contains('tab-hidden'),
    tabOn: document.querySelector('.ptab[data-tab="swatches"]').classList.contains('on')
  }));
  /* 그룹 접기 */
  await page.click('.pgroup[data-group="1"] .fold');
  await page.waitForTimeout(50);
  const collapsed = await ev(() => document.querySelector('.pgroup[data-group="1"]').classList.contains('collapsed'));
  /* 윈도우 메뉴로 패널 꺼내기 — 접힌 그룹도 펴진다 */
  const r2 = await ev(() => {
    AI.commands.run('panel_gradient');
    const g = document.querySelector('.pgroup[data-group="1"]');
    return {
      reopened: !g.classList.contains('collapsed'),
      shown: !document.querySelector('.panel[data-panel="gradient"]').classList.contains('tab-hidden'),
      checked: AI.commands.defs.panel_gradient.checked(AI.app),
      otherChecked: AI.commands.defs.panel_swatches.checked(AI.app)
    };
  });
  if (r0.groups !== 6) throw new Error('그룹 수=' + r0.groups);
  if (r0.panels !== 15) throw new Error('패널 수=' + r0.panels);
  if (r0.badGroups) throw new Error('한 번에 하나만 보여야 함 — 어긋난 그룹 ' + r0.badGroups);
  if (!r1.shown || !r1.hidden || !r1.tabOn) throw new Error('탭 전환=' + JSON.stringify(r1));
  if (!collapsed) throw new Error('접기 실패');
  if (!r2.reopened || !r2.shown) throw new Error('윈도우 메뉴로 꺼내기 실패=' + JSON.stringify(r2));
  if (!r2.checked || r2.otherChecked) throw new Error('체크 표시가 활성 탭을 따르지 않음');
  return `그룹 ${r0.groups}개 · 패널 ${r0.panels}개 · 탭 전환 · 접기 · 윈도우 메뉴 체크`;
});

await check('버튼 — 아이콘은 SVG 하나로, 쓸 수 없으면 실제로 비활성', async () => {
  await ev(() => {
    const app = AI.app;
    app.setDoc(AI.model.newDoc(400, 400));
    AI.sel.clear(app);
    AI.ui.syncAll(app);
  });
  const off = await ev(() => ({
    pf: [...document.querySelectorAll('#p-pathfinder [data-pf]')].every(b => b.hasAttribute('disabled')),
    align: document.querySelector('#p-align [data-cmd="alignLeft"]').hasAttribute('disabled'),
    dist: document.querySelector('#p-align [data-cmd="distH"]').hasAttribute('disabled')
  }));
  /* 2개 선택 → 정렬은 켜지고 배분은 아직 꺼져 있다 (3개 이상 필요) */
  await ev(() => {
    const app = AI.app, Mo = AI.model;
    const a = Mo.newRect(10, 10, 40, 40, 0), b = Mo.newRect(80, 10, 40, 40, 0);
    app.doc.layers[0].children.push(a, b);
    AI.sel.set(app, [a, b]);
    AI.ui.syncAll(app);
  });
  const two = await ev(() => ({
    pf: [...document.querySelectorAll('#p-pathfinder [data-pf]')].every(b => !b.hasAttribute('disabled')),
    align: document.querySelector('#p-align [data-cmd="alignLeft"]').hasAttribute('disabled'),
    dist: document.querySelector('#p-align [data-cmd="distH"]').hasAttribute('disabled')
  }));
  await ev(() => {
    const app = AI.app, Mo = AI.model;
    const c = Mo.newRect(150, 10, 40, 40, 0);
    app.doc.layers[0].children.push(c);
    AI.sel.set(app, app.doc.layers[0].children.slice());
    AI.ui.syncAll(app);
  });
  const three = await ev(() => document.querySelector('#p-align [data-cmd="distH"]').hasAttribute('disabled'));

  /* 패널 버튼에는 글리프 대신 SVG 아이콘만 들어간다 */
  const glyphs = await ev(() => {
    const bad = [];
    document.querySelectorAll('#panels .btn, #panels .mini-btn, #panels .seg-b, .ab-btn, #ctl-lockratio')
      .forEach(b => {
        const txt = (b.textContent || '').trim();
        /* 라벨 없는 버튼이라면 SVG 가 있어야 하고, 라벨이 있으면 한글/영문이어야 한다 */
        if (!txt && !b.querySelector('svg')) bad.push(b.className + ' (빈 버튼)');
        if (/[←-⇿─-➿＋\uD83C-\uDBFF]/.test(txt)) bad.push(b.className + ': ' + txt);
      });
    return bad;
  });
  if (!off.pf || !off.align) throw new Error('선택 없을 때 비활성이 아님=' + JSON.stringify(off));
  if (two.pf !== true) throw new Error('2개 선택 시 패스파인더가 켜지지 않음');
  if (two.align) throw new Error('2개 선택 시 정렬이 꺼져 있음');
  if (!two.dist) throw new Error('2개 선택 시 배분은 아직 꺼져 있어야 함');
  if (three) throw new Error('3개 선택 시 배분이 켜지지 않음');
  if (glyphs.length) throw new Error('글리프 버튼이 남아 있음: ' + glyphs.join(', '));
  return '선택 0→2→3 에 따라 비활성 전환 · 글리프 버튼 0개';
});

await check('세그먼트 컨트롤이 현재 획 설정을 비춘다', async () => {
  await showPanel('stroke');
  await ev(() => {
    const app = AI.app, Mo = AI.model, Col = AI.color;
    app.setDoc(Mo.newDoc(400, 400));
    const r = Mo.newRect(50, 50, 100, 100, 0);
    r.fill = Col.none();
    r.stroke = Mo.mkStroke('#000000', 6);
    r.stroke.cap = 'round';
    r.stroke.join = 'bevel';
    r.stroke.align = 'inside';
    app.doc.layers[0].children.push(r);
    AI.sel.set(app, [r]);
    AI.ui.syncAll(app);
  });
  const on = await ev(() => ({
    cap: document.querySelector('#p-stroke .seg-b[data-cap].on').dataset.cap,
    join: document.querySelector('#p-stroke .seg-b[data-join].on').dataset.join,
    align: document.querySelector('#p-stroke .seg-b[data-salign].on').dataset.salign,
    /* 세그먼트는 하나씩만 켜져 있어야 한다 */
    counts: ['cap', 'join', 'salign'].map(k =>
      document.querySelectorAll('#p-stroke .seg-b[data-' + k + '].on').length).join(',')
  }));
  /* 세그먼트를 눌러 값을 바꾼다 */
  await page.click('#p-stroke .seg-b[data-salign="outside"]');
  await page.waitForTimeout(60);
  const after = await ev(() => ({
    model: AI.app.sel[0].stroke.align,
    ui: document.querySelector('#p-stroke .seg-b[data-salign].on').dataset.salign
  }));
  if (on.cap !== 'round' || on.join !== 'bevel' || on.align !== 'inside') throw new Error('반영 실패=' + JSON.stringify(on));
  if (on.counts !== '1,1,1') throw new Error('세그먼트가 여러 개 켜짐=' + on.counts);
  if (after.model !== 'outside' || after.ui !== 'outside') throw new Error('클릭 반영 실패=' + JSON.stringify(after));
  return `cap ${on.cap} · join ${on.join} · align ${on.align} → 클릭으로 ${after.model}`;
});

/* ---------------- 효과 > 왜곡 및 변형 ---------------- */
await check('효과 > 왜곡 및 변형 — 지그재그가 실제로 기하를 바꾼다', async () => {
  await ev(() => {
    const app = AI.app;
    app.setDoc(AI.model.newDoc(400, 400));
    const r = AI.model.newRect(100, 100, 200, 100, 0);
    r.fill = AI.color.solid('#3366cc');
    app.doc.layers[0].children.push(r);
    AI.sel.set(app, [r]);
  });
  const before = await ev(() => {
    const it = AI.app.sel[0];
    return { pts: it.subs[0].pts.length, w: Math.round(AI.render.worldBounds(AI.app.doc, it, true).x2 - AI.render.worldBounds(AI.app.doc, it, true).x) };
  });
  await ev(() => AI.commands.run('fxZigzag'));
  await page.waitForSelector('.dlg');
  await page.fill('#dlgf-size', '20');
  await page.fill('#dlgf-ridges', '3');
  await page.press('#dlgf-ridges', 'Tab');
  await page.waitForTimeout(60);
  const live = await ev(() => AI.distort.result(AI.app.sel[0])[0].subs[0].pts.length);
  await page.click('.dlg-btn:has-text("확인")');
  await page.waitForTimeout(80);
  const after = await ev(() => {
    const it = AI.app.sel[0];
    const b = AI.render.worldBounds(AI.app.doc, it, true);
    return {
      srcPts: it.subs[0].pts.length,          /* 원본은 그대로 (비파괴) */
      fxPts: AI.distort.result(it)[0].subs[0].pts.length,
      grew: Math.round((b.x2 - b.x) - 200),   /* 융기가 바깥으로 나가 바운딩이 커진다 */
      label: AI.effects.label(it.effects[0]),
      rows: document.querySelectorAll('#fx-list .list-row').length
    };
  });
  if (after.srcPts !== before.pts) throw new Error('원본 패스가 바뀜=' + after.srcPts);
  if (after.fxPts <= before.pts) throw new Error('기하가 안 바뀜=' + after.fxPts);
  if (live !== after.fxPts) throw new Error('미리 보기와 결과가 다름 ' + live + '/' + after.fxPts);
  if (after.grew < 10) throw new Error('바운딩이 안 커짐=' + after.grew);
  if (after.rows !== 1) throw new Error('효과 패널 행=' + after.rows);
  return `원본 ${after.srcPts}점 유지 · 효과 ${after.fxPts}점 · 바운딩 +${after.grew}pt · ${after.label}`;
});

await check('왜곡 효과가 히트 · SVG · 모양 확장까지 따라온다', async () => {
  /* 앞 테스트에서 지그재그가 걸린 사각형이 그대로 선택되어 있다 */
  const svg = await ev(() => AI.io.toSVG(AI.app));
  const d = (svg.match(/<path d="([^"]*)"/) || [, ''])[1];
  const verts = (d.match(/[LC]/g) || []).length;   /* 원본 사각형이면 4 — 지그재그가 반영되면 더 많다 */
  if (verts < 12) throw new Error('SVG 에 왜곡이 반영되지 않음=' + verts);
  const hit = await ev(() => {
    const it = AI.app.sel[0];
    const vm = AI.viewT.matrix(AI.app);
    const b = AI.render.worldBounds(AI.app.doc, it, true);
    const c = AI.mat.apply(vm, (b.x + b.x2) / 2, (b.y + b.y2) / 2);
    return AI.hit.itemAt(AI.app, c.x, c.y, true) === it;
  });
  const exp = await ev(() => {
    AI.commands.run('expandAppearance');
    const it = AI.app.doc.layers[0].children[0];
    return { type: it.type, pts: it.subs ? it.subs[0].pts.length : 0, fx: !!it.effects };
  });
  if (!hit) throw new Error('히트 실패');
  if (exp.type !== 'path' || exp.fx) throw new Error('확장 결과=' + JSON.stringify(exp));
  if (exp.pts < 8) throw new Error('확장된 점 수=' + exp.pts);
  const after = await ev(() => AI.io.toSVG(AI.app).indexOf('<path') >= 0);
  await ev(() => AI.commands.run('undo'));
  const back = await ev(() => !!AI.app.doc.layers[0].children[0].effects);
  if (!after) throw new Error('SVG 에 패스 없음');
  if (!back) throw new Error('실행 취소로 효과가 복원되지 않음');
  return `SVG 정점 ${verts}개 · 히트 · 확장 ${exp.pts}점 · 실행 취소로 복원`;
});

await check('변형 효과의 사본 · 자유 왜곡 · 오목·볼록 (API)', async () => {
  const r = await ev(() => {
    const app = AI.app;
    app.setDoc(AI.model.newDoc(600, 400));
    illy.rect({ x: 50, y: 50, width: 100, height: 100, fill: '#cc3333' });
    /* 변형: 40pt 씩 옮긴 사본 3개 → 폭이 100 + 3×40 = 220 이 된다 */
    illy.applyEffect({ type: 'transformFx', moveX: 40, copies: 3 });
    const b = illy.get(illy.select({ type: 'path' })[0].id).geometricBounds;
    /* 오목·볼록 */
    illy.applyEffect({ type: 'puckerBloat', amount: 60 });
    const b2 = illy.get(illy.select({ type: 'path' })[0].id).geometricBounds;
    const list = illy.effects({})[0].effects.map(e => e.type);
    return { w: Math.round(b.w), bloatW: Math.round(b2.w), list: list.join(','), copies: AI.distort.result(AI.app.doc.layers[0].children[0]).length };
  });
  const free = await ev(() => {
    illy.clearEffects({});
    illy.applyEffect({ type: 'freeDistort', corners: [0, 0, 0, 0, 0, 0, -50, 0] });
    const b = illy.get(illy.select({ type: 'path' })[0].id).geometricBounds;
    return Math.round(b.w);
  });
  if (r.w !== 220) throw new Error('사본 폭=' + r.w);
  if (r.copies !== 4) throw new Error('사본 수=' + r.copies);
  if (r.bloatW <= 220) throw new Error('볼록이 안 커짐=' + r.bloatW);
  if (r.list !== 'transformFx,puckerBloat') throw new Error('효과 목록=' + r.list);
  if (free !== 150) throw new Error('자유 왜곡 폭=' + free);
  return `사본 4벌 220pt · 볼록 ${r.bloatW}pt · 자유 왜곡 ${free}pt`;
});

/* ---------------- 패스 상의 문자 ---------------- */
await check('패스 상의 문자 — 도구로 만들고 글자가 접선을 따라 선다', async () => {
  await ev(() => {
    const app = AI.app;
    app.setDoc(AI.model.newDoc(500, 400));
    /* 위로 볼록한 호 */
    const arc = AI.model.newPath([{ closed: false, pts: [
      { x: 50, y: 250, ox: 50, oy: 80 },
      { x: 450, y: 250, ix: 450, iy: 80 }
    ] }]);
    arc.fill = AI.color.none();
    app.doc.layers[0].children.push(arc);
    AI.viewT.fitArtboard(app);
  });
  /* 패스 상 문자 도구로 호의 왼쪽을 클릭 */
  await ev(() => AI.tools.setTool(AI.app, 'typepath'));
  const pt = await ev(() => {
    const vm = AI.viewT.matrix(AI.app);
    const q = AI.mat.apply(vm, 50, 250);
    return { x: q.x, y: q.y };
  });
  const vbox = await (await page.$('#view')).boundingBox();
  await page.mouse.click(vbox.x + pt.x, vbox.y + pt.y);
  await page.waitForTimeout(80);
  await page.keyboard.type('Illymolly');
  await page.waitForTimeout(80);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(80);

  const r = await ev(() => {
    const it = AI.app.doc.layers[0].children[0];
    const L = AI.render.measureText(it);
    return {
      type: it.type, onPath: !!(it.text && it.text.path),
      content: it.text.content,
      glyphs: L.glyphs.length,
      /* 호의 왼쪽 끝에서는 접선이 거의 수직(위쪽), 오른쪽으로 갈수록 눕는다 */
      a0: Math.round(L.glyphs[0].ang * 180 / Math.PI),
      aLast: Math.round(L.glyphs[L.glyphs.length - 1].ang * 180 / Math.PI),
      count: AI.app.doc.layers[0].children.length      /* 원본 패스는 사라진다 */
    };
  });
  if (r.type !== 'text' || !r.onPath) throw new Error('패스 상의 문자가 안 만들어짐=' + JSON.stringify(r));
  if (r.content !== 'Illymolly') throw new Error('내용=' + r.content);
  if (r.glyphs !== 9) throw new Error('글자 수=' + r.glyphs);
  if (r.count !== 1) throw new Error('원본 패스가 남음=' + r.count);
  if (!(r.a0 < -60) || !(r.aLast > r.a0 + 10)) throw new Error('접선 각도=' + r.a0 + '/' + r.aLast);
  return `글자 ${r.glyphs}개 · 접선 ${r.a0}° → ${r.aLast}° · 원본 패스는 문자 오브젝트가 됨`;
});

await check('패스 상의 문자 — 옵션 · 뒤집기 · 풀기 · SVG textPath', async () => {
  const before = await ev(() => {
    const it = AI.app.doc.layers[0].children[0];
    AI.sel.set(AI.app, [it]);
    return AI.render.measureText(it).glyphs[0].y;
  });
  /* 옵션 대화상자로 문자 맞추기 · 시작 위치 */
  await ev(() => AI.commands.run('typePathOptions'));
  await page.waitForSelector('.dlg');
  await page.selectOption('#dlgf-align', 'ascender');
  await page.fill('#dlgf-start', '40');
  await page.press('#dlgf-start', 'Tab');
  await page.waitForTimeout(60);
  await page.click('.dlg-btn:has-text("확인")');
  await page.waitForTimeout(60);

  const opt = await ev(() => {
    const it = AI.app.sel[0];
    const L = AI.render.measureText(it);
    return { align: it.text.path.align, start: it.text.path.start, y: L.glyphs[0].y };
  });
  if (opt.align !== 'ascender' || opt.start !== 40) throw new Error('옵션=' + JSON.stringify(opt));
  if (Math.abs(opt.y - before) < 1) throw new Error('문자 맞추기가 반영되지 않음');

  /* 뒤집기 */
  const flipped = await ev(() => {
    const y0 = AI.render.measureText(AI.app.sel[0]).glyphs[0].y;
    AI.commands.run('typePathFlip');
    const it = AI.app.sel[0];
    return { on: it.text.path.flip, moved: Math.abs(AI.render.measureText(it).glyphs[0].y - y0) > 1 };
  });
  if (!flipped.on || !flipped.moved) throw new Error('뒤집기=' + JSON.stringify(flipped));

  /* SVG 는 textPath 로 나간다 */
  const svg = await ev(() => AI.io.toSVG(AI.app));
  if (svg.indexOf('<textPath') < 0) throw new Error('textPath 없음');
  if (!/<path id="tp\d+"/.test(svg)) throw new Error('기준선 패스 정의 없음');

  /* 풀기 → 다시 패스로 */
  const rel = await ev(() => {
    AI.commands.run('releaseTypePath');
    const it = AI.app.doc.layers[0].children[0];
    return { type: it.type, subs: it.subs ? it.subs.length : 0 };
  });
  if (rel.type !== 'path' || rel.subs !== 1) throw new Error('풀기=' + JSON.stringify(rel));
  await ev(() => AI.commands.run('undo'));
  const back = await ev(() => AI.app.doc.layers[0].children[0].type);
  if (back !== 'text') throw new Error('실행 취소 실패=' + back);
  return `맞추기 ascender · 시작 40pt · 뒤집기 · SVG textPath · 풀기/복원`;
});

/* ---------------- 다중 문서 탭 ---------------- */
await check('문서 탭 — 여러 문서를 한 창에서 · 문서마다 실행 취소가 따로', async () => {
  /* 앞선 테스트들이 열어 둔 탭을 정리하고 하나만 남긴다 */
  await ev(() => {
    while (illy.documents().length > 1) AI.docs.close(AI.app, illy.documents().length - 1, true);
    AI.app.doc.name = '무제-1';
  });
  await refreshBox();
  const start = await ev(() => ({
    n: illy.documents().length,
    hidden: document.getElementById('doctabs').classList.contains('one')
  }));
  if (start.n !== 1 || !start.hidden) throw new Error('시작 상태=' + JSON.stringify(start));

  await ev(() => {
    AI.app.setDoc(AI.model.newDoc(400, 400));
    AI.app.history.reset(AI.app.doc, '새 문서');
    illy.rect({ x: 10, y: 10, width: 100, height: 100, fill: '#ff0000' });
  });
  /* Ctrl+N 대화상자로 두 번째 문서 */
  await ev(() => AI.commands.run('new'));
  await page.waitForSelector('.dlg');
  await page.fill('#dlgf-name', '두번째');
  await page.click('.dlg-btn:has-text("확인")');
  await page.waitForTimeout(80);

  const two = await ev(() => ({
    docs: illy.documents().map(d => d.name + ':' + (d.active ? 'on' : 'off') + ':' + d.objects),
    tabs: [...document.querySelectorAll('#doctabs .dtab')].length,
    shown: !document.getElementById('doctabs').classList.contains('one'),
    on: document.querySelector('#doctabs .dtab.on .dt-name').textContent
  }));
  if (two.tabs !== 2 || !two.shown) throw new Error('탭=' + JSON.stringify(two));
  if (two.on !== '두번째') throw new Error('활성 탭=' + two.on);
  if (two.docs[0] !== '무제-1:off:1') throw new Error('첫 문서=' + two.docs[0]);

  /* 두 번째 문서에 도형을 넣고 실행 취소 — 첫 문서에는 영향이 없어야 한다 */
  const undo = await ev(() => {
    illy.ellipse({ x: 0, y: 0, width: 60, height: 60, fill: '#00ff00' });
    const before = illy.documents().map(d => d.objects).join(',');
    AI.commands.run('undo');
    return { before, after: illy.documents().map(d => d.objects).join(',') };
  });
  if (undo.before !== '1,1' || undo.after !== '1,0') throw new Error('실행 취소 격리 실패 ' + JSON.stringify(undo));

  /* 탭 클릭으로 전환 — 선택과 화면 배율도 문서마다 따로 */
  await page.click('#doctabs .dtab:nth-child(1)');
  await page.waitForTimeout(60);
  const back = await ev(() => ({
    name: AI.app.doc.name,
    objs: AI.app.doc.layers[0].children.length,
    label: AI.app.history.undoLabel(),
    on: document.querySelector('#doctabs .dtab.on .dt-name').textContent
  }));
  if (back.name !== '무제-1' || back.objs !== 1) throw new Error('전환=' + JSON.stringify(back));
  if (back.on !== '무제-1') throw new Error('탭 표시=' + back.on);
  if (back.label !== 'addRect') throw new Error('실행 취소 스택이 섞임=' + back.label);
  return `탭 2개 · 문서별 실행 취소(${undo.before}→${undo.after}) · 클릭 전환`;
});

await check('문서 탭 — Ctrl+Tab 순환 · 닫기 · 마지막 하나는 남는다', async () => {
  await page.keyboard.press('Control+Tab');
  await page.waitForTimeout(60);
  const next = await ev(() => AI.app.doc.name);
  await page.keyboard.press('Control+Shift+Tab');
  await page.waitForTimeout(60);
  const prev = await ev(() => AI.app.doc.name);
  if (next !== '두번째' || prev !== '무제-1') throw new Error('순환=' + next + '/' + prev);

  /* 탭의 × 로 닫기 (수정 표시가 없는 문서라 확인 없이 닫힌다) */
  const closed = await ev(() => {
    AI.docs.close(AI.app, 1, true);
    return { n: illy.documents().length, name: AI.app.doc.name };
  });
  if (closed.n !== 1 || closed.name !== '무제-1') throw new Error('닫기=' + JSON.stringify(closed));

  /* 마지막 문서를 닫으면 빈 새 문서가 대신 열린다 (일러스트레이터와 같다) */
  const last = await ev(() => {
    AI.docs.close(AI.app, 0, true);
    return { n: illy.documents().length, objs: AI.app.doc.layers[0].children.length };
  });
  if (last.n !== 1 || last.objs !== 0) throw new Error('마지막 닫기=' + JSON.stringify(last));
  const hidden = await ev(() => document.getElementById('doctabs').classList.contains('one'));
  if (!hidden) throw new Error('탭 줄이 다시 숨겨지지 않음');
  await refreshBox();
  return 'Ctrl+Tab 순환 · 닫기 · 마지막 문서는 빈 문서로 대체 · 탭 줄 자동 숨김';
});

/* ---------------- 라이브 셰이프 위젯 ---------------- */
await check('라이브 원형 — 파이 각도 위젯으로 부채꼴이 된다', async () => {
  await ev(() => {
    const app = AI.app;
    app.setDoc(AI.model.newDoc(400, 400));
    const e2 = AI.model.newEllipse(100, 100, 200, 200);
    e2.fill = AI.color.solid('#3366cc');
    app.doc.layers[0].children.push(e2);
    AI.sel.set(app, [e2]);
    AI.viewT.fitArtboard(app);
  });
  await refreshBox();
  const w0 = await ev(() => {
    const lw = AI.render.liveWidgets(AI.app);
    return lw && lw.pts.map(p => ({ kind: p.kind, x: p.x, y: p.y }));
  });
  if (!w0 || w0.length !== 2) throw new Error('파이 위젯이 없음=' + JSON.stringify(w0));

  /* 끝 각도 손잡이를 아래쪽(90°)으로 끌어 4분원으로 만든다 */
  const end = w0.find(p => p.kind === 'pieEnd');
  const target = await ev(() => {
    const vm = AI.viewT.matrix(AI.app);
    const q = AI.mat.apply(vm, 200, 300);        /* 타원 아래쪽 끝 = 90° */
    return { x: q.x, y: q.y };
  });
  await drag({ x: box.x + end.x, y: box.y + end.y }, { x: box.x + target.x, y: box.y + target.y });
  await page.waitForTimeout(60);

  const r = await ev(() => {
    const it = AI.app.sel[0];
    const b = AI.render.worldBounds(AI.app.doc, it, true);
    return {
      pie: it.shape.pie && [Math.round(it.shape.pie.start), Math.round(it.shape.pie.end)],
      w: Math.round(b.x2 - b.x), h: Math.round(b.y2 - b.y),
      anchors: it.subs[0].pts.length,
      label: AI.app.history.undoLabel()
    };
  });
  if (!r.pie || Math.abs(r.pie[1] - 90) > 3) throw new Error('끝 각도=' + JSON.stringify(r.pie));
  if (r.w !== 100 || r.h !== 100) throw new Error('부채꼴 바운딩=' + r.w + '×' + r.h);
  if (r.anchors !== 3) throw new Error('앵커=' + r.anchors);  /* 중심 + 호 양 끝 */
  if (r.label !== '파이 각도') throw new Error('실행 취소 이름=' + r.label);

  /* 한 바퀴로 되돌리면 다시 온전한 원 */
  const back = await ev(() => {
    illy.set(AI.app.sel[0].id, { pieEnd: 360 });
    return { pie: !!AI.app.sel[0].shape.pie, anchors: AI.app.sel[0].subs[0].pts.length };
  });
  if (back.pie || back.anchors !== 4) throw new Error('원 복귀=' + JSON.stringify(back));
  return `파이 0→${r.pie[1]}° · 바운딩 ${r.w}×${r.h} · 앵커 ${r.anchors} · 360°에서 온전한 원 복귀`;
});

await check('라이브 다각형 — 변의 수 위젯을 끌면 변이 늘어난다', async () => {
  await ev(() => {
    const app = AI.app;
    app.setDoc(AI.model.newDoc(400, 400));
    const pg = AI.model.newPolygon(200, 200, 80, 6);
    pg.fill = AI.color.solid('#cc6633');
    app.doc.layers[0].children.push(pg);
    AI.sel.set(app, [pg]);
    AI.viewT.fitArtboard(app);
  });
  await refreshBox();
  const w = await ev(() => {
    const lw = AI.render.liveWidgets(AI.app);
    return lw && lw.pts[0];
  });
  if (!w || w.kind !== 'sides') throw new Error('변 수 위젯이 없음=' + JSON.stringify(w));
  /* 위로 24px = +3 */
  await drag({ x: box.x + w.x, y: box.y + w.y }, { x: box.x + w.x, y: box.y + w.y - 24 });
  await page.waitForTimeout(60);
  const up = await ev(() => ({
    n: AI.app.sel[0].shape.n,
    pts: AI.app.sel[0].subs[0].pts.length,
    label: AI.app.history.undoLabel()
  }));
  if (up.n !== 9 || up.pts !== 9) throw new Error('변 수=' + JSON.stringify(up));
  if (up.label !== '변의 수') throw new Error('실행 취소 이름=' + up.label);
  await ev(() => AI.commands.run('undo'));
  const undone = await ev(() => AI.app.doc.layers[0].children[0].shape.n);
  if (undone !== 6) throw new Error('실행 취소=' + undone);
  return `변 6 → ${up.n} (앵커 ${up.pts}) · 실행 취소로 6 복원`;
});

/* ---------------- 에이전트용 연산 (render · diff) ---------------- */
await check('render() — 에이전트가 결과를 눈으로 확인한다', async () => {
  const r = await ev(() => {
    const app = AI.app;
    while (illy.documents().length > 1) AI.docs.close(app, illy.documents().length - 1, true);
    app.setDoc(AI.model.newDoc(400, 300));
    app.history.reset(app.doc, '새 문서');
    illy.rect({ x: 20, y: 20, width: 100, height: 100, fill: '#ff0000' });
    const b = illy.ellipse({ x: 200, y: 20, width: 80, height: 80, fill: '#00ff00' });
    const board = illy.render({ of: 'artboard', maxSize: 200 });
    illy.select([b]);
    const sel = illy.render({ of: 'selection', maxSize: 120, padding: 0 });
    const all = illy.render({ of: 'all', maxSize: 200, padding: 10 });
    return {
      board: { w: board.width, h: board.height, isPng: board.png.indexOf('data:image/png;base64,') === 0, region: board.region },
      sel: { w: sel.width, h: sel.height, region: sel.region },
      all: { w: all.width, h: all.height }
    };
  });
  /* 대지 400×300 을 긴 변 200 으로 → 200×150 */
  if (r.board.w !== 200 || r.board.h !== 150) throw new Error('대지 렌더=' + r.board.w + 'x' + r.board.h);
  if (!r.board.isPng) throw new Error('PNG data URL 이 아님');
  if (r.board.region.width !== 400 || r.board.region.height !== 300) throw new Error('영역=' + JSON.stringify(r.board.region));
  /* 선택 렌더는 그 오브젝트만 담는다 (원 80×80) */
  if (Math.abs(r.sel.region.width - 80) > 2 || Math.abs(r.sel.region.height - 80) > 2) {
    throw new Error('선택 영역=' + JSON.stringify(r.sel.region));
  }

  /* 실제로 그 오브젝트가 찍혔는지 픽셀로 확인 */
  const px = await ev(() => {
    const out = illy.render({ of: 'selection', maxSize: 120, padding: 0, background: false });
    return new Promise(res => {
      const im = new Image();
      im.onload = () => {
        const cv = document.createElement('canvas');
        cv.width = im.width; cv.height = im.height;
        const c = cv.getContext('2d'); c.drawImage(im, 0, 0);
        const d = c.getImageData(Math.round(im.width / 2), Math.round(im.height / 2), 1, 1).data;
        return res([d[0], d[1], d[2]].join(','));
      };
      im.src = out.png;
    });
  });
  if (px !== '0,255,0') throw new Error('선택 렌더 가운데 픽셀=' + px);

  /* 선택이 없으면 친절하게 알려 준다 */
  const errMsg = await ev(() => {
    illy.deselect();
    try { illy.render({ of: 'selection' }); return 'no-error'; }
    catch (e) { return e.message; }
  });
  if (errMsg.indexOf('선택') < 0) throw new Error('오류 안내=' + errMsg);
  return `대지 ${r.board.w}×${r.board.h} · 선택 ${r.sel.w}×${r.sel.h}(가운데 ${px}) · 전체 ${r.all.w}×${r.all.h}`;
});

await check('diff() — 표시해 둔 시점 이후 무엇이 달라졌는지', async () => {
  const r = await ev(() => {
    const app = AI.app;
    app.setDoc(AI.model.newDoc(400, 300));
    app.history.reset(app.doc, '새 문서');
    const a = illy.rect({ x: 20, y: 20, width: 100, height: 100, fill: '#ff0000' });
    const gone = illy.rect({ x: 300, y: 20, width: 40, height: 40, fill: '#888888' });
    const mark = illy.mark();

    illy.ellipse({ x: 200, y: 20, width: 80, height: 80, fill: '#00ff00' });   /* 추가 */
    illy.set(a, { fill: '#0000ff', opacity: 0.5 });                            /* 변경 */
    illy.move([a], { dx: 10, dy: 0 });                                         /* 변경 */
    illy.remove(gone);                                                         /* 삭제 */

    const d = illy.diff({ since: mark });
    return {
      summary: d.summary,
      since: d.since === mark,
      added: d.added.map(x => x.type + ':' + x.fill),
      removed: d.removed.map(x => x.name),
      changedKeys: d.changed.map(c => Object.keys(c.changes).sort().join('|')),
      changedName: d.changed[0] && d.changed[0].name,
      unchanged: d.unchanged
    };
  });
  if (r.summary !== '추가 1 · 삭제 1 · 변경 1') throw new Error('요약=' + r.summary);
  if (!r.since) throw new Error('기준 시점이 안 맞음');
  if (r.added[0] !== 'path:#00ff00') throw new Error('추가=' + r.added);
  if (r.removed.length !== 1) throw new Error('삭제=' + JSON.stringify(r.removed));
  const keys = r.changedKeys[0];
  ['칠', '불투명도', '위치·크기'].forEach(k => {
    if (keys.indexOf(k) < 0) throw new Error('"' + k + '" 변경이 안 잡힘 — ' + keys);
  });

  /* 문서 자체가 달라진 것도 알려 준다 */
  const docd = await ev(() => {
    const m = illy.mark();
    illy.addArtboard({ width: 100, height: 100, name: '둘째' });
    const d = illy.diff({ since: m });
    return d.document ? Object.keys(d.document).join(',') + '=' + d.document.artboards.from + '→' + d.document.artboards.to : '(없음)';
  });
  if (docd !== 'artboards=1→2') throw new Error('문서 변경=' + docd);

  /* mark 가 없으면 마지막 동작 직전과 견준다 */
  const auto = await ev(() => {
    const app = AI.app;
    app.setDoc(AI.model.newDoc(300, 300));
    app.history.reset(app.doc, '새 문서');
    delete app.__marks;
    illy.rect({ x: 10, y: 10, width: 50, height: 50, fill: '#123456' });
    const d = illy.diff({});
    return { since: d.since, summary: d.summary, added: d.added.length };
  });
  if (auto.added !== 1) throw new Error('자동 비교 추가=' + auto.added);
  if (String(auto.since).indexOf('마지막 동작 직전') < 0) throw new Error('기준=' + auto.since);

  /* 없는 표시를 주면 살아 있는 표시를 알려 준다 */
  const bad = await ev(() => {
    try { illy.diff({ since: '없는표시' }); return 'no-error'; } catch (e) { return e.message; }
  });
  if (bad.indexOf('표시를 찾을 수 없습니다') < 0) throw new Error('오류 안내=' + bad);
  return `${r.summary} · 변경 항목 [${keys}] · 문서 ${docd} · mark 없으면 "${auto.since}"`;
});

/* ---------------- 자유형 그레이디언트 ---------------- */
await check('자유형 그레이디언트 — 색 점이 제 자리를 지키며 섞인다', async () => {
  const r = await ev(() => {
    const app = AI.app;
    while (illy.documents().length > 1) AI.docs.close(app, illy.documents().length - 1, true);
    app.setDoc(AI.model.newDoc(200, 200));
    app.history.reset(app.doc, '새 문서');
    const id = illy.rect({ x: 0, y: 0, width: 200, height: 200, fill: {
      type: 'freeform', stops: [
        { x: 40, y: 40, color: '#ff0000', spread: 60 },
        { x: 160, y: 40, color: '#00ff00', spread: 60 },
        { x: 100, y: 160, color: '#0000ff', spread: 60 }
      ]
    } });
    return { id, type: illy.get(id).fill.type, n: illy.get(id).fill.stops.length };
  });
  if (r.type !== 'freeform' || r.n !== 3) throw new Error('칠=' + JSON.stringify(r));

  /* 각 색 점 자리에는 그 색이, 가운데에는 섞인 색이 찍혀야 한다 */
  const px = await ev(() => {
    const url = illy.toPNG({ scale: 1, background: false });
    return new Promise(res => {
      const im = new Image();
      im.onload = () => {
        const cv = document.createElement('canvas');
        cv.width = im.width; cv.height = im.height;
        const c = cv.getContext('2d'); c.drawImage(im, 0, 0);
        const at = (x, y) => { const d = c.getImageData(x, y, 1, 1).data; return [d[0], d[1], d[2]]; };
        return res({ red: at(40, 40), green: at(160, 40), blue: at(100, 160), mid: at(100, 80) });
      };
      im.src = url;
    });
  });
  const near = (a, b) => Math.abs(a[0] - b[0]) < 40 && Math.abs(a[1] - b[1]) < 40 && Math.abs(a[2] - b[2]) < 40;
  if (!near(px.red, [255, 0, 0])) throw new Error('빨강 점=' + px.red);
  if (!near(px.green, [0, 255, 0])) throw new Error('초록 점=' + px.green);
  if (!near(px.blue, [0, 0, 255])) throw new Error('파랑 점=' + px.blue);
  /* 가운데는 어느 원색과도 달라야 (= 섞여야) 한다 */
  if (near(px.mid, [255, 0, 0]) || near(px.mid, [0, 255, 0]) || near(px.mid, [0, 0, 255])) {
    throw new Error('가운데가 안 섞임=' + px.mid);
  }

  /* 점을 더한 뒤 순서를 바꿔도 결과가 같다 (거리 가중이라 순서에 안 흔들린다) */
  const order = await page.evaluate((id) => {
    const before = illy.toPNG({ scale: 1, background: false });
    const f = AI.model.find(AI.app.doc, id).fill;
    f.stops.reverse();
    AI.app.invalidate();
    return before === illy.toPNG({ scale: 1, background: false });
  }, r.id);
  if (!order) throw new Error('점 순서에 따라 결과가 달라짐');

  /* SVG 로는 구운 그림을 도형으로 잘라 심는다 */
  const svg = await ev(() => AI.io.toSVG(AI.app));
  if (svg.indexOf('<image') < 0 || svg.indexOf('ffclip') < 0) throw new Error('SVG 출력에 그림/클립 없음');
  return `세 점 색 유지 · 가운데 ${px.mid.join(',')} 로 섞임 · 순서 무관 · SVG 클립 이미지`;
});

await check('자유형 그레이디언트 — 패널 전환 · 캔버스에서 점 끌기', async () => {
  await ev(() => {
    const app = AI.app;
    app.setDoc(AI.model.newDoc(300, 300));
    app.history.reset(app.doc, '새 문서');
    illy.rect({ x: 50, y: 50, width: 200, height: 200, fill: '#3366cc' });
    illy.select(illy.find({ type: 'path' }));
    app.fillFocus = true;            /* 칠 쪽에 초점 (앞 테스트가 획을 만졌을 수 있다) */
    AI.viewT.fitArtboard(app);
    AI.ui.showPanel('gradient');
  });
  await refreshBox();
  /* 패널에서 선형 → 자유형 */
  await page.selectOption('#gr-type', 'linear');
  await page.waitForTimeout(60);
  await page.selectOption('#gr-type', 'freeform');
  await page.waitForTimeout(80);
  const on = await ev(() => {
    const f = AI.app.sel[0].fill;
    return {
      type: f.type, n: f.stops.length,
      spreadRow: document.getElementById('gr-spread-row').style.display !== 'none',
      angleOff: document.getElementById('gr-angle').hasAttribute('disabled')
    };
  });
  if (on.type !== 'freeform') throw new Error('자유형 전환 실패=' + on.type);
  if (on.n < 2) throw new Error('색 점 수=' + on.n);
  if (!on.spreadRow || !on.angleOff) throw new Error('패널 표시=' + JSON.stringify(on));

  /* G 도구로 색 점을 끌어 옮긴다 */
  await ev(() => AI.tools.setTool(AI.app, 'gradient'));
  const p0 = await ev(() => {
    const it = AI.app.sel[0];
    const wm = AI.mat.mul(AI.viewT.matrix(AI.app), AI.model.worldMatrix(AI.app.doc, it));
    const s = it.fill.stops[0];
    const q = AI.mat.apply(wm, s.x, s.y);
    const t = AI.mat.apply(wm, s.x + 40, s.y + 30);
    return { from: q, to: t, x0: Math.round(s.x), y0: Math.round(s.y) };
  });
  await drag({ x: box.x + p0.from.x, y: box.y + p0.from.y }, { x: box.x + p0.to.x, y: box.y + p0.to.y });
  await page.waitForTimeout(60);
  const moved = await ev(() => {
    const s = AI.app.sel[0].fill.stops[0];
    return { x: Math.round(s.x), y: Math.round(s.y), label: AI.app.history.undoLabel() };
  });
  if (Math.abs(moved.x - (p0.x0 + 40)) > 3 || Math.abs(moved.y - (p0.y0 + 30)) > 3) {
    throw new Error('점 이동=' + JSON.stringify(moved) + ' 기대 ' + (p0.x0 + 40) + ',' + (p0.y0 + 30));
  }
  if (moved.label !== '색 점 이동') throw new Error('실행 취소 이름=' + moved.label);

  /* 빈 곳을 두 번 누르면 점이 늘어난다 */
  const added = await ev(() => AI.app.sel[0].fill.stops.length);
  const mid = await ev(() => {
    const it = AI.app.sel[0];
    const wm = AI.mat.mul(AI.viewT.matrix(AI.app), AI.model.worldMatrix(AI.app.doc, it));
    const q = AI.mat.apply(wm, 200, 200);
    return { x: q.x, y: q.y };
  });
  await page.mouse.dblclick(box.x + mid.x, box.y + mid.y);
  await page.waitForTimeout(80);
  const after = await ev(() => AI.app.sel[0].fill.stops.length);
  if (after !== added + 1) throw new Error('점 추가 ' + added + ' → ' + after);
  await ev(() => AI.tools.setTool(AI.app, 'select'));
  return `선형→자유형 (점 ${on.n}개) · 끌어서 이동 · 두 번 눌러 ${after}개로 추가`;
});

/* ---------------- 아트 브러시 · 패턴 브러시 ---------------- */
await check('아트 브러시 — 아트웍이 패스를 따라 휘어진다', async () => {
  const r = await ev(() => {
    const app = AI.app;
    while (illy.documents().length > 1) AI.docs.close(app, illy.documents().length - 1, true);
    app.setDoc(AI.model.newDoc(600, 400));
    app.history.reset(app.doc, '새 문서');
    /* 위로 볼록한 호 */
    const arc = AI.model.newPath([{ closed: false, pts: [
      { x: 50, y: 300, ox: 50, oy: 60 },
      { x: 550, y: 300, ix: 550, iy: 60 }
    ] }]);
    arc.fill = AI.color.none();
    app.doc.layers[0].children.push(arc);
    /* 브러시 아트웍: 가로로 긴 삼각형 */
    const artId = illy.addPath({ points: [[0, 0], [100, 10], [0, 20]], closed: true, fill: '#cc3333' });
    const arcB = AI.render.worldBounds(app.doc, arc, true);

    illy.applyBrush({ kind: 'art', artwork: artId, query: [arc.id, artId] });
    const kids = app.doc.layers[0].children;
    const g = kids[kids.length - 1];
    const gb = AI.render.worldBounds(app.doc, g, true);
    return {
      arcH: Math.round(arcB.y2 - arcB.y),
      name: g.name,
      leaves: g.children.length,
      pts: g.children[0].subs[0].pts.length,
      fill: g.children[0].fill.color,
      /* 휘었다면 결과 높이가 호 높이만큼 나온다 (안 휘면 납작해진다) */
      h: Math.round(gb.y2 - gb.y),
      w: Math.round(gb.x2 - gb.x),
      left: kids.length          /* 원본 패스는 브러시가 되면서 사라진다 */
    };
  });
  if (r.name !== '아트 브러시') throw new Error('그룹 이름=' + r.name);
  if (r.h < r.arcH) throw new Error('휘지 않음 — 결과 높이 ' + r.h + ' / 호 높이 ' + r.arcH);
  if (r.pts < 50) throw new Error('점이 너무 적어 휘어 보이지 않음=' + r.pts);
  if (r.fill !== '#cc3333') throw new Error('아트웍 색이 안 따라옴=' + r.fill);
  if (r.left !== 2) throw new Error('원본 패스 정리 실패 — 남은 오브젝트 ' + r.left);

  /* 화면에도 호를 따라 실제로 칠해졌는지 픽셀로 확인 */
  const px = await ev(() => {
    const url = illy.toPNG({ scale: 1, background: true });
    return new Promise(res => {
      const im = new Image();
      im.onload = () => {
        const cv = document.createElement('canvas');
        cv.width = im.width; cv.height = im.height;
        const c = cv.getContext('2d');
        c.drawImage(im, 0, 0);
        /* 호의 꼭대기 부근(300,125 근처)에 브러시 색이 있어야 한다 */
        let hit = 0;
        for (let y = 115; y < 145; y++) {
          const d = c.getImageData(300, y, 1, 1).data;
          if (d[0] > 150 && d[1] < 100 && d[2] < 100) hit++;
        }
        return res(hit);
      };
      im.src = url;
    });
  });
  if (px < 3) throw new Error('호 꼭대기에 브러시가 안 그려짐 (' + px + '픽셀)');
  return `${r.w}×${r.h} 로 호를 따라 휘어짐 (점 ${r.pts}개) · 꼭대기 ${px}픽셀`;
});

await check('패턴 브러시 — 타일이 패스 길이에 맞춰 반복된다', async () => {
  const r = await ev(() => {
    const app = AI.app;
    app.setDoc(AI.model.newDoc(600, 200));
    app.history.reset(app.doc, '새 문서');
    /* 길이 400 인 직선 */
    const line = AI.model.newPath([{ closed: false, pts: [{ x: 100, y: 100 }, { x: 500, y: 100 }] }]);
    line.fill = AI.color.none();
    app.doc.layers[0].children.push(line);
    /* 폭 100 인 타일 → 4개가 딱 맞는다 */
    const artId = illy.addPath({ points: [[0, 0], [100, 0], [100, 20], [0, 20]], closed: true, fill: '#2288cc' });

    illy.applyBrush({ kind: 'pattern', artwork: artId, query: [line.id, artId], width: 100, keepPath: true });
    const kids = app.doc.layers[0].children;
    const g = kids[kids.length - 1];
    const gb = AI.render.worldBounds(app.doc, g, true);
    return {
      tiles: g.children.length,
      w: Math.round(gb.x2 - gb.x), h: Math.round(gb.y2 - gb.y),
      kept: kids.some(k => k.id === line.id)        /* 원본 패스 남기기 */
    };
  });
  if (r.tiles !== 4) throw new Error('타일 수=' + r.tiles);
  if (r.w !== 400) throw new Error('전체 폭=' + r.w);
  if (r.h !== 20) throw new Error('타일 높이=' + r.h);
  if (!r.kept) throw new Error('원본 패스 남기기가 동작하지 않음');

  /* 브러시 폭을 절반으로 → 타일이 두 배 */
  const half = await ev(() => {
    AI.commands.run('undo');
    const kids = AI.app.doc.layers[0].children;
    const line = kids.find(k => k.type === 'path' && k.subs[0].pts.length === 2);
    const art = kids.find(k => k !== line);
    illy.applyBrush({ kind: 'pattern', artwork: art.id, query: [line.id, art.id], width: 50 });
    const g = AI.app.doc.layers[0].children.slice(-1)[0];
    return g.children.length;
  });
  if (half !== 8) throw new Error('폭 50%% 일 때 타일 수=' + half);
  return `타일 4개(폭 400) · 폭 50%면 ${half}개 · 원본 패스 유지 옵션 확인`;
});

/* ---------------- 효과 > 3D ---------------- */
await check('효과 > 3D 돌출과 경사 — 면마다 다르게 음영이 든다', async () => {
  const r = await ev(() => {
    const app = AI.app;
    while (illy.documents().length > 1) AI.docs.close(app, illy.documents().length - 1, true);
    app.setDoc(AI.model.newDoc(400, 400));
    app.history.reset(app.doc, '새 문서');
    const id = illy.rect({ x: 100, y: 100, width: 120, height: 120, fill: '#3366cc' });
    const flat = illy.get(id).geometricBounds;
    illy.applyEffect({ type: 'extrude', depth: 60, ax: -18, ay: -26, az: 8 });
    const it = AI.app.doc.layers[0].children[0];
    const td = AI.threed.result(it);
    const b3 = illy.get(id).geometricBounds;
    return {
      id,
      flatW: Math.round(flat.w),
      faces: td.faces.length,
      colors: [...new Set(td.faces.map(f => f.color))].length,
      /* 가장 앞(마지막에 그리는) 면이 마구리여야 한다 */
      frontIsCap: !!td.faces[td.faces.length - 1].cap,
      grewW: Math.round(b3.w) > Math.round(flat.w),
      grewH: Math.round(b3.h) > Math.round(flat.h),
      srcPts: it.subs[0].pts.length,       /* 원본은 그대로 (비파괴) */
      label: AI.effects.label(it.effects[0])
    };
  });
  if (r.faces < 3) throw new Error('면 수=' + r.faces);
  if (r.colors < 3) throw new Error('음영이 갈리지 않음 — 색 ' + r.colors + '가지');
  if (!r.frontIsCap) throw new Error('마구리가 맨 앞에 오지 않음');
  if (!r.grewW || !r.grewH) throw new Error('돌출로 바운딩이 안 커짐');
  if (r.srcPts !== 4) throw new Error('원본 패스가 바뀜=' + r.srcPts);

  /* 화면에도 실제로 세 면이 서로 다른 색으로 찍히는지 픽셀로 확인 */
  const px = await ev(() => {
    const url = illy.toPNG({ scale: 1, background: true });
    return new Promise(res => {
      const im = new Image();
      im.onload = () => {
        const cv = document.createElement('canvas');
        cv.width = im.width; cv.height = im.height;
        const c = cv.getContext('2d');
        c.drawImage(im, 0, 0);
        const seen = new Set();
        for (let y = 90; y < 235; y += 3) {
          for (let x = 90; x < 230; x += 3) {
            const d = c.getImageData(x, y, 1, 1).data;
            if (d[0] === 255 && d[1] === 255 && d[2] === 255) continue;
            seen.add(d[0] + ',' + d[1] + ',' + d[2]);
          }
        }
        return res(seen.size);
      };
      im.src = url;
    });
  });
  if (px < 3) throw new Error('화면에 찍힌 색 = ' + px + '가지');

  /* SVG · PDF 로도 면이 그대로 나간다 */
  const out = await ev(() => {
    const svg = AI.io.toSVG(AI.app);
    return {
      paths: (svg.match(/<path /g) || []).length,
      fills: [...new Set(svg.match(/fill="#[0-9a-f]{6}"/g) || [])].length,
      pdf: AI.pdf.toPDF(AI.app).length
    };
  });
  if (out.paths < 3 || out.fills < 3) throw new Error('SVG=' + JSON.stringify(out));
  if (out.pdf < 500) throw new Error('PDF 크기=' + out.pdf);

  /* 모양 확장 → 면마다 실제 패스가 된다 */
  const exp = await ev(() => {
    illy.select(illy.find({ type: 'path' }));
    AI.commands.run('expandAppearance');
    const g = AI.app.doc.layers[0].children[0];
    return { type: g.type, n: g.type === 'group' ? g.children.length : 0, fx: !!g.effects };
  });
  if (exp.type !== 'group' || exp.n !== r.faces) throw new Error('확장=' + JSON.stringify(exp));
  if (exp.fx) throw new Error('확장 후에도 효과가 남음');
  await ev(() => AI.commands.run('undo'));
  return `면 ${r.faces}개 · 색 ${r.colors}가지 · 화면 ${px}가지 · SVG ${out.paths}패스 · 확장 ${exp.n}개`;
});

await check('효과 > 3D 회전 · 대화상자의 위치 사전 설정', async () => {
  const rot = await ev(() => {
    const app = AI.app;
    app.setDoc(AI.model.newDoc(400, 400));
    app.history.reset(app.doc, '새 문서');
    const id = illy.rect({ x: 100, y: 100, width: 120, height: 120, fill: '#cc6633' });
    illy.applyEffect({ type: 'rotate3d', ax: 0, ay: -60, az: 0 });
    const b = illy.get(id).geometricBounds;
    const td = AI.threed.result(AI.app.doc.layers[0].children[0]);
    return { w: Math.round(b.w), h: Math.round(b.h), faces: td.faces.length };
  });
  /* Y 로 60° 돌리면 가로만 절반(cos60°)으로 줄어든다 */
  if (rot.w !== 60 || rot.h !== 120) throw new Error('회전 결과=' + rot.w + 'x' + rot.h);
  if (rot.faces !== 1) throw new Error('깊이 0 인데 면이 여러 장=' + rot.faces);

  /* 대화상자: 위치 사전 설정을 고르면 회전각이 따라 들어간다 */
  await ev(() => { illy.clearEffects({}); AI.commands.run('fx3dExtrude'); });
  await page.waitForSelector('.dlg');
  await page.selectOption('#dlgf-preset', 'top');
  await page.waitForTimeout(80);
  const angles = await page.evaluate(() => [
    document.getElementById('dlgf-ax').value,
    document.getElementById('dlgf-ay').value,
    document.getElementById('dlgf-az').value
  ].join(','));
  if (angles !== '-90,0,0') throw new Error('사전 설정 "윗면"=' + angles);
  await page.fill('#dlgf-depth', '80');
  await page.press('#dlgf-depth', 'Tab');
  await page.waitForTimeout(80);
  const preview = await ev(() => AI.threed.result(AI.app.sel[0]).faces.length);
  await page.click('.dlg-btn:has-text("확인")');
  await page.waitForTimeout(80);
  const done = await ev(() => {
    const e = AI.app.sel[0].effects[0];
    return { type: e.type, depth: e.depth, ax: e.ax, rows: document.querySelectorAll('#fx-list .list-row').length };
  });
  if (done.type !== 'extrude' || done.depth !== 80 || done.ax !== -90) throw new Error('확인=' + JSON.stringify(done));
  if (done.rows !== 1) throw new Error('효과 패널 행=' + done.rows);
  if (preview < 1) throw new Error('미리 보기 면=' + preview);
  return `회전 ${rot.w}x${rot.h} · 사전 설정 윗면 ${angles} · 깊이 80 적용`;
});

/* ---------------- 실행 취소 메모리 ---------------- */
await check('실행 취소가 바뀌지 않은 가지를 나눠 쓴다 (메모리 절감)', async () => {
  const r = await ev(() => {
    const app = AI.app;
    while (illy.documents().length > 1) AI.docs.close(app, illy.documents().length - 1, true);
    app.setDoc(AI.model.newDoc(2000, 2000));
    /* 앵커 6000개짜리 문서 */
    for (let i = 0; i < 500; i++) {
      illy.addStar({ cx: (i % 25) * 80 + 40, cy: Math.floor(i / 25) * 80 + 40, radius: 30, points: 6, fill: '#3366cc' });
    }
    app.history.reset(app.doc, '새 문서');
    const base = AI.util.nodeCount(app.doc);
    const ids = illy.find({ type: 'path' });
    for (let i = 0; i < 60; i++) {
      app.history.begin('이동', app.doc);
      illy.move([ids[i]], { dx: 1, dy: 1 });
      app.history.commit();
    }
    const h = illy.history();
    return { base, naive: base * 61, nodes: h.nodes, steps: h.depth, mb: h.approxMB, last: ids[59] };
  });
  if (r.base < 5000) throw new Error('문서가 너무 작다=' + r.base);
  if (r.steps !== 61) throw new Error('단계 수=' + r.steps);
  /* 전체 복사였다면 문서 크기 × 단계 수 — 실제로는 그 10분의 1도 안 되어야 한다 */
  if (r.nodes > r.naive / 10) throw new Error('절감 실패: ' + r.nodes + ' / ' + r.naive);

  /* 값이 실제로 되돌아가고 다시 실행되는지 */
  const rt = await page.evaluate((id) => {
    const x0 = Math.round(illy.get(id).geometricBounds.x);
    AI.commands.run('undo');
    const x1 = Math.round(illy.get(id).geometricBounds.x);
    AI.commands.run('redo');
    const x2 = Math.round(illy.get(id).geometricBounds.x);
    return [x0, x1, x2].join(',');
  }, r.last);
  const [a0, a1, a2] = rt.split(',').map(Number);
  if (a1 !== a0 - 1 || a2 !== a0) throw new Error('되돌리기 왕복=' + rt);

  /* 여러 번 되돌려도 문서가 온전한지 */
  const deep = await ev(() => {
    for (let i = 0; i < 30; i++) AI.commands.run('undo');
    const n1 = illy.find({ type: 'path' }).length;
    for (let i = 0; i < 30; i++) AI.commands.run('redo');
    return n1 + ',' + illy.find({ type: 'path' }).length;
  });
  if (deep !== '500,500') throw new Error('깊은 되돌리기=' + deep);
  return `문서 ${r.base} 노드 · 61단계에 ${r.nodes} 노드 (전체 복사면 ${r.naive}) · ${Math.round(r.naive / r.nodes)}배 절약 · 왕복 ${rt}`;
});

/* ---------------- 컴파운드 패스의 구멍 ---------------- */
await check('패스파인더가 컴파운드 패스의 구멍을 잃지 않는다', async () => {
  const setup = () => {
    const app = AI.app;
    app.setDoc(AI.model.newDoc(400, 400));
    app.history.reset(app.doc, '새 문서');
    /* 도넛: 200×200 사각형 안에 100×100 구멍 */
    illy.rect({ x: 50, y: 50, width: 200, height: 200, fill: '#3366cc' });
    illy.rect({ x: 100, y: 100, width: 100, height: 100 });
    illy.select(illy.find({ type: 'path' }));
    AI.commands.run('compoundMake');
  };

  /* 구멍을 건드리지 않는 자리에서 나누기 — 살 부분은 구멍을 그대로 지녀야 한다 */
  const r = await ev(() => {
    const app = AI.app;
    app.setDoc(AI.model.newDoc(400, 400));
    app.history.reset(app.doc, '새 문서');
    illy.rect({ x: 50, y: 50, width: 200, height: 200, fill: '#3366cc' });
    illy.rect({ x: 100, y: 100, width: 100, height: 100 });
    illy.select(illy.find({ type: 'path' }));
    AI.commands.run('compoundMake');
    illy.rect({ x: 40, y: 140, width: 30, height: 20, fill: '#ff0000' });
    illy.select(illy.find({ type: 'path' }));
    AI.commands.run('pf_divide');
    return illy.find({ type: 'path' }).map(id => {
      const it = AI.model.find(AI.app.doc, id);
      const b = illy.get(id).geometricBounds;
      return {
        b: [b.x, b.y, b.w, b.h].map(Math.round).join(','),
        subs: it.subs.length, fill: illy.get(id).fill.color
      };
    });
  });
  const donut = r.filter(o => o.fill === '#3366cc');
  if (donut.length !== 1) throw new Error('도넛 조각 수=' + donut.length + ' / ' + JSON.stringify(r));
  if (donut[0].subs !== 2) throw new Error('구멍이 사라짐 — 서브패스=' + donut[0].subs);
  if (donut[0].b !== '50,50,200,200') throw new Error('도넛 바운딩=' + donut[0].b);
  if (r.length !== 3) throw new Error('조각 수=' + r.length);

  /* 구멍 자리가 실제로 비어 있는지 픽셀로 확인 */
  const px = await ev(() => {
    const url = illy.toPNG({ scale: 1, background: true });
    return new Promise(res => {
      const im = new Image();
      im.onload = () => {
        const cv = document.createElement('canvas');
        cv.width = im.width; cv.height = im.height;
        const c = cv.getContext('2d');
        c.drawImage(im, 0, 0);
        const hole = c.getImageData(150, 150, 1, 1).data;     /* 구멍 한가운데 */
        const meat = c.getImageData(60, 60, 1, 1).data;       /* 살 부분 */
        return res([hole[0], hole[1], hole[2], '/', meat[0], meat[1], meat[2]].join(','));
      };
      im.src = url;
    });
  });
  if (px !== '255,255,255,/,51,102,204') throw new Error('구멍/살 픽셀=' + px);

  /* 구멍을 가로지르는 경우에도 조각이 제대로 나온다 */
  const cross = await ev(() => {
    const app = AI.app;
    app.setDoc(AI.model.newDoc(400, 400));
    app.history.reset(app.doc, '새 문서');
    illy.rect({ x: 50, y: 50, width: 200, height: 200, fill: '#3366cc' });
    illy.rect({ x: 100, y: 100, width: 100, height: 100 });
    illy.select(illy.find({ type: 'path' }));
    AI.commands.run('compoundMake');
    illy.rect({ x: 0, y: 130, width: 400, height: 40, fill: '#ff0000' });
    illy.select(illy.find({ type: 'path' }));
    AI.commands.run('pf_divide');
    const parts = illy.find({ type: 'path' }).map(id => illy.get(id).fill.color);
    return { n: parts.length, blue: parts.filter(c => c === '#3366cc').length };
  });
  if (cross.n !== 7 || cross.blue !== 2) throw new Error('가로지르기=' + JSON.stringify(cross));
  return `살 1조각(서브패스 ${donut[0].subs}) · 구멍 비어 있음 · 가로지르면 ${cross.n}조각(파랑 ${cross.blue})`;
});

/* ---------------- 유사 항목 선택 ---------------- */
await check('선택 > 동일 — 획 두께 · 불투명도 · 혼합 모드 · 도형', async () => {
  await ev(() => {
    const app = AI.app;
    while (illy.documents().length > 1) AI.docs.close(app, illy.documents().length - 1, true);
    app.setDoc(AI.model.newDoc(600, 400));
    app.history.reset(app.doc, '새 문서');
    /* 획 두께 3 인 사각형 2개, 두께 1 인 원 1개, 반투명 별 1개 */
    illy.rect({ x: 10, y: 10, width: 50, height: 50, fill: '#ff0000', stroke: '#000000', strokeWidth: 3 });
    illy.rect({ x: 80, y: 10, width: 50, height: 50, fill: '#00ff00', stroke: '#000000', strokeWidth: 3 });
    illy.ellipse({ x: 150, y: 10, width: 50, height: 50, fill: '#ff0000', stroke: '#000000', strokeWidth: 1 });
    illy.addStar({ cx: 250, cy: 40, radius: 25, innerRadius: 12, points: 5, fill: '#0000ff', opacity: 0.5 });
    illy.set(illy.find({ type: 'path' })[3], { blend: 'multiply' });
  });
  const ids = await ev(() => illy.find({ type: 'path' }));

  const r = await page.evaluate((ids) => {
    const out = {};
    out.weight = illy.selectSame([ids[0]], { attribute: 'strokeWeight' }).length;
    out.fill = illy.selectSame([ids[0]], { attribute: 'fill' }).length;
    out.shape = illy.selectSame([ids[0]], { attribute: 'shape' }).length;
    out.opacity = illy.selectSame([ids[3]], { attribute: 'opacity' }).length;
    out.blend = illy.selectSame([ids[3]], { attribute: 'blend' }).length;
    out.fillStroke = illy.selectSame([ids[0]], { attribute: 'fillStroke' }).length;
    /* 여러 개를 골라 두면 그 값들이 모두 기준이 된다 */
    out.multi = illy.selectSame([ids[0], ids[2]], { attribute: 'strokeWeight' }).length;
    return out;
  }, ids);
  if (r.weight !== 2) throw new Error('획 두께 3 = ' + r.weight);
  if (r.fill !== 2) throw new Error('빨강 칠 = ' + r.fill);
  if (r.shape !== 2) throw new Error('사각형 = ' + r.shape);
  if (r.opacity !== 1) throw new Error('불투명도 0.5 = ' + r.opacity);
  if (r.blend !== 1) throw new Error('multiply = ' + r.blend);
  if (r.fillStroke !== 1) throw new Error('칠+획 완전 일치 = ' + r.fillStroke);
  if (r.multi !== 3) throw new Error('두께 3 또는 1 = ' + r.multi);

  /* 잠긴/숨긴 오브젝트는 걸리지 않는다 */
  const locked = await page.evaluate((ids) => {
    illy.set(ids[1], { locked: true });
    const n = illy.selectSame([ids[0]], { attribute: 'strokeWeight' }).length;
    illy.set(ids[1], { locked: false });
    return n;
  }, ids);
  if (locked !== 1) throw new Error('잠긴 것이 선택됨=' + locked);
  return `두께 ${r.weight} · 칠 ${r.fill} · 도형 ${r.shape} · 불투명도 ${r.opacity} · 혼합 ${r.blend} · 다중 기준 ${r.multi} · 잠금 제외`;
});

await check('선택 > 오브젝트 · 메뉴의 동일/오브젝트 서브메뉴', async () => {
  const r = await ev(() => {
    illy.text({ x: 300, y: 100, text: '가나다', size: 20 });
    return {
      texts: illy.selectObjects({ kind: 'textObjects' }).length,
      layer: illy.selectObjects({ kind: 'sameLayer' }).length,
      brush: illy.selectObjects({ kind: 'brushStrokes' }).length
    };
  });
  if (r.texts !== 1) throw new Error('텍스트 오브젝트=' + r.texts);
  if (r.layer !== 5) throw new Error('같은 레이어=' + r.layer);
  if (r.brush !== 0) throw new Error('브러시 획=' + r.brush);

  /* 메뉴에 서브메뉴가 뜨고, 항목을 눌러 실제로 선택이 바뀐다
     (메뉴는 열릴 때 사용 가능 여부를 다시 따지므로 먼저 기준을 골라 둔다) */
  await ev(() => illy.select(illy.find({ type: 'path' })[0]));
  const menuIdx = await ev(() => AI.commands.MENUS.findIndex(m => m.title === '선택'));
  await page.click(`#menus .menu-title >> nth=${menuIdx}`);
  await page.waitForSelector('.menubar-pop .mi.has-sub');
  const subs = await page.$$eval('.menubar-pop .mi.has-sub', els => els.map(e => e.textContent.replace('›', '').trim()));
  if (subs.join(',') !== '동일,오브젝트') throw new Error('서브메뉴=' + subs);

  await page.hover('.menubar-pop .mi.has-sub >> nth=0');
  await page.waitForTimeout(150);
  const pops = await page.$$('.menubar-pop');
  if (pops.length < 2) throw new Error('서브메뉴가 열리지 않음 (' + pops.length + ')');
  const items = await page.$$eval('.menubar-pop >> nth=1 >> .mi', els => els.map(e => e.textContent.trim()));
  if (items.indexOf('획 두께') < 0) throw new Error('서브 항목=' + items);

  await page.click('.menubar-pop >> nth=1 >> .mi:has-text("획 두께")');
  await page.waitForTimeout(100);
  const sel = await ev(() => AI.app.sel.length);
  const closed = await page.$$('.menubar-pop');
  if (sel !== 2) throw new Error('서브메뉴 실행 결과=' + sel);
  if (closed.length) throw new Error('메뉴가 닫히지 않음');
  return `텍스트 ${r.texts} · 레이어 ${r.layer} · 서브메뉴 ${subs.join('/')} · 항목 ${items.length}개 · 클릭 실행 ${sel}개 선택`;
});

/* ---------------- 문자 · 단락 스타일 ---------------- */
await check('문자 스타일 — 걸어 두면 고칠 때 함께 바뀐다 · 재정의 표시', async () => {
  await ev(() => {
    const app = AI.app;
    while (illy.documents().length > 1) AI.docs.close(app, illy.documents().length - 1, true);
    app.setDoc(AI.model.newDoc(400, 400));
    app.history.reset(app.doc, '새 문서');
    illy.text({ x: 20, y: 40, text: '제목', size: 32, weight: 700 });
    illy.text({ x: 20, y: 100, text: '본문', size: 12 });
  });
  const ids = await ev(() => illy.find({ type: 'text' }));
  const [a, b2] = ids;

  const made = await page.evaluate(([a, b2]) => {
    illy.select([a]);
    illy.addTextStyle({ kind: 'char', name: '제목 스타일' });
    illy.applyTextStyle([b2], { kind: 'char', style: '제목 스타일' });
    return { size: illy.get(b2).text.size, weight: illy.get(b2).text.weight };
  }, [a, b2]);
  if (made.size !== 32 || made.weight !== 700) throw new Error('적용=' + JSON.stringify(made));

  /* 스타일을 고치면 걸린 텍스트가 모두 따라 바뀐다 */
  const upd = await page.evaluate(([a, b2]) => {
    const n = illy.updateTextStyle({ kind: 'char', style: '제목 스타일', size: 40 });
    return { n, sizes: [illy.get(a).text.size, illy.get(b2).text.size] };
  }, [a, b2]);
  if (upd.n !== 2 || upd.sizes.join(',') !== '40,40') throw new Error('갱신=' + JSON.stringify(upd));

  /* 텍스트를 직접 고치면 재정의(+) 로 표시된다 */
  const over = await page.evaluate(([a, b2]) => {
    illy.set(b2, { size: 99 });
    illy.select([b2]);
    AI.ui.syncAll(AI.app);
    AI.ui.showPanel('styles');
    return {
      flag: AI.styles.hasOverride(AI.app.doc, AI.model.find(AI.app.doc, b2), 'char'),
      mark: !!document.querySelector('#sty-char .list-row.on .ovr'),
      rows: document.querySelectorAll('#sty-char .list-row').length
    };
  }, [a, b2]);
  if (!over.flag || !over.mark) throw new Error('재정의 표시=' + JSON.stringify(over));
  if (over.rows !== 1) throw new Error('패널 행=' + over.rows);

  /* 스타일 재정의: 지금 텍스트의 서식을 스타일의 새 정의로 */
  const redef = await page.evaluate(([a, b2]) => {
    AI.commands.run('redefineStyle');
    return {
      sizes: [illy.get(a).text.size, illy.get(b2).text.size],
      attr: illy.textStyles({ kind: 'char' })[0].attrs.size,
      mark: !!document.querySelector('#sty-char .list-row.on .ovr')
    };
  }, [a, b2]);
  if (redef.sizes.join(',') !== '99,99' || redef.attr !== 99) throw new Error('재정의=' + JSON.stringify(redef));
  if (redef.mark) throw new Error('재정의 후에도 + 가 남아 있음');
  return `2개 텍스트에 스타일 · 32→40 동시 반영 · 재정의 + 표시 · 재정의로 99 확정`;
});

await check('단락 스타일 · 패널에서 만들고 적용 · 연결 끊기', async () => {
  const r = await ev(() => {
    const app = AI.app;
    illy.select(illy.find({ type: 'text' }));
    AI.ui.showPanel('styles');
    /* 패널의 [새로] 버튼 — 선택한 텍스트의 서식으로 단락 스타일을 만든다 */
    document.querySelector('#p-styles [data-sty="para:new"]').click();
    const first = illy.find({ type: 'text' })[0];
    illy.updateTextStyle({ kind: 'para', style: illy.textStyles({ kind: 'para' })[0].name, align: 'center' });
    return {
      styles: illy.textStyles({ kind: 'para' }).map(s => s.name + ':' + s.used),
      aligns: illy.find({ type: 'text' }).map(id => illy.get(id).text.align).join(','),
      rows: document.querySelectorAll('#sty-para .list-row').length
    };
  });
  if (r.styles.length !== 1 || !/:2$/.test(r.styles[0])) throw new Error('단락 스타일=' + JSON.stringify(r.styles));
  if (r.aligns !== 'center,center') throw new Error('정렬 반영=' + r.aligns);
  if (r.rows !== 1) throw new Error('패널 행=' + r.rows);

  /* 연결 끊기 — 서식은 남고 연결만 사라진다 */
  const un = await ev(() => {
    document.querySelector('#p-styles [data-sty="para:unlink"]').click();
    const ids = illy.find({ type: 'text' });
    return {
      linked: ids.map(id => !!AI.model.find(AI.app.doc, id).text.paraStyle).join(','),
      aligns: ids.map(id => illy.get(id).text.align).join(','),
      used: illy.textStyles({ kind: 'para' })[0].used
    };
  });
  if (un.linked !== 'false,false') throw new Error('연결 끊기 실패=' + un.linked);
  if (un.aligns !== 'center,center') throw new Error('서식이 함께 사라짐=' + un.aligns);
  if (un.used !== 0) throw new Error('사용 수=' + un.used);

  /* 저장·불러오기에도 스타일이 남는다 */
  const rt = await ev(() => {
    const json = illy.toJSON();
    illy.loadJSON({ json });
    return illy.textStyles({ kind: 'char' }).length + ',' + illy.textStyles({ kind: 'para' }).length;
  });
  if (rt !== '1,1') throw new Error('저장 왕복=' + rt);
  return `패널에서 생성 · 2개에 적용 · 정렬 동시 반영 · 연결 끊어도 서식 유지 · 저장 왕복 ${rt}`;
});

/* ---------------- 대지별 내보내기 ---------------- */
await check('대지별 내보내기 — 대지마다 파일 하나 · 대지 이름이 파일 이름에', async () => {
  await ev(() => {
    const app = AI.app;
    while (illy.documents().length > 1) AI.docs.close(app, illy.documents().length - 1, true);
    app.setDoc(AI.model.newDoc(200, 200));
    app.history.reset(app.doc, '새 문서');
    app.doc.name = '책';
    app.doc.artboards[0].name = '표지';
    illy.rect({ x: 20, y: 20, width: 100, height: 100, fill: '#ff0000' });
    illy.addArtboard({ width: 300, height: 150, name: '내지' });
    illy.rect({ x: 250, y: 20, width: 60, height: 60, fill: '#00ff00' });
  });
  await refreshBox();

  /* 자동화 경로: 대지마다 결과가 하나씩 */
  const api = await ev(() => {
    const svgs = illy.exportArtboards({ format: 'svg' });
    const one = illy.exportArtboards({ format: 'png', scale: 1, artboards: [1] });
    return {
      n: svgs.length,
      names: svgs.map(o => o.name),
      /* 각 SVG 는 자기 대지 영역만 담는다 */
      boxes: svgs.map(o => (o.svg.match(/viewBox="([^"]*)"/) || [])[1]),
      colors: svgs.map(o => (o.svg.match(/fill="(#[0-9a-f]{6})"/) || [])[1]),
      png: one.length + ':' + one[0].name
    };
  });
  if (api.n !== 2) throw new Error('대지 수=' + api.n);
  if (api.names.join(',') !== '표지,내지') throw new Error('이름=' + api.names);
  if (api.boxes[0] !== '0 0 200 200' || api.boxes[1] !== '240 0 300 150') throw new Error('viewBox=' + JSON.stringify(api.boxes));
  if (api.png !== '1:내지') throw new Error('대지 지정 내보내기=' + api.png);

  /* 두 번째 대지 PNG 에 실제로 초록 사각형이 찍혔는지 픽셀로 확인 */
  const px = await ev(() => {
    const url = illy.exportArtboards({ format: 'png', scale: 1, artboards: [1] })[0].png;
    return new Promise(res => {
      const im = new Image();
      im.onload = () => {
        const cv = document.createElement('canvas');
        cv.width = im.width; cv.height = im.height;
        const c = cv.getContext('2d');
        c.drawImage(im, 0, 0);
        const d = c.getImageData(20, 40, 1, 1).data;   /* 대지 로컬 (250,20)~(310,80) 안쪽 */
        return res([im.width, im.height, d[0], d[1], d[2]].join(','));
      };
      im.src = url;
    });
  });
  if (px !== '300,150,0,255,0') throw new Error('PNG 픽셀=' + px);

  /* GUI 경로: 대화상자 → 대지 수만큼 파일이 내려온다 */
  await ev(() => AI.commands.run('exportArtboards'));
  await page.waitForSelector('.dlg');
  await page.selectOption('#dlgf-format', 'svg');
  const info = await page.textContent('.dlg-info');
  const dl = [];
  page.on('download', d => dl.push(d.suggestedFilename()));
  await page.click('.dlg-btn:has-text("확인")');
  await page.waitForTimeout(600);
  if (dl.length !== 2) throw new Error('내려받은 파일 수=' + dl.length + ' (' + dl + ')');
  const names = await ev(() => AI.io.lastExportNames.join(','));
  if (names !== '책-표지.svg,책-내지.svg') throw new Error('파일 이름=' + names);
  if (info.indexOf('2개 파일') < 0) throw new Error('안내 문구=' + info);
  return `SVG ${api.n}개 · 각자 자기 대지 영역 · PNG 픽셀 검증 · 파일 ${names}`;
});

/* ---------------- 자동 저장 · 복구 ----------------
   (페이지를 새로 고치므로 다른 테스트 뒤에 둔다) */
await check('자동 저장 · 복구 — 새로 고쳐도 작업이 살아남는다', async () => {
  const wrote = await ev(() => {
    const app = AI.app;
    while (illy.documents().length > 1) AI.docs.close(app, illy.documents().length - 1, true);
    app.setDoc(AI.model.newDoc(400, 400));
    app.history.reset(app.doc, '새 문서');
    app.doc.name = '작업중';
    illy.rect({ x: 10, y: 10, width: 100, height: 100, fill: '#ff0000' });
    illy.ellipse({ x: 150, y: 20, width: 80, height: 80, fill: '#0000ff' });
    app.dirty = true;
    return { ok: AI.autosave.save(app, true), has: !!localStorage.getItem(AI.autosave.KEY) };
  });
  if (!wrote.ok || !wrote.has) throw new Error('자동 저장 실패=' + JSON.stringify(wrote));

  /* 브라우저가 죽었다 살아난 것과 같은 상황 */
  await page.reload({ waitUntil: 'load' });
  await page.waitForSelector('.dlg-title', { timeout: 3000 });
  const title = await page.textContent('.dlg-title');
  const body = await page.textContent('.dlg-body');
  if (title !== '문서 복구') throw new Error('대화상자=' + title);
  if (body.indexOf('작업중') < 0) throw new Error('문서 이름이 안 보임');

  await page.click('.dlg-btn:has-text("복구")');
  await page.waitForTimeout(150);
  const r = await ev(() => ({
    docs: illy.documents().map(d => d.name + ':' + d.objects),
    modified: illy.documents()[0].modified,
    left: localStorage.getItem(AI.autosave.KEY),
    fills: AI.app.doc.layers[0].children.map(c => c.fill.color).join(',')
  }));
  if (r.docs.length !== 1 || r.docs[0] !== '작업중 [복구됨]:2') throw new Error('복구 결과=' + JSON.stringify(r.docs));
  if (!r.modified) throw new Error('복구본은 아직 저장되지 않은 상태여야 한다');
  if (r.left) throw new Error('복구 후 기록이 남음');
  if (r.fills !== '#ff0000,#0000ff') throw new Error('칠 색이 안 살아남음=' + r.fills);

  /* 다시 새로 고치면 더 묻지 않는다 (복구본은 dirty 지만 기록은 지워졌다) */
  await ev(() => { AI.autosave.clear(); AI.app.dirty = false; AI.docs.current(AI.app).dirty = false; });
  await page.reload({ waitUntil: 'load' });
  await page.waitForTimeout(400);
  const again = await page.$('.dlg-title');
  if (again) throw new Error('복구할 게 없는데 다시 물어봄');
  await refreshBox();
  return `2개 오브젝트 · 색상 유지 · "작업중 [복구됨]" · 기록 정리`;
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
