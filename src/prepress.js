/* =========================================================================
   prepress.js — 출고(프리프레스)
   -------------------------------------------------------------------------
   그리는 것과 넘기는 것은 다른 일이다. 인쇄소 · 커팅기 · 레이저 · 실크스크린은
   그림이 아니라 규격을 본다. 색상 모드, 별색 이름, 획 두께, 도련 수치.
   이 파일이 그 규격을 담당한다.

     · CMYK      — 문서 색상 모드와 원색 분해
     · 별색      — 이름을 가진 색. 칼선 · 분판 · 브랜드색의 전제
     · 오버프린트 — 밑색을 파내지 않고 겹쳐 찍기
     · 도련·재단선 — 대지 밖으로 나가는 여분과 재단 표시
     · 프리플라이트 — 넘기기 전 마지막 검사, 그리고 자동 수정

   설계 원칙 하나: **화면에 보이는 색은 언제나 paint.color(hex) 다.**
   CMYK 와 별색은 그 옆에 붙는 정보이고, 값이 바뀌면 hex 를 다시 계산해
   맞춰 둔다. 덕분에 렌더러 · 히트 · SVG 는 아무것도 몰라도 된다.
   ========================================================================= */
(function (AI) {
  'use strict';
  var U = AI.util, Col = AI.color, Model = AI.model, M = AI.mat, R = AI.rect;
  var PP = AI.prepress = {};

  var PT_PER_MM = 72 / 25.4;   /* 1mm = 2.8346pt */
  var PT_PER_IN = 72;

  /* =====================================================================
     1. CMYK
     ---------------------------------------------------------------------
     장비 프로파일 없이 정확한 분해는 불가능하다. 여기서는 인쇄 업계가
     "프로파일 없는 변환"으로 쓰는 표준 공식을 쓴다. 목적은 정확한 색 재현이
     아니라 화면 · PDF · 검사 결과의 수치가 서로 어긋나지 않는 것이다.
     ===================================================================== */
  function c01(v) { return U.clamp((+v || 0) / 100, 0, 1); }

  PP.rgbToCmyk = function (hex) {
    var c = Col.hexToRgb(hex);
    var r = c.r / 255, g = c.g / 255, b = c.b / 255;
    var k = 1 - Math.max(r, g, b);
    if (k >= 1 - 1e-9) return { c: 0, m: 0, y: 0, k: 100 };
    var d = 1 - k;
    return {
      c: U.round(((1 - r - k) / d) * 100, 1),
      m: U.round(((1 - g - k) / d) * 100, 1),
      y: U.round(((1 - b - k) / d) * 100, 1),
      k: U.round(k * 100, 1)
    };
  };

  PP.cmykToHex = function (v) {
    if (!v) return '#000000';
    var c = c01(v.c), m = c01(v.m), y = c01(v.y), k = c01(v.k);
    return Col.rgbToHex(255 * (1 - c) * (1 - k), 255 * (1 - m) * (1 - k), 255 * (1 - y) * (1 - k));
  };

  PP.cmyk = function (c, m, y, k) {
    return { c: U.clamp(+c || 0, 0, 100), m: U.clamp(+m || 0, 0, 100), y: U.clamp(+y || 0, 0, 100), k: U.clamp(+k || 0, 0, 100) };
  };
  PP.cmykEq = function (a, b) {
    if (!a || !b) return false;
    return Math.abs(a.c - b.c) < .5 && Math.abs(a.m - b.m) < .5 && Math.abs(a.y - b.y) < .5 && Math.abs(a.k - b.k) < .5;
  };
  PP.cmykText = function (v) {
    if (!v) return '';
    return 'C' + U.round(v.c, 0) + ' M' + U.round(v.m, 0) + ' Y' + U.round(v.y, 0) + ' K' + U.round(v.k, 0);
  };
  /* 총 잉크량 — 300% 를 넘으면 마르지 않아 인쇄 사고가 난다 */
  PP.inkTotal = function (v) { return v ? U.round(v.c + v.m + v.y + v.k, 1) : 0; };

  /* 인쇄 업계가 쓰는 상용 값 */
  PP.RICH_BLACK = PP.cmyk(60, 40, 40, 100);
  PP.REGISTRATION = PP.cmyk(100, 100, 100, 100);

  /* =====================================================================
     2. 별색 (Spot)
     ---------------------------------------------------------------------
     doc.spots = [{ name, cmyk, hex, kind:'spot'|'registration' }]
     칠 · 획이 별색을 쓰면  paint.spot = 이름, paint.tint = 0~100(농도)
     ===================================================================== */
  PP.spots = function (doc) { return (doc && doc.spots) || (doc ? (doc.spots = []) : []); };

  PP.findSpot = function (doc, name) {
    if (!name) return null;
    var list = PP.spots(doc);
    for (var i = 0; i < list.length; i++) if (list[i].name === name) return list[i];
    return null;
  };

  PP.addSpot = function (doc, def) {
    if (!def || !def.name) throw new Error('별색에는 이름이 필요합니다');
    var found = PP.findSpot(doc, def.name);
    var cmyk = def.cmyk ? PP.cmyk(def.cmyk.c, def.cmyk.m, def.cmyk.y, def.cmyk.k)
      : PP.rgbToCmyk(def.hex || '#000000');
    var spot = found || { name: def.name, kind: def.kind || 'spot' };
    spot.cmyk = cmyk;
    spot.hex = def.hex || PP.cmykToHex(cmyk);
    if (def.kind) spot.kind = def.kind;
    if (!found) PP.spots(doc).push(spot);
    return spot;
  };

  PP.removeSpot = function (doc, name) {
    var list = PP.spots(doc);
    for (var i = 0; i < list.length; i++) {
      if (list[i].name === name) { list.splice(i, 1); return true; }
    }
    return false;
  };

  /* 별색 · CMYK 가 붙은 색을 hex 로 되돌려 놓는다 (화면이 늘 진실을 보게) */
  PP.resolvePaint = function (doc, paint) {
    if (!paint) return paint;
    if (paint.spot) {
      var s = PP.findSpot(doc, paint.spot);
      if (s) {
        var t = paint.tint == null ? 100 : U.clamp(paint.tint, 0, 100);
        paint.cmyk = PP.cmyk(s.cmyk.c * t / 100, s.cmyk.m * t / 100, s.cmyk.y * t / 100, s.cmyk.k * t / 100);
        paint.color = t >= 100 ? s.hex : Col.mix('#ffffff', s.hex, t / 100);
      } else {
        delete paint.spot; delete paint.tint;   /* 사라진 별색은 일반 색으로 */
      }
    } else if (paint.cmyk) {
      paint.color = PP.cmykToHex(paint.cmyk);
    }
    if (paint.stops) paint.stops.forEach(function (st) { PP.resolvePaint(doc, st); });
    return paint;
  };

  /* 문서 색상 모드에 맞춘 CMYK 값. 색을 만들 때마다 채워 넣는 대신
     필요한 곳(출력 · 검사 · 패널)에서 이걸로 물어본다 — 어디서 만든 색이든
     결과가 같아진다. */
  PP.paintCmyk = function (doc, paint) {
    if (!paint || paint.type === 'none') return null;
    if (paint.cmyk) return paint.cmyk;
    if (PP.colorMode(doc) !== 'cmyk') return null;
    return PP.rgbToCmyk(paint.color);
  };

  /* 문서 안의 모든 색에 CMYK 값을 실제로 박아 넣는다 (모드 전환 · 저장 직전) */
  PP.normalizeDoc = function (doc) {
    if (PP.colorMode(doc) !== 'cmyk') return doc;
    eachPaint(doc, function (p) {
      if (!p.spot && !p.cmyk && p.type === 'solid') p.cmyk = PP.rgbToCmyk(p.color);
      if (p.stops) p.stops.forEach(function (st) { if (!st.cmyk) st.cmyk = PP.rgbToCmyk(st.color); });
    });
    return doc;
  };

  /* 문서 전체의 색을 다시 맞춘다 — 별색 정의를 고친 뒤 부른다 */
  PP.resolveAll = function (doc) {
    eachPaint(doc, function (p) { PP.resolvePaint(doc, p); });
    return doc;
  };

  /* 칠 · 획 · 모양 겹 · 그레이디언트 색 점을 빠짐없이 훑는다 */
  function eachPaint(doc, fn) {
    Model.walk(doc, function (it) {
      itemPaints(it).forEach(fn);
    });
    /* 문서에 저장된 견본 · 스타일도 함께 */
    (doc.swatches || []).forEach(fn);
  }
  PP.eachPaint = eachPaint;

  function itemPaints(it) {
    var out = [];
    function add(p) { if (p && p.type && p.type !== 'none') out.push(p); }
    add(it.fill); add(it.stroke);
    (it.fills || []).forEach(add);
    (it.strokes || []).forEach(add);
    if (it.appearance) {
      (it.appearance.fills || []).forEach(add);
      (it.appearance.strokes || []).forEach(add);
    }
    return out;
  }
  PP.itemPaints = itemPaints;

  /* =====================================================================
     3. 문서 색상 모드
     ---------------------------------------------------------------------
     인쇄는 CMYK 를 요구하고 레이저 커팅은 RGB 를 요구한다 — 정반대다.
     그래서 모드는 문서마다 따로 둔다.
     ===================================================================== */
  PP.colorMode = function (doc) { return (doc && doc.colorMode) || 'rgb'; };

  PP.setColorMode = function (doc, mode) {
    mode = (mode === 'cmyk') ? 'cmyk' : 'rgb';
    doc.colorMode = mode;
    eachPaint(doc, function (p) {
      if (p.spot) return;                       /* 별색은 모드와 무관하게 유지 */
      if (mode === 'cmyk') { if (!p.cmyk) p.cmyk = PP.rgbToCmyk(p.color); }
      else delete p.cmyk;
    });
    return mode;
  };

  /* =====================================================================
     4. 오버프린트
     ---------------------------------------------------------------------
     it.overprint = { fill:true, stroke:false }
     미리보기는 곱하기 합성으로 흉내 낸다 (실제 RIP 과 완전히 같지는 않지만
     "밑색이 비쳐 보인다" 는 성질은 그대로 확인된다).
     ===================================================================== */
  PP.overprint = function (it) { return it && it.overprint; };
  PP.hasOverprint = function (it, which) {
    return !!(it && it.overprint && it.overprint[which]);
  };
  PP.setOverprint = function (it, which, on) {
    if (!it.overprint) it.overprint = { fill: false, stroke: false };
    it.overprint[which] = !!on;
    if (!it.overprint.fill && !it.overprint.stroke) delete it.overprint;
  };
  /* K100 검정은 관례상 오버프린트로 넘긴다 (흰 테 방지) */
  PP.isK100 = function (paint) {
    if (!paint || paint.type !== 'solid') return false;
    var v = paint.cmyk || PP.rgbToCmyk(paint.color);
    return v.k >= 99.5 && v.c < .5 && v.m < .5 && v.y < .5;
  };
  PP.isWhite = function (paint) {
    if (!paint || paint.type !== 'solid') return false;
    var v = paint.cmyk || PP.rgbToCmyk(paint.color);
    return v.c < .5 && v.m < .5 && v.y < .5 && v.k < .5;
  };

  /* =====================================================================
     5. 도련 · 재단 표시
     ===================================================================== */
  PP.bleed = function (doc) { return (doc && doc.bleed) || 0; };
  PP.setBleed = function (doc, pt) { doc.bleed = Math.max(0, +pt || 0); return doc.bleed; };
  PP.mm = function (v) { return v * PT_PER_MM; };
  PP.inch = function (v) { return v * PT_PER_IN; };

  /* 대지 + 도련 사각형 */
  PP.bleedBox = function (doc, ab) {
    var b = PP.bleed(doc);
    return { x: ab.x - b, y: ab.y - b, x2: ab.x + ab.w + b, y2: ab.y + ab.h + b };
  };
  PP.trimBox = function (ab) { return { x: ab.x, y: ab.y, x2: ab.x + ab.w, y2: ab.y + ab.h }; };

  var MARK_LAYER = '재단 표시';

  /* 재단선 · 등록마크 · 컬러바를 잠긴 레이어 하나에 만들어 둔다.
     다시 부르면 통째로 새로 만든다 — 대지가 바뀌어도 어긋나지 않게. */
  PP.addMarks = function (app, opts) {
    opts = opts || {};
    var doc = app.doc;
    var reg = PP.addSpot(doc, { name: 'Registration', cmyk: PP.REGISTRATION, kind: 'registration' });
    PP.removeMarks(app);

    var layer = Model.newLayer(MARK_LAYER);
    layer.locked = true;
    doc.layers.push(layer);

    var bleed = PP.bleed(doc);
    var len = opts.length == null ? PP.mm(4) : opts.length;   /* 마크 길이 */
    var gap = opts.gap == null ? Math.max(bleed, PP.mm(2)) : opts.gap;
    var w = opts.width == null ? 0.25 : opts.width;
    var boards = opts.all ? doc.artboards : [doc.artboards[doc.activeArtboard]];

    boards.forEach(function (ab) {
      if (!ab) return;
      var t = PP.trimBox(ab);
      /* 재단선 — 모서리마다 두 줄, 도련 바깥에서 시작한다 */
      var corners = [
        [t.x, t.y, -1, -1], [t.x2, t.y, 1, -1],
        [t.x, t.y2, -1, 1], [t.x2, t.y2, 1, 1]
      ];
      corners.forEach(function (c) {
        var x = c[0], y = c[1], sx = c[2], sy = c[3];
        line(layer, x + sx * gap, y, x + sx * (gap + len), y, w, reg);
        line(layer, x, y + sy * gap, x, y + sy * (gap + len), w, reg);
      });
      if (opts.registration !== false) {
        var cx = (t.x + t.x2) / 2, cy = (t.y + t.y2) / 2, off = gap + len / 2;
        [[cx, t.y - off], [cx, t.y2 + off], [t.x - off, cy], [t.x2 + off, cy]].forEach(function (p) {
          regMark(layer, p[0], p[1], PP.mm(2), w, reg);
        });
      }
      if (opts.colorBar !== false) colorBar(layer, t.x, t.y2 + gap + len * 0.6, PP.mm(4));
    });

    return { layer: layer.name, artboards: boards.length };
  };

  PP.removeMarks = function (app) {
    var ls = app.doc.layers;
    for (var i = ls.length - 1; i >= 0; i--) if (ls[i].name === MARK_LAYER) ls.splice(i, 1);
    if (app.doc.activeLayer >= ls.length) app.doc.activeLayer = Math.max(0, ls.length - 1);
  };
  PP.hasMarks = function (doc) {
    return doc.layers.some(function (l) { return l.name === MARK_LAYER; });
  };

  function spotPaint(spot, tint) {
    var t = tint == null ? 100 : tint;
    return {
      type: 'solid', alpha: 1, spot: spot.name, tint: t,
      cmyk: PP.cmyk(spot.cmyk.c * t / 100, spot.cmyk.m * t / 100, spot.cmyk.y * t / 100, spot.cmyk.k * t / 100),
      color: t >= 100 ? spot.hex : Col.mix('#ffffff', spot.hex, t / 100)
    };
  }
  PP.spotPaint = spotPaint;

  function line(layer, x1, y1, x2, y2, w, spot) {
    var it = Model.newPath();
    it.name = '재단선';
    it.subs = [{ closed: false, pts: [Model.pt(x1, y1), Model.pt(x2, y2)] }];
    it.fill = Col.none();
    it.stroke = Model.mkStroke(spot.hex, w);
    it.stroke.spot = spot.name; it.stroke.tint = 100; it.stroke.cmyk = spot.cmyk;
    layer.children.push(it);
    return it;
  }

  function regMark(layer, cx, cy, r, w, spot) {
    var c = Model.newEllipse(cx - r, cy - r, r * 2, r * 2);
    c.name = '등록마크';
    c.fill = Col.none();
    c.stroke = Model.mkStroke(spot.hex, w);
    c.stroke.spot = spot.name; c.stroke.tint = 100; c.stroke.cmyk = spot.cmyk;
    layer.children.push(c);
    line(layer, cx - r * 1.6, cy, cx + r * 1.6, cy, w, spot);
    line(layer, cx, cy - r * 1.6, cx, cy + r * 1.6, w, spot);
  }

  /* 컬러바 — 인쇄 농도를 눈으로 확인하는 색 조각들 */
  function colorBar(layer, x, y, size) {
    var bars = [
      PP.cmyk(100, 0, 0, 0), PP.cmyk(0, 100, 0, 0), PP.cmyk(0, 0, 100, 0), PP.cmyk(0, 0, 0, 100),
      PP.cmyk(50, 0, 0, 0), PP.cmyk(0, 50, 0, 0), PP.cmyk(0, 0, 50, 0), PP.cmyk(0, 0, 0, 50)
    ];
    bars.forEach(function (v, i) {
      var r = Model.newRect(x + i * size, y, size, size);
      r.name = '컬러바';
      r.fill = { type: 'solid', color: PP.cmykToHex(v), alpha: 1, cmyk: v };
      r.stroke = Model.defaultStroke();
      layer.children.push(r);
    });
  }

  /* =====================================================================
     6. 업종 프리셋
     ---------------------------------------------------------------------
     각 업종이 요구하는 규격 한 벌. 사람은 메뉴 한 번, AI 는 호출 한 번으로
     문서를 그 업종 규격에 맞춘다.
     ===================================================================== */
  PP.PRESETS = {
    print: {
      label: '인쇄 (오프셋 · 디지털)',
      colorMode: 'cmyk',
      bleedMm: 3,
      minStroke: 0.5,          /* pt — 이보다 얇으면 인쇄에서 사라진다 */
      minImageDpi: 300,
      needOutlines: true,
      maxInk: 300,
      note: '도련 3mm · 글꼴 윤곽선 · 이미지 300dpi · 최소 획 0.5pt'
    },
    cut: {
      label: '커팅 플로터 (스티커 · 시트지)',
      colorMode: 'cmyk',
      bleedMm: 3,
      minStroke: 0.5,
      minImageDpi: 150,
      needOutlines: true,
      cutSpot: 'CutContour',
      cutStroke: 0.25,
      note: '칼선은 별색 CutContour · 칠 없음 · 획 0.25pt'
    },
    laser: {
      label: '레이저 커팅 · 각인',
      colorMode: 'rgb',        /* 인쇄와 정반대 — 장비가 RGB 로 읽는다 */
      bleedMm: 0,
      exactStroke: 0.001,
      needOutlines: true,
      noWidthProfile: true,
      palette: [
        { hex: '#ff0000', role: '절단' },
        { hex: '#0000ff', role: '접기(스코어)' },
        { hex: '#000000', role: '각인' }
      ],
      note: 'RGB · 절단 빨강 · 접기 파랑 · 각인 검정 · 획 0.001pt'
    },
    screen: {
      label: '실크스크린 (분판)',
      colorMode: 'cmyk',
      bleedMm: 0,
      minStroke: 0.75,
      minImageDpi: 300,
      needOutlines: true,
      spotOnly: true,          /* 색마다 스크린 한 장 — 별색이어야 분판이 된다 */
      noGradient: true,        /* 그라데이션은 하프톤으로 변환해서 넘겨야 한다 */
      maxSpots: 8,
      note: '색마다 별색 · 그라데이션 금지(하프톤 변환) · 이미지 300dpi'
    }
  };

  PP.preset = function (name) { return PP.PRESETS[name] || PP.PRESETS.print; };

  /* 문서를 업종 규격에 맞춰 세팅한다 (색상 모드 · 도련 · 필요한 별색) */
  PP.applyPreset = function (app, name) {
    var p = PP.preset(name), doc = app.doc, done = [];
    if (PP.colorMode(doc) !== p.colorMode) {
      PP.setColorMode(doc, p.colorMode);
      done.push('색상 모드 → ' + p.colorMode.toUpperCase());
    }
    var want = PP.mm(p.bleedMm || 0);
    if (Math.abs(PP.bleed(doc) - want) > 0.01) {
      PP.setBleed(doc, want);
      done.push('도련 → ' + (p.bleedMm || 0) + 'mm');
    }
    if (p.cutSpot && !PP.findSpot(doc, p.cutSpot)) {
      PP.addSpot(doc, { name: p.cutSpot, cmyk: PP.cmyk(0, 100, 0, 0), hex: '#00a651' });
      done.push('별색 ' + p.cutSpot + ' 등록');
    }
    doc.intent = name;
    return { intent: name, label: p.label, note: p.note, changed: done };
  };

  /* 선택한 패스를 칼선으로 바꾼다 — 커팅 업종의 핵심 동작 */
  PP.makeCutLine = function (app, items, opts) {
    opts = opts || {};
    var doc = app.doc;
    var name = opts.spot || 'CutContour';
    var spot = PP.findSpot(doc, name) || PP.addSpot(doc, { name: name, cmyk: PP.cmyk(0, 100, 0, 0), hex: '#00a651' });
    var w = opts.width == null ? 0.25 : opts.width;
    var n = 0;
    items.forEach(function (it) {
      if (it.type !== 'path') return;
      it.fill = Col.none();
      delete it.fills; delete it.strokes;
      it.stroke = Model.mkStroke(spot.hex, w);
      it.stroke.spot = spot.name; it.stroke.tint = 100; it.stroke.cmyk = spot.cmyk;
      delete it.stroke.widthProfile;
      delete it.stroke.brush;
      if (it.name === '패스' || !it.name) it.name = '칼선';
      n++;
    });
    return { count: n, spot: name };
  };

  /* =====================================================================
     7. 이미지 크기 — 파일 헤더만 읽는다
     ---------------------------------------------------------------------
     브라우저 밖(Node)에서도 해상도를 검사할 수 있어야 한다. 그래서
     디코더를 쓰지 않고 PNG · JPEG · GIF 헤더에서 픽셀 크기만 뽑는다.
     ===================================================================== */
  function b64Bytes(src, max) {
    var i = String(src || '').indexOf('base64,');
    if (i < 0) return null;
    var b64 = src.slice(i + 7).replace(/\s/g, '');
    if (max) b64 = b64.slice(0, Math.ceil(max / 3) * 4);
    var bin;
    try {
      if (typeof atob === 'function') bin = atob(b64);
      else if (typeof Buffer !== 'undefined') return Buffer.from(b64, 'base64');
      else return null;
    } catch (e) { return null; }
    var out = new Uint8Array(bin.length);
    for (var k = 0; k < bin.length; k++) out[k] = bin.charCodeAt(k) & 255;
    return out;
  }

  PP.imageSize = function (src) {
    var b = b64Bytes(src, 65536);
    if (!b || b.length < 24) return null;
    /* PNG: 8바이트 시그니처 + IHDR */
    if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) {
      return { w: rd32(b, 16), h: rd32(b, 20) };
    }
    /* GIF87a / GIF89a — 리틀 엔디안 */
    if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) {
      return { w: b[6] | (b[7] << 8), h: b[8] | (b[9] << 8) };
    }
    /* JPEG: SOF0~SOF15 마커를 찾아 간다 */
    if (b[0] === 0xff && b[1] === 0xd8) {
      var i = 2;
      while (i + 9 < b.length) {
        if (b[i] !== 0xff) { i++; continue; }
        var mk = b[i + 1];
        if (mk === 0xd8 || mk === 0x01 || (mk >= 0xd0 && mk <= 0xd7)) { i += 2; continue; }
        var len = (b[i + 2] << 8) | b[i + 3];
        if (mk >= 0xc0 && mk <= 0xcf && mk !== 0xc4 && mk !== 0xc8 && mk !== 0xcc) {
          return { h: (b[i + 5] << 8) | b[i + 6], w: (b[i + 7] << 8) | b[i + 8] };
        }
        i += 2 + len;
      }
    }
    return null;
  };
  function rd32(b, i) { return (b[i] << 24 | b[i + 1] << 16 | b[i + 2] << 8 | b[i + 3]) >>> 0; }

  /* 배치된 크기 대비 실제 해상도 (pt 는 1/72인치이므로 px/pt*72 = dpi) */
  PP.imageDpi = function (it) {
    var sz = PP.imageSize(it.src);
    if (!sz || !it.w || !it.h) return null;
    var sc = it.m ? Math.sqrt(Math.abs(it.m[0] * it.m[3] - it.m[1] * it.m[2])) || 1 : 1;
    var wpt = it.w * sc, hpt = it.h * sc;
    if (wpt <= 0 || hpt <= 0) return null;
    return Math.round(Math.min(sz.w / wpt, sz.h / hpt) * 72);
  };

})(typeof globalThis !== 'undefined' ? globalThis.AI : window.AI);
