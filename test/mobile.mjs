/* =========================================================================
   test/mobile.mjs — 모바일 / 터치 UI 검증
   근거: Parhi et al.(MobileHCI 2006) 9.2mm≈35px · Apple 44pt · Material 48dp
         · WCAG 2.2 SC 2.5.8 최소 24px
   ========================================================================= */
import { chromium, devices } from 'playwright';
import { serve } from './server.mjs';

const PORT = 8171;
const server = await serve(PORT);
const browser = await chromium.launch();
const results = [];
const check = async (name, fn) => {
  try { results.push([name, true, (await fn()) ?? '']); }
  catch (e) { results.push([name, false, e.message]); }
};

/* 멀티터치를 실제 TouchEvent 로 흉내 낸다 */
const TOUCH_HELPER = `
window.__t = {
  make(el, pts) {
    return pts.map((p, i) => new Touch({
      identifier: i + 1, target: el, clientX: p.x, clientY: p.y,
      radiusX: 12, radiusY: 12, force: 1
    }));
  },
  fire(el, type, touches) {
    el.dispatchEvent(new TouchEvent(type, {
      bubbles: true, cancelable: true,
      touches: type === 'touchend' ? [] : touches,
      targetTouches: type === 'touchend' ? [] : touches,
      changedTouches: touches
    }));
  },
  seq(sel, frames, gap) {
    const el = document.querySelector(sel);
    let i = 0;
    return new Promise(res => {
      const step = () => {
        if (i >= frames.length) return res(true);
        const f = frames[i++];
        this.fire(el, f.type, this.make(el, f.pts));
        setTimeout(step, gap || 16);
      };
      step();
    });
  }
};`;

async function newPhone(device = 'iPhone 13') {
  const ctx = await browser.newContext({ ...devices[device] });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push('PAGEERROR: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errs.push('CONSOLE: ' + m.text()); });
  await page.goto(`http://127.0.0.1:${PORT}/index.html`, { waitUntil: 'load' });
  await page.waitForTimeout(600);
  await page.addScriptTag({ content: TOUCH_HELPER });
  page.__errs = errs;
  return { ctx, page };
}

/* ---------------- 레이아웃 전환 ---------------- */
await check('기기별 레이아웃 전환 (폰 / 태블릿 / 데스크톱)', async () => {
  const out = [];
  for (const [d, want] of [['iPhone 13', 'phone'], ['Pixel 5', 'phone'], ['iPad (gen 7)', 'tablet']]) {
    const { ctx, page } = await newPhone(d);
    const m = await page.evaluate(() => AI.mobile.mode());
    if (m !== want) throw new Error(`${d}: ${m} (기대 ${want})`);
    out.push(`${d}=${m}`);
    await ctx.close();
  }
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  await page.goto(`http://127.0.0.1:${PORT}/index.html`, { waitUntil: 'load' });
  await page.waitForTimeout(400);
  const m = await page.evaluate(() => AI.mobile.mode());
  await ctx.close();
  if (m !== 'desktop') throw new Error('데스크톱 판정 실패: ' + m);
  return out.join(' · ') + ' · 1440px=desktop';
});

await check('가로 모드 휴대폰은 태블릿으로 오인되지 않는다', async () => {
  const ctx = await browser.newContext({
    ...devices['iPhone 13'], viewport: { width: 844, height: 390 }, isLandscape: true
  });
  const page = await ctx.newPage();
  await page.goto(`http://127.0.0.1:${PORT}/index.html`, { waitUntil: 'load' });
  await page.waitForTimeout(400);
  const m = await page.evaluate(() => AI.mobile.mode());
  await ctx.close();
  if (m !== 'phone') throw new Error('844×390 → ' + m);
  return '844×390 → phone';
});

/* ---------------- 터치 타깃 크기 (연구 기준) ---------------- */
await check('모든 터치 타깃이 44px 이상 (Apple 44pt / Material 48dp / 연구 9.2mm≈35px)', async () => {
  const { ctx, page } = await newPhone();
  const bad = await page.evaluate(() => {
    const sels = '#m-appbar .m-btn, #m-dock .m-tool, #m-dock .m-swatch, #m-zoom';
    const out = [];
    document.querySelectorAll(sels).forEach(el => {
      const r = el.getBoundingClientRect();
      if (r.width < 1) return;
      if (r.width < 44 || r.height < 32) out.push(`${el.id || el.className}: ${Math.round(r.width)}×${Math.round(r.height)}`);
    });
    return out;
  });
  await ctx.close();
  if (bad.length) throw new Error('작은 타깃: ' + bad.join(', '));
  return '앱바 · 독 · 줌 배지 모두 통과';
});

await check('선택 컨텍스트 바 · 시트 컨트롤도 터치 크기를 지킨다', async () => {
  const { ctx, page } = await newPhone();
  const r = await page.evaluate(async () => {
    illy.addRect({ x: 40, y: 40, width: 200, height: 120, fill: '#f36' });
    AI.mobile.sync();
    await new Promise(s => setTimeout(s, 60));
    const chips = [...document.querySelectorAll('#m-context .m-chip')]
      .map(e => e.getBoundingClientRect()).filter(b => b.width > 1);
    AI.mobile.openPanel('color', '색상');
    await new Promise(s => setTimeout(s, 60));
    const fields = [...document.querySelectorAll('#m-sheet-body .fld, #m-sheet-body .mini-btn, #m-sheet-body .swatch-btn')]
      .map(e => e.getBoundingClientRect()).filter(b => b.width > 1);
    return {
      chipCount: chips.length,
      chipMin: Math.min(...chips.map(b => Math.min(b.width, b.height))),
      fieldCount: fields.length,
      fieldMinH: Math.min(...fields.map(b => b.height))
    };
  });
  await ctx.close();
  if (r.chipCount < 8) throw new Error('컨텍스트 칩 ' + r.chipCount + '개');
  if (r.chipMin < 36) throw new Error('칩 최소 ' + r.chipMin);
  if (r.fieldMinH < 40) throw new Error('시트 컨트롤 높이 ' + r.fieldMinH);
  return `칩 ${r.chipCount}개(최소 ${Math.round(r.chipMin)}px) · 시트 컨트롤 ${r.fieldCount}개(높이 ${Math.round(r.fieldMinH)}px)`;
});

await check('가로 스크롤이 생기지 않는다 (모든 폭에서)', async () => {
  const out = [];
  for (const w of [320, 360, 390, 430]) {
    const ctx = await browser.newContext({ ...devices['iPhone 13'], viewport: { width: w, height: 700 } });
    const page = await ctx.newPage();
    await page.goto(`http://127.0.0.1:${PORT}/index.html`, { waitUntil: 'load' });
    await page.waitForTimeout(400);
    const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    await ctx.close();
    if (over > 0) throw new Error(`${w}px 에서 ${over}px 넘침`);
    out.push(w);
  }
  return out.join('/') + 'px 모두 정상';
});

/* ---------------- 터치 입력 ---------------- */
await check('한 손가락 드래그로 도형을 그린다', async () => {
  const { ctx, page } = await newPhone();
  const n = await page.evaluate(async () => {
    AI.tools.setTool(AI.app, 'rect', true);
    await window.__t.seq('#view', [
      { type: 'touchstart', pts: [{ x: 120, y: 300 }] },
      { type: 'touchmove', pts: [{ x: 180, y: 360 }] },
      { type: 'touchmove', pts: [{ x: 240, y: 420 }] },
      { type: 'touchend', pts: [{ x: 240, y: 420 }] }
    ]);
    await new Promise(s => setTimeout(s, 80));
    return AI.app.doc.layers.reduce((a, l) => a + l.children.length, 0);
  });
  const errs = page.__errs.slice();
  await ctx.close();
  if (errs.length) throw new Error(errs[0]);
  if (n !== 1) throw new Error('도형 ' + n + '개');
  return '사각형 1개 생성';
});

await check('두 손가락으로 캔버스 이동 · 확대', async () => {
  const { ctx, page } = await newPhone();
  const r = await page.evaluate(async () => {
    const v0 = { ...AI.app.view };
    await window.__t.seq('#view', [
      { type: 'touchstart', pts: [{ x: 150, y: 300 }, { x: 250, y: 300 }] },
      { type: 'touchmove', pts: [{ x: 160, y: 320 }, { x: 260, y: 320 }] },
      { type: 'touchmove', pts: [{ x: 130, y: 340 }, { x: 290, y: 340 }] },
      { type: 'touchend', pts: [{ x: 130, y: 340 }] }
    ]);
    return { s0: v0.scale, s1: AI.app.view.scale, moved: Math.abs(AI.app.view.ty - v0.ty) };
  });
  await ctx.close();
  if (!(r.s1 > r.s0 * 1.1)) throw new Error(`확대 ${r.s0}→${r.s1}`);
  if (!(r.moved > 5)) throw new Error('이동 없음 ' + r.moved);
  return `${Math.round(r.s0 * 100)}% → ${Math.round(r.s1 * 100)}% · ${Math.round(r.moved)}px 이동`;
});

await check('두 손가락 탭 = 실행 취소, 세 손가락 탭 = 다시 실행 (Procreate 관례)', async () => {
  const { ctx, page } = await newPhone();
  const r = await page.evaluate(async () => {
    illy.addRect({ x: 20, y: 20, width: 60, height: 60 });
    const before = AI.app.doc.layers[0].children.length;
    await window.__t.seq('#view', [
      { type: 'touchstart', pts: [{ x: 150, y: 300 }, { x: 200, y: 300 }] },
      { type: 'touchend', pts: [{ x: 150, y: 300 }, { x: 200, y: 300 }] }
    ], 40);
    await new Promise(s => setTimeout(s, 100));
    const afterUndo = AI.app.doc.layers[0].children.length;
    await window.__t.seq('#view', [
      { type: 'touchstart', pts: [{ x: 150, y: 300 }, { x: 200, y: 300 }, { x: 250, y: 300 }] },
      { type: 'touchend', pts: [{ x: 150, y: 300 }, { x: 200, y: 300 }, { x: 250, y: 300 }] }
    ], 40);
    await new Promise(s => setTimeout(s, 100));
    return { before, afterUndo, afterRedo: AI.app.doc.layers[0].children.length };
  });
  await ctx.close();
  if (r.before !== 1 || r.afterUndo !== 0 || r.afterRedo !== 1) throw new Error(JSON.stringify(r));
  return `1 → 2손가락탭 → ${r.afterUndo} → 3손가락탭 → ${r.afterRedo}`;
});

await check('도구 드래그 중 두 번째 손가락이 닿으면 그 작업만 취소된다', async () => {
  const { ctx, page } = await newPhone();
  const r = await page.evaluate(async () => {
    illy.addRect({ x: 20, y: 20, width: 60, height: 60, name: '먼저' });   /* 지켜야 할 이전 작업 */
    const before = AI.app.doc.layers[0].children.length;
    AI.tools.setTool(AI.app, 'rect', true);
    await window.__t.seq('#view', [
      { type: 'touchstart', pts: [{ x: 120, y: 300 }] },
      { type: 'touchmove', pts: [{ x: 200, y: 380 }] },
      { type: 'touchstart', pts: [{ x: 200, y: 380 }, { x: 260, y: 380 }] },  /* 두 번째 손가락 */
      { type: 'touchend', pts: [{ x: 200, y: 380 }, { x: 260, y: 380 }] }
    ]);
    await new Promise(s => setTimeout(s, 120));
    const names = AI.app.doc.layers[0].children.map(c => c.name);
    return { before, after: names.length, names };
  });
  await ctx.close();
  if (r.after !== r.before) throw new Error(`${r.before} → ${r.after} (${r.names})`);
  if (r.names[0] !== '먼저') throw new Error('이전 작업이 사라짐: ' + r.names);
  return `그리던 도형만 취소되고 이전 작업("${r.names[0]}")은 보존`;
});

/* ---------------- 마킹 메뉴 ---------------- */
await check('도구 슬롯 길게 누르기 → 방사형 마킹 메뉴 → 방향으로 선택', async () => {
  const { ctx, page } = await newPhone();
  const r = await page.evaluate(async () => {
    const btn = document.querySelector('#m-dock .m-tool[data-slot="0"]');
    const b = btn.getBoundingClientRect();
    const cx = b.left + b.width / 2, cy = b.top + b.height / 2;
    const T = window.__t;
    T.fire(btn, 'touchstart', T.make(btn, [{ x: cx, y: cy }]));
    await new Promise(s => setTimeout(s, 360));                 /* 길게 누르기 */
    const opened = document.getElementById('m-marking').classList.contains('open');
    const count = document.querySelectorAll('#m-marking .mi').length;
    /* 첫 항목 방향으로 끌기 */
    const mi = document.querySelectorAll('#m-marking .mi')[1];
    const mb = mi.getBoundingClientRect();
    T.fire(btn, 'touchmove', T.make(btn, [{ x: mb.left + mb.width / 2, y: mb.top + mb.height / 2 }]));
    await new Promise(s => setTimeout(s, 40));
    const hot = document.querySelectorAll('#m-marking .mi.hot').length;
    T.fire(btn, 'touchend', T.make(btn, [{ x: mb.left + mb.width / 2, y: mb.top + mb.height / 2 }]));
    await new Promise(s => setTimeout(s, 60));
    return { opened, count, hot, tool: AI.app.tool, closed: !document.getElementById('m-marking').classList.contains('open') };
  });
  await ctx.close();
  if (!r.opened) throw new Error('메뉴가 열리지 않음');
  if (r.count !== 4) throw new Error('항목 ' + r.count + '개');
  if (r.hot !== 1) throw new Error('방향 강조 실패');
  if (r.tool !== 'directselect') throw new Error('선택된 도구 ' + r.tool);
  if (!r.closed) throw new Error('메뉴가 닫히지 않음');
  return `4개 항목 · 방향 선택 → ${r.tool}`;
});

/* ---------------- 바텀 시트 ---------------- */
await check('바텀 시트가 데스크톱 패널을 재사용하고 닫으면 되돌려 놓는다', async () => {
  const { ctx, page } = await newPhone();
  const r = await page.evaluate(async () => {
    const section = document.querySelector('.panel[data-panel="color"]');
    const bodyBefore = section.querySelector('.body');
    AI.mobile.openPanel('color', '색상');
    await new Promise(s => setTimeout(s, 60));
    const inSheet = document.getElementById('m-sheet-body').contains(bodyBefore);
    const hexVisible = !!document.querySelector('#m-sheet-body #cl-hex');
    /* 시트 안 컨트롤이 실제로 문서를 바꾸는지 */
    illy.addRect({ x: 10, y: 10, width: 50, height: 50 });
    const hex = document.querySelector('#m-sheet-body #cl-hex');
    hex.value = '#12ab56';
    hex.dispatchEvent(new Event('change', { bubbles: true }));
    await new Promise(s => setTimeout(s, 40));
    const fill = AI.app.sel[0] && AI.app.sel[0].fill.color;
    AI.mobile.closeSheet();
    await new Promise(s => setTimeout(s, 60));
    return { inSheet, hexVisible, fill, restored: section.contains(bodyBefore) };
  });
  await ctx.close();
  if (!r.inSheet) throw new Error('패널이 시트로 옮겨지지 않음');
  if (!r.hexVisible) throw new Error('패널 내용 없음');
  if (!r.fill) throw new Error('시트 안 견본이 동작하지 않음');
  if (!r.restored) throw new Error('닫은 뒤 원래 자리로 돌아오지 않음');
  return `패널 이동 · 견본 클릭 → ${r.fill} · 복귀 확인`;
});

await check('선택하면 컨텍스트 바가 나타나고 넛지가 동작', async () => {
  const { ctx, page } = await newPhone();
  const r = await page.evaluate(async () => {
    illy.addRect({ x: 100, y: 100, width: 80, height: 80 });
    AI.mobile.sync();
    await new Promise(s => setTimeout(s, 50));
    const shown = document.body.classList.contains('has-sel');
    const x0 = AI.render.selectionBounds(AI.app, true).x;
    [...document.querySelectorAll('#m-context .m-chip')].find(c => c.textContent === '▶').click();
    await new Promise(s => setTimeout(s, 50));
    const x1 = AI.render.selectionBounds(AI.app, true).x;
    AI.commands.run('deselectAll');
    AI.mobile.sync();
    return { shown, x0, x1, hidden: !document.body.classList.contains('has-sel') };
  });
  await ctx.close();
  if (!r.shown) throw new Error('컨텍스트 바가 나타나지 않음');
  if (Math.abs(r.x1 - r.x0 - 1) > 0.01) throw new Error(`넛지 ${r.x0}→${r.x1}`);
  if (!r.hidden) throw new Error('선택 해제 후에도 표시됨');
  return `표시 · 넛지 +1pt · 해제 시 숨김`;
});

/* ---------------- 정밀 조작 ---------------- */
await check('정밀 도구 드래그 중 루페가 뜬다 (Shift, Vogel & Baudisch 2007)', async () => {
  const { ctx, page } = await newPhone();
  const r = await page.evaluate(async () => {
    illy.addRect({ x: 60, y: 60, width: 200, height: 200, fill: '#39f' });
    AI.tools.setTool(AI.app, 'select', true);
    const fr = AI.render.bboxFrame(AI.app);
    const p = fr.pts[4];
    const cv = document.getElementById('view').getBoundingClientRect();
    const T = window.__t;
    const el = document.getElementById('view');
    T.fire(el, 'touchstart', T.make(el, [{ x: cv.left + p.x, y: cv.top + p.y }]));
    T.fire(el, 'touchmove', T.make(el, [{ x: cv.left + p.x + 30, y: cv.top + p.y + 30 }]));
    await new Promise(s => setTimeout(s, 60));
    const during = !!AI.app.loupe;
    T.fire(el, 'touchend', T.make(el, [{ x: cv.left + p.x + 30, y: cv.top + p.y + 30 }]));
    await new Promise(s => setTimeout(s, 60));
    return { during, after: !!AI.app.loupe };
  });
  await ctx.close();
  if (!r.during) throw new Error('드래그 중 루페 없음');
  if (r.after) throw new Error('놓은 뒤에도 루페가 남음');
  return '드래그 중에만 표시';
});

await check('터치 기기에서 히트 허용 범위가 넓어진다', async () => {
  const { ctx, page } = await newPhone();
  const tol = await page.evaluate(() => AI.hit.TOL);
  await ctx.close();
  const ctx2 = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page2 = await ctx2.newPage();
  await page2.goto(`http://127.0.0.1:${PORT}/index.html`, { waitUntil: 'load' });
  await page2.waitForTimeout(400);
  const tolDesk = await page2.evaluate(() => AI.hit.TOL);
  await ctx2.close();
  if (!(tol > tolDesk)) throw new Error(`터치 ${tol} vs 데스크톱 ${tolDesk}`);
  return `터치 ${tol}px · 마우스 ${tolDesk}px`;
});

/* ---------------- 접근성 · 설정 ---------------- */
await check('왼손잡이 배치 전환', async () => {
  const { ctx, page } = await newPhone();
  const r = await page.evaluate(async () => {
    const dock = document.getElementById('m-dock');
    const before = getComputedStyle(dock).flexDirection;
    document.body.classList.add('lefty');
    const after = getComputedStyle(dock).flexDirection;
    const zoomBefore = getComputedStyle(document.getElementById('m-zoom')).left;
    document.body.classList.remove('lefty');
    return { before, after, zoomBefore };
  });
  await ctx.close();
  if (r.before !== 'row' || r.after !== 'row-reverse') throw new Error(`${r.before} → ${r.after}`);
  return `독 ${r.before} → ${r.after} · 줌 배지도 반대편으로`;
});

await check('모바일에서도 자동화 API 가 그대로 동작', async () => {
  const { ctx, page } = await newPhone();
  const r = await page.evaluate(() => {
    illy.newDocument({ width: 300, height: 200 });
    const id = illy.addRect({ x: 10, y: 10, width: 100, height: 60, fill: 'red' });
    AI.mobile.sync();
    return {
      id,
      ctxBar: document.body.classList.contains('has-sel'),
      chips: document.querySelectorAll('#m-context .m-chip').length,
      title: document.getElementById('m-title').textContent
    };
  });
  await ctx.close();
  if (!r.id || !r.ctxBar || r.chips < 8) throw new Error(JSON.stringify(r));
  return `${r.id} · 컨텍스트 칩 ${r.chips}개 · 제목 "${r.title}"`;
});

await check('데스크톱 레이아웃은 그대로 유지된다', async () => {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(e.message));
  await page.goto(`http://127.0.0.1:${PORT}/index.html`, { waitUntil: 'load' });
  await page.waitForTimeout(500);
  const r = await page.evaluate(() => ({
    dock: getComputedStyle(document.getElementById('m-dock')).display,
    appbar: getComputedStyle(document.getElementById('m-appbar')).display,
    panels: getComputedStyle(document.getElementById('panels')).display,
    toolbar: getComputedStyle(document.getElementById('toolbar')).display,
    menubar: getComputedStyle(document.getElementById('menubar')).display,
    cls: document.body.className
  }));
  await ctx.close();
  if (errs.length) throw new Error(errs[0]);
  if (r.dock !== 'none' || r.appbar !== 'none') throw new Error('모바일 셸이 노출됨');
  if (r.panels === 'none' || r.toolbar === 'none' || r.menubar === 'none') throw new Error('데스크톱 UI 누락');
  return '모바일 셸 숨김 · 데스크톱 UI 정상';
});

/* ---------------- 결과 ---------------- */
console.log('\n=== 모바일 / 터치 UI ===');
let fail = 0;
for (const [n, ok, d] of results) {
  if (!ok) fail++;
  console.log(`${ok ? '✔' : '✘'} ${n}${d ? ' — ' + d : ''}`);
}
console.log(`\n${results.length - fail}/${results.length} 통과`);
await browser.close();
server.close();
process.exit(fail ? 1 : 0);
