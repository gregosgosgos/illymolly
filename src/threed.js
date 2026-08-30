/* =========================================================================
   threed.js — 효과 > 3D (돌출과 경사 · 회전)
   -------------------------------------------------------------------------
   일러스트레이터의 [효과 > 3D] 에 대응한다. 평면 패스를 z 축으로 밀어 올려
   앞면 · 뒷면 · 옆면을 만들고, 회전 · 원근을 먹인 뒤 화면에 눕힌다.
   면마다 법선으로 밝기를 구해 칠하므로 입체로 보인다.

     it.effects = [{ type:'extrude', depth:50, ax:-18, ay:-26, az:8,
                     perspective:0, cap:true, shade:'plastic',
                     light:60, ambient:30 }]
     it.effects = [{ type:'rotate3d', ax:…, ay:…, az:…, perspective:… }]   // 깊이 0

   결과는 이미 2D 로 투영된 면 목록이라 렌더 · 히트 · SVG · PDF 가 그대로
   재활용한다.

     TD.result(it) -> { faces:[{rings:[[{x,y}…]…], color, z}], bounds }

   원본 패스는 그대로 남는다 (비파괴).
   ========================================================================= */
(function (AI) {
  'use strict';
  var U = AI.util, M = AI.mat, R = AI.rect, G = AI.geom, Col = AI.color;
  var TD = AI.threed = {};

  TD.DEFS = {
    extrude: {
      name: '돌출과 경사', menu: '3D', threeD: true,
      make: function () {
        return {
          type: 'extrude', depth: 50, ax: -18, ay: -26, az: 8,
          perspective: 0, cap: true, shade: 'plastic', light: 100, ambient: 40
        };
      },
      label: function (e) {
        return '3D 돌출 ' + U.fmt(e.depth) + 'pt · ' +
          U.fmt(e.ax) + '/' + U.fmt(e.ay) + '/' + U.fmt(e.az) + '°';
      }
    },
    rotate3d: {
      name: '회전', menu: '3D', threeD: true,
      make: function () {
        return {
          type: 'rotate3d', depth: 0, ax: -18, ay: -26, az: 8,
          perspective: 0, cap: true, shade: 'diffuse', light: 100, ambient: 50
        };
      },
      label: function (e) {
        return '3D 회전 ' + U.fmt(e.ax) + '/' + U.fmt(e.ay) + '/' + U.fmt(e.az) + '°';
      }
    }
  };

  TD.isThreeD = function (type) { return !!(TD.DEFS[type] && TD.DEFS[type].threeD); };

  TD.has = function (it) {
    if (!it || it.type !== 'path' || !it.effects) return false;
    for (var i = 0; i < it.effects.length; i++) if (TD.isThreeD(it.effects[i].type)) return true;
    return false;
  };

  function effectOf(it) {
    var list = (it && it.effects) || [];
    for (var i = 0; i < list.length; i++) if (TD.isThreeD(list[i].type)) return list[i];
    return null;
  }
  TD.effectOf = effectOf;

  /* ---------------- 입력 기하 ----------------
     왜곡 및 변형 효과가 걸려 있으면 그 결과를 재료로 쓴다 (효과는 쌓인다). */
  function inputRings(it) {
    var out = [];
    var geo = AI.distort && AI.distort.result(it);
    if (geo) {
      geo.forEach(function (entry) {
        G.flattenItem({ subs: entry.subs }, 0.4, entry.m).forEach(function (p) {
          if (p.pts.length > 2) out.push(p.pts);
        });
      });
    } else {
      G.flattenItem(it, 0.4, null).forEach(function (p) {
        if (p.pts.length > 2) out.push(p.pts);
      });
    }
    return AI.pathfinder.normalize(out);
  }

  /* ---------------- 3D 수학 ---------------- */
  function rotMatrix(ax, ay, az) {
    var a = U.rad(ax), b = U.rad(ay), c = U.rad(az);
    var ca = Math.cos(a), sa = Math.sin(a);
    var cb = Math.cos(b), sb = Math.sin(b);
    var cc = Math.cos(c), sc = Math.sin(c);
    /* R = Rx · Ry · Rz (일러스트레이터의 위치 순서와 같은 느낌으로) */
    return [
      cb * cc, cb * sc, -sb,
      sa * sb * cc - ca * sc, sa * sb * sc + ca * cc, sa * cb,
      ca * sb * cc + sa * sc, ca * sb * sc - sa * cc, ca * cb
    ];
  }
  function rot(m, p) {
    return {
      x: m[0] * p.x + m[3] * p.y + m[6] * p.z,
      y: m[1] * p.x + m[4] * p.y + m[7] * p.z,
      z: m[2] * p.x + m[5] * p.y + m[8] * p.z
    };
  }
  function cross(a, b) {
    return { x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x };
  }
  function norm(v) {
    var l = Math.hypot(v.x, v.y, v.z) || 1;
    return { x: v.x / l, y: v.y / l, z: v.z / l };
  }

  /* ---------------- 음영 ----------------
     LIGHT 는 면에서 조명을 바라보는 방향이다. 화면 왼쪽 위 · 앞쪽에 조명을 둔다
     (일러스트레이터의 기본 조명 위치와 같은 자리). y 는 아래가 +, z 는 뒤가 +. */
  var LIGHT = norm({ x: -0.3, y: -0.42, z: -1 });

  function shadeColor(base, n, e) {
    if (e.shade === 'none') return base;
    var amb = U.clamp((e.ambient == null ? 40 : e.ambient) / 100, 0, 1);
    var pow = U.clamp((e.light == null ? 100 : e.light) / 100, 0, 1.5);
    /* 면 법선이 조명 쪽을 볼수록 밝다 */
    var d = Math.max(0, n.x * LIGHT.x + n.y * LIGHT.y + n.z * LIGHT.z);
    var k = amb + (1 - amb) * d * pow;
    if (e.shade === 'plastic') {
      /* 반사광 한 겹 — 플라스틱처럼 하이라이트가 생긴다 */
      k += Math.pow(d, 18) * 0.55 * pow;
    }
    k = U.clamp(k, 0, 1.6);
    var c = Col.hexToRgb(base);
    return Col.rgbToHex(
      Math.round(U.clamp(c.r * k, 0, 255)),
      Math.round(U.clamp(c.g * k, 0, 255)),
      Math.round(U.clamp(c.b * k, 0, 255))
    );
  }

  /* ---------------- 면 만들기 ---------------- */
  function build(it, e) {
    var rings = inputRings(it);
    if (!rings.length) return null;

    var bb = R.empty();
    rings.forEach(function (r) { r.forEach(function (p) { R.add(bb, p.x, p.y); }); });
    if (R.isEmpty(bb)) return null;
    var cx = (bb.x + bb.x2) / 2, cy = (bb.y + bb.y2) / 2;
    var depth = Math.max(0, e.depth || 0);
    var z0 = -depth / 2, z1 = depth / 2;

    var rm = rotMatrix(e.ax || 0, e.ay || 0, e.az || 0);
    var diag = Math.hypot(R.w(bb), R.h(bb)) + depth;
    var persp = U.clamp(e.perspective || 0, 0, 160);
    var D = persp > 0.01 ? (diag / Math.tan(U.rad(persp) / 2)) : 0;

    /* 로컬 (x,y,z) -> 회전 -> 원근 -> 화면 (x,y) + 깊이 z */
    function P(x, y, z) {
      var q = rot(rm, { x: x - cx, y: y - cy, z: z });
      var k = D > 0 ? D / Math.max(1e-3, D + q.z) : 1;
      return { x: cx + q.x * k, y: cy + q.y * k, z: q.z };
    }

    var base = baseColor(it);
    var faces = [];

    /* --- 옆면 --- */
    if (depth > 0) {
      rings.forEach(function (ring) {
        var n = ring.length;
        for (var i = 0; i < n; i++) {
          var a = ring[i], b = ring[(i + 1) % n];
          if (Math.abs(a.x - b.x) < 1e-9 && Math.abs(a.y - b.y) < 1e-9) continue;
          var q = [P(a.x, a.y, z0), P(b.x, b.y, z0), P(b.x, b.y, z1), P(a.x, a.y, z1)];
          /* 화면에서 뒤집힌 면(뒤통수)은 그리지 않는다 */
          if (signedArea(q) >= 0) continue;
          /* 면 법선 — 옆면은 진행 방향과 z 축의 외적 */
          var e1 = rot(rm, { x: b.x - a.x, y: b.y - a.y, z: 0 });
          var nrm = norm(cross(e1, rot(rm, { x: 0, y: 0, z: 1 })));
          faces.push({
            rings: [q.map(xy)],
            color: shadeColor(base, nrm, e),
            z: (q[0].z + q[1].z + q[2].z + q[3].z) / 4
          });
        }
      });
    }

    /* --- 마구리(앞·뒷면) ---
       깊이가 0 이면 두 마구리가 겹치므로 관찰자 쪽을 보는 한 장만 만든다. */
    if (e.cap !== false) {
      var caps = [z1, z0];
      if (depth === 0) caps = [rot(rm, { x: 0, y: 0, z: -1 }).z <= 0 ? z0 : z1];
      caps.forEach(function (z) {
        var proj = rings.map(function (ring) {
          return ring.map(function (p) { return xy(P(p.x, p.y, z)); });
        });
        var nrm = norm(rot(rm, { x: 0, y: 0, z: z === z0 ? -1 : 1 }));
        /* 관찰자 반대쪽을 보는 마구리는 건너뛴다 (돌출일 때만 — 회전은 양면 다 씀) */
        if (depth > 0 && nrm.z > 0) return;
        var zs = 0, cnt = 0;
        rings.forEach(function (ring) {
          ring.forEach(function (p) { zs += P(p.x, p.y, z).z; cnt++; });
        });
        /* 마구리는 옆면과 평균 깊이가 같아질 수 있다. 앞 마구리는 조금 더 앞,
           뒤 마구리는 조금 더 뒤로 밀어 그리는 순서를 확실히 한다. */
        var bias = diag * 0.02 * (z === z0 ? -1 : 1);
        faces.push({
          rings: proj,
          color: shadeColor(base, nrm, e),
          z: (cnt ? zs / cnt : z) + bias,
          cap: true
        });
      });
    }

    if (!faces.length) return null;
    /* 화가 알고리즘 — 먼 면부터 그린다 */
    faces.sort(function (a, b) { return b.z - a.z; });

    var out = R.empty();
    faces.forEach(function (f) {
      f.rings.forEach(function (r) { r.forEach(function (p) { R.add(out, p.x, p.y); }); });
    });
    return { faces: faces, bounds: out };
  }

  function xy(p) { return { x: p.x, y: p.y }; }
  function signedArea(q) {
    var s = 0;
    for (var i = 0; i < q.length; i++) {
      var a = q[i], b = q[(i + 1) % q.length];
      s += a.x * b.y - b.x * a.y;
    }
    return s / 2;
  }

  /* 3D 표면의 바탕색 — 칠이 있으면 칠, 없으면 획 */
  function baseColor(it) {
    var p = it.fill;
    if (p && p.type === 'solid') return p.color;
    if (p && p.stops && p.stops.length) return p.stops[0].color;
    var s = it.stroke;
    if (s && s.type === 'solid') return s.color;
    return '#8f8f8f';
  }

  /* ---------------- 캐시 ---------------- */
  function signature(it, e) {
    var h = 0, n = 0;
    for (var s = 0; s < it.subs.length; s++) {
      var pts = it.subs[s].pts;
      n += pts.length;
      for (var i = 0; i < pts.length; i++) {
        h = (h * 31 + pts[i].x * 7.1 + pts[i].y * 3.3) % 1e9;
      }
    }
    return n + ':' + U.round(h, 2) + '|' + JSON.stringify(e) + '|' + baseColor(it) +
      '|' + JSON.stringify((it.effects || []).filter(function (x) {
        return AI.distort && AI.distort.isGeo(x.type);
      }));
  }

  TD.result = function (it) {
    if (!TD.has(it)) return null;
    var e = effectOf(it);
    var key = signature(it, e);
    if (it.__td && it.__td.key === key) return it.__td.out;
    var out = build(it, e);
    try {
      Object.defineProperty(it, '__td', {
        value: { key: key, out: out }, writable: true, configurable: true, enumerable: false
      });
    } catch (err) { it.__td = { key: key, out: out }; }
    return out;
  };

  /* 면을 실제 오브젝트로 굳힌다 (오브젝트 > 모양 확장) */
  TD.expand = function (it) {
    var res = TD.result(it);
    if (!res) return null;
    return res.faces.map(function (f) {
      return { rings: f.rings.map(function (r) { return r.map(function (p) { return { x: p.x, y: p.y }; }); }), color: f.color };
    });
  };

  /* 캔버스에 그린다 */
  TD.draw = function (ctx, it, m, res) {
    for (var i = 0; i < res.faces.length; i++) {
      var f = res.faces[i];
      ctx.beginPath();
      for (var r = 0; r < f.rings.length; r++) {
        var ring = f.rings[r];
        if (ring.length < 2) continue;
        var p0 = M.apply(m, ring[0].x, ring[0].y);
        ctx.moveTo(p0.x, p0.y);
        for (var k = 1; k < ring.length; k++) {
          var q = M.apply(m, ring[k].x, ring[k].y);
          ctx.lineTo(q.x, q.y);
        }
        ctx.closePath();
      }
      ctx.fillStyle = f.color;
      ctx.fill('evenodd');
      /* 이웃한 면 사이의 반투명 이음매를 없애려고 아주 얇게 같은 색으로 덧그린다 */
      ctx.strokeStyle = f.color;
      ctx.lineWidth = 0.6;
      ctx.stroke();
    }
  };

  /* 점이 3D 결과 안에 들어 있는가 (히트 테스트) */
  TD.hitTest = function (res, x, y) {
    for (var i = 0; i < res.faces.length; i++) {
      var f = res.faces[i], inside = false;
      for (var r = 0; r < f.rings.length; r++) {
        if (ringHas(f.rings[r], x, y)) inside = !inside;
      }
      if (inside) return true;
    }
    return false;
  };
  function ringHas(ring, x, y) {
    var inside = false, n = ring.length;
    for (var i = 0, j = n - 1; i < n; j = i++) {
      var a = ring[i], b = ring[j];
      if (((a.y > y) !== (b.y > y)) && (x < (b.x - a.x) * (y - a.y) / (b.y - a.y) + a.x)) inside = !inside;
    }
    return inside;
  }
})(typeof globalThis !== 'undefined' ? globalThis.AI : window.AI);
