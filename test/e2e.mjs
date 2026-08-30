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
  return `${title} · FHD ${w1} → 세로 ${w2} · ${doc.w}×${doc.h}`;
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
      panel: document.querySelectorAll('#fx-list .fx-row').length
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
  await page.waitForSelector('#fx-list .fx-del');
  await page.click('#fx-list .fx-del');
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
  await page.selectOption('#sk-a2', 'arrow');
  await page.waitForTimeout(60);
  await page.fill('#sk-ascale', '150');
  await page.press('#sk-ascale', 'Enter');
  await page.waitForTimeout(60);
  await page.click('#sk-aswap');
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
  const rows0 = await ev(() => document.querySelectorAll('#p-artboards .ab-row').length);
  await page.click('#p-artboards [data-abcmd="newArtboard"]');
  await page.waitForTimeout(80);
  const rows1 = await ev(() => document.querySelectorAll('#p-artboards .ab-row').length);
  await ev(() => { AI.sel.set(AI.app, [AI.app.doc.layers[0].children[0]]); });
  await page.click('#p-artboards [data-abcmd="fitArtboardToSelection"]');
  await page.waitForTimeout(80);
  const fit = await ev(() => {
    const ab = AI.app.doc.artboards[AI.app.doc.activeArtboard];
    return [ab.x, ab.y, ab.w, ab.h].map(v => Math.round(v)).join(',');
  });
  await ev(() => { AI.edit.rearrangeArtboards(AI.app, 2, 20); });
  const arranged = await ev(() => AI.app.doc.artboards.map(a => Math.round(a.x) + ',' + Math.round(a.y)).join(' '));
  const active = await ev(() => document.querySelectorAll('#p-artboards .ab-row.on').length);
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

/* ---------------- 결과 ---------------- */
console.log('\n=== Illymolly E2E ===');
for (const [n, s, d] of results) console.log(`${s === 'OK' ? '✔' : '✘'} ${n}${d ? ' — ' + d : ''}`);
const failed = results.filter(r => r[1] === 'FAIL').length;
console.log(`\n${results.length - failed}/${results.length} 통과, 콘솔 오류 ${errors.length}건`);
errors.slice(0, 10).forEach(e => console.log('  ' + e));

await browser.close();
server.close();
process.exit(failed || errors.length ? 1 : 0);
