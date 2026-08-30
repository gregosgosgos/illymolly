/* =========================================================================
   api.js — 자동화 / AI 에이전트용 스크립팅 API
   -------------------------------------------------------------------------
   설계 원칙
   1. 모든 인자와 반환값은 JSON 직렬화 가능 — 라이브 객체 참조를 노출하지 않는다.
      (RPC · postMessage · 원격 호출 그대로 통과)
   2. 연산은 선언형 OPS 테이블 한 곳에 정의하고, 호출 가능한 메서드와
      도구 매니페스트(illy.ops())를 같은 테이블에서 생성한다 — 문서와 구현이
      어긋날 수 없다.
   3. 식별자는 결정적(sequential) — 같은 스크립트는 같은 결과를 낸다.
   4. batch() 는 원자적 — 하나라도 실패하면 전부 되돌리고 실패 지점을 알려 준다.
   5. 브라우저에서는 살아 있는 GUI 를, Node 에서는 헤드리스 세션을 같은 API 로 다룬다.
   ========================================================================= */
(function (AI) {
  'use strict';
  var U = AI.util, M = AI.mat, R = AI.rect, G = AI.geom,
    Model = AI.model, Rn = AI.render, E = AI.edit, Col = AI.color;

  var API = AI.api = {};
  API.VERSION = '1.0';

  /* ===================== 헬퍼 ===================== */
  function err(code, msg, extra) {
    var e = new Error(msg);
    e.code = code;
    if (extra) for (var k in extra) e[k] = extra[k];
    return e;
  }
  function rect(b) {
    if (!b || R.isEmpty(b)) return null;
    return { x: U.round(b.x, 4), y: U.round(b.y, 4), w: U.round(R.w(b), 4), h: U.round(R.h(b), 4) };
  }

  /* 색 입력 정규화: '#f00' | 'none' | 'red' | {r,g,b} | 그레이디언트 스펙 */
  function paint(v, fallback) {
    if (v === undefined) return fallback === undefined ? undefined : fallback;
    if (v === null || v === 'none' || v === false) return Col.none();
    if (typeof v === 'string') {
      var hex = normalizeHex(v);
      if (!hex) throw err('BAD_COLOR', '색상을 해석할 수 없습니다: ' + v);
      return Col.solid(hex);
    }
    if (typeof v === 'object') {
      if (v.r !== undefined && v.g !== undefined && v.b !== undefined) {
        return Col.solid(Col.rgbToHex(v.r, v.g, v.b), v.a == null ? 1 : v.a);
      }
      if (v.type === 'linear' || v.type === 'radial') {
        var g = Col.gradient(v.type);
        if (v.stops && v.stops.length) {
          g.stops = v.stops.map(function (s, i) {
            if (Array.isArray(s)) return { t: s[0], color: normalizeHex(s[1]) || '#000000', alpha: s[2] == null ? 1 : s[2] };
            return { t: s.t == null ? i : s.t, color: normalizeHex(s.color) || '#000000', alpha: s.alpha == null ? 1 : s.alpha };
          }).sort(function (a, b) { return a.t - b.t; });
        }
        if (v.angle != null) g.angle = v.angle;
        if (v.cx != null) g.cx = v.cx;
        if (v.cy != null) g.cy = v.cy;
        if (v.r != null) g.r = v.r;
        return g;
      }
      if (v.color) return Col.solid(normalizeHex(v.color) || '#000000', v.alpha);
    }
    throw err('BAD_COLOR', '색상 형식을 알 수 없습니다: ' + JSON.stringify(v));
  }

  var NAMED = {
    black: '#000000', white: '#ffffff', red: '#ff0000', green: '#008000', lime: '#00ff00',
    blue: '#0000ff', yellow: '#ffff00', cyan: '#00ffff', magenta: '#ff00ff', gray: '#808080',
    grey: '#808080', orange: '#ffa500', purple: '#800080', pink: '#ffc0cb', brown: '#a52a2a',
    navy: '#000080', teal: '#008080', olive: '#808000', silver: '#c0c0c0', gold: '#ffd700'
  };
  function normalizeHex(v) {
    if (typeof v !== 'string') return null;
    var s = v.trim().toLowerCase();
    if (NAMED[s]) return NAMED[s];
    if (s[0] !== '#') s = '#' + s;
    if (/^#[0-9a-f]{3}$/.test(s)) return '#' + s[1] + s[1] + s[2] + s[2] + s[3] + s[3];
    if (/^#[0-9a-f]{6}$/.test(s)) return s;
    return null;
  }
  API.normalizeHex = normalizeHex;

  function paintOut(p) {
    if (!p || p.type === 'none') return { type: 'none' };
    if (p.type === 'solid') return { type: 'solid', color: p.color, alpha: p.alpha == null ? 1 : p.alpha };
    return {
      type: p.type, angle: p.angle || 0,
      stops: p.stops.map(function (s) { return { t: U.round(s.t, 4), color: s.color, alpha: s.alpha == null ? 1 : s.alpha }; })
    };
  }
  function strokeOut(s) {
    if (!s || s.type === 'none') return { type: 'none' };
    return {
      type: s.type, color: s.color, alpha: s.alpha == null ? 1 : s.alpha,
      width: s.width, cap: s.cap, join: s.join, align: s.align || 'center',
      dash: (s.dash || []).slice(),
      arrowStart: s.arrowStart || 'none', arrowEnd: s.arrowEnd || 'none',
      arrowScale: s.arrowScale == null ? 100 : s.arrowScale
    };
  }

  /* ===================== 컨텍스트(세션) ===================== */
  /* 브라우저: 살아 있는 GUI app. Node: 최소 app 유사 객체. */
  API.headless = function (opts) {
    opts = opts || {};
    var ctx = {
      headless: true,
      doc: Model.newDoc(opts.width || 595.28, opts.height || 841.89),
      sel: [], selPts: [],
      view: { scale: 1, tx: 0, ty: 0 }, dpr: 1, canvas: null,
      fill: Col.solid('#ffffff'), stroke: Col.solid('#000000'),
      strokeWidth: 1, fillFocus: true, refPoint: 0,
      prefs: {
        unit: opts.unit || 'pt', smart: false, snapGrid: false, outline: false,
        previewBounds: false, keyIncrement: 1, gridSize: 72, gridDiv: 8
      },
      history: new AI.History(80),
      invalidate: function () { },
      resize: function () { }
    };
    if (opts.name) ctx.doc.name = opts.name;
    ctx.setDoc = function (d) {
      var ids = ctx.sel.map(function (i) { return i.id; });
      ctx.doc = d;
      ctx.sel = [];
      ctx.selPts = [];
      ids.forEach(function (id) { var it = Model.find(d, id); if (it) ctx.sel.push(it); });
    };
    ctx.history.reset(ctx.doc, '새 문서');
    return ctx;
  };

  /* ===================== 선택자 ===================== */
  /* q: string | id | [ids] | {…조건} — 문서 순서(뒤→앞)로 id 배열 반환 */
  function resolve(ctx, q, opts) {
    opts = opts || {};
    if (q === undefined || q === null) {
      if (opts.defaultSelection !== false) return ctx.sel.map(function (i) { return i.id; });
      return [];
    }
    if (Array.isArray(q)) {
      return q.map(function (x) { return typeof x === 'string' ? x : (x && x.id); }).filter(Boolean);
    }
    if (typeof q === 'string') {
      if (q === '*' || q === 'all') return allIds(ctx);
      if (q === 'selection' || q === 'selected') return ctx.sel.map(function (i) { return i.id; });
      if (Model.find(ctx.doc, q)) return [q];
      return match(ctx, { name: q });
    }
    if (typeof q === 'object') {
      if (q.id) return Model.find(ctx.doc, q.id) ? [q.id] : [];
      if (q.ids) return q.ids.filter(function (id) { return !!Model.find(ctx.doc, id); });
      return match(ctx, q);
    }
    return [];
  }

  function allIds(ctx) {
    var out = [];
    Model.walk(ctx.doc, function (it) { out.push(it.id); });
    return out;
  }

  function match(ctx, q) {
    var out = [];
    var selIds = ctx.sel.map(function (i) { return i.id; });
    var re = null;
    if (q.name && /^\/.*\/[a-z]*$/.test(q.name)) {
      var m = /^\/(.*)\/([a-z]*)$/.exec(q.name);
      re = new RegExp(m[1], m[2]);
    }
    Model.walkWorld(ctx.doc, function (it, info) {
      if (q.topLevel && info.depth !== 0) return;
      if (q.type && it.type !== q.type) return;
      if (q.name) {
        var nm = it.name || '';
        if (re ? !re.test(nm) : nm !== q.name) return;
      }
      if (q.shape && !(it.shape && it.shape.kind === q.shape)) return;
      if (q.layer && (!info.layer || info.layer.name !== q.layer)) return;
      if (q.selected !== undefined && (selIds.indexOf(it.id) >= 0) !== !!q.selected) return;
      if (q.visible !== undefined && !!it.visible !== !!q.visible) return;
      if (q.locked !== undefined && !!it.locked !== !!q.locked) return;
      if (q.fill) {
        var want = normalizeHex(q.fill) || q.fill;
        if (!(it.fill && ((it.fill.type === 'solid' && it.fill.color === want) || it.fill.type === want))) return;
      }
      if (q.stroke) {
        var ws = normalizeHex(q.stroke) || q.stroke;
        if (!(it.stroke && it.stroke.type !== 'none' && it.stroke.color === ws)) return;
      }
      if (q.text !== undefined) {
        if (it.type !== 'text' || String(it.text.content).indexOf(q.text) < 0) return;
      }
      var b = null;
      if (q.within || q.at || q.intersects) b = Rn.boundsM(it, info.m, false, 1);
      if (q.within) {
        var w = q.within;
        if (!b || !R.contains({ x: w.x, y: w.y, x2: w.x + w.w, y2: w.y + w.h }, b)) return;
      }
      if (q.intersects) {
        var iq = q.intersects;
        if (!b || !R.hit({ x: iq.x, y: iq.y, x2: iq.x + iq.w, y2: iq.y + iq.h }, b)) return;
      }
      if (q.at) {
        if (!b || !R.has(b, q.at.x, q.at.y)) return;
      }
      out.push(it.id);
    });
    if (q.limit) out = out.slice(0, q.limit);
    return out;
  }

  function items(ctx, q, opts) {
    return resolve(ctx, q, opts).map(function (id) { return Model.find(ctx.doc, id); }).filter(Boolean);
  }
  function need(ctx, q, opName) {
    var list = items(ctx, q);
    if (!list.length) throw err('NO_TARGET', opName + ': 대상이 없습니다 (선택도 비어 있음)');
    return list;
  }

  /* ===================== 아이템 직렬화 ===================== */
  function itemInfo(ctx, it, info) {
    var loc = info || Model.locate(ctx.doc, it);
    var wm = Model.worldMatrix(ctx.doc, it);
    var o = {
      id: it.id,
      type: it.type,
      name: it.name || '',
      layer: loc && loc.layer ? loc.layer.name : null,
      visible: it.visible !== false,
      locked: !!it.locked,
      opacity: it.opacity == null ? 1 : it.opacity,
      blend: it.blend || 'normal',
      bounds: rect(Rn.boundsM(it, wm, false, 1)),
      geometricBounds: rect(Rn.boundsM(it, wm, true, 1)),
      rotation: U.round(M.angle(wm), 3)
    };
    if (it.type !== 'group') {
      o.fill = paintOut(it.fill);
      o.stroke = strokeOut(it.stroke);
    }
    if (it.type === 'path') {
      o.closed = it.subs.every(function (s) { return s.closed; });
      o.subpaths = it.subs.length;
      o.points = Model.countPts(it);
      if (it.shape) o.shape = U.deepCopy(it.shape);
    } else if (it.type === 'text') {
      o.text = {
        content: it.text.content, font: it.text.family, size: it.text.size,
        weight: it.text.weight, italic: !!it.text.italic,
        leading: it.text.leading, tracking: it.text.tracking, align: it.text.align
      };
    } else if (it.type === 'image') {
      o.image = { width: it.w, height: it.h, srcLength: (it.src || '').length, srcKind: /^data:/.test(it.src || '') ? 'dataURL' : 'url' };
    } else if (it.type === 'group') {
      o.clip = !!it.clip;
      o.children = it.children.map(function (c) { return c.id; });
    }
    return o;
  }

  /* ===================== 연산 테이블 ===================== */
  /* p(): 파라미터 스펙 축약 */
  function p(type, desc, o) {
    var d = { type: type, description: desc };
    if (o) for (var k in o) d[k] = o[k];
    return d;
  }
  var Q = p('selector', '대상 선택자. 생략하면 현재 선택. id · 이름 · {type,name,fill,layer,at,within,…} · id 배열');

  var OPS = {};
  function op(name, spec) {
    if (typeof spec.undoable !== 'boolean') {
      throw new Error("api.js: '" + name + "' 이(가) undoable 플래그를 선언하지 않았습니다 " +
        '(읽기 전용 연산이 실행 취소 스택을 오염시키는 것을 막기 위한 필수 표시)');
    }
    spec.name = name;
    OPS[name] = spec;
  }

  /* ---------- 문서 ---------- */
  op('newDocument', {
    undoable: false, group: '문서', desc: '새 문서를 만들고 기존 내용을 대체합니다.',
    params: {
      width: p('number', '대지 폭 (pt)', { default: 595.28 }),
      height: p('number', '대지 높이 (pt)', { default: 841.89 }),
      name: p('string', '문서 이름', { default: '무제-1' }),
      unit: p('string', '표시 단위', { enum: ['pt', 'px', 'mm', 'cm', 'in'], default: 'pt' }),
      background: p('color', '대지 배경색', { default: '#ffffff' })
    },
    run: function (ctx, a) {
      var d = Model.newDoc(a.width || 595.28, a.height || 841.89);
      if (a.name) d.name = a.name;
      if (a.background) d.bg = normalizeHex(a.background) || '#ffffff';
      ctx.setDoc(d);
      ctx.history.reset(ctx.doc, '새 문서');
      if (a.unit) ctx.prefs.unit = a.unit;
      if (!ctx.headless && AI.viewT) AI.viewT.fitArtboard(ctx);
      return documentInfo(ctx);
    }
  });

  function documentInfo(ctx) {
    return {
      name: ctx.doc.name,
      unit: ctx.prefs.unit || 'pt',
      background: ctx.doc.bg || '#ffffff',
      artboards: ctx.doc.artboards.map(function (a, i) {
        return { index: i, name: a.name, x: a.x, y: a.y, width: a.w, height: a.h, active: i === ctx.doc.activeArtboard };
      }),
      layers: ctx.doc.layers.map(function (l, i) {
        return { index: i, name: l.name, color: l.color, visible: l.visible, locked: l.locked, items: l.children.length, active: i === ctx.doc.activeLayer };
      }),
      itemCount: allIds(ctx).length,
      selection: ctx.sel.map(function (i) { return i.id; })
    };
  }

  op('documentInfo', { undoable: false, group: '문서', desc: '문서 · 대지 · 레이어 요약을 반환합니다.', params: {}, run: documentInfo });

  op('setDocument', {
    undoable: true, group: '문서', desc: '활성 대지 크기 · 문서 이름 · 단위 · 배경을 변경합니다.',
    params: {
      width: p('number', '활성 대지 폭'), height: p('number', '활성 대지 높이'),
      name: p('string', '문서 이름'), unit: p('string', '표시 단위', { enum: ['pt', 'px', 'mm', 'cm', 'in'] }),
      background: p('color', '대지 배경색')
    },
    run: function (ctx, a) {
      var ab = ctx.doc.artboards[ctx.doc.activeArtboard];
      if (a.width != null) { ab.w = Math.max(1, a.width); ctx.doc.width = ab.w; }
      if (a.height != null) { ab.h = Math.max(1, a.height); ctx.doc.height = ab.h; }
      if (a.name) ctx.doc.name = a.name;
      if (a.unit) ctx.prefs.unit = a.unit;
      if (a.background) ctx.doc.bg = normalizeHex(a.background) || ctx.doc.bg;
      return documentInfo(ctx);
    }
  });

  /* ---------- 생성 ---------- */
  var STYLE_PARAMS = {
    fill: p('color', "칠. '#ff0000' · 'red' · 'none' · {type:'linear',stops:[[0,'#fff'],[1,'#000']],angle:45}"),
    stroke: p('color', '획 색. 없으면 획 없음'),
    strokeWidth: p('number', '획 두께 (pt). 획이 없는 오브젝트에는 색을 함께 지정해야 보입니다'),
    strokeAlign: p('string', '획 정렬', { enum: ['center', 'inside', 'outside'] }),
    strokeDash: p('number[]', '점선 패턴 (예: [4,2])'),
    opacity: p('number', '불투명도 0~1'),
    blend: p('string', '혼합 모드'),
    name: p('string', '오브젝트 이름'),
    layer: p('string', '넣을 레이어 이름 (없으면 활성 레이어)')
  };

  /* 지정한 속성만 건드린다 — 넘기지 않은 값은 절대 덮어쓰지 않는다.
     (set() 으로 칠만 바꿀 때 불투명도나 획이 초기화되면 안 된다) */
  function applyStyle(ctx, it, a) {
    if (a.fill !== undefined) it.fill = paint(a.fill);
    if (a.stroke !== undefined) {
      var sp = paint(a.stroke);
      var s = Model.defaultStroke();
      var old = it.stroke || {};
      s.cap = old.cap || s.cap; s.join = old.join || s.join;
      s.align = old.align || s.align; s.dash = (old.dash || []).slice();
      if (sp.type === 'none') s.type = 'none';
      else if (sp.type === 'solid') { s.type = 'solid'; s.color = sp.color; s.alpha = sp.alpha; }
      else { Object.keys(sp).forEach(function (k) { s[k] = U.deepCopy(sp[k]); }); }
      s.width = a.strokeWidth != null ? a.strokeWidth : (old.width == null ? 1 : old.width);
      it.stroke = s;
    } else if (a.strokeWidth != null && it.stroke) {
      it.stroke.width = a.strokeWidth;
    }
    if (a.strokeAlign && it.stroke) it.stroke.align = a.strokeAlign;
    if (a.strokeDash && it.stroke) it.stroke.dash = a.strokeDash.slice();
    if (a.opacity != null) it.opacity = U.clamp(a.opacity, 0, 1);
    if (a.blend) it.blend = a.blend;
    if (a.name) it.name = a.name;
    return it;
  }

  function place(ctx, it, a) {
    var layer = null;
    if (a && a.layer) {
      layer = ctx.doc.layers.filter(function (l) { return l.name === a.layer; })[0];
      if (!layer) throw err('NO_LAYER', "레이어를 찾을 수 없습니다: '" + a.layer + "'");
    }
    (layer || Model.activeLayer(ctx.doc)).children.push(it);
    ctx.sel = [it];
    ctx.selPts = [];
    return it.id;
  }

  function shapeOp(name, group, desc, params, build) {
    var all = {};
    for (var k in params) all[k] = params[k];
    for (var k2 in STYLE_PARAMS) all[k2] = STYLE_PARAMS[k2];
    op(name, {
      undoable: true, group: group, desc: desc, params: all, returns: 'id',
      run: function (ctx, a) { return place(ctx, applyStyle(ctx, build(ctx, a), a), a); }
    });
  }

  shapeOp('addRect', '생성', '사각형(라이브 셰이프)을 추가합니다.', {
    x: p('number', '왼쪽 좌표', { required: true }), y: p('number', '위쪽 좌표', { required: true }),
    width: p('number', '폭', { required: true }), height: p('number', '높이', { required: true }),
    radius: p('number', '모퉁이 반경', { default: 0 })
  }, function (ctx, a) { return Model.newRect(a.x, a.y, a.width, a.height, a.radius || 0); });

  shapeOp('addEllipse', '생성', '타원을 추가합니다. 파이 각도를 주면 부채꼴이 됩니다.', {
    x: p('number', '바운딩 왼쪽', { required: true }), y: p('number', '바운딩 위쪽', { required: true }),
    width: p('number', '폭', { required: true }), height: p('number', '높이', { required: true }),
    pieStart: p('number', '파이 시작 각도 (°, 0 = 오른쪽)', { default: 0 }),
    pieEnd: p('number', '파이 끝 각도 (°)', { default: 360 })
  }, function (ctx, a) {
    var it = Model.newEllipse(a.x, a.y, a.width, a.height);
    if (Math.abs((((a.pieEnd - a.pieStart) % 360) + 360) % 360) > 0.001) {
      it.shape.pie = { start: a.pieStart, end: a.pieEnd };
      it.name = '파이';
      Model.buildShape(it);
    }
    return it;
  });

  shapeOp('addPolygon', '생성', '정다각형을 추가합니다.', {
    cx: p('number', '중심 x', { required: true }), cy: p('number', '중심 y', { required: true }),
    radius: p('number', '반경', { required: true }), sides: p('number', '변의 수', { default: 6 })
  }, function (ctx, a) { return Model.newPolygon(a.cx, a.cy, a.radius, Math.max(3, a.sides || 6)); });

  shapeOp('addStar', '생성', '별을 추가합니다.', {
    cx: p('number', '중심 x', { required: true }), cy: p('number', '중심 y', { required: true }),
    radius: p('number', '바깥 반경', { required: true }),
    innerRadius: p('number', '안쪽 반경 (기본: 바깥의 절반)'),
    points: p('number', '점 개수', { default: 5 })
  }, function (ctx, a) {
    return Model.newStar(a.cx, a.cy, a.radius, a.innerRadius == null ? a.radius / 2 : a.innerRadius, Math.max(3, a.points || 5));
  });

  shapeOp('addLine', '생성', '선분을 추가합니다.', {
    x1: p('number', '시작 x', { required: true }), y1: p('number', '시작 y', { required: true }),
    x2: p('number', '끝 x', { required: true }), y2: p('number', '끝 y', { required: true })
  }, function (ctx, a) { return Model.newLine(a.x1, a.y1, a.x2, a.y2); });

  shapeOp('addPath', '생성', "패스를 추가합니다. SVG 의 d 문자열 또는 점 배열을 받습니다.", {
    d: p('string', "SVG path d 문자열 (예: 'M0 0 L100 0 C120 40 80 60 0 60 Z')"),
    points: p('number[][]', '점 배열 [[x,y],…] — d 대신 사용'),
    closed: p('boolean', 'points 사용 시 닫힌 패스 여부', { default: false })
  }, function (ctx, a) {
    var it = null;
    if (a.d) it = AI.io.pathFromD(a.d);
    else if (a.points && a.points.length > 1) {
      it = Model.newPath([{
        closed: !!a.closed,
        pts: a.points.map(function (q) { return { x: q[0], y: q[1] }; })
      }]);
    }
    if (!it) throw err('BAD_PATH', 'd 또는 points 중 하나가 필요합니다');
    return it;
  });

  shapeOp('addText', '생성', '점 문자(포인트 텍스트)를 추가합니다. 원점은 첫 줄 베이스라인입니다.', {
    x: p('number', '기준 x', { required: true }), y: p('number', '베이스라인 y', { required: true }),
    text: p('string', '내용 (\\n 으로 줄바꿈)', { required: true }),
    font: p('string', 'CSS font-family', { default: 'Noto Sans KR, sans-serif' }),
    size: p('number', '글꼴 크기 (pt)', { default: 24 }),
    weight: p('number', '굵기 100~900', { default: 400 }),
    italic: p('boolean', '기울임', { default: false }),
    leading: p('number', '행간 배수', { default: 1.2 }),
    tracking: p('number', '자간 (px)', { default: 0 }),
    align: p('string', '정렬', { enum: ['left', 'center', 'right'], default: 'left' })
  }, function (ctx, a) {
    var it = Model.newText(a.x, a.y, a.text);
    var t = it.text;
    if (a.font) t.family = a.font;
    if (a.size != null) t.size = a.size;
    if (a.weight != null) t.weight = a.weight;
    if (a.italic != null) t.italic = !!a.italic;
    if (a.leading != null) t.leading = a.leading;
    if (a.tracking != null) t.tracking = a.tracking;
    if (a.align) t.align = a.align;
    if (a.fill === undefined) it.fill = Col.solid('#000000');
    return it;
  });

  /* ---------- 문서 (탭) ---------- */
  op('documents', {
    undoable: false, group: '문서', desc: '열려 있는 문서(탭) 목록을 반환합니다.', params: {},
    run: function (ctx) {
      if (!AI.docs) return [];
      AI.docs.sync(ctx);
      return AI.docs.list(ctx).map(function (s, i) {
        return {
          index: i, name: s.doc.name, active: i === ctx.docIndex,
          modified: !!s.dirty, artboards: s.doc.artboards.length,
          objects: s.doc.layers.reduce(function (n, l) { return n + l.children.length; }, 0)
        };
      });
    }
  });
  op('newDocument', {
    undoable: false, group: '문서', desc: '새 문서를 새 탭으로 열고 활성화합니다.',
    params: {
      name: p('string', '문서 이름'),
      width: p('number', '폭 (pt)', { default: 595.28 }),
      height: p('number', '높이 (pt)', { default: 841.89 })
    },
    returns: 'string',
    run: function (ctx, a) {
      var d = Model.newDoc(Math.max(1, a.width), Math.max(1, a.height));
      if (a.name) d.name = a.name;
      if (!AI.docs) { ctx.setDoc(d); ctx.history.reset(d, '새 문서'); return d.name; }
      AI.docs.add(ctx, d, { label: '새 문서' });
      return ctx.doc.name;
    }
  });
  op('activateDocument', {
    undoable: false, group: '문서', desc: '탭 번호 또는 이름으로 문서를 전환합니다.',
    params: { document: p('string', '문서 이름 또는 0부터 시작하는 탭 번호', { required: true }) },
    returns: 'string',
    run: function (ctx, a) {
      if (!AI.docs) throw err('NO_DOCS', '다중 문서를 쓸 수 없습니다');
      var list = AI.docs.list(ctx), i = -1;
      if (/^\d+$/.test(String(a.document))) i = +a.document;
      else for (var k = 0; k < list.length; k++) if (list[k].doc.name === a.document) { i = k; break; }
      if (i < 0 || i >= list.length) {
        throw err('NO_DOC', "문서를 찾을 수 없습니다: '" + a.document + "'. 열린 문서: " +
          list.map(function (s) { return s.doc.name; }).join(', '));
      }
      AI.docs.switchTo(ctx, i);
      return ctx.doc.name;
    }
  });
  op('closeDocument', {
    undoable: false, group: '문서', desc: '문서 탭을 닫습니다. 저장 여부는 묻지 않습니다.',
    params: { document: p('string', '문서 이름 또는 탭 번호 (생략하면 현재 문서)') },
    returns: 'string',
    run: function (ctx, a) {
      if (!AI.docs) throw err('NO_DOCS', '다중 문서를 쓸 수 없습니다');
      var list = AI.docs.list(ctx), i = ctx.docIndex;
      if (a.document != null && a.document !== '') {
        if (/^\d+$/.test(String(a.document))) i = +a.document;
        else { i = -1; for (var k = 0; k < list.length; k++) if (list[k].doc.name === a.document) { i = k; break; } }
      }
      if (i < 0 || i >= list.length) throw err('NO_DOC', '문서를 찾을 수 없습니다: ' + a.document);
      AI.docs.close(ctx, i, true);
      return ctx.doc.name;
    }
  });

  op('typeOnPath', {
    undoable: true, group: '문자',
    desc: '선택한 패스를 기준선 삼아 글을 흘립니다 (패스 상의 문자). 원본 패스는 문자 오브젝트가 됩니다.',
    params: {
      query: Q,
      text: p('string', '내용', { required: true }),
      size: p('number', '글꼴 크기 (pt)'),
      font: p('string', 'CSS font-family'),
      start: p('number', '패스 시작점에서의 오프셋 (pt)', { default: 0 }),
      textAlign: p('string', '패스 위 정렬', { enum: ['left', 'center', 'right'], default: 'left' }),
      alignTo: p('string', '문자 맞추기', { enum: ['baseline', 'ascender', 'descender', 'center'], default: 'baseline' }),
      flip: p('boolean', '패스 뒤집기', { default: false })
    },
    returns: 'id[]',
    run: function (ctx, a) {
      var made = [];
      withSel(ctx, a.query, 'typeOnPath', function (list) {
        list.forEach(function (src) {
          if (src.type !== 'path') return;
          var it = AI.edit.makePathText(ctx, src, a.start || 0);
          if (!it) return;
          it.text.content = a.text;
          if (a.size != null) it.text.size = a.size;
          if (a.font) it.text.family = a.font;
          if (a.textAlign) it.text.align = a.textAlign;
          if (a.alignTo) it.text.path.align = a.alignTo;
          it.text.path.flip = !!a.flip;
          made.push(it);
        });
      });
      if (!made.length) throw err('NO_PATH', '기준선이 될 패스를 선택하세요');
      ctx.sel = made;
      return made.map(function (i) { return i.id; });
    }
  });

  shapeOp('addImage', '생성', '이미지를 배치합니다. src 는 data URL 또는 URL.', {
    src: p('string', 'data URL 또는 이미지 URL', { required: true }),
    x: p('number', '왼쪽', { required: true }), y: p('number', '위쪽', { required: true }),
    width: p('number', '폭', { required: true }), height: p('number', '높이', { required: true })
  }, function (ctx, a) { return Model.newImage(a.src, a.x, a.y, a.width, a.height); });

  /* ---------- 조회 ---------- */
  op('find', {
    undoable: false, group: '조회', desc: '선택자에 맞는 오브젝트 id 목록을 문서 순서(뒤→앞)로 반환합니다.',
    params: { query: Q }, returns: 'id[]',
    run: function (ctx, a) { return resolve(ctx, a.query, { defaultSelection: false }); }
  });

  op('get', {
    undoable: false, group: '조회', desc: '오브젝트 상세 정보를 반환합니다.',
    params: { query: Q },
    run: function (ctx, a) {
      var list = items(ctx, a.query);
      if (!list.length) return null;
      return list.length === 1 ? itemInfo(ctx, list[0]) : list.map(function (i) { return itemInfo(ctx, i); });
    }
  });

  op('snapshot', {
    undoable: false, group: '조회', desc: '문서 전체를 기계가 읽을 수 있는 구조로 반환합니다 (AI 가 화면 없이 상태를 파악할 때).',
    params: { includeGeometry: p('boolean', '패스 좌표까지 포함', { default: false }) },
    run: function (ctx, a) {
      var byLayer = ctx.doc.layers.map(function (l) {
        return {
          name: l.name, color: l.color, visible: l.visible, locked: l.locked,
          items: l.children.map(function (c) { return node(c); })
        };
      });
      function node(it) {
        var o = itemInfo(ctx, it);
        if (it.type === 'group') o.items = it.children.map(node);
        if (a.includeGeometry && it.type === 'path') o.d = G.toSvgD(it, null);
        return o;
      }
      return {
        version: API.VERSION,
        document: documentInfo(ctx),
        layers: byLayer,
        selection: ctx.sel.map(function (i) { return i.id; })
      };
    }
  });

  op('describe', {
    undoable: false, group: '조회', desc: '문서를 사람이 읽는 짧은 텍스트로 요약합니다 (LLM 컨텍스트용).',
    params: {}, returns: 'string',
    run: function (ctx) {
      var un = ctx.prefs.unit || 'pt';
      var ab = ctx.doc.artboards[ctx.doc.activeArtboard];
      var lines = [];
      AI.assets.ensure(ctx.doc);
      lines.push('문서 "' + ctx.doc.name + '" · 대지 ' + ctx.doc.artboards.length + '개 · 활성 대지 ' +
        U.fmtUnit(ab.w, un) + '×' + U.fmtUnit(ab.h, un) + un + ' · 레이어 ' + ctx.doc.layers.length + '개' +
        (ctx.doc.guides.length ? ' · 안내선 ' + ctx.doc.guides.length + '개' : '') +
        (ctx.doc.symbols.length ? ' · 심볼 ' + ctx.doc.symbols.length + '개' : '') +
        (ctx.doc.patterns.length ? ' · 패턴 ' + ctx.doc.patterns.length + '개' : ''));
      var selIds = ctx.sel.map(function (i) { return i.id; });
      ctx.doc.layers.forEach(function (l) {
        lines.push('[' + l.name + ']' + (l.visible ? '' : ' (숨김)') + (l.locked ? ' (잠금)' : ''));
        (function rec(list, ind) {
          list.forEach(function (it) {
            var b = Rn.boundsM(it, Model.worldMatrix(ctx.doc, it), true, 1);
            var parts = [ind + (selIds.indexOf(it.id) >= 0 ? '▶ ' : '  ') + it.id, typeLabel(it)];
            if (b && !R.isEmpty(b)) {
              parts.push('x' + U.fmtUnit(b.x, un) + ' y' + U.fmtUnit(b.y, un) +
                ' w' + U.fmtUnit(R.w(b), un) + ' h' + U.fmtUnit(R.h(b), un));
            }
            if (it.type !== 'group' && it.type !== 'symbol') {
              parts.push('칠 ' + paintLabel(it.fill));
              if (it.stroke && it.stroke.type !== 'none') parts.push('획 ' + it.stroke.color + ' ' + U.fmt(it.stroke.width) + 'pt');
            }
            if (it.type === 'text') {
              parts.push('"' + String(it.text.content).replace(/\n/g, '\\n').slice(0, 40) + '"');
              if (it.text.area) parts.push('영역문자 ' + U.fmt(it.text.area.w) + '×' + U.fmt(it.text.area.h) +
                (Rn.layoutText && Rn.layoutText(it).overflow ? ' (넘침)' : ''));
            }
            if (it.type === 'symbol') parts.push('심볼 ' + (symName(ctx.doc, it.symbolId) || it.symbolId));
            if (it.opacity != null && it.opacity < 1) parts.push('불투명 ' + Math.round(it.opacity * 100) + '%');
            /* 에이전트가 화면을 못 보므로 겉모습을 바꾸는 것은 전부 적어 준다 */
            if (AI.appearance.isCustom(it)) {
              parts.push('모양 ' + AI.appearance.list(it).map(function (e2) {
                return e2.kind === 'fill' ? '칠' : '획';
              }).join('+'));
            }
            if (AI.effects.hasAny(it)) {
              parts.push('효과 ' + AI.effects.list(it).map(function (e3) { return AI.effects.label(e3); }).join(' / '));
            }
            if (it.opacityMask) parts.push('불투명도 마스크' + (it.maskInvert ? '(반전)' : ''));
            if (it.stroke) {
              if ((it.stroke.arrowStart && it.stroke.arrowStart !== 'none') ||
                  (it.stroke.arrowEnd && it.stroke.arrowEnd !== 'none')) {
                parts.push('화살표 ' + (it.stroke.arrowStart || 'none') + '→' + (it.stroke.arrowEnd || 'none'));
              }
              if (it.stroke.widthProfile && it.stroke.widthProfile.length > 1) parts.push('가변폭');
              if (it.stroke.brush) parts.push('브러시 ' + it.stroke.brush.type);
            }
            if (it.crop) parts.push('자름');
            if (!it.visible) parts.push('숨김');
            if (it.locked) parts.push('잠금');
            lines.push(parts.join('  '));
            if (it.type === 'group') rec(it.children, ind + '    ');
          });
        })(l.children, '  ');
      });
      lines.push('선택: ' + (selIds.length ? selIds.join(', ') : '없음'));
      return lines.join('\n');
    }
  });

  function symName(doc, id) {
    var d = AI.assets.findSymbol(doc, id);
    return d ? d.name : null;
  }
  function typeLabel(it) {
    if (it.type === 'symbol') return '심볼';
    if (it.type === 'group') return it.isLayer ? '하위레이어' : (it.clip ? '클립그룹' : '그룹');
    if (it.type === 'text') return '텍스트';
    if (it.type === 'image') return '이미지';
    if (it.shape) return { rect: '사각형', ellipse: '타원', polygon: '다각형', star: '별', line: '선분' }[it.shape.kind] || '패스';
    return '패스';
  }
  function paintLabel(p2) {
    if (!p2 || p2.type === 'none') return '없음';
    if (p2.type === 'solid') return p2.color;
    return p2.stops.map(function (s) { return s.color; }).join('→') + '(' + (p2.type === 'radial' ? '방사형' : '선형') + ')';
  }

  /* ---------- 선택 ---------- */
  op('select', {
    undoable: false, group: '선택', desc: '선택자에 맞는 오브젝트를 선택합니다.',
    params: { query: Q, add: p('boolean', '기존 선택에 추가', { default: false }) },
    returns: 'id[]',
    run: function (ctx, a) {
      var list = items(ctx, a.query, { defaultSelection: false });
      ctx.sel = a.add ? ctx.sel.concat(list.filter(function (i) { return ctx.sel.indexOf(i) < 0; })) : list;
      ctx.selPts = [];
      return ctx.sel.map(function (i) { return i.id; });
    }
  });
  op('deselect', {
    undoable: false, group: '선택', desc: '선택을 해제합니다.', params: {},
    run: function (ctx) { ctx.sel = []; ctx.selPts = []; return []; }
  });
  op('selection', {
    undoable: false, group: '선택', desc: '현재 선택된 id 와 합친 바운딩을 반환합니다.', params: {},
    run: function (ctx) {
      return { ids: ctx.sel.map(function (i) { return i.id; }), bounds: rect(Rn.selectionBounds(ctx, true)) };
    }
  });

  /* ---------- 수정 ---------- */
  op('set', {
    undoable: true, group: '수정', desc: '오브젝트 속성을 변경합니다 (칠·획·불투명도·이름·표시/잠금·텍스트·라이브 셰이프).',
    params: (function () {
      var o = { query: Q };
      for (var k in STYLE_PARAMS) o[k] = STYLE_PARAMS[k];
      delete o.layer;
      o.visible = p('boolean', '표시 여부');
      o.locked = p('boolean', '잠금 여부');
      o.text = p('string', '텍스트 내용 (텍스트 오브젝트)');
      o.size = p('number', '글꼴 크기');
      o.font = p('string', '글꼴');
      o.align = p('string', '문단 정렬', { enum: ['left', 'center', 'right'] });
      o.radius = p('number', '모퉁이 반경 (라이브 사각형)');
      o.sides = p('number', '변/점 개수 (다각형·별)');
      o.pieStart = p('number', '파이 시작 각도 ° (라이브 원형)');
      o.pieEnd = p('number', '파이 끝 각도 ° (라이브 원형)');
      return o;
    })(),
    returns: 'id[]',
    run: function (ctx, a) {
      var list = need(ctx, a.query, 'set');
      list.forEach(function (it) {
        (function rec(o) {
          if (o.type === 'group' && (a.fill !== undefined || a.stroke !== undefined || a.strokeWidth != null)) {
            o.children.forEach(rec);
          }
          if (o.type !== 'group') applyStyle(ctx, o, a);
        })(it);
        if (a.name) it.name = a.name;
        if (a.opacity != null) it.opacity = U.clamp(a.opacity, 0, 1);
        if (a.blend) it.blend = a.blend;
        if (a.visible != null) it.visible = !!a.visible;
        if (a.locked != null) it.locked = !!a.locked;
        if (it.type === 'text') {
          if (a.text != null) it.text.content = String(a.text);
          if (a.size != null) it.text.size = a.size;
          if (a.font) it.text.family = a.font;
          if (a.align) it.text.align = a.align;
        }
        if (it.shape) {
          var changed = false;
          if (a.radius != null && it.shape.kind === 'rect') { it.shape.r = Math.max(0, a.radius); changed = true; }
          if (a.sides != null && (it.shape.kind === 'polygon' || it.shape.kind === 'star')) {
            it.shape.n = Math.max(3, Math.round(a.sides)); changed = true;
          }
          if ((a.pieStart != null || a.pieEnd != null) && it.shape.kind === 'ellipse') {
            var pie = it.shape.pie || { start: 0, end: 360 };
            if (a.pieStart != null) pie.start = a.pieStart;
            if (a.pieEnd != null) pie.end = a.pieEnd;
            if (Math.abs((((pie.end - pie.start) % 360) + 360) % 360) < 0.001) delete it.shape.pie;
            else it.shape.pie = pie;
            changed = true;
          }
          if (changed) Model.buildShape(it);
        }
      });
      return list.map(function (i) { return i.id; });
    }
  });

  op('remove', {
    undoable: true, group: '수정', desc: '오브젝트를 삭제합니다.', params: { query: Q }, returns: 'number',
    run: function (ctx, a) {
      var list = need(ctx, a.query, 'remove');
      list.forEach(function (it) {
        var loc = Model.locate(ctx.doc, it);
        if (loc) loc.list.splice(loc.index, 1);
      });
      ctx.sel = ctx.sel.filter(function (i) { return !!Model.locate(ctx.doc, i); });
      return list.length;
    }
  });

  op('duplicate', {
    undoable: true, group: '수정', desc: '오브젝트를 복제하고 복제본을 선택합니다.',
    params: { query: Q, dx: p('number', '가로 이동', { default: 0 }), dy: p('number', '세로 이동', { default: 0 }) },
    returns: 'id[]',
    run: function (ctx, a) {
      withSel(ctx, a.query, 'duplicate', function () { E.duplicate(ctx, a.dx || 0, a.dy || 0); });
      return ctx.sel.map(function (i) { return i.id; });
    }
  });

  /* 선택을 일시적으로 바꿔 기존 edit 연산을 재사용 */
  function withSel(ctx, q, opName, fn) {
    var prev = ctx.sel;
    var list = need(ctx, q, opName);
    ctx.sel = list;
    try { fn(list); } finally {
      if (ctx.sel === list) ctx.sel = ctx.sel.filter(function (i) { return !!Model.locate(ctx.doc, i); });
    }
    return ctx.sel;
  }

  op('move', {
    undoable: true, group: '변형', desc: '상대 이동합니다.',
    params: { query: Q, dx: p('number', '가로 이동', { default: 0 }), dy: p('number', '세로 이동', { default: 0 }) },
    run: function (ctx, a) {
      withSel(ctx, a.query, 'move', function () { E.move(ctx, a.dx || 0, a.dy || 0); });
      return rect(Rn.selectionBounds(ctx, true));
    }
  });

  op('setBounds', {
    undoable: true, group: '변형', desc: '바운딩 박스를 지정한 위치·크기로 맞춥니다. anchor 는 기준점(0~8, 0=좌상단).',
    params: {
      query: Q, x: p('number', '기준점 x'), y: p('number', '기준점 y'),
      width: p('number', '폭'), height: p('number', '높이'),
      anchor: p('number', '기준점 0~8 (0=좌상 4=중앙 8=우하)', { default: 0 })
    },
    run: function (ctx, a) {
      withSel(ctx, a.query, 'setBounds', function () {
        E.setBounds(ctx, a.x == null ? null : a.x, a.y == null ? null : a.y,
          a.width == null ? null : a.width, a.height == null ? null : a.height, a.anchor || 0);
      });
      return rect(Rn.selectionBounds(ctx, true));
    }
  });

  op('rotate', {
    undoable: true, group: '변형', desc: '회전합니다 (반시계 양수). 기준점을 지정하지 않으면 바운딩 중심.',
    params: { query: Q, angle: p('number', '각도(도)', { required: true }), cx: p('number', '기준 x'), cy: p('number', '기준 y'), anchor: p('number', '기준점 0~8') },
    run: function (ctx, a) {
      withSel(ctx, a.query, 'rotate', function () {
        var o = origin(ctx, a);
        E.rotate(ctx, -a.angle, o.x, o.y);
      });
      return rect(Rn.selectionBounds(ctx, true));
    }
  });

  op('scale', {
    undoable: true, group: '변형', desc: '크기를 배율로 조절합니다.',
    params: {
      query: Q, sx: p('number', '가로 배율 (1=100%)', { default: 1 }), sy: p('number', '세로 배율 (기본: sx 와 동일)'),
      cx: p('number', '기준 x'), cy: p('number', '기준 y'), anchor: p('number', '기준점 0~8'),
      scaleStrokes: p('boolean', '획 두께도 함께 조절', { default: false })
    },
    run: function (ctx, a) {
      var sx = a.sx == null ? 1 : a.sx, sy = a.sy == null ? sx : a.sy;
      withSel(ctx, a.query, 'scale', function (list) {
        var o = origin(ctx, a);
        E.scale(ctx, sx, sy, o.x, o.y);
        if (a.scaleStrokes) {
          var k = Math.sqrt(Math.abs(sx * sy)) || 1;
          list.forEach(function (it) {
            (function rec(x) {
              if (x.type === 'group') { x.children.forEach(rec); return; }
              if (x.stroke && x.stroke.type !== 'none') x.stroke.width *= k;
            })(it);
          });
        }
      });
      return rect(Rn.selectionBounds(ctx, true));
    }
  });

  op('reflect', {
    undoable: true, group: '변형', desc: '가로축 또는 세로축으로 반사합니다.',
    params: { query: Q, axis: p('string', '반사 축', { enum: ['horizontal', 'vertical'], default: 'vertical' }), cx: p('number', '기준 x'), cy: p('number', '기준 y'), anchor: p('number', '기준점 0~8') },
    run: function (ctx, a) {
      withSel(ctx, a.query, 'reflect', function () {
        var o = origin(ctx, a);
        E.reflect(ctx, a.axis === 'horizontal' ? 'h' : 'v', o.x, o.y);
      });
      return rect(Rn.selectionBounds(ctx, true));
    }
  });

  function origin(ctx, a) {
    if (a.cx != null && a.cy != null) return { x: a.cx, y: a.cy };
    var b = Rn.selectionBounds(ctx, true);
    if (R.isEmpty(b)) return { x: 0, y: 0 };
    return a.anchor != null ? E.refPointOf(b, a.anchor) : { x: R.cx(b), y: R.cy(b) };
  }

  op('arrange', {
    undoable: true, group: '수정', desc: '쌓임 순서를 바꿉니다.',
    params: { query: Q, order: p('string', '순서', { enum: ['front', 'forward', 'backward', 'back'], required: true }) },
    run: function (ctx, a) {
      withSel(ctx, a.query, 'arrange', function () { E.arrange(ctx, a.order); });
      return ctx.sel.map(function (i) { return i.id; });
    }
  });

  op('group', {
    undoable: true, group: '수정', desc: '선택한 오브젝트를 그룹으로 묶습니다.', params: { query: Q, name: p('string', '그룹 이름') },
    returns: 'id',
    run: function (ctx, a) {
      var list = need(ctx, a.query, 'group');
      if (list.length < 2) throw err('NEED_TWO', 'group: 2개 이상이 필요합니다');
      ctx.sel = list;
      E.group(ctx);
      if (a.name && ctx.sel[0]) ctx.sel[0].name = a.name;
      return ctx.sel[0] ? ctx.sel[0].id : null;
    }
  });
  op('ungroup', {
    undoable: true, group: '수정', desc: '그룹을 해제합니다.', params: { query: Q }, returns: 'id[]',
    run: function (ctx, a) {
      withSel(ctx, a.query, 'ungroup', function () { E.ungroup(ctx); });
      return ctx.sel.map(function (i) { return i.id; });
    }
  });

  op('align', {
    undoable: true, group: '정렬', desc: '정렬합니다.',
    params: {
      query: Q,
      mode: p('string', '정렬 기준', { enum: ['left', 'hcenter', 'right', 'top', 'vcenter', 'bottom'], required: true }),
      relativeTo: p('string', '기준', { enum: ['selection', 'artboard'], default: 'selection' })
    },
    run: function (ctx, a) {
      withSel(ctx, a.query, 'align', function () { E.align(ctx, a.mode, a.relativeTo || 'selection'); });
      return rect(Rn.selectionBounds(ctx, true));
    }
  });
  op('distribute', {
    undoable: true, group: '정렬', desc: '균등 배분합니다 (3개 이상).',
    params: { query: Q, axis: p('string', '축', { enum: ['h', 'v'], required: true }), spacing: p('number', '간격을 지정하면 간격 기준 배분') },
    run: function (ctx, a) {
      withSel(ctx, a.query, 'distribute', function () {
        if (a.spacing != null) E.distributeSpacing(ctx, a.axis, a.spacing);
        else E.distribute(ctx, a.axis);
      });
      return ctx.sel.map(function (i) { return i.id; });
    }
  });

  op('pathfinder', {
    undoable: true, group: '패스', desc: '패스파인더 연산을 적용합니다.',
    params: {
      query: Q,
      operation: p('string', '연산', {
        enum: ['unite', 'minusFront', 'minusBack', 'intersect', 'exclude', 'divide', 'trim', 'merge', 'crop', 'outline'],
        required: true
      })
    },
    returns: 'id[]',
    run: function (ctx, a) {
      var okRes;
      withSel(ctx, a.query, 'pathfinder', function () { okRes = E.pathfinder(ctx, a.operation); });
      if (okRes === false) throw err('PF_EMPTY', 'pathfinder: 결과가 비어 있습니다');
      return ctx.sel.map(function (i) { return i.id; });
    }
  });

  op('offsetPath', {
    undoable: true, group: '패스', desc: '패스를 지정한 거리만큼 밖(양수)·안(음수)으로 이동한 새 패스를 만듭니다.',
    params: {
      query: Q, offset: p('number', '이동 거리 (음수면 안쪽)', { required: true }),
      replace: p('boolean', '원본을 대체할지', { default: false })
    },
    returns: 'id[]',
    run: function (ctx, a) {
      var okRes;
      withSel(ctx, a.query, 'offsetPath', function () {
        okRes = E.offsetPath(ctx, a.offset, { replace: !!a.replace });
      });
      if (okRes === false) throw err('OFFSET_EMPTY', 'offsetPath: 결과가 비어 있습니다');
      return ctx.sel.map(function (i) { return i.id; });
    }
  });
  op('simplify', {
    undoable: true, group: '패스', desc: '앵커 수를 줄여 패스를 단순화합니다.',
    params: {
      query: Q,
      precision: p('number', '곡선 정밀도 % (100 = 원본에 가깝게)', { default: 90 }),
      angle: p('number', '이 각도보다 뾰족한 지점은 코너로 유지 (0 = 사용 안 함)', { default: 0 }),
      curves: p('boolean', '곡선으로 맞춤', { default: true })
    },
    run: function (ctx, a) {
      var r;
      withSel(ctx, a.query, 'simplify', function () {
        r = E.simplifyPaths(ctx, { precision: a.precision, angle: a.angle, curves: a.curves });
      });
      if (r === false) throw err('NO_PATH', 'simplify: 단순화할 패스가 없습니다');
      return { anchorsBefore: r.before, anchorsAfter: r.after };
    }
  });

  op('clipMask', {
    undoable: true, group: '패스', desc: '맨 앞 오브젝트를 마스크로 클리핑 그룹을 만듭니다.', params: { query: Q }, returns: 'id',
    run: function (ctx, a) {
      withSel(ctx, a.query, 'clipMask', function () { E.makeClipMask(ctx); });
      return ctx.sel[0] ? ctx.sel[0].id : null;
    }
  });

  /* ---------- 레이어 · 대지 ---------- */
  op('addLayer', {
    undoable: true, group: '레이어', desc: '레이어를 추가하고 활성화합니다.',
    params: { name: p('string', '레이어 이름'), color: p('color', '레이어 색상') }, returns: 'string',
    run: function (ctx, a) {
      var l = Model.newLayer(a.name || ('레이어 ' + (ctx.doc.layers.length + 1)), ctx.doc.layers.length);
      if (a.color) l.color = normalizeHex(a.color) || l.color;
      ctx.doc.layers.push(l);
      ctx.doc.activeLayer = ctx.doc.layers.length - 1;
      return l.name;
    }
  });
  op('setLayer', {
    undoable: true, group: '레이어', desc: '활성 레이어를 바꾸거나 레이어 속성을 변경합니다.',
    params: { name: p('string', '레이어 이름', { required: true }), visible: p('boolean', '표시'), locked: p('boolean', '잠금'), rename: p('string', '새 이름') },
    run: function (ctx, a) {
      var i = -1;
      ctx.doc.layers.forEach(function (l, k) { if (l.name === a.name) i = k; });
      if (i < 0) throw err('NO_LAYER', "레이어를 찾을 수 없습니다: '" + a.name + "'");
      ctx.doc.activeLayer = i;
      var l2 = ctx.doc.layers[i];
      if (a.visible != null) l2.visible = !!a.visible;
      if (a.locked != null) l2.locked = !!a.locked;
      if (a.rename) l2.name = a.rename;
      return documentInfo(ctx).layers;
    }
  });
  op('addArtboard', {
    undoable: true, group: '대지', desc: '대지를 추가하고 활성화합니다.',
    params: {
      name: p('string', '이름'), x: p('number', 'x'), y: p('number', 'y'),
      width: p('number', '폭', { required: true }), height: p('number', '높이', { required: true })
    },
    run: function (ctx, a) {
      var last = ctx.doc.artboards[ctx.doc.artboards.length - 1];
      ctx.doc.artboards.push({
        id: U.uid('AB'), name: a.name || ('대지 ' + (ctx.doc.artboards.length + 1)),
        x: a.x == null ? last.x + last.w + 40 : a.x, y: a.y == null ? last.y : a.y,
        w: a.width, h: a.height
      });
      ctx.doc.activeArtboard = ctx.doc.artboards.length - 1;
      return documentInfo(ctx).artboards;
    }
  });
  op('gotoArtboard', {
    undoable: true, group: '대지', desc: '활성 대지를 바꿉니다.', params: { index: p('number', '0부터 시작하는 인덱스', { required: true }) },
    run: function (ctx, a) {
      ctx.doc.activeArtboard = U.clamp(Math.round(a.index), 0, ctx.doc.artboards.length - 1);
      if (!ctx.headless && AI.viewT) AI.viewT.fitArtboard(ctx);
      return ctx.doc.activeArtboard;
    }
  });

  op('setArtboard', {
    undoable: true, group: '대지', desc: '대지의 이름 · 위치 · 크기를 바꿉니다. index 를 생략하면 활성 대지.',
    params: {
      index: p('number', '0부터 시작하는 인덱스 (생략 시 활성 대지)'),
      name: p('string', '이름'), x: p('number', 'x'), y: p('number', 'y'),
      width: p('number', '폭'), height: p('number', '높이')
    },
    run: function (ctx, a) {
      var i = a.index == null ? ctx.doc.activeArtboard : U.clamp(Math.round(a.index), 0, ctx.doc.artboards.length - 1);
      var ab = ctx.doc.artboards[i];
      if (a.name) ab.name = a.name;
      if (a.x != null) ab.x = a.x;
      if (a.y != null) ab.y = a.y;
      if (a.width != null) ab.w = Math.max(1, a.width);
      if (a.height != null) ab.h = Math.max(1, a.height);
      if (i === ctx.doc.activeArtboard) { ctx.doc.width = ab.w; ctx.doc.height = ab.h; }
      return documentInfo(ctx).artboards;
    }
  });
  op('removeArtboard', {
    undoable: true, group: '대지', desc: '대지를 삭제합니다 (최소 1개는 남습니다).',
    params: { index: p('number', '0부터 시작하는 인덱스 (생략 시 활성 대지)') },
    run: function (ctx, a) {
      if (ctx.doc.artboards.length < 2) throw err('LAST_ARTBOARD', '대지는 최소 1개 필요합니다');
      var i = a.index == null ? ctx.doc.activeArtboard : U.clamp(Math.round(a.index), 0, ctx.doc.artboards.length - 1);
      ctx.doc.artboards.splice(i, 1);
      ctx.doc.activeArtboard = U.clamp(ctx.doc.activeArtboard, 0, ctx.doc.artboards.length - 1);
      return documentInfo(ctx).artboards;
    }
  });
  op('fitArtboard', {
    undoable: true, group: '대지', desc: '활성 대지를 선택 항목 또는 아트웍 전체 경계에 맞춥니다.',
    params: { mode: p('string', '기준', { enum: ['selection', 'artwork'], default: 'selection' }), query: Q },
    run: function (ctx, a) {
      var mode = a.mode || 'selection';
      if (mode === 'selection') {
        var listed = need(ctx, a.query, 'fitArtboard');
        var prev = ctx.sel;
        ctx.sel = listed;
        try {
          if (E.fitArtboardTo(ctx, 'selection') === false) throw err('EMPTY', 'fitArtboard: 대상이 비어 있습니다');
        } finally { ctx.sel = prev; }
      } else if (E.fitArtboardTo(ctx, 'artwork') === false) {
        throw err('EMPTY', 'fitArtboard: 대지에 오브젝트가 없습니다');
      }
      if (!ctx.headless && AI.viewT) AI.viewT.fitArtboard(ctx);
      return documentInfo(ctx).artboards[ctx.doc.activeArtboard];
    }
  });
  op('rearrangeArtboards', {
    undoable: true, group: '대지', desc: '모든 대지를 격자로 재배치합니다.',
    params: {
      columns: p('number', '가로 개수 (생략 시 정사각에 가깝게)'),
      gap: p('number', '대지 사이 간격', { default: 40 })
    },
    run: function (ctx, a) {
      E.rearrangeArtboards(ctx, a.columns, a.gap == null ? 40 : a.gap);
      if (!ctx.headless && AI.viewT) AI.viewT.fitAll(ctx);
      return documentInfo(ctx).artboards;
    }
  });

  /* ---------- 레이어 (구성) ---------- */
  op('mergeLayers', {
    undoable: true, group: '레이어', desc: '모든 레이어를 맨 아래 레이어 하나로 병합합니다.', params: {},
    run: function (ctx) {
      if (E.mergeLayers(ctx) === false) throw err('ONE_LAYER', '병합할 레이어가 없습니다');
      return documentInfo(ctx).layers;
    }
  });
  op('releaseToLayers', {
    undoable: true, group: '레이어', desc: '활성 레이어의 최상위 오브젝트를 각각 새 레이어로 배포합니다.', params: {},
    run: function (ctx) {
      if (E.releaseToLayers(ctx) === false) throw err('TOO_FEW', '배포하려면 오브젝트가 2개 이상 필요합니다');
      return documentInfo(ctx).layers;
    }
  });
  op('collectInLayer', {
    undoable: true, group: '레이어', desc: '선택한 오브젝트를 새 레이어로 모읍니다.',
    params: { query: Q, name: p('string', '새 레이어 이름') }, returns: 'id[]',
    run: function (ctx, a) {
      withSel(ctx, a.query, 'collectInLayer', function () {
        if (E.collectInNewLayer(ctx, a.name) === false) throw err('EMPTY', 'collectInLayer: 대상이 없습니다');
      });
      return ctx.sel.map(function (i) { return i.id; });
    }
  });

  /* ---------- 안내선 ---------- */
  op('addGuide', {
    undoable: true, group: '안내선', desc: '가로 · 세로 안내선을 추가합니다.',
    params: {
      axis: p('string', "축 ('h' = 가로선, 'v' = 세로선)", { enum: ['h', 'v'], required: true }),
      position: p('number', '문서 좌표 위치', { required: true })
    },
    run: function (ctx, a) {
      ctx.doc.guides.push({ axis: a.axis, pos: a.position });
      return ctx.doc.guides.map(function (g) { return { axis: g.axis, position: U.round(g.pos, 4) }; });
    }
  });
  op('guides', {
    undoable: false, group: '안내선', desc: '안내선 목록을 반환합니다.', params: {},
    run: function (ctx) {
      return ctx.doc.guides.map(function (g) { return { axis: g.axis, position: U.round(g.pos, 4) }; });
    }
  });
  op('clearGuides', {
    undoable: true, group: '안내선', desc: '모든 안내선을 지웁니다.', params: {},
    run: function (ctx) { var n = ctx.doc.guides.length; ctx.doc.guides = []; return n; }
  });
  op('releaseGuides', {
    undoable: true, group: '안내선', desc: '안내선을 선 오브젝트로 바꿉니다.', params: {}, returns: 'id[]',
    run: function (ctx) {
      if (E.releaseGuides(ctx) === false) throw err('NO_GUIDES', '안내선이 없습니다');
      return ctx.sel.map(function (i) { return i.id; });
    }
  });

  /* ---------- 앵커 단위 패스 편집 ----------
     에이전트가 도형을 통째로 다시 그리지 않고 "고칠" 수 있게 한다.
     좌표는 모두 문서(월드) 좌표다 — 아이템의 변환은 내부에서 처리한다. */
  function pathOf(ctx, q, opName) {
    var list = need(ctx, q, opName);
    var it = list[0];
    if (!it || it.type !== 'path') throw err('NOT_PATH', opName + ': 패스를 지정하세요');
    return it;
  }
  function toLocal(ctx, it, x, y) {
    var inv = M.invert(Model.worldMatrix(ctx.doc, it));
    return M.apply(inv, x, y);
  }
  function anchorOut(ctx, it) {
    var wm = Model.worldMatrix(ctx.doc, it);
    return it.subs.map(function (sub, si) {
      return {
        index: si, closed: !!sub.closed,
        points: sub.pts.map(function (pt, pi) {
          var w = M.apply(wm, pt.x, pt.y);
          var o = { index: pi, x: U.round(w.x, 4), y: U.round(w.y, 4) };
          if (pt.ix != null) { var i2 = M.apply(wm, pt.ix, pt.iy); o.inX = U.round(i2.x, 4); o.inY = U.round(i2.y, 4); }
          if (pt.ox != null) { var o2 = M.apply(wm, pt.ox, pt.oy); o.outX = U.round(o2.x, 4); o.outY = U.round(o2.y, 4); }
          return o;
        })
      };
    });
  }

  op('anchors', {
    undoable: false, group: '앵커', desc: '패스의 앵커와 방향선을 문서 좌표로 반환합니다.',
    params: { query: Q },
    run: function (ctx, a) {
      var it = pathOf(ctx, a.query, 'anchors');
      return { id: it.id, subpaths: anchorOut(ctx, it) };
    }
  });

  op('setAnchor', {
    undoable: true, group: '앵커', desc: '앵커 하나의 위치와 방향선을 바꿉니다 (문서 좌표).',
    params: {
      query: Q,
      subpath: p('number', '서브패스 번호', { default: 0 }),
      index: p('number', '앵커 번호', { required: true }),
      x: p('number', '앵커 x'), y: p('number', '앵커 y'),
      inX: p('number', '들어오는 방향선 x'), inY: p('number', '들어오는 방향선 y'),
      outX: p('number', '나가는 방향선 x'), outY: p('number', '나가는 방향선 y'),
      corner: p('boolean', '참이면 방향선을 없애 코너로 만듭니다')
    },
    run: function (ctx, a) {
      var it = pathOf(ctx, a.query, 'setAnchor');
      var sub = it.subs[a.subpath == null ? 0 : Math.round(a.subpath)];
      if (!sub) throw err('NO_SUBPATH', 'setAnchor: 서브패스 ' + a.subpath + ' 이(가) 없습니다');
      var pt = sub.pts[Math.round(a.index)];
      if (!pt) throw err('NO_ANCHOR', 'setAnchor: 앵커 ' + a.index + ' 이(가) 없습니다');
      if (a.x != null || a.y != null) {
        var w = M.apply(Model.worldMatrix(ctx.doc, it), pt.x, pt.y);
        var q = toLocal(ctx, it, a.x == null ? w.x : a.x, a.y == null ? w.y : a.y);
        var dx = q.x - pt.x, dy = q.y - pt.y;
        pt.x = q.x; pt.y = q.y;
        /* 방향선은 앵커를 따라 함께 움직인다 (일러스트레이터와 동일) */
        if (pt.ix != null) { pt.ix += dx; pt.iy += dy; }
        if (pt.ox != null) { pt.ox += dx; pt.oy += dy; }
      }
      if (a.corner) { delete pt.ix; delete pt.iy; delete pt.ox; delete pt.oy; }
      if (a.inX != null && a.inY != null) { var i2 = toLocal(ctx, it, a.inX, a.inY); pt.ix = i2.x; pt.iy = i2.y; }
      if (a.outX != null && a.outY != null) { var o2 = toLocal(ctx, it, a.outX, a.outY); pt.ox = o2.x; pt.oy = o2.y; }
      it.shape = null;                    /* 손으로 고쳤으므로 라이브 셰이프는 해제 */
      return { id: it.id, subpaths: anchorOut(ctx, it) };
    }
  });

  op('addAnchor', {
    undoable: true, group: '앵커', desc: '세그먼트 위 t(0~1) 위치에 앵커를 끼워 넣습니다.',
    params: {
      query: Q, subpath: p('number', '서브패스 번호', { default: 0 }),
      segment: p('number', '세그먼트 번호 (앵커 n 과 n+1 사이)', { required: true }),
      t: p('number', '세그먼트 안의 위치 0~1', { default: 0.5 })
    },
    run: function (ctx, a) {
      var it = pathOf(ctx, a.query, 'addAnchor');
      var sub = it.subs[a.subpath == null ? 0 : Math.round(a.subpath)];
      if (!sub) throw err('NO_SUBPATH', 'addAnchor: 서브패스가 없습니다');
      var segs = G.segments(sub);
      var si = Math.round(a.segment);
      if (si < 0 || si >= segs.length) throw err('NO_SEGMENT', 'addAnchor: 세그먼트 ' + a.segment + ' 이(가) 없습니다 (0~' + (segs.length - 1) + ')');
      G.insertAnchor(sub, si, U.clamp(a.t == null ? 0.5 : a.t, 0, 1));
      it.shape = null;
      return { id: it.id, subpaths: anchorOut(ctx, it) };
    }
  });

  op('removeAnchor', {
    undoable: true, group: '앵커', desc: '앵커를 지웁니다.',
    params: { query: Q, subpath: p('number', '서브패스 번호', { default: 0 }), index: p('number', '앵커 번호', { required: true }) },
    run: function (ctx, a) {
      var it = pathOf(ctx, a.query, 'removeAnchor');
      var sub = it.subs[a.subpath == null ? 0 : Math.round(a.subpath)];
      if (!sub) throw err('NO_SUBPATH', 'removeAnchor: 서브패스가 없습니다');
      if (sub.pts.length <= 2) throw err('TOO_FEW', 'removeAnchor: 앵커가 2개 이하면 지울 수 없습니다');
      if (!sub.pts[Math.round(a.index)]) throw err('NO_ANCHOR', 'removeAnchor: 앵커 ' + a.index + ' 이(가) 없습니다');
      G.removeAnchor(sub, Math.round(a.index));
      it.shape = null;
      return { id: it.id, subpaths: anchorOut(ctx, it) };
    }
  });

  op('setSubpathClosed', {
    undoable: true, group: '앵커', desc: '서브패스를 닫거나 엽니다.',
    params: { query: Q, subpath: p('number', '서브패스 번호', { default: 0 }), closed: p('boolean', '닫힘 여부', { required: true }) },
    run: function (ctx, a) {
      var it = pathOf(ctx, a.query, 'setSubpathClosed');
      var sub = it.subs[a.subpath == null ? 0 : Math.round(a.subpath)];
      if (!sub) throw err('NO_SUBPATH', 'setSubpathClosed: 서브패스가 없습니다');
      sub.closed = !!a.closed;
      it.shape = null;
      return { id: it.id, closed: sub.closed };
    }
  });

  /* ---------- 심볼 · 패턴 ---------- */
  op('assets', {
    undoable: false, group: '자산', desc: '문서의 심볼 · 패턴 목록을 반환합니다.', params: {},
    run: function (ctx) {
      AI.assets.ensure(ctx.doc);
      return {
        symbols: ctx.doc.symbols.map(function (d) { return { id: d.id, name: d.name }; }),
        patterns: ctx.doc.patterns.map(function (d) { return { id: d.id, name: d.name, width: d.w, height: d.h }; })
      };
    }
  });
  op('defineSymbol', {
    undoable: true, group: '자산', desc: '선택 아트웍을 심볼로 등록하고 원본을 인스턴스로 바꿉니다.',
    params: { query: Q, name: p('string', '심볼 이름') }, returns: 'string',
    run: function (ctx, a) {
      var d;
      withSel(ctx, a.query, 'defineSymbol', function () { d = AI.assets.defineSymbol(ctx, a.name); });
      if (!d) throw err('SYMBOL_FAILED', 'defineSymbol: 심볼을 만들 수 없습니다');
      return d.id;
    }
  });
  op('placeSymbol', {
    undoable: true, group: '자산', desc: '심볼 인스턴스를 배치합니다.',
    params: {
      symbol: p('string', '심볼 id 또는 이름', { required: true }),
      x: p('number', 'x', { default: 0 }), y: p('number', 'y', { default: 0 })
    },
    returns: 'id',
    run: function (ctx, a) {
      AI.assets.ensure(ctx.doc);
      var d = AI.assets.findSymbol(ctx.doc, a.symbol);
      if (!d) {
        ctx.doc.symbols.forEach(function (x) { if (!d && x.name === a.symbol) d = x; });
      }
      if (!d) throw err('NO_SYMBOL', "placeSymbol: 심볼을 찾을 수 없습니다: '" + a.symbol + "'");
      var it = AI.assets.placeSymbol(ctx, d.id, a.x || 0, a.y || 0);
      return it ? it.id : null;
    }
  });
  op('breakSymbolLink', {
    undoable: true, group: '자산', desc: '심볼 인스턴스를 실제 아트웍으로 바꿉니다.',
    params: { query: Q }, returns: 'id[]',
    run: function (ctx, a) {
      var okRes;
      withSel(ctx, a.query, 'breakSymbolLink', function () { okRes = AI.assets.breakLink(ctx); });
      if (okRes === false) throw err('NO_INSTANCE', 'breakSymbolLink: 심볼 인스턴스가 없습니다');
      return ctx.sel.map(function (i) { return i.id; });
    }
  });
  op('definePattern', {
    undoable: true, group: '자산', desc: '선택 아트웍을 패턴 타일로 등록합니다.',
    params: { query: Q, name: p('string', '패턴 이름') }, returns: 'string',
    run: function (ctx, a) {
      var d;
      withSel(ctx, a.query, 'definePattern', function () { d = AI.assets.definePattern(ctx, a.name); });
      if (!d) throw err('PATTERN_FAILED', 'definePattern: 패턴을 만들 수 없습니다');
      return d.id;
    }
  });
  op('applyPattern', {
    undoable: true, group: '자산', desc: '등록한 패턴으로 칠하거나 획을 줍니다.',
    params: {
      query: Q, pattern: p('string', '패턴 id 또는 이름', { required: true }),
      target: p('string', '적용 대상', { enum: ['fill', 'stroke'], default: 'fill' }),
      scale: p('number', '타일 비율 (%)', { default: 100 }),
      angle: p('number', '타일 각도 (°)', { default: 0 })
    },
    returns: 'id[]',
    run: function (ctx, a) {
      AI.assets.ensure(ctx.doc);
      var d = AI.assets.findPattern(ctx.doc, a.pattern);
      if (!d) ctx.doc.patterns.forEach(function (x) { if (!d && x.name === a.pattern) d = x; });
      if (!d) throw err('NO_PATTERN', "applyPattern: 패턴을 찾을 수 없습니다: '" + a.pattern + "'");
      withSel(ctx, a.query, 'applyPattern', function () {
        E.applyPaint(ctx, AI.assets.patternPaint(d, { scale: a.scale, angle: a.angle }), a.target || 'fill');
      });
      return ctx.sel.map(function (i) { return i.id; });
    }
  });

  /* ---------- 마스크 · 블렌드 ---------- */
  op('opacityMask', {
    undoable: true, group: '패스', desc: '맨 앞 오브젝트를 불투명도 마스크로 씁니다 (밝기 = 불투명도).',
    params: { query: Q, invert: p('boolean', '마스크 반전', { default: false }) }, returns: 'id',
    run: function (ctx, a) {
      var okRes;
      withSel(ctx, a.query, 'opacityMask', function () { okRes = E.makeOpacityMask(ctx); });
      if (okRes === false) throw err('MASK_FAILED', 'opacityMask: 2개 이상 필요합니다');
      if (a.invert && ctx.sel[0]) ctx.sel[0].maskInvert = true;
      return ctx.sel[0] ? ctx.sel[0].id : null;
    }
  });
  op('blend', {
    undoable: true, group: '패스', desc: '두 오브젝트 사이에 중간 단계를 만듭니다.',
    params: { query: Q, steps: p('number', '중간 단계 수', { default: 5 }) }, returns: 'id',
    run: function (ctx, a) {
      var okRes;
      withSel(ctx, a.query, 'blend', function () { okRes = E.blend(ctx, a.steps); });
      if (okRes === false) throw err('BLEND_FAILED', 'blend: 블렌드할 수 없습니다');
      return ctx.sel[0] ? ctx.sel[0].id : null;
    }
  });
  op('recolor', {
    undoable: true, group: '스타일', desc: '선택 아트웍의 색을 바꾸거나 색조 · 채도 · 밝기를 조정합니다.',
    params: {
      query: Q,
      map: p('object', '{원본색: 새색} 형태의 치환표'),
      hue: p('number', '색조 회전 (°)'), saturation: p('number', '채도 증감 (%)'), lightness: p('number', '밝기 증감 (%)')
    },
    run: function (ctx, a) {
      var map = {};
      if (a.map) Object.keys(a.map).forEach(function (k) {
        map[String(k).toLowerCase()] = normalizeHex(a.map[k]) || a.map[k];
      });
      var changed;
      withSel(ctx, a.query, 'recolor', function () {
        changed = E.recolor(ctx, map, { hue: a.hue || 0, sat: a.saturation, light: a.lightness });
      });
      if (!changed) throw err('NO_CHANGE', 'recolor: 바뀐 색이 없습니다');
      return E.collectColors(ctx).map(function (c) { return c.color; });
    }
  });
  op('colors', {
    undoable: false, group: '스타일', desc: '선택 아트웍에 쓰인 색을 많이 쓰인 순서로 반환합니다.',
    params: { query: Q },
    run: function (ctx, a) {
      var out;
      var prev = ctx.sel;
      ctx.sel = need(ctx, a.query, 'colors');
      try { out = E.collectColors(ctx); } finally { ctx.sel = prev; }
      return out;
    }
  });

  /* ---------- 모양 (다중 칠/획) ---------- */
  op('appearance', {
    undoable: false, group: '모양', desc: '오브젝트의 모양 스택(칠·획 겹)을 아래→위 순서로 반환합니다.',
    params: { query: Q },
    run: function (ctx, a) {
      return need(ctx, a.query, 'appearance').map(function (it) {
        return {
          id: it.id,
          custom: AI.appearance.isCustom(it),
          layers: AI.appearance.list(it).map(function (e) {
            return e.kind === 'fill'
              ? { kind: 'fill', fill: paintOut(e.paint) }
              : { kind: 'stroke', stroke: strokeOut(e.stroke) };
          })
        };
      });
    }
  });
  op('addFill', {
    undoable: true, group: '모양', desc: '모양 스택에 칠을 한 겹 더합니다.',
    params: { query: Q, color: p('color', '새 칠 색상') }, returns: 'id[]',
    run: function (ctx, a) {
      withSel(ctx, a.query, 'addFill', function (list) {
        list.forEach(function (it) {
          if (!AI.appearance.supports(it)) return;
          AI.appearance.addFill(it, a.color === undefined ? null : paint(a.color));
        });
      });
      return ctx.sel.map(function (i) { return i.id; });
    }
  });
  op('addStroke', {
    undoable: true, group: '모양', desc: '모양 스택에 획을 한 겹 더합니다.',
    params: { query: Q, color: p('color', '새 획 색상'), width: p('number', '새 획 두께') },
    returns: 'id[]',
    run: function (ctx, a) {
      withSel(ctx, a.query, 'addStroke', function (list) {
        list.forEach(function (it) {
          if (!AI.appearance.supports(it)) return;
          var st = Model.mkStroke(a.color ? (normalizeHex(a.color) || '#000000') : '#000000',
            a.width == null ? 1 : a.width);
          AI.appearance.addStroke(it, st);
        });
      });
      return ctx.sel.map(function (i) { return i.id; });
    }
  });
  op('setAppearanceLayer', {
    undoable: true, group: '모양', desc: '모양 스택의 한 겹(index, 0 = 맨 아래)을 수정합니다.',
    params: {
      query: Q, index: p('number', '겹 번호 (0 = 맨 아래)', { required: true }),
      color: p('color', '색상'), width: p('number', '획 두께 (획 겹만)')
    },
    returns: 'id[]',
    run: function (ctx, a) {
      withSel(ctx, a.query, 'setAppearanceLayer', function (list) {
        list.forEach(function (it) {
          if (!AI.appearance.supports(it)) return;
          AI.appearance.materialize(it);
          var e = AI.appearance.entry(it, Math.round(a.index));
          if (!e) throw err('NO_LAYER', 'setAppearanceLayer: 겹 ' + a.index + ' 이(가) 없습니다');
          if (e.kind === 'fill') {
            if (a.color !== undefined) e.paint = paint(a.color);
          } else {
            if (a.color !== undefined) {
              var np = paint(a.color);
              if (np.type === 'none') e.stroke.type = 'none';
              else { e.stroke.type = 'solid'; e.stroke.color = np.color; e.stroke.alpha = np.alpha; }
            }
            if (a.width != null) { e.stroke.width = a.width; if (e.stroke.type === 'none') e.stroke.type = 'solid'; }
          }
          AI.appearance.sync(it);
        });
      });
      return ctx.sel.map(function (i) { return i.id; });
    }
  });
  op('removeAppearanceLayer', {
    undoable: true, group: '모양', desc: '모양 스택에서 한 겹을 제거합니다.',
    params: { query: Q, index: p('number', '겹 번호 (0 = 맨 아래)', { required: true }) },
    returns: 'id[]',
    run: function (ctx, a) {
      withSel(ctx, a.query, 'removeAppearanceLayer', function (list) {
        list.forEach(function (it) {
          if (!AI.appearance.supports(it)) return;
          AI.appearance.materialize(it);
          if (!AI.appearance.removeAt(it, Math.round(a.index))) {
            throw err('LAST_LAYER', 'removeAppearanceLayer: 마지막 겹은 지울 수 없습니다');
          }
        });
      });
      return ctx.sel.map(function (i) { return i.id; });
    }
  });
  op('expandAppearance', {
    undoable: true, group: '모양', desc: '모양 스택의 각 겹을 실제 오브젝트(그룹)로 펼칩니다.',
    params: { query: Q }, returns: 'id[]',
    run: function (ctx, a) {
      var out = [], any = false;
      withSel(ctx, a.query, 'expandAppearance', function (list) {
        list.slice().forEach(function (it) {
          var parts = AI.appearance.expand(it);
          if (!parts) { out.push(it); return; }
          var g = Model.newGroup(parts);
          g.name = it.name + ' (확장)';
          g.m = it.m.slice();
          g.opacity = it.opacity;
          g.blend = it.blend;
          if (AI.effects.hasAny(it)) g.effects = U.deepCopy(it.effects);
          parts.forEach(function (c) { c.m = M.ident(); });
          var loc = Model.locate(ctx.doc, it);
          if (loc) loc.list.splice(loc.index, 1, g); else Model.activeLayer(ctx.doc).children.push(g);
          out.push(g);
          any = true;
        });
      });
      if (!any) throw err('NOTHING_TO_EXPAND', 'expandAppearance: 확장할 모양 스택이 없습니다');
      ctx.sel = out;
      return out.map(function (i) { return i.id; });
    }
  });

  /* ---------- 효과 ---------- */
  var FX_PARAMS = {
    radius: p('number', '흐림 반경 (blur)'),
    dx: p('number', 'X 오프셋 (shadow)'), dy: p('number', 'Y 오프셋 (shadow)'),
    blur: p('number', '흐림 정도 (shadow · glow)'),
    color: p('color', '효과 색상 (shadow · glow)'),
    alpha: p('number', '효과 불투명도 0~1 (shadow · glow)'),
    /* 왜곡 및 변형 (기하 효과) */
    size: p('number', '크기 pt (zigzag · roughen)'),
    ridges: p('number', '세그먼트당 융기 수 (zigzag)'),
    detail: p('number', '세부 (roughen)'),
    smooth: p('boolean', '매끄러운 점으로 (zigzag · roughen)'),
    amount: p('number', '오목(-) · 볼록(+) % (puckerBloat)'),
    angle: p('number', '각도 ° (twist · transformFx)'),
    scaleX: p('number', '가로 비율 % (transformFx)'),
    scaleY: p('number', '세로 비율 % (transformFx)'),
    moveX: p('number', '가로 이동 pt (transformFx)'),
    moveY: p('number', '세로 이동 pt (transformFx)'),
    copies: p('number', '사본 수 (transformFx)'),
    anchor: p('number', '기준점 0~8 (transformFx)'),
    reflectX: p('boolean', 'X 반사 (transformFx)'),
    reflectY: p('boolean', 'Y 반사 (transformFx)'),
    corners: p('number[]', '네 모퉁이 이동량 % [tlx,tly,trx,try,brx,bry,blx,bly] (freeDistort)')
  };
  var FX_KEYS = ['radius', 'dx', 'dy', 'blur', 'alpha', 'size', 'ridges', 'detail',
    'smooth', 'amount', 'angle', 'scaleX', 'scaleY', 'moveX', 'moveY', 'copies',
    'anchor', 'reflectX', 'reflectY'];
  var FX_ENUM = ['blur', 'shadow', 'glow',
    'zigzag', 'roughen', 'puckerBloat', 'twist', 'transformFx', 'freeDistort'];
  op('applyEffect', {
    undoable: true, group: '효과', desc: '비파괴 효과를 적용합니다. 같은 종류가 이미 있으면 값을 갱신합니다.',
    params: (function () {
      var o = { query: Q, type: p('string', '효과 종류', { enum: FX_ENUM, required: true }) };
      for (var k in FX_PARAMS) o[k] = FX_PARAMS[k];
      return o;
    })(),
    returns: 'id[]',
    run: function (ctx, a) {
      var FX = AI.effects;
      if (!FX.def(a.type)) throw err('BAD_EFFECT', '알 수 없는 효과: ' + a.type);
      withSel(ctx, a.query, 'applyEffect', function (list) {
        list.forEach(function (it) {
          var base = null;
          (it.effects || []).forEach(function (e) { if (!base && e.type === a.type) base = e; });
          var e2 = base || FX.create(a.type);
          FX_KEYS.forEach(function (k) {
            if (a[k] != null && e2[k] !== undefined) e2[k] = a[k];
          });
          if (a.color != null && e2.color !== undefined) e2.color = normalizeHex(a.color) || e2.color;
          /* 자유 왜곡의 네 모퉁이는 한 배열로 받는다 */
          if (a.corners && e2.tl) {
            var c = a.corners;
            e2.tl = [+c[0] || 0, +c[1] || 0]; e2.tr = [+c[2] || 0, +c[3] || 0];
            e2.br = [+c[4] || 0, +c[5] || 0]; e2.bl = [+c[6] || 0, +c[7] || 0];
          }
          if (!base) { it.effects = it.effects || []; it.effects.push(e2); }
        });
      });
      return ctx.sel.map(function (i) { return i.id; });
    }
  });
  op('clearEffects', {
    undoable: true, group: '효과', desc: '적용된 효과를 모두 제거합니다.', params: { query: Q }, returns: 'id[]',
    run: function (ctx, a) {
      withSel(ctx, a.query, 'clearEffects', function (list) {
        list.forEach(function (it) { AI.effects.clear(it); });
      });
      return ctx.sel.map(function (i) { return i.id; });
    }
  });
  op('effects', {
    undoable: false, group: '효과', desc: '대상에 적용된 효과 목록을 반환합니다.', params: { query: Q },
    run: function (ctx, a) {
      return need(ctx, a.query, 'effects').map(function (it) {
        return { id: it.id, effects: AI.effects.list(it).map(function (e) { return U.deepCopy(e); }) };
      });
    }
  });

  /* ---------- 획 화살표 ---------- */
  var ARROW_ENUM = ['none', 'arrow', 'triangle', 'circle', 'square', 'bar'];
  op('setArrowheads', {
    undoable: true, group: '스타일', desc: '열린 패스의 시작 · 끝 화살표를 지정합니다.',
    params: {
      query: Q,
      start: p('string', '시작 화살표', { enum: ARROW_ENUM }),
      end: p('string', '끝 화살표', { enum: ARROW_ENUM }),
      scale: p('number', '화살표 비율 (%)')
    },
    returns: 'id[]',
    run: function (ctx, a) {
      if (a.start == null && a.end == null && a.scale == null) {
        throw err('NO_ARGS', 'setArrowheads: start · end · scale 중 하나는 지정해야 합니다');
      }
      withSel(ctx, a.query, 'setArrowheads', function () {
        if (a.start != null) E.applyStrokeProp(ctx, 'arrowStart', a.start);
        if (a.end != null) E.applyStrokeProp(ctx, 'arrowEnd', a.end);
        if (a.scale != null) E.applyStrokeProp(ctx, 'arrowScale', U.clamp(a.scale, 1, 1000));
      });
      return ctx.sel.map(function (i) { return i.id; });
    }
  });

  /* ---------- 개별 변형 ---------- */
  op('transformEach', {
    undoable: true, group: '변형', desc: '선택한 오브젝트를 각자의 기준점 기준으로 변형합니다.',
    params: {
      query: Q,
      scaleX: p('number', '가로 비율 (%)', { default: 100 }),
      scaleY: p('number', '세로 비율 (%)', { default: 100 }),
      dx: p('number', '가로 이동', { default: 0 }),
      dy: p('number', '세로 이동', { default: 0 }),
      angle: p('number', '회전 각도 (°, 반시계)', { default: 0 }),
      anchor: p('number', '기준점 0~8 (0=좌상단, 4=가운데)', { default: 4 }),
      reflectX: p('boolean', 'X 반사'), reflectY: p('boolean', 'Y 반사'),
      random: p('number', '임의 적용 (참이면 오브젝트마다 임의 값)')
    },
    run: function (ctx, a) {
      withSel(ctx, a.query, 'transformEach', function () {
        E.transformEach(ctx, {
          sx: a.scaleX == null ? 100 : a.scaleX, sy: a.scaleY == null ? 100 : a.scaleY,
          dx: a.dx || 0, dy: a.dy || 0, angle: a.angle || 0,
          anchor: a.anchor == null ? 4 : a.anchor,
          reflectX: !!a.reflectX, reflectY: !!a.reflectY, random: !!a.random
        });
      });
      return rect(Rn.selectionBounds(ctx, true));
    }
  });

  /* ---------- 이미지 ---------- */
  op('cropImage', {
    undoable: true, group: '이미지', desc: '이미지와 그 위의 도형을 함께 지정하면 도형 경계로 이미지를 자릅니다.',
    params: { query: Q }, returns: 'id',
    run: function (ctx, a) {
      var okRes;
      withSel(ctx, a.query, 'cropImage', function () { okRes = E.cropImage(ctx); });
      if (okRes === false) throw err('CROP_FAILED', 'cropImage: 이미지와 자를 도형을 함께 선택하세요');
      return ctx.sel[0] ? ctx.sel[0].id : null;
    }
  });
  op('imageTrace', {
    undoable: true, group: '이미지', desc: '이미지를 벡터 패스 그룹으로 추적합니다 (브라우저 전용).',
    params: {
      query: Q,
      preset: p('string', '사전 설정', { enum: Object.keys(AI.trace ? AI.trace.PRESETS : {}) }),
      mode: p('string', '모드', { enum: ['bw', 'gray', 'color'] }),
      colors: p('number', '색상 수 (gray · color)'),
      threshold: p('number', '한계값 0~255 (bw)'),
      path: p('number', '패스 단순화 허용치 — 클수록 단순'),
      noise: p('number', '노이즈 제거 최소 면적 (px²)'),
      curves: p('boolean', '곡선으로 맞춤', { default: true })
    },
    returns: 'id',
    run: function (ctx, a) {
      var TR = AI.trace;
      if (!TR || !U.hasDOM) throw err('NO_DOM', 'imageTrace: 브라우저 환경에서만 사용할 수 있습니다');
      var list = need(ctx, a.query, 'imageTrace');
      var img = null;
      list.forEach(function (it) { if (!img && it.type === 'image') img = it; });
      if (!img) throw err('NO_IMAGE', 'imageTrace: 이미지를 선택하세요');
      var el = Rn.getImage(img.src);
      if (!el || !el.complete || !el.naturalWidth) throw err('IMAGE_LOADING', 'imageTrace: 이미지를 아직 읽는 중입니다');

      var P = (a.preset && TR.PRESETS[a.preset]) || TR.PRESETS.color6;
      var opt = {
        mode: a.mode || P.mode,
        colors: a.colors == null ? P.colors : a.colors,
        threshold: a.threshold == null ? P.threshold : a.threshold,
        path: a.path == null ? P.path : a.path,
        noise: a.noise == null ? P.noise : a.noise,
        curves: a.curves !== false
      };
      var g = TR.toGroup(ctx, img, TR.traceImage(el, opt), opt);
      if (!g) throw err('TRACE_EMPTY', 'imageTrace: 추적 결과가 비어 있습니다');
      var loc = Model.locate(ctx.doc, img);
      if (loc) loc.list.splice(loc.index, 1, g);
      else Model.activeLayer(ctx.doc).children.push(g);
      ctx.sel = [g];
      return g.id;
    }
  });

  /* ---------- 히스토리 ---------- */
  op('undo', {
    undoable: false, group: '히스토리', desc: '실행을 취소합니다.', params: {}, 
    run: function (ctx) {
      var s = ctx.history.undo(ctx.doc);
      if (!s) return { ok: false, message: '취소할 항목이 없습니다' };
      ctx.setDoc(s);
      return { ok: true, next: ctx.history.undoLabel() };
    }
  });
  op('redo', {
    undoable: false, group: '히스토리', desc: '취소한 작업을 다시 실행합니다.', params: {}, 
    run: function (ctx) {
      var s = ctx.history.redo(ctx.doc);
      if (!s) return { ok: false, message: '다시 실행할 항목이 없습니다' };
      ctx.setDoc(s);
      return { ok: true, next: ctx.history.redoLabel() };
    }
  });
  op('history', {
    undoable: false, group: '히스토리', desc: '실행 취소 스택 상태를 반환합니다.', params: {}, 
    run: function (ctx) {
      return {
        canUndo: ctx.history.canUndo(), canRedo: ctx.history.canRedo(),
        undoLabel: ctx.history.undoLabel(), redoLabel: ctx.history.redoLabel(),
        depth: ctx.history.stack.length
      };
    }
  });

  /* ---------- 출력 ---------- */
  op('toSVG', {
    undoable: false, group: '출력', desc: '대지 하나를 SVG 문자열로 반환합니다 (생략 시 활성 대지).',
    params: { artboard: p('number', '대지 번호 (0부터)') }, returns: 'string',
    run: function (ctx, a) { return AI.io.toSVG(ctx, a.artboard); }
  });
  op('exportArtboards', {
    undoable: false, group: '출력',
    desc: '대지마다 하나씩 내보냅니다. 브라우저에서는 파일로 내려받고, 그 밖에는 문자열 목록을 반환합니다.',
    params: {
      format: p('string', '형식', { enum: ['svg', 'png', 'pdf'], default: 'svg' }),
      artboards: p('number[]', '대지 번호 목록 (0부터, 생략 시 전체)'),
      scale: p('number', 'PNG 배율', { default: 2 }),
      background: p('boolean', '대지 배경 포함', { default: true }),
      download: p('boolean', '브라우저에서 파일로 내려받기', { default: false })
    },
    run: function (ctx, a) {
      var all = ctx.doc.artboards.map(function (_, i) { return i; });
      var idx = (a.artboards && a.artboards.length)
        ? a.artboards.map(function (v) { return U.clamp(Math.round(v), 0, all.length - 1); })
        : all;
      if (a.download) {
        if (!U.hasDOM) throw err('NO_DOM', 'download 는 브라우저에서만 쓸 수 있습니다');
        return AI.io.exportArtboardsNow(ctx, {
          format: a.format, indexes: idx, scale: a.scale, background: a.background !== false
        });
      }
      return idx.map(function (i) {
        var ab = ctx.doc.artboards[i];
        var o = { index: i, name: ab.name, width: ab.w, height: ab.h };
        if (a.format === 'svg') o.svg = AI.io.toSVG(ctx, i);
        else if (a.format === 'pdf') {
          if (!AI.pdf) throw err('NO_PDF', 'PDF 모듈을 찾을 수 없습니다');
          o.pdf = AI.pdf.toPDF(ctx, { artboard: i, background: a.background !== false });
        } else {
          if (!U.hasDOM) throw err('NO_CANVAS', 'PNG 는 브라우저에서만 만들 수 있습니다');
          o.png = AI.io.renderArtboard(ctx, i, U.clamp(a.scale == null ? 2 : a.scale, 0.05, 20),
            a.background !== false).toDataURL('image/png');
        }
        return o;
      });
    }
  });
  op('toJSON', {
    undoable: false, group: '출력', desc: '문서 전체를 저장 형식(JSON 문자열)으로 반환합니다.', params: {}, returns: 'string', 
    run: function (ctx) { return JSON.stringify({ format: 'illymolly', version: 1, doc: ctx.doc }); }
  });
  op('loadJSON', {
    undoable: false, group: '출력', desc: '저장 형식 JSON 을 불러옵니다.', params: { json: p('string', 'toJSON 이 만든 문자열', { required: true }) },
    run: function (ctx, a) {
      var o = JSON.parse(a.json);
      var d = o.doc || o;
      AI.io.normalizeDoc(d);
      ctx.setDoc(d);
      ctx.history.reset(ctx.doc, '불러오기');
      return documentInfo(ctx);
    }
  });
  op('toPDF', {
    undoable: false, group: '출력', desc: '활성 대지를 벡터 PDF 문자열로 반환합니다 (latin1 바이트 문자열).',
    params: { artboard: p('number', '대지 번호 (생략 시 활성 대지)') }, returns: 'string',
    run: function (ctx, a) {
      if (!AI.pdf) throw err('NO_PDF', 'toPDF: PDF 모듈을 찾을 수 없습니다');
      var str = AI.pdf.toPDF(ctx, { artboard: a.artboard });
      return str;
    }
  });

  op('toPNG', {
    undoable: false, group: '출력', desc: '활성 대지를 PNG data URL 로 반환합니다 (브라우저 전용).',
    params: {
      scale: p('number', '배율', { default: 2 }),
      background: p('boolean', '대지 배경 포함', { default: true }),
      artboard: p('number', '대지 번호 (생략 시 활성 대지)')
    },
    returns: 'string',
    run: function (ctx, a) {
      if (!U.hasDOM) throw err('NO_CANVAS', 'toPNG 는 브라우저에서만 사용할 수 있습니다. Node 에서는 toSVG 를 쓰세요.');
      var i = a.artboard == null ? ctx.doc.activeArtboard
        : U.clamp(Math.round(a.artboard), 0, ctx.doc.artboards.length - 1);
      var scale = U.clamp(a.scale == null ? 2 : a.scale, 0.05, 20);
      return AI.io.renderArtboard(ctx, i, scale, a.background !== false).toDataURL('image/png');
    }
  });

  /* ---------- GUI 연동 (브라우저 전용) ---------- */
  op('setTool', {
    undoable: false, group: 'GUI', desc: '도구를 전환합니다 (브라우저 전용).',
    params: { tool: p('string', '도구 id', { required: true }) }, 
    run: function (ctx, a) {
      if (ctx.headless || !AI.tools) throw err('GUI_ONLY', 'setTool 은 브라우저에서만 사용할 수 있습니다');
      if (!AI.tools.get(a.tool)) throw err('NO_TOOL', "도구를 찾을 수 없습니다: '" + a.tool + "'. illy.ops() 의 setTool 설명을 참고하세요.");
      AI.tools.setTool(ctx, a.tool, true);
      return ctx.tool;
    }
  });
  op('zoom', {
    undoable: false, group: 'GUI', desc: '확대/축소 또는 대지 맞춤 (브라우저 전용).',
    params: { scale: p('number', '배율 (1=100%)'), fit: p('string', '맞춤', { enum: ['artboard', 'all'] }) },
    
    run: function (ctx, a) {
      if (ctx.headless || !AI.viewT) throw err('GUI_ONLY', 'zoom 은 브라우저에서만 사용할 수 있습니다');
      if (a.fit === 'all') AI.viewT.fitAll(ctx);
      else if (a.fit) AI.viewT.fitArtboard(ctx);
      else if (a.scale) AI.viewT.setZoom(ctx, a.scale);
      return { scale: U.round(ctx.view.scale, 4) };
    }
  });

  /* ===================== 실행기 ===================== */
  function coerce(spec, v, name, opName) {
    if (v === undefined || v === null) return v;
    switch (spec.type) {
      case 'number':
        var n = typeof v === 'number' ? v : parseFloat(v);
        if (!isFinite(n)) throw err('BAD_ARG', opName + '.' + name + ': 숫자가 필요합니다 (받은 값: ' + JSON.stringify(v) + ')');
        return n;
      case 'boolean': return !!v;
      case 'string':
        var s = String(v);
        if (spec.enum && spec.enum.indexOf(s) < 0) {
          throw err('BAD_ARG', opName + '.' + name + ": '" + s + "' 은(는) 허용되지 않습니다. 가능한 값: " + spec.enum.join(', '));
        }
        return s;
      case 'number[]':
        if (!Array.isArray(v)) throw err('BAD_ARG', opName + '.' + name + ': 배열이 필요합니다');
        return v.map(Number);
      default: return v;
    }
  }

  function execute(ctx, opName, args) {
    var spec = OPS[opName];
    if (!spec) throw err('NO_OP', "알 수 없는 연산: '" + opName + "'. 비슷한 것: " + suggest(opName).join(', ') || '(없음)');
    args = args || {};
    var a = {};
    Object.keys(spec.params).forEach(function (k) {
      var ps = spec.params[k];
      var v = args[k];
      if (v === undefined && ps.default !== undefined) v = ps.default;
      if (v === undefined && ps.required) {
        throw err('MISSING_ARG', opName + ': 필수 인자 누락 — ' + k + ' (' + ps.description + ')');
      }
      a[k] = coerce(ps, v, k, opName);
    });
    /* 알 수 없는 인자는 조용히 무시하지 않고 알려 준다 */
    var unknown = Object.keys(args).filter(function (k) { return !(k in spec.params); });
    if (unknown.length) {
      throw err('UNKNOWN_ARG', opName + ': 알 수 없는 인자 — ' + unknown.join(', ') +
        '. 사용 가능: ' + Object.keys(spec.params).join(', '));
    }
    return spec.run(ctx, a);
  }

  function suggest(name) {
    var lower = String(name).toLowerCase();
    return Object.keys(OPS).filter(function (k) {
      return k.toLowerCase().indexOf(lower.slice(0, 4)) >= 0 || lower.indexOf(k.toLowerCase().slice(0, 4)) >= 0;
    }).slice(0, 4);
  }

  /* ===================== illy 객체 생성 ===================== */
  /* 인자 정규화 — 에이전트가 자연스럽게 쓰는 형태를 모두 받는다.
       illy.find({type:'path'})        선택자만
       illy.remove('박스')             문자열 선택자
       illy.set('박스', {fill:'red'})  (선택자, 인자)
       illy.rotate({angle:90})         선택자 생략 = 현재 선택
     판정 규칙: op 에 query 파라미터가 있고, 넘긴 객체의 키 중 실제 파라미터
     이름이 하나도 없으면 그 객체 전체를 선택자로 본다. 모호함이 없다. */
  function normArgs(opName, a, b) {
    var spec = OPS[opName];
    if (!spec) return a || {};
    var hasQuery = 'query' in spec.params;
    if (b !== undefined && b !== null) {
      var merged = {};
      Object.keys(b).forEach(function (k) { merged[k] = b[k]; });
      if (hasQuery) merged.query = a;
      return merged;
    }
    if (a === undefined || a === null) return {};
    if (typeof a === 'string' || Array.isArray(a)) return hasQuery ? { query: a } : {};
    if (typeof a === 'object') {
      var keys = Object.keys(a);
      var known = keys.some(function (k) { return k in spec.params; });
      if (hasQuery && keys.length && !known) return { query: a };
      return a;
    }
    return {};
  }
  API.normArgs = normArgs;

  API.create = function (ctx) {
    var inBatch = false;

    function refresh() {
      ctx.invalidate && ctx.invalidate();
      if (!ctx.headless && AI.ui && AI.ui.syncAll) AI.ui.syncAll(ctx);
    }

    function call(opName, args) {
      var spec = OPS[opName];
      var mutating = spec && spec.undoable;
      if (mutating && !inBatch) ctx.history.begin(opName, ctx.doc);
      try {
        var r = execute(ctx, opName, args);
        if (mutating && !inBatch) ctx.history.commit();
        if (!inBatch) refresh();
        return r;
      } catch (e) {
        if (mutating && !inBatch) ctx.history.abort();
        throw e;
      }
    }

    var illy = {
      version: API.VERSION,
      /* 저수준 진입점 — RPC 는 이걸 쓴다 */
      run: function (opName, args, args2) {
        try { return { ok: true, result: call(opName, normArgs(opName, args, args2)) }; }
        catch (e) { return { ok: false, error: { code: e.code || 'ERROR', message: e.message } }; }
      },
      /* 원자적 배치 — 하나라도 실패하면 전부 되돌린다 */
      batch: function (ops, label) {
        if (!Array.isArray(ops)) throw err('BAD_ARG', 'batch: 배열이 필요합니다');
        var before = U.deepCopy(ctx.doc);
        var selIds = ctx.sel.map(function (i) { return i.id; });
        ctx.history.begin(label || ('batch(' + ops.length + ')'), ctx.doc);
        inBatch = true;
        var results = [];
        try {
          for (var i = 0; i < ops.length; i++) {
            var o = ops[i];
            var nm = o.op || o.name;
            results.push(execute(ctx, nm, normArgs(nm, o.args || o.params || o.query, o.args && o.query ? o.args : undefined)));
          }
          inBatch = false;
          ctx.history.commit();
          refresh();
          return { ok: true, results: results };
        } catch (e) {
          inBatch = false;
          ctx.history.abort();
          ctx.setDoc(before);
          ctx.sel = selIds.map(function (id) { return Model.find(ctx.doc, id); }).filter(Boolean);
          refresh();
          return {
            ok: false,
            failedAt: results.length,
            failedOp: ops[results.length] && (ops[results.length].op || ops[results.length].name),
            error: { code: e.code || 'ERROR', message: e.message },
            rolledBack: true
          };
        }
      },
      /* 여러 변경을 하나의 실행 취소 단위로 묶는다 */
      transaction: function (label, fn) {
        ctx.history.begin(label || 'transaction', ctx.doc);
        inBatch = true;
        try {
          var r = fn(illy);
          inBatch = false;
          ctx.history.commit();
          refresh();
          return r;
        } catch (e) {
          inBatch = false;
          ctx.history.abort();
          throw e;
        }
      },
      /* 도구 매니페스트 — LLM 함수 정의로 그대로 넘길 수 있다 */
      ops: function (filter) {
        return Object.keys(OPS)
          .filter(function (k) { return !filter || OPS[k].group === filter || k.indexOf(filter) >= 0; })
          .map(function (k) {
            var s = OPS[k];
            var props = {}, required = [];
            Object.keys(s.params).forEach(function (n) {
              var ps = s.params[n];
              var t = { type: ps.type, description: ps.description };
              if (ps.enum) t.enum = ps.enum;
              if (ps.default !== undefined) t.default = ps.default;
              props[n] = t;
              if (ps.required) required.push(n);
            });
            return {
              name: k, group: s.group, description: s.desc,
              parameters: { type: 'object', properties: props, required: required },
              returns: s.returns || 'object',
              undoable: !!s.undoable
            };
          });
      },
      help: function (name) {
        if (!name) {
          var by = {};
          Object.keys(OPS).forEach(function (k) { (by[OPS[k].group] = by[OPS[k].group] || []).push(k); });
          return Object.keys(by).map(function (g) { return g + ': ' + by[g].join(', '); }).join('\n');
        }
        var s = OPS[name];
        if (!s) return "알 수 없는 연산: '" + name + "'. 비슷한 것: " + suggest(name).join(', ');
        var lines = [name + ' — ' + s.desc];
        Object.keys(s.params).forEach(function (k) {
          var ps = s.params[k];
          lines.push('  ' + k + ' (' + ps.type + (ps.required ? ', 필수' : '') +
            (ps.default !== undefined ? ', 기본 ' + JSON.stringify(ps.default) : '') + ') — ' + ps.description +
            (ps.enum ? ' [' + ps.enum.join('|') + ']' : ''));
        });
        return lines.join('\n');
      },
      /* 내부 접근 (고급) */
      _context: function () { return ctx; }
    };

    /* OPS 를 그대로 메서드로 노출 — 실패 시 예외를 던진다 */
    Object.keys(OPS).forEach(function (k) {
      illy[k] = function (a, b) { return call(k, normArgs(k, a, b)); };
    });

    /* 자주 쓰는 축약 */
    illy.rect = illy.addRect;
    illy.ellipse = illy.addEllipse;
    illy.text = illy.addText;
    illy.path = illy.addPath;
    illy.image = illy.addImage;

    return illy;
  };

  API.OPS = OPS;
  API.execute = execute;
})(typeof globalThis !== 'undefined' ? globalThis.AI : window.AI);
