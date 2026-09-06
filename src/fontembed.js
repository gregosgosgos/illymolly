/* =========================================================================
   fontembed.js — PDF 에 글꼴 심기
   -------------------------------------------------------------------------
   지금까지 한글은 PDF 표준 14 글꼴에 없어서 ? 가 되거나, 화면을 추적해
   윤곽선으로 바꿔야 했다. 추적은 획 끝이 둥글어지고 텍스트도 아니게 된다.

   제대로 된 길은 글꼴 파일을 PDF 안에 심는 것이다. 그러면
     · 글자 모양이 원본 그대로이고
     · 일러스트레이터에서 **여전히 편집 가능한 텍스트**로 열리고
     · 복사 · 검색도 된다.

   이 파일이 하는 일:
     1) .woff 를 푼다 — 표마다 zlib 으로 눌린 SFNT 라, pdfin 의 inflate 를 쓴다
     2) cmap · loca · glyf · hmtx 를 읽는다
     3) 문서에 실제로 쓰인 글자만 골라 **서브셋**한다 (합성 글리프는 부품까지)
     4) PDF 의 Type0 / CIDFontType2 (Identity-H) 로 넘길 조각을 만든다

   서브셋하므로 상세페이지 한 장이면 30~80KB 만 붙는다.
   ========================================================================= */
(function (AI) {
  'use strict';
  var U = AI.util;
  var FE = AI.fontembed = {};

  /* 내장 글꼴 — Noto Sans KR (SIL Open Font License 1.1) */
  FE.FONTS = {
    'kr-400': { url: 'fonts/NotoSansKR-Regular.woff', name: 'NotoSansKR-Regular', weight: 400 },
    'kr-700': { url: 'fonts/NotoSansKR-Bold.woff', name: 'NotoSansKR-Bold', weight: 700 },
    'la-400': { url: 'fonts/NotoSansKR-Latin-Regular.woff', name: 'NotoSansKR-Latin-Regular', weight: 400 },
    'la-700': { url: 'fonts/NotoSansKR-Latin-Bold.woff', name: 'NotoSansKR-Latin-Bold', weight: 700 }
  };
  /* 번들(단일 HTML)에서는 base64 를 여기에 미리 넣어 둔다 — 그러면 받지 않는다 */
  FE.INLINE = {};

  var cache = {};      /* key -> Font */
  var loading = {};    /* key -> Promise */

  /* =====================================================================
     1. WOFF -> SFNT
     ===================================================================== */
  function rd16(b, i) { return (b[i] << 8) | b[i + 1]; }
  function rd32(b, i) { return ((b[i] << 24) | (b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3]) >>> 0; }
  function rdS16(b, i) { var v = rd16(b, i); return v & 0x8000 ? v - 0x10000 : v; }

  FE.woffToSfnt = function (b) {
    if (rd32(b, 0) !== 0x774f4646) return { raw: b, tables: sfntTables(b) };   /* 이미 TTF */
    var num = rd16(b, 12), off = 44, tables = {};
    for (var i = 0; i < num; i++) {
      var tag = String.fromCharCode(b[off], b[off + 1], b[off + 2], b[off + 3]);
      var o = rd32(b, off + 4), cl = rd32(b, off + 8), ol = rd32(b, off + 12);
      var raw = b.subarray(o, o + cl);
      tables[tag] = (cl < ol) ? AI.pdfin.inflate(raw) : raw;
      off += 20;
    }
    return { tables: tables };
  };

  function sfntTables(b) {
    var num = rd16(b, 4), off = 12, tables = {};
    for (var i = 0; i < num; i++) {
      var tag = String.fromCharCode(b[off], b[off + 1], b[off + 2], b[off + 3]);
      var o = rd32(b, off + 8), len = rd32(b, off + 12);
      tables[tag] = b.subarray(o, o + len);
      off += 16;
    }
    return tables;
  }

  /* =====================================================================
     2. 글꼴 읽기
     ===================================================================== */
  FE.parse = function (bytes, meta) {
    var t = FE.woffToSfnt(bytes).tables;
    if (!t.glyf || !t.loca || !t.head || !t.maxp || !t.hhea || !t.hmtx) {
      throw new Error('TrueType(glyf) 글꼴이 아닙니다');
    }
    var head = t.head, maxp = t.maxp, hhea = t.hhea;
    var f = {
      tables: t,
      name: (meta && meta.name) || 'Embedded',
      unitsPerEm: rd16(head, 18) || 1000,
      indexToLocFormat: rdS16(head, 50),
      numGlyphs: rd16(maxp, 4),
      numberOfHMetrics: rd16(hhea, 34),
      ascent: rdS16(hhea, 4), descent: rdS16(hhea, 6),
      xMin: rdS16(head, 36), yMin: rdS16(head, 38), xMax: rdS16(head, 40), yMax: rdS16(head, 42),
      flags: rd16(head, 16)
    };
    f.loca = readLoca(t.loca, f);
    f.cmap = readCmap(t.cmap);
    return f;
  };

  function readLoca(loca, f) {
    var n = f.numGlyphs + 1, out = new Uint32Array(n);
    if (f.indexToLocFormat === 0) for (var i = 0; i < n; i++) out[i] = rd16(loca, i * 2) * 2;
    else for (var j = 0; j < n; j++) out[j] = rd32(loca, j * 4);
    return out;
  }

  /* 유니코드 -> 글리프 번호. 형식 4(BMP)와 12(전체)를 읽는다. */
  function readCmap(cm) {
    var map = new Map();
    if (!cm) return map;
    var n = rd16(cm, 2), best = null;
    for (var i = 0; i < n; i++) {
      var pid = rd16(cm, 4 + i * 8), eid = rd16(cm, 6 + i * 8), off = rd32(cm, 8 + i * 8);
      if (off >= cm.length) continue;
      var fmt = rd16(cm, off);
      if (fmt === 4 && pid === 3 && (eid === 1 || eid === 10)) best = best || { off: off, fmt: 4 };
      if (fmt === 12 && pid === 3 && eid === 10) { best = { off: off, fmt: 12 }; break; }
      if (fmt === 4 && pid === 0) best = best || { off: off, fmt: 4 };
    }
    if (!best) return map;
    if (best.fmt === 12) {
      var o12 = best.off, groups = rd32(cm, o12 + 12);
      for (var g = 0; g < groups; g++) {
        var p = o12 + 16 + g * 12;
        var s = rd32(cm, p), e = rd32(cm, p + 4), gi = rd32(cm, p + 8);
        if (e - s > 0x20000) e = s + 0x20000;
        for (var c = s; c <= e; c++) map.set(c, gi + (c - s));
      }
      return map;
    }
    var o = best.off, segX2 = rd16(cm, o + 6), seg = segX2 / 2;
    for (var s2 = 0; s2 < seg; s2++) {
      var end = rd16(cm, o + 14 + s2 * 2);
      var start = rd16(cm, o + 16 + segX2 + s2 * 2);
      var delta = rdS16(cm, o + 16 + segX2 * 2 + s2 * 2);
      var roOff = o + 16 + segX2 * 3 + s2 * 2, ro = rd16(cm, roOff);
      if (start > end) continue;
      for (var c2 = start; c2 <= end && c2 !== 0xffff; c2++) {
        var gid;
        if (ro === 0) gid = (c2 + delta) & 0xffff;
        else {
          var gi2 = roOff + ro + (c2 - start) * 2;
          if (gi2 + 1 >= cm.length) continue;
          gid = rd16(cm, gi2);
          if (gid) gid = (gid + delta) & 0xffff;
        }
        if (gid) map.set(c2, gid);
      }
    }
    return map;
  }

  FE.gid = function (f, cp) { return f && f.cmap.get(cp) || 0; };
  FE.has = function (f, cp) { return !!(f && f.cmap.get(cp)); };

  /* 글리프 진행 폭 (폰트 단위) */
  FE.advance = function (f, gid) {
    var n = f.numberOfHMetrics, h = f.tables.hmtx;
    var i = gid < n ? gid : n - 1;
    if (i < 0 || i * 4 + 1 >= h.length) return f.unitsPerEm / 2;
    return rd16(h, i * 4);
  };

  /* =====================================================================
     3. 서브셋
     ---------------------------------------------------------------------
     쓰인 글리프만 남기고 번호를 0..n-1 로 다시 매긴다. 합성 글리프는
     부품 글리프까지 따라 들어가야 모양이 깨지지 않는다.
     ===================================================================== */
  function collect(f, gids) {
    var want = {}, queue = [];
    gids.forEach(function (g) { if (!want[g]) { want[g] = 1; queue.push(g); } });
    want[0] = 1;
    var guard = 0;
    while (queue.length && guard++ < 200000) {
      var g2 = queue.pop();
      var s = f.loca[g2], e = f.loca[g2 + 1];
      if (e <= s || e > f.tables.glyf.length) continue;
      var d = f.tables.glyf, nc = rdS16(d, s);
      if (nc >= 0) continue;                       /* 단순 글리프 */
      var p = s + 10;                              /* 합성 글리프 — 부품을 따라간다 */
      for (;;) {
        var fl = rd16(d, p), sub = rd16(d, p + 2);
        if (!want[sub]) { want[sub] = 1; queue.push(sub); }
        p += 4;
        p += (fl & 1) ? 4 : 2;                     /* ARG_1_AND_2_ARE_WORDS */
        if (fl & 8) p += 2;                        /* WE_HAVE_A_SCALE */
        else if (fl & 0x40) p += 4;                /* X_AND_Y_SCALE */
        else if (fl & 0x80) p += 8;                /* TWO_BY_TWO */
        if (!(fl & 0x20)) break;                   /* MORE_COMPONENTS */
        if (p >= e) break;
      }
    }
    return Object.keys(want).map(Number).sort(function (a, b) { return a - b; });
  }

  /* gids: 원본 글리프 번호 목록 -> { data, order, map }
     **순서가 중요하다.** PDF 쪽에서 CID = 새 글리프 번호로 쓰기 때문에,
     넘긴 순서 그대로 1, 2, 3… 이 되어야 콘텐츠에 미리 적어 둔 번호와 맞는다.
     합성 글리프의 부품은 뒤에 덧붙인다 (콘텐츠가 직접 가리키지 않으므로). */
  FE.subset = function (f, gids) {
    var order = [0], seen = { 0: 1 };
    gids.forEach(function (g) { if (!seen[g]) { seen[g] = 1; order.push(g); } });
    collect(f, gids).forEach(function (g) { if (!seen[g]) { seen[g] = 1; order.push(g); } });
    var map = {};                                  /* 원본 gid -> 새 gid */
    order.forEach(function (g, i) { map[g] = i; });

    /* --- glyf + loca --- */
    var parts = [], total = 0;
    order.forEach(function (g) {
      var s = f.loca[g], e = f.loca[g + 1];
      var d = (e > s && e <= f.tables.glyf.length) ? f.tables.glyf.slice(s, e) : new Uint8Array(0);
      if (d.length >= 10 && rdS16(d, 0) < 0) remapComposite(d, map);
      if (d.length % 4) {                           /* 4바이트 경계 맞추기 */
        var pad = new Uint8Array(d.length + (4 - d.length % 4));
        pad.set(d, 0); d = pad;
      }
      parts.push(d); total += d.length;
    });
    var glyf = new Uint8Array(total), off = 0, offsets = [0];
    parts.forEach(function (d) { glyf.set(d, off); off += d.length; offsets.push(off); });

    var longLoca = total > 0x1fffe;
    var loca = new Uint8Array((order.length + 1) * (longLoca ? 4 : 2));
    offsets.forEach(function (o, i) {
      if (longLoca) wr32(loca, i * 4, o); else wr16(loca, i * 2, o / 2);
    });

    /* --- hmtx --- */
    var hmtx = new Uint8Array(order.length * 4);
    order.forEach(function (g, i) {
      wr16(hmtx, i * 4, FE.advance(f, g));
      var n = f.numberOfHMetrics, h = f.tables.hmtx;
      var lsb = g < n ? rdS16(h, g * 4 + 2)
        : rdS16(h, n * 4 + (g - n) * 2 >= h.length ? 0 : n * 4 + (g - n) * 2);
      wr16(hmtx, i * 4 + 2, lsb & 0xffff);
    });

    /* --- head · hhea · maxp --- */
    var head = f.tables.head.slice();
    wr16(head, 50, longLoca ? 1 : 0);
    wr32(head, 8, 0);                               /* checkSumAdjustment 는 0 으로 둔다 */
    var hhea = f.tables.hhea.slice();
    wr16(hhea, 34, order.length);
    var maxp = f.tables.maxp.slice();
    wr16(maxp, 4, order.length);

    var out = { 'head': head, 'hhea': hhea, 'maxp': maxp, 'hmtx': hmtx, 'loca': loca, 'glyf': glyf };
    ['cvt ', 'fpgm', 'prep', 'gasp'].forEach(function (t) {   /* 힌팅이 참조하므로 함께 */
      if (f.tables[t]) out[t] = f.tables[t];
    });
    return { data: buildSfnt(out), map: map, order: order, count: order.length };
  };

  function remapComposite(d, map) {
    var p = 10;
    for (;;) {
      if (p + 4 > d.length) break;
      var fl = rd16(d, p), sub = rd16(d, p + 2);
      wr16(d, p + 2, map[sub] == null ? 0 : map[sub]);
      p += 4;
      p += (fl & 1) ? 4 : 2;
      if (fl & 8) p += 2; else if (fl & 0x40) p += 4; else if (fl & 0x80) p += 8;
      if (!(fl & 0x20)) break;
    }
  }

  function wr16(b, i, v) { b[i] = (v >> 8) & 255; b[i + 1] = v & 255; }
  function wr32(b, i, v) { b[i] = (v >>> 24) & 255; b[i + 1] = (v >>> 16) & 255; b[i + 2] = (v >>> 8) & 255; b[i + 3] = v & 255; }

  function buildSfnt(tables) {
    var tags = Object.keys(tables).sort();
    var num = tags.length;
    var headerLen = 12 + num * 16;
    var total = headerLen;
    var pads = {};
    tags.forEach(function (t) {
      var len = tables[t].length;
      pads[t] = (4 - (len % 4)) % 4;
      total += len + pads[t];
    });
    var out = new Uint8Array(total);
    wr32(out, 0, 0x00010000);
    wr16(out, 4, num);
    var sr = 1, es = 0;
    while (sr * 2 <= num) { sr *= 2; es++; }
    wr16(out, 6, sr * 16); wr16(out, 8, es); wr16(out, 10, num * 16 - sr * 16);
    var off = headerLen, dir = 12;
    tags.forEach(function (t) {
      var d = tables[t];
      out[dir] = t.charCodeAt(0); out[dir + 1] = t.charCodeAt(1);
      out[dir + 2] = t.charCodeAt(2); out[dir + 3] = t.charCodeAt(3);
      wr32(out, dir + 4, checksum(d));
      wr32(out, dir + 8, off);
      wr32(out, dir + 12, d.length);
      out.set(d, off);
      off += d.length + pads[t];
      dir += 16;
    });
    return out;
  }

  function checksum(d) {
    var sum = 0;
    for (var i = 0; i + 3 < d.length; i += 4) sum = (sum + rd32(d, i)) >>> 0;
    var rem = d.length % 4;
    if (rem) {
      var last = 0;
      for (var k = 0; k < 4; k++) last = (last << 8) | (k < rem ? d[d.length - rem + k] : 0);
      sum = (sum + (last >>> 0)) >>> 0;
    }
    return sum >>> 0;
  }

  /* =====================================================================
     4. 불러오기
     ---------------------------------------------------------------------
     문서에 한글이 없으면 아예 받지 않는다. 필요한 굵기만 받는다.
     ===================================================================== */
  function bytesFromBase64(b64) {
    var bin;
    if (typeof atob === 'function') bin = atob(b64);
    else if (typeof Buffer !== 'undefined') bin = Buffer.from(b64, 'base64').toString('latin1');
    else return null;
    var out = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i) & 255;
    return out;
  }

  FE.get = function (key) { return cache[key] || null; };

  /* 이미 읽어 둔 글꼴 바이트를 바로 등록한다 (테스트 · 번들 · CLI) */
  FE.register = function (key, bytes) {
    var def = FE.FONTS[key] || { name: key };
    var f = FE.parse(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes), def);
    f.key = key; f.psName = def.name;
    cache[key] = f;
    return f;
  };
  FE.loaded = function () { return Object.keys(cache); };
  FE.reader = null;      /* (url) -> bytes | Promise<bytes> */

  FE.load = function (key) {
    if (cache[key]) return Promise.resolve(cache[key]);
    if (loading[key]) return loading[key];
    var def = FE.FONTS[key];
    if (!def) return Promise.reject(new Error('알 수 없는 글꼴: ' + key));

    var p;
    if (FE.INLINE[key]) {
      p = Promise.resolve(bytesFromBase64(FE.INLINE[key]));
    } else if (FE.reader) {
      /* 브라우저 밖(Node · CLI)에서는 호스트가 읽는 방법을 넣어 준다 */
      p = Promise.resolve().then(function () { return new Uint8Array(FE.reader(def.url)); });
    } else if (typeof fetch === 'function' && U.hasDOM) {
      p = fetch(FE.baseUrl(def.url)).then(function (r) {
        if (!r.ok) throw new Error(def.url + ' — HTTP ' + r.status);
        return r.arrayBuffer();
      }).then(function (ab) { return new Uint8Array(ab); });
    } else {
      p = Promise.reject(new Error('글꼴을 받을 방법이 없습니다'));
    }

    loading[key] = p.then(function (bytes) {
      var f = FE.parse(bytes, def);
      f.key = key; f.psName = def.name;
      cache[key] = f;
      delete loading[key];
      return f;
    }).catch(function (e) { delete loading[key]; throw e; });
    return loading[key];
  };

  /* 앱이 어디에 놓여 있든 fonts/ 를 찾게 한다 */
  FE.baseUrl = function (rel) {
    if (!U.hasDOM) return rel;
    try {
      var base = document.baseURI || location.href;
      return new URL(rel, base).href;
    } catch (e) { return rel; }
  };

  /* 문서에 쓰인 글자를 모아 필요한 글꼴만 받는다 */
  FE.scan = function (doc) {
    var chars = {}, weights = {};
    AI.model.walk(doc, function (it) {
      if (it.type !== 'text' || !it.text) return;
      var s = String(it.text.content || '');
      var w = (it.text.weight >= 600) ? 700 : 400;
      weights[w] = 1;
      for (var i = 0; i < s.length; i++) {
        var c = s.codePointAt(i);
        if (c > 0xffff) i++;
        chars[c] = 1;
      }
    });
    var cps = Object.keys(chars).map(Number);
    var needsEmbed = cps.some(function (c) { return c > 0x7e; });
    return { codepoints: cps, weights: Object.keys(weights).map(Number), needsEmbed: needsEmbed };
  };

  FE.ensureFor = function (doc) {
    var s = FE.scan(doc);
    if (!s.needsEmbed) return Promise.resolve({ loaded: [], needed: false });
    var keys = [];
    s.weights.forEach(function (w) { keys.push('kr-' + w); keys.push('la-' + w); });
    return Promise.all(keys.map(function (k) {
      return FE.load(k).then(function () { return k; }, function () { return null; });
    })).then(function (got) {
      return { loaded: got.filter(Boolean), needed: true };
    });
  };

  /* 이 글자를 담을 수 있는 글꼴을 고른다 (한글 서브셋 우선, 없으면 라틴) */
  FE.pick = function (cp, weight) {
    var w = weight >= 600 ? 700 : 400;
    var kr = cache['kr-' + w], la = cache['la-' + w];
    if (kr && FE.has(kr, cp)) return kr;
    if (la && FE.has(la, cp)) return la;
    return null;
  };

  /* 문서를 글꼴 없이 온전히 내보낼 수 있는지 */
  FE.missing = function (doc) {
    var s = FE.scan(doc), out = [];
    s.codepoints.forEach(function (c) {
      if (c <= 0x7e) return;
      var ok = s.weights.some(function (w) { return !!FE.pick(c, w); });
      if (!ok) out.push(c);
    });
    return out;
  };

})(typeof globalThis !== 'undefined' ? globalThis.AI : window.AI);
