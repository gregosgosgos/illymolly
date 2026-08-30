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

/* ---------------- 결과 ---------------- */
console.log('\n=== Illymolly E2E ===');
for (const [n, s, d] of results) console.log(`${s === 'OK' ? '✔' : '✘'} ${n}${d ? ' — ' + d : ''}`);
const failed = results.filter(r => r[1] === 'FAIL').length;
console.log(`\n${results.length - failed}/${results.length} 통과, 콘솔 오류 ${errors.length}건`);
errors.slice(0, 10).forEach(e => console.log('  ' + e));

await browser.close();
server.close();
process.exit(failed || errors.length ? 1 : 0);
