/* =========================================================================
   preflight.js — 출고 전 검사와 자동 수정
   -------------------------------------------------------------------------
   인쇄소가 파일을 반려하는 이유는 거의 정해져 있다. 규칙이 명문화되어 있고,
   항목이 수십 개이고, 사람이 눈으로 훑다가 빠뜨린다. 창의성이 아니라
   정확성만 필요한 일이라 도구가 대신하기에 딱 맞는다.

     PF.run(app, intent)   — 검사만. 무엇이 왜 걸렸는지 목록으로.
     PF.fix(app, opts)     — 고칠 수 있는 것을 고치고 무엇을 고쳤는지 보고.

   규칙 하나는 { code, level, label, test, fix? } 다.
     test(ctx) -> [{ id, name, detail }]     걸린 것들
     fix(ctx, hits) -> '무엇을 했는지'       없으면 자동 수정 불가

   업종(intent)마다 규칙이 다르다. 인쇄는 CMYK 를 요구하고 레이저는 RGB 를
   요구한다 — 한 벌로 덮을 수 없어서 규칙마다 적용 업종을 적어 둔다.
   ========================================================================= */
(function (AI) {
  'use strict';
  var U = AI.util, Col = AI.color, Model = AI.model, PP = AI.prepress, R = AI.rect, Rn = AI.render;
  var PF = AI.preflight = {};

  var ALL = ['print', 'cut', 'laser', 'screen'];

  /* 검사 대상 — 잠긴 레이어의 재단 표시는 우리가 만든 것이므로 뺀다 */
  function targets(app) {
    var out = [];
    Model.walkWorld(app.doc, function (it, info) {
      if (info.layer && info.layer.name === '재단 표시') return false;
      if (it.type === 'group') return;
      out.push({ it: it, m: info.m, layer: info.layer });
    });
    return out;
  }

  function hit(o, detail) {
    return { id: o.it ? o.it.id : o.id, name: (o.it || o).name || '', detail: detail || '' };
  }

  /* =====================================================================
     규칙
     ===================================================================== */
  var RULES = [];
  function rule(r) { RULES.push(r); return r; }

  /* ---- 색상 모드 ---- */
  rule({
    code: 'color-mode',
    level: 'error',
    intents: ALL,
    label: '문서 색상 모드',
    test: function (ctx) {
      var want = ctx.preset.colorMode, have = PP.colorMode(ctx.doc);
      if (want === have) return [];
      return [{ id: null, name: ctx.doc.name, detail: '문서가 ' + have.toUpperCase() + ' 인데 ' + want.toUpperCase() + ' 이어야 합니다' }];
    },
    fix: function (ctx) {
      PP.setColorMode(ctx.doc, ctx.preset.colorMode);
      return '색상 모드를 ' + ctx.preset.colorMode.toUpperCase() + ' 로 바꿨습니다';
    }
  });

  /* ---- 글꼴 윤곽선 ---- */
  rule({
    code: 'text-not-outlined',
    level: 'error',
    intents: ALL,
    label: '글꼴 윤곽선 만들기',
    test: function (ctx) {
      return ctx.items.filter(function (o) { return o.it.type === 'text'; })
        .map(function (o) { return hit(o, '"' + String((o.it.text && o.it.text.content) || '').slice(0, 14) + '"'); });
    },
    fix: function (ctx, hits) {
      /* 글리프 윤곽은 캔버스로 뽑는다 — Node 에서는 못 고치고 보고만 한다 */
      if (!AI.trace || !U.hasDOM) return null;
      var ids = hits.map(function (h) { return h.id; }), n = 0;
      ids.forEach(function (id) {
        var it = null;
        Model.walk(ctx.doc, function (o) { if (o.id === id) { it = o; return false; } });
        if (!it) return;
        var outline = AI.trace.textToOutlines(ctx.app, it);
        if (!outline) return;
        var loc = Model.locate(ctx.doc, it);
        if (loc) { loc.list.splice(loc.index, 1, outline); n++; }
      });
      return n ? n + '개 문자를 윤곽선으로 바꿨습니다' : null;
    }
  });

  /* ---- 얇은 획 (인쇄에서 사라진다) ---- */
  rule({
    code: 'thin-stroke',
    level: 'error',
    intents: ['print', 'cut', 'screen'],
    label: '너무 얇은 획',
    test: function (ctx) {
      var min = ctx.preset.minStroke;
      if (!min) return [];
      var out = [];
      ctx.items.forEach(function (o) {
        strokesOf(o.it).forEach(function (s) {
          if (s.type !== 'none' && s.width > 0 && s.width < min - 1e-6) {
            out.push(hit(o, U.round(s.width, 3) + 'pt < ' + min + 'pt'));
          }
        });
      });
      return out;
    },
    fix: function (ctx, hits) {
      var min = ctx.preset.minStroke, n = 0;
      var ids = hits.map(function (h) { return h.id; });
      ctx.items.forEach(function (o) {
        if (ids.indexOf(o.it.id) < 0) return;
        strokesOf(o.it).forEach(function (s) {
          if (s.type !== 'none' && s.width > 0 && s.width < min - 1e-6) { s.width = min; n++; }
        });
      });
      return n + '개 획을 ' + min + 'pt 로 올렸습니다';
    }
  });

  /* ---- 레이저: 획 두께가 정확해야 한다 ---- */
  rule({
    code: 'laser-stroke',
    level: 'error',
    intents: ['laser'],
    label: '레이저 획 규격',
    test: function (ctx) {
      var want = ctx.preset.exactStroke, out = [];
      ctx.items.forEach(function (o) {
        strokesOf(o.it).forEach(function (s) {
          if (s.type === 'none') return;
          if (Math.abs(s.width - want) > 1e-6) out.push(hit(o, U.round(s.width, 4) + 'pt ≠ ' + want + 'pt'));
          else if (s.widthProfile && s.widthProfile.length > 1) out.push(hit(o, '가변 폭 획 — 균일이어야 합니다'));
        });
      });
      return out;
    },
    fix: function (ctx, hits) {
      var want = ctx.preset.exactStroke, n = 0;
      var ids = hits.map(function (h) { return h.id; });
      ctx.items.forEach(function (o) {
        if (ids.indexOf(o.it.id) < 0) return;
        strokesOf(o.it).forEach(function (s) {
          if (s.type === 'none') return;
          s.width = want; delete s.widthProfile; delete s.brush; n++;
        });
      });
      return n + '개 획을 ' + want + 'pt 균일로 맞췄습니다';
    }
  });

  /* ---- 레이저: 규정 색만 ---- */
  rule({
    code: 'laser-color',
    level: 'error',
    intents: ['laser'],
    label: '레이저 규정 색',
    test: function (ctx) {
      var pal = ctx.preset.palette.map(function (p) { return p.hex; });
      var out = [];
      ctx.items.forEach(function (o) {
        strokesOf(o.it).forEach(function (s) {
          if (s.type === 'solid' && pal.indexOf(String(s.color).toLowerCase()) < 0) {
            out.push(hit(o, s.color + ' — 절단/접기/각인 색이 아닙니다'));
          }
        });
      });
      return out;
    },
    fix: function (ctx, hits) {
      var pal = ctx.preset.palette, n = 0;
      var ids = hits.map(function (h) { return h.id; });
      ctx.items.forEach(function (o) {
        if (ids.indexOf(o.it.id) < 0) return;
        strokesOf(o.it).forEach(function (s) {
          if (s.type !== 'solid') return;
          s.color = nearestHex(s.color, pal.map(function (p) { return p.hex; }));
          delete s.cmyk; delete s.spot; n++;
        });
      });
      return n + '개 획을 가장 가까운 규정 색으로 맞췄습니다';
    }
  });

  /* ---- 이미지 해상도 ---- */
  rule({
    code: 'low-res-image',
    level: 'error',
    intents: ['print', 'cut', 'screen'],
    label: '이미지 해상도',
    test: function (ctx) {
      var min = ctx.preset.minImageDpi;
      if (!min) return [];
      return ctx.items.filter(function (o) { return o.it.type === 'image'; }).map(function (o) {
        var dpi = PP.imageDpi(o.it);
        if (dpi == null) return null;
        return dpi < min ? hit(o, dpi + 'dpi < ' + min + 'dpi') : null;
      }).filter(Boolean);
    }
    /* 자동 수정 없음 — 원본 화소가 없는 것을 만들어 낼 수는 없다 */
  });

  /* ---- 연결된(내장 안 된) 이미지 ---- */
  rule({
    code: 'linked-image',
    level: 'error',
    intents: ALL,
    label: '연결된 이미지',
    test: function (ctx) {
      return ctx.items.filter(function (o) {
        return o.it.type === 'image' && o.it.linked;
      }).map(function (o) { return hit(o, '원본이 파일에 담기지 않았습니다'); });
    }
  });

  /* ---- 도련 값 자체가 0 인 경우 ---- */
  rule({
    code: 'no-bleed',
    level: 'error',
    intents: ['print', 'cut'],
    label: '도련 없음',
    test: function (ctx) {
      var want = ctx.preset.bleedMm;
      if (!want) return [];
      var have = PP.bleed(ctx.doc) / (72 / 25.4);
      if (have >= want - 0.01) return [];
      return [{ id: null, name: ctx.doc.name, detail: '도련이 ' + U.round(have, 2) + 'mm — ' + want + 'mm 이어야 합니다' }];
    },
    fix: function (ctx) {
      PP.setBleed(ctx.doc, PP.mm(ctx.preset.bleedMm));
      return '도련을 ' + ctx.preset.bleedMm + 'mm 로 설정했습니다';
    }
  });

  /* ---- 도련 ---- */
  rule({
    code: 'bleed-gap',
    level: 'warn',
    intents: ['print', 'cut'],
    label: '도련까지 뻗지 않은 개체',
    test: function (ctx) {
      var bleed = PP.bleed(ctx.doc);
      if (!(bleed > 0)) return [];
      var ab = ctx.doc.artboards[ctx.doc.activeArtboard];
      if (!ab) return [];
      var t = PP.trimBox(ab), bb = PP.bleedBox(ctx.doc, ab), tol = 0.5;
      var out = [];
      ctx.items.forEach(function (o) {
        var b = Rn.boundsM(o.it, o.m, true, 1);
        if (R.isEmpty(b)) return;
        var sides = [];
        if (b.x <= t.x + tol && b.x > bb.x + tol) sides.push('왼쪽');
        if (b.y <= t.y + tol && b.y > bb.y + tol) sides.push('위');
        if (b.x2 >= t.x2 - tol && b.x2 < bb.x2 - tol) sides.push('오른쪽');
        if (b.y2 >= t.y2 - tol && b.y2 < bb.y2 - tol) sides.push('아래');
        if (sides.length) out.push(hit(o, sides.join('·') + ' 가장자리가 도련에 못 미칩니다'));
      });
      return out;
    }
  });

  /* ---- 오버프린트 실수 ---- */
  rule({
    code: 'overprint-white',
    level: 'error',
    intents: ['print', 'cut', 'screen'],
    label: '흰색 오버프린트',
    test: function (ctx) {
      return ctx.items.filter(function (o) {
        return PP.hasOverprint(o.it, 'fill') && PP.isWhite(o.it.fill);
      }).map(function (o) { return hit(o, '흰색에 오버프린트 — 인쇄에서 사라집니다'); });
    },
    fix: function (ctx, hits) {
      var ids = hits.map(function (h) { return h.id; });
      ctx.items.forEach(function (o) {
        if (ids.indexOf(o.it.id) >= 0) PP.setOverprint(o.it, 'fill', false);
      });
      return hits.length + '개의 흰색 오버프린트를 껐습니다';
    }
  });

  /* ---- K100 검정은 오버프린트가 관례 ---- */
  rule({
    code: 'k100-overprint',
    level: 'info',
    intents: ['print'],
    label: 'K100 검정 오버프린트',
    test: function (ctx) {
      return ctx.items.filter(function (o) {
        return PP.isK100(o.it.fill) && !PP.hasOverprint(o.it, 'fill');
      }).map(function (o) { return hit(o, '오버프린트를 켜면 흰 테가 안 생깁니다'); });
    },
    fix: function (ctx, hits) {
      var ids = hits.map(function (h) { return h.id; });
      ctx.items.forEach(function (o) {
        if (ids.indexOf(o.it.id) >= 0) PP.setOverprint(o.it, 'fill', true);
      });
      return hits.length + '개 K100 검정에 오버프린트를 켰습니다';
    }
  });

  /* ---- 총 잉크량 ---- */
  rule({
    code: 'ink-limit',
    level: 'warn',
    intents: ['print'],
    label: '총 잉크량 초과',
    test: function (ctx) {
      var max = ctx.preset.maxInk;
      if (!max) return [];
      var out = [];
      ctx.items.forEach(function (o) {
        PP.itemPaints(o.it).forEach(function (p) {
          if (p.type !== 'solid') return;
          var v = p.cmyk || PP.rgbToCmyk(p.color);
          var t = PP.inkTotal(v);
          if (t > max) out.push(hit(o, t + '% > ' + max + '%'));
        });
      });
      return out;
    }
  });

  /* ---- 실크스크린: 별색만 ---- */
  rule({
    code: 'spot-only',
    level: 'error',
    intents: ['screen'],
    label: '별색이 아닌 색',
    test: function (ctx) {
      if (!ctx.preset.spotOnly) return [];
      var out = [];
      ctx.items.forEach(function (o) {
        PP.itemPaints(o.it).forEach(function (p) {
          if (p.type === 'solid' && !p.spot) out.push(hit(o, p.color + ' — 별색이 아니면 분판이 안 나옵니다'));
        });
      });
      return out;
    }
  });

  rule({
    code: 'no-gradient',
    level: 'error',
    intents: ['screen'],
    label: '그라데이션',
    test: function (ctx) {
      if (!ctx.preset.noGradient) return [];
      var out = [];
      ctx.items.forEach(function (o) {
        PP.itemPaints(o.it).forEach(function (p) {
          if (Col.isGradient(p)) out.push(hit(o, '하프톤으로 변환해서 넘겨야 합니다'));
        });
      });
      return out;
    }
  });

  rule({
    code: 'spot-count',
    level: 'warn',
    intents: ['screen'],
    label: '별색 개수',
    test: function (ctx) {
      var max = ctx.preset.maxSpots;
      if (!max) return [];
      var used = PF.usedSpots(ctx.doc);
      if (used.length <= max) return [];
      return [{ id: null, name: ctx.doc.name, detail: used.length + '색 > ' + max + '색 (스크린 ' + used.length + '장)' }];
    }
  });

  /* ---- 커팅: 칼선 ---- */
  rule({
    code: 'cut-line',
    level: 'error',
    intents: ['cut'],
    label: '칼선 규격',
    test: function (ctx) {
      var name = ctx.preset.cutSpot;
      var cuts = ctx.items.filter(function (o) {
        return strokesOf(o.it).some(function (s) { return s.spot === name; });
      });
      if (!cuts.length) {
        return [{ id: null, name: ctx.doc.name, detail: '별색 ' + name + ' 을 쓰는 칼선이 하나도 없습니다' }];
      }
      return cuts.filter(function (o) {
        return o.it.fill && o.it.fill.type !== 'none';
      }).map(function (o) { return hit(o, '칼선에 칠이 있습니다 — 칠은 없어야 합니다'); });
    },
    fix: function (ctx, hits) {
      var ids = hits.map(function (h) { return h.id; }).filter(Boolean);
      if (!ids.length) return null;
      var n = 0;
      ctx.items.forEach(function (o) {
        if (ids.indexOf(o.it.id) >= 0) { o.it.fill = Col.none(); n++; }
      });
      return n + '개 칼선의 칠을 없앴습니다';
    }
  });

  /* ---- 빈 패스 ---- */
  rule({
    code: 'empty-path',
    level: 'warn',
    intents: ALL,
    label: '빈 패스',
    test: function (ctx) {
      return ctx.items.filter(function (o) {
        if (o.it.type !== 'path') return false;
        var n = (o.it.subs || []).reduce(function (a, s) { return a + (s.pts ? s.pts.length : 0); }, 0);
        return n < 2;
      }).map(function (o) { return hit(o, '점이 2개 미만입니다'); });
    },
    fix: function (ctx, hits) {
      var ids = hits.map(function (h) { return h.id; });
      var n = 0;
      Model.walk(ctx.doc, function (it, list, i) {
        if (ids.indexOf(it.id) >= 0) { list.splice(i, 1); n++; return false; }
      });
      /* walk 중 삭제는 한 번에 하나만 안전하므로 남은 것을 반복해서 지운다 */
      var guard = 0;
      while (n < ids.length && guard++ < 500) {
        var removed = false;
        Model.walk(ctx.doc, function (it, list, i) {
          if (ids.indexOf(it.id) >= 0) { list.splice(i, 1); n++; removed = true; return false; }
        });
        if (!removed) break;
      }
      return n + '개 빈 패스를 지웠습니다';
    }
  });

  /* ---- 대지 밖 개체 ---- */
  rule({
    code: 'outside-artboard',
    level: 'info',
    intents: ALL,
    label: '대지 밖 개체',
    test: function (ctx) {
      var ab = ctx.doc.artboards[ctx.doc.activeArtboard];
      if (!ab) return [];
      var bb = PP.bleedBox(ctx.doc, ab);
      return ctx.items.filter(function (o) {
        var b = Rn.boundsM(o.it, o.m, true, 1);
        return !R.isEmpty(b) && (b.x2 < bb.x || b.x > bb.x2 || b.y2 < bb.y || b.y > bb.y2);
      }).map(function (o) { return hit(o, '대지 · 도련 영역 밖에 있습니다'); });
    }
  });

  /* =====================================================================
     실행
     ===================================================================== */
  function strokesOf(it) {
    var out = [];
    if (it.stroke) out.push(it.stroke);
    (it.strokes || []).forEach(function (s) { out.push(s); });
    if (it.appearance && it.appearance.strokes) it.appearance.strokes.forEach(function (s) { out.push(s); });
    return out;
  }

  function nearestHex(hex, list) {
    var c = Col.hexToRgb(hex), best = list[0], bd = Infinity;
    list.forEach(function (h) {
      var o = Col.hexToRgb(h);
      var d = (c.r - o.r) * (c.r - o.r) + (c.g - o.g) * (c.g - o.g) + (c.b - o.b) * (c.b - o.b);
      if (d < bd) { bd = d; best = h; }
    });
    return best;
  }

  PF.usedSpots = function (doc) {
    var seen = {}, out = [];
    Model.walk(doc, function (it) {
      PP.itemPaints(it).forEach(function (p) {
        if (p.spot && !seen[p.spot]) { seen[p.spot] = 1; out.push(p.spot); }
      });
    });
    return out;
  };

  PF.RULES = RULES;
  PF.intentOf = function (doc) { return doc.intent || 'print'; };

  function context(app, intent) {
    intent = intent || PF.intentOf(app.doc);
    return {
      app: app, doc: app.doc, intent: intent,
      preset: PP.preset(intent),
      items: targets(app)
    };
  }

  /* 검사만 — 문서를 건드리지 않는다 */
  PF.run = function (app, intent) {
    var ctx = context(app, intent);
    var issues = [];
    RULES.forEach(function (r) {
      if (r.intents.indexOf(ctx.intent) < 0) return;
      var hits;
      try { hits = r.test(ctx) || []; } catch (e) { hits = []; }
      if (!hits.length) return;
      issues.push({
        code: r.code, level: r.level, label: r.label,
        count: hits.length, fixable: !!r.fix,
        items: hits.slice(0, 40)
      });
    });
    var by = { error: 0, warn: 0, info: 0 };
    issues.forEach(function (i) { by[i.level] += i.count; });
    return {
      intent: ctx.intent,
      preset: ctx.preset.label,
      note: ctx.preset.note,
      ok: by.error === 0,
      errors: by.error, warnings: by.warn, notes: by.info,
      issues: issues
    };
  };

  /* 고칠 수 있는 것을 고친다.
     opts.only  — 이 코드들만
     opts.skip  — 이 코드들은 빼고
     opts.levels — 기본 ['error'] (경고까지 고치려면 ['error','warn','info']) */
  PF.fix = function (app, opts) {
    opts = opts || {};
    var levels = opts.levels || ['error'];
    var intent = opts.intent || PF.intentOf(app.doc);
    var done = [], guard = 0;

    /* 한 번 고치면 다른 규칙의 결과가 달라진다 (예: 문자를 윤곽선으로 바꾸면
       얇은 획 검사 대상이 늘어난다). 변화가 없을 때까지 돌린다. */
    while (guard++ < 6) {
      var ctx = context(app, intent);
      var acted = false;
      for (var i = 0; i < RULES.length; i++) {
        var r = RULES[i];
        if (r.intents.indexOf(intent) < 0 || !r.fix) continue;
        if (levels.indexOf(r.level) < 0) continue;
        if (opts.only && opts.only.indexOf(r.code) < 0) continue;
        if (opts.skip && opts.skip.indexOf(r.code) >= 0) continue;
        var hits;
        try { hits = r.test(ctx) || []; } catch (e) { continue; }
        if (!hits.length) continue;
        var msg;
        try { msg = r.fix(ctx, hits); } catch (e) { msg = null; }
        if (msg) { done.push({ code: r.code, label: r.label, did: msg }); acted = true; }
        ctx = context(app, intent);   /* 문서가 바뀌었으니 다시 훑는다 */
      }
      if (!acted) break;
    }

    var after = PF.run(app, intent);
    return {
      intent: intent,
      fixed: done,
      remaining: after.issues.filter(function (i) { return i.level === 'error'; }),
      ok: after.ok,
      report: after
    };
  };

  /* 사람이 읽는 한 줄 요약 */
  PF.summary = function (rep) {
    if (rep.ok && !rep.warnings) return '이상 없습니다 — ' + rep.preset;
    var parts = [];
    if (rep.errors) parts.push('오류 ' + rep.errors);
    if (rep.warnings) parts.push('경고 ' + rep.warnings);
    if (rep.notes) parts.push('참고 ' + rep.notes);
    return parts.join(' · ') + ' (' + rep.preset + ')';
  };

})(typeof globalThis !== 'undefined' ? globalThis.AI : window.AI);
