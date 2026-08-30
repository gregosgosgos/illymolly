/* =========================================================================
   trace.js — 이미지 추적 (Image Trace)
   -------------------------------------------------------------------------
   래스터 이미지를 벡터 패스로 변환한다.
     1) 작업 해상도로 축소해 픽셀을 읽는다
     2) 모드에 따라 색을 줄인다 (흑백 임계값 / 회색 음영 / 색상 양자화)
     3) 색 레이어마다 이진 마스크를 만들고 마칭 스퀘어로 등고선을 딴다
     4) 선분을 이어 닫힌 링으로 만들고, 중첩 깊이로 구멍 방향을 정리한다
     5) RDP 로 단순화하고 필요하면 곡선으로 맞춘다
   ========================================================================= */
(function (AI) {
  'use strict';
  var U = AI.util, G = AI.geom, PF = AI.pathfinder, Model = AI.model, Col = AI.color;
  var TR = AI.trace = {};

  /* Illustrator 의 사전 설정에 대응 */
  TR.PRESETS = {
    bwLogo: { name: '흑백 로고', mode: 'bw', threshold: 128, colors: 2, path: 1.2, noise: 20 },
    silhouette: { name: '실루엣', mode: 'bw', threshold: 160, colors: 2, path: 2, noise: 40, fillColor: '#000000' },
    lineArt: { name: '라인 아트', mode: 'bw', threshold: 100, colors: 2, path: 0.8, noise: 8 },
    sketch: { name: '스케치 아트', mode: 'bw', threshold: 190, colors: 2, path: 1.6, noise: 12 },
    gray3: { name: '3색 회색 음영', mode: 'gray', colors: 3, path: 1.2, noise: 20 },
    color3: { name: '3색', mode: 'color', colors: 3, path: 1.2, noise: 25 },
    color6: { name: '6색', mode: 'color', colors: 6, path: 1.2, noise: 20 },
    color16: { name: '16색', mode: 'color', colors: 16, path: 1, noise: 12 },
    photoLow: { name: '저충실도 사진', mode: 'color', colors: 8, path: 1.6, noise: 20 },
    photoHigh: { name: '고충실도 사진', mode: 'color', colors: 24, path: 0.8, noise: 6 }
  };

  var MAX_SIDE = 640;   /* 작업 해상도 상한 — Illustrator 도 내부적으로 축소한다 */

  /* ---------- 픽셀 읽기 ---------- */
  function readPixels(img) {
    var iw = img.naturalWidth || img.width, ih = img.naturalHeight || img.height;
    if (!iw || !ih) return null;
    var k = Math.min(1, MAX_SIDE / Math.max(iw, ih));
    var w = Math.max(1, Math.round(iw * k)), h = Math.max(1, Math.round(ih * k));
    var cv = document.createElement('canvas');
    cv.width = w; cv.height = h;
    var ctx = cv.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(img, 0, 0, w, h);
    return { data: ctx.getImageData(0, 0, w, h).data, w: w, h: h, sx: iw / w, sy: ih / h };
  }

  /* ---------- 색 양자화 (중앙값 분할) ---------- */
  function quantize(px, n) {
    var pts = [], data = px.data;
    var step = Math.max(1, Math.floor((px.w * px.h) / 20000));   /* 표본 추출 */
    for (var i = 0; i < px.w * px.h; i += step) {
      var o = i * 4;
      if (data[o + 3] < 8) continue;
      pts.push([data[o], data[o + 1], data[o + 2]]);
    }
    if (!pts.length) return [[0, 0, 0]];

    var boxes = [pts];
    while (boxes.length < n) {
      /* 가장 넓게 퍼진 상자를 가장 긴 축에서 중앙값으로 자른다 */
      var bi = -1, bs = -1;
      boxes.forEach(function (b, i2) {
        if (b.length < 2) return;
        var sp = spread(b);
        if (sp.range > bs) { bs = sp.range; bi = i2; }
      });
      if (bi < 0) break;
      var box = boxes[bi], ax = spread(box).axis;
      box.sort(function (a, b) { return a[ax] - b[ax]; });
      var mid = box.length >> 1;
      boxes.splice(bi, 1, box.slice(0, mid), box.slice(mid));
    }
    return boxes.filter(function (b) { return b.length; }).map(function (b) {
      var s = [0, 0, 0];
      b.forEach(function (p) { s[0] += p[0]; s[1] += p[1]; s[2] += p[2]; });
      return [Math.round(s[0] / b.length), Math.round(s[1] / b.length), Math.round(s[2] / b.length)];
    });
  }
  function spread(box) {
    var mn = [255, 255, 255], mx = [0, 0, 0];
    box.forEach(function (p) {
      for (var c = 0; c < 3; c++) { if (p[c] < mn[c]) mn[c] = p[c]; if (p[c] > mx[c]) mx[c] = p[c]; }
    });
    var r = [mx[0] - mn[0], mx[1] - mn[1], mx[2] - mn[2]];
    var axis = r[0] >= r[1] && r[0] >= r[2] ? 0 : (r[1] >= r[2] ? 1 : 2);
    return { axis: axis, range: r[axis] };
  }

  /* ---------- 마칭 스퀘어 등고선 ---------- */
  /* mask: Uint8Array(w*h) — 1 인 영역의 경계를 닫힌 링으로 만든다 */
  function contours(mask, w, h) {
    var segs = [];
    function at(x, y) { return (x < 0 || y < 0 || x >= w || y >= h) ? 0 : mask[y * w + x]; }
    for (var y = -1; y < h; y++) {
      for (var x = -1; x < w; x++) {
        var a = at(x, y), b = at(x + 1, y), c = at(x + 1, y + 1), d = at(x, y + 1);
        var code = (a << 3) | (b << 2) | (c << 1) | d;
        if (code === 0 || code === 15) continue;
        var T = { x: x + 1, y: y + 0.5 }, Rt = { x: x + 1.5, y: y + 1 };
        var B = { x: x + 1, y: y + 1.5 }, L = { x: x + 0.5, y: y + 1 };
        /* 채워진 영역이 왼쪽에 오도록 방향을 맞춘다 */
        switch (code) {
          case 1: segs.push([B, L]); break;
          case 2: segs.push([Rt, B]); break;
          case 3: segs.push([Rt, L]); break;
          case 4: segs.push([T, Rt]); break;
          case 5: segs.push([T, L]); segs.push([B, Rt]); break;
          case 6: segs.push([T, B]); break;
          case 7: segs.push([T, L]); break;
          case 8: segs.push([L, T]); break;
          case 9: segs.push([B, T]); break;
          case 10: segs.push([L, B]); segs.push([Rt, T]); break;
          case 11: segs.push([Rt, T]); break;
          case 12: segs.push([L, Rt]); break;
          case 13: segs.push([B, Rt]); break;
          case 14: segs.push([L, B]); break;
        }
      }
    }
    return chainSegments(segs);
  }

  /* 선분을 끝점으로 이어 닫힌 링 배열로 */
  function chainSegments(segs) {
    var key = function (p) { return Math.round(p.x * 2) + ',' + Math.round(p.y * 2); };
    var map = Object.create(null);
    segs.forEach(function (s, i) { (map[key(s[0])] || (map[key(s[0])] = [])).push(i); });
    var used = new Uint8Array(segs.length), rings = [];
    for (var i = 0; i < segs.length; i++) {
      if (used[i]) continue;
      var ring = [], cur = i, guard = 0;
      while (guard++ < 200000) {
        used[cur] = 1;
        ring.push({ x: segs[cur][0].x, y: segs[cur][0].y });
        var cand = map[key(segs[cur][1])] || [], nx = -1;
        for (var k = 0; k < cand.length; k++) if (!used[cand[k]]) { nx = cand[k]; break; }
        if (nx < 0) break;
        cur = nx;
      }
      if (ring.length > 3) rings.push(ring);
    }
    return rings;
  }

  /* ---------- 추적 본체 ---------- */
  /* img: HTMLImageElement, opt: {mode, colors, threshold, path, noise}
     반환: [{ color:'#rrggbb', rings:[[{x,y}…]] }]  — 좌표는 이미지 픽셀 기준 */
  TR.traceImage = function (img, opt) {
    var px = readPixels(img);
    if (!px) return [];
    var w = px.w, h = px.h, data = px.data;
    var layers = [];

    function build(maskFn, color) {
      var mask = new Uint8Array(w * h);
      var any = false;
      for (var i = 0; i < w * h; i++) {
        var o = i * 4;
        if (data[o + 3] < 8) continue;
        if (maskFn(data[o], data[o + 1], data[o + 2], i)) { mask[i] = 1; any = true; }
      }
      if (!any) return;
      var rings = contours(mask, w, h);
      /* 잡티 제거 — 면적이 작은 링을 버린다 */
      var minArea = Math.max(1, opt.noise || 20);
      rings = rings.filter(function (r) { return Math.abs(PF.area(r)) >= minArea; });
      if (!rings.length) return;
      /* 단순화 후 이미지 좌표로 환산 */
      var tol = Math.max(0.2, opt.path == null ? 1.2 : opt.path);
      rings = rings.map(function (r) {
        var s = G.simplify(r, tol);
        if (s.length > 2 && (s[0].x !== s[s.length - 1].x || s[0].y !== s[s.length - 1].y)) { /* 열린 채 유지 */ }
        return s.map(function (p) { return { x: p.x * px.sx, y: p.y * px.sy }; });
      }).filter(function (r) { return r.length > 2; });
      if (!rings.length) return;
      layers.push({ color: color, rings: PF.normalize(rings) });
    }

    if (opt.mode === 'bw') {
      var th = opt.threshold == null ? 128 : opt.threshold;
      build(function (r, g, b) { return (0.299 * r + 0.587 * g + 0.114 * b) < th; }, opt.fillColor || '#000000');
    } else if (opt.mode === 'gray') {
      var n = Math.max(2, Math.min(10, opt.colors || 3));
      for (var li = 0; li < n; li++) {
        (function (level) {
          var lo = (level / n) * 255, hi = ((level + 1) / n) * 255;
          var v = Math.round(((level + 0.5) / n) * 255);
          build(function (r, g, b) {
            var y = 0.299 * r + 0.587 * g + 0.114 * b;
            return y >= lo && y < (level === n - 1 ? 256 : hi);
          }, Col.rgbToHex(v, v, v));
        })(li);
      }
    } else {
      var pal = quantize(px, Math.max(2, Math.min(32, opt.colors || 6)));
      /* 픽셀마다 가장 가까운 팔레트 색 인덱스를 미리 계산 */
      var idx = new Uint8Array(w * h);
      for (var p = 0; p < w * h; p++) {
        var o2 = p * 4;
        if (data[o2 + 3] < 8) { idx[p] = 255; continue; }
        var best = 0, bd = Infinity;
        for (var c = 0; c < pal.length; c++) {
          var dr = data[o2] - pal[c][0], dg = data[o2 + 1] - pal[c][1], db = data[o2 + 2] - pal[c][2];
          var dd = dr * dr + dg * dg + db * db;
          if (dd < bd) { bd = dd; best = c; }
        }
        idx[p] = best;
      }
      /* 넓은 색부터 뒤에 깔리도록 면적 순으로 */
      var counts = pal.map(function (_, c) {
        var n2 = 0;
        for (var q = 0; q < idx.length; q++) if (idx[q] === c) n2++;
        return { c: c, n: n2 };
      }).sort(function (a, b) { return b.n - a.n; });
      counts.forEach(function (o3) {
        if (!o3.n) return;
        build(function (r, g, b, i2) { return idx[i2] === o3.c; }, Col.rgbToHex(pal[o3.c][0], pal[o3.c][1], pal[o3.c][2]));
      });
    }
    return layers;
  };

  /* 추적 결과를 문서 아이템(그룹)으로 — imageItem 의 배치/변형을 그대로 이어받는다 */
  TR.toGroup = function (app, imageItem, layers, opt) {
    var iw = imageItem.w, ih = imageItem.h;
    var img = AI.render.getImage(imageItem.src);
    var nw = img.naturalWidth || iw, nh = img.naturalHeight || ih;
    var kx = iw / nw, ky = ih / nh;
    var children = [];
    layers.forEach(function (L) {
      var subs = L.rings.map(function (r) {
        var pts = r.map(function (p) { return { x: p.x * kx, y: p.y * ky }; });
        if (opt && opt.curves) return { closed: true, pts: G.fitCurve(pts, 0.8) };
        return { closed: true, pts: pts };
      });
      if (!subs.length) return;
      var it = Model.newPath(subs);
      it.name = L.color;
      it.fill = Col.solid(L.color);
      it.stroke = Model.defaultStroke();
      children.push(it);
    });
    if (!children.length) return null;
    var g = Model.newGroup(children);
    g.name = '이미지 추적';
    g.m = imageItem.m.slice();
    return g;
  };
})(typeof globalThis !== 'undefined' ? globalThis.AI : window.AI);
