/* =========================================================================
   pdfin.js — PDF 가져오기
   -------------------------------------------------------------------------
   PDF 를 열어 편집 가능한 벡터 오브젝트로 되돌린다. 외부 라이브러리 없이,
   브라우저와 Node 에서 같은 코드가 돈다.

     1) DEFLATE 를 직접 푼다 (FlateDecode 가 거의 모든 스트림에 걸려 있다)
     2) 파일 전체를 훑어 "N G obj … endobj" 를 모은다 — 상호 참조표(xref)가
        깨진 파일도 열리도록 일부러 브루트포스로 간다
     3) 오브젝트 스트림(/ObjStm) 안에 숨은 오브젝트까지 펼친다
     4) 페이지 콘텐츠 스트림의 연산자를 해석해 패스 · 색 · 문자 · 이미지를 만든다

   가져오지 못한 것은 조용히 버리지 않고 report.skipped 에 남긴다.
   ========================================================================= */
(function (AI) {
  'use strict';
  var U = AI.util, M = AI.mat, Col = AI.color, Model = AI.model;
  var PI = AI.pdfin = {};

  /* =====================================================================
     0. DEFLATE 풀기 (RFC 1950 zlib / RFC 1951 raw)
     ===================================================================== */
  function Bits(buf, pos) { this.b = buf; this.p = pos || 0; this.bit = 0; this.cur = 0; }
  Bits.prototype.get = function (n) {
    var v = 0;
    for (var i = 0; i < n; i++) {
      if (this.bit === 0) { this.cur = this.b[this.p++]; if (this.cur === undefined) throw new Error('EOF'); }
      v |= ((this.cur >> this.bit) & 1) << i;
      this.bit = (this.bit + 1) & 7;
    }
    return v;
  };
  Bits.prototype.align = function () { this.bit = 0; };

  /* 코드 길이 배열 -> 정규 허프만 표 */
  function huff(lens) {
    var max = 0, i;
    for (i = 0; i < lens.length; i++) if (lens[i] > max) max = lens[i];
    var count = new Int32Array(max + 1);
    for (i = 0; i < lens.length; i++) count[lens[i]]++;
    count[0] = 0;
    var next = new Int32Array(max + 2), code = 0;
    for (i = 1; i <= max; i++) { code = (code + count[i - 1]) << 1; next[i] = code; }
    var codes = new Int32Array(lens.length);
    for (i = 0; i < lens.length; i++) if (lens[i]) codes[i] = next[lens[i]]++;
    return { lens: lens, codes: codes, max: max };
  }
  function decode(bs, t) {
    var code = 0, len = 0;
    while (len < t.max) {
      code = (code << 1) | bs.get(1);
      len++;
      for (var i = 0; i < t.lens.length; i++) {
        if (t.lens[i] === len && t.codes[i] === code) return i;
      }
    }
    throw new Error('허프만 코드를 읽지 못했습니다');
  }
  /* 위 선형 탐색은 느리다 — 길이별 시작 인덱스를 미리 만들어 둔다 */
  function fastTable(lens) {
    var t = huff(lens), byLen = {};
    for (var i = 0; i < lens.length; i++) {
      if (!lens[i]) continue;
      (byLen[lens[i]] = byLen[lens[i]] || {})[t.codes[i]] = i;
    }
    t.byLen = byLen;
    return t;
  }
  function decodeFast(bs, t) {
    var code = 0;
    for (var len = 1; len <= t.max; len++) {
      code = (code << 1) | bs.get(1);
      var m = t.byLen[len];
      if (m && m[code] !== undefined) return m[code];
    }
    throw new Error('허프만 코드를 읽지 못했습니다');
  }

  var LBASE = [3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258];
  var LEXT = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0];
  var DBASE = [1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537, 2049, 3073, 4097, 6145, 8193, 12289, 16385, 24577];
  var DEXT = [0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13];
  var CLORDER = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15];

  PI.inflate = function (buf) {
    var start = 0;
    /* zlib 래퍼(0x78 …)면 두 바이트를 건너뛴다 */
    if (buf.length > 2 && (buf[0] & 0x0f) === 8 && ((buf[0] << 8 | buf[1]) % 31) === 0) start = 2;
    var bs = new Bits(buf, start);
    var out = [], fixedL = null, fixedD = null;

    for (;;) {
      var last = bs.get(1), type = bs.get(2);
      if (type === 0) {
        bs.align();
        var len = bs.b[bs.p] | (bs.b[bs.p + 1] << 8);
        bs.p += 4;
        for (var i = 0; i < len; i++) out.push(bs.b[bs.p++]);
      } else {
        var lt, dt;
        if (type === 1) {
          if (!fixedL) {
            var ll = new Array(288);
            for (var j = 0; j < 288; j++) ll[j] = j < 144 ? 8 : j < 256 ? 9 : j < 280 ? 7 : 8;
            fixedL = fastTable(ll);
            var dl = new Array(30); for (var k = 0; k < 30; k++) dl[k] = 5;
            fixedD = fastTable(dl);
          }
          lt = fixedL; dt = fixedD;
        } else if (type === 2) {
          var hlit = bs.get(5) + 257, hdist = bs.get(5) + 1, hclen = bs.get(4) + 4;
          var cl = new Array(19); for (var c = 0; c < 19; c++) cl[c] = 0;
          for (var q = 0; q < hclen; q++) cl[CLORDER[q]] = bs.get(3);
          var ct = fastTable(cl);
          var lens = [], prev = 0;
          while (lens.length < hlit + hdist) {
            var sym = decodeFast(bs, ct);
            if (sym < 16) { lens.push(sym); prev = sym; }
            else if (sym === 16) { var r = 3 + bs.get(2); while (r--) lens.push(prev); }
            else if (sym === 17) { var r2 = 3 + bs.get(3); while (r2--) lens.push(0); }
            else { var r3 = 11 + bs.get(7); while (r3--) lens.push(0); }
          }
          lt = fastTable(lens.slice(0, hlit));
          dt = fastTable(lens.slice(hlit));
        } else throw new Error('알 수 없는 압축 블록');

        for (;;) {
          var s = decodeFast(bs, lt);
          if (s === 256) break;
          if (s < 256) { out.push(s); continue; }
          var li = s - 257;
          var length = LBASE[li] + bs.get(LEXT[li]);
          var ds = decodeFast(bs, dt);
          var dist = DBASE[ds] + bs.get(DEXT[ds]);
          var from = out.length - dist;
          for (var n2 = 0; n2 < length; n2++) out.push(out[from + n2]);
        }
      }
      if (last) break;
    }
    return new Uint8Array(out);
  };

  /* PNG 예측기 — /DecodeParms 의 Predictor >= 10 */
  function unpredict(data, pred, colors, bpc, columns) {
    if (!pred || pred < 10) return data;
    var bpp = Math.ceil(colors * bpc / 8);
    var rowLen = Math.ceil(colors * bpc * columns / 8);
    var rows = Math.floor(data.length / (rowLen + 1));
    var out = new Uint8Array(rows * rowLen);
    var prevRow = new Uint8Array(rowLen);
    for (var r = 0; r < rows; r++) {
      var ft = data[r * (rowLen + 1)];
      var row = data.subarray(r * (rowLen + 1) + 1, (r + 1) * (rowLen + 1));
      var cur = new Uint8Array(rowLen);
      for (var i = 0; i < rowLen; i++) {
        var raw = row[i] || 0, a = i >= bpp ? cur[i - bpp] : 0, b = prevRow[i], c = i >= bpp ? prevRow[i - bpp] : 0;
        var v;
        if (ft === 0) v = raw;
        else if (ft === 1) v = raw + a;
        else if (ft === 2) v = raw + b;
        else if (ft === 3) v = raw + ((a + b) >> 1);
        else {
          var p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
          v = raw + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c);
        }
        cur[i] = v & 255;
      }
      out.set(cur, r * rowLen);
      prevRow = cur;
    }
    return out;
  }

  /* =====================================================================
     1. 토큰 · 오브젝트 파서
     ===================================================================== */
  function isWS(c) { return c === 32 || c === 10 || c === 13 || c === 9 || c === 0 || c === 12; }
  function isDelim(c) { return c === 40 || c === 41 || c === 60 || c === 62 || c === 91 || c === 93 || c === 123 || c === 125 || c === 47 || c === 37; }

  function Lexer(buf, pos) { this.b = buf; this.p = pos || 0; }
  Lexer.prototype.skip = function () {
    while (this.p < this.b.length) {
      var c = this.b[this.p];
      if (isWS(c)) { this.p++; continue; }
      if (c === 37) { while (this.p < this.b.length && this.b[this.p] !== 10 && this.b[this.p] !== 13) this.p++; continue; }
      break;
    }
  };
  Lexer.prototype.token = function () {
    this.skip();
    if (this.p >= this.b.length) return null;
    var b = this.b, c = b[this.p];
    if (c === 47) {                                   /* /Name */
      var s = ++this.p;
      while (this.p < b.length && !isWS(b[this.p]) && !isDelim(b[this.p])) this.p++;
      return { t: 'name', v: decodeName(b, s, this.p) };
    }
    if (c === 40) return this.literalString();        /* (string) */
    if (c === 60) {
      if (b[this.p + 1] === 60) { this.p += 2; return { t: '<<' }; }
      return this.hexString();
    }
    if (c === 62 && b[this.p + 1] === 62) { this.p += 2; return { t: '>>' }; }
    if (c === 91) { this.p++; return { t: '[' }; }
    if (c === 93) { this.p++; return { t: ']' }; }
    if (c === 123) { this.p++; return { t: '{' }; }
    if (c === 125) { this.p++; return { t: '}' }; }
    if ((c >= 48 && c <= 57) || c === 43 || c === 45 || c === 46) {
      var st = this.p;
      this.p++;
      while (this.p < b.length && ((b[this.p] >= 48 && b[this.p] <= 57) || b[this.p] === 46 || b[this.p] === 45 || b[this.p] === 43)) this.p++;
      return { t: 'num', v: parseFloat(str(b, st, this.p)) || 0 };
    }
    var s2 = this.p;
    while (this.p < b.length && !isWS(b[this.p]) && !isDelim(b[this.p])) this.p++;
    if (this.p === s2) { this.p++; return { t: 'op', v: String.fromCharCode(c) }; }
    return { t: 'op', v: str(b, s2, this.p) };
  };
  Lexer.prototype.literalString = function () {
    var b = this.b, depth = 0, out = [];
    this.p++;
    while (this.p < b.length) {
      var c = b[this.p++];
      if (c === 92) {                                  /* \ 이스케이프 */
        var e = b[this.p++];
        if (e === 110) out.push(10); else if (e === 114) out.push(13);
        else if (e === 116) out.push(9); else if (e === 98) out.push(8);
        else if (e === 102) out.push(12);
        else if (e >= 48 && e <= 55) {
          var oct = e - 48;
          for (var k = 0; k < 2 && b[this.p] >= 48 && b[this.p] <= 55; k++) oct = oct * 8 + (b[this.p++] - 48);
          out.push(oct & 255);
        } else if (e === 10) { /* 줄 이어짐 */ }
        else out.push(e);
        continue;
      }
      if (c === 40) { depth++; out.push(c); continue; }
      if (c === 41) { if (!depth) break; depth--; out.push(c); continue; }
      out.push(c);
    }
    return { t: 'str', v: new Uint8Array(out) };
  };
  Lexer.prototype.hexString = function () {
    var b = this.b, out = [], hi = -1;
    this.p++;
    while (this.p < b.length) {
      var c = b[this.p++];
      if (c === 62) break;
      var d = hexVal(c);
      if (d < 0) continue;
      if (hi < 0) hi = d; else { out.push(hi * 16 + d); hi = -1; }
    }
    if (hi >= 0) out.push(hi * 16);
    return { t: 'str', v: new Uint8Array(out) };
  };
  function hexVal(c) {
    if (c >= 48 && c <= 57) return c - 48;
    if (c >= 97 && c <= 102) return c - 87;
    if (c >= 65 && c <= 70) return c - 55;
    return -1;
  }
  function str(b, s, e) {
    var out = '';
    for (var i = s; i < e; i++) out += String.fromCharCode(b[i]);
    return out;
  }
  function decodeName(b, s, e) {
    var out = '';
    for (var i = s; i < e; i++) {
      if (b[i] === 35 && i + 2 < e) { out += String.fromCharCode(hexVal(b[i + 1]) * 16 + hexVal(b[i + 2])); i += 2; }
      else out += String.fromCharCode(b[i]);
    }
    return out;
  }

  function Ref(num, gen) { this.num = num; this.gen = gen; }
  Ref.prototype.isRef = true;

  /* 토큰 스트림에서 값 하나 */
  function parseValue(lx, tok) {
    var t = tok || lx.token();
    if (!t) return null;
    if (t.t === 'num') {
      /* "12 0 R" 인지 앞을 살짝 본다 */
      var save = lx.p;
      var t2 = lx.token();
      if (t2 && t2.t === 'num') {
        var save2 = lx.p, t3 = lx.token();
        if (t3 && t3.t === 'op' && t3.v === 'R') return new Ref(t.v, t2.v);
        lx.p = save;
        return t.v;
      }
      lx.p = save;
      return t.v;
    }
    if (t.t === 'name') return { name: t.v };
    if (t.t === 'str') return t.v;
    if (t.t === '[') {
      var arr = [];
      for (;;) {
        var e = lx.token();
        if (!e || e.t === ']') break;
        arr.push(parseValue(lx, e));
      }
      return arr;
    }
    if (t.t === '<<') {
      var d = {};
      for (;;) {
        var k = lx.token();
        if (!k || k.t === '>>') break;
        if (k.t !== 'name') continue;
        d[k.v] = parseValue(lx);
      }
      return d;
    }
    if (t.t === 'op') {
      if (t.v === 'true') return true;
      if (t.v === 'false') return false;
      if (t.v === 'null') return null;
      return { op: t.v };
    }
    return null;
  }

  /* =====================================================================
     2. 문서 — 브루트포스로 오브젝트를 모은다
     ===================================================================== */
  function Doc(buf) {
    this.b = buf;
    this.objs = {};       /* "num" -> 값 */
    this.streams = {};    /* "num" -> {dict, start, len} */
    this.scan();
    this.expandObjStreams();
  }

  Doc.prototype.scan = function () {
    var b = this.b, s = str(b, 0, b.length);
    var re = /(\d+)\s+(\d+)\s+obj\b/g, m;
    while ((m = re.exec(s))) {
      var num = +m[1];
      var lx = new Lexer(b, m.index + m[0].length);
      var val;
      try { val = parseValue(lx); } catch (e) { continue; }
      /* 스트림이면 본문 위치를 기억해 둔다 */
      lx.skip();
      if (str(b, lx.p, lx.p + 6) === 'stream') {
        var p = lx.p + 6;
        if (b[p] === 13) p++;
        if (b[p] === 10) p++;
        this.streams[num] = { dict: val, start: p };
      }
      this.objs[num] = val;
    }
  };

  Doc.prototype.get = function (v) {
    var guard = 0;
    while (v instanceof Ref && guard++ < 32) v = this.objs[v.num];
    return v;
  };
  Doc.prototype.dictGet = function (d, key) {
    if (!d) return null;
    return this.get(d[key]);
  };

  /* 스트림 본문 (필터 해제까지) */
  Doc.prototype.stream = function (num) {
    var s = this.streams[num];
    if (!s) return null;
    if (s.data) return s.data;
    var len = this.get(s.dict.Length);
    var raw;
    if (typeof len === 'number' && len > 0 && s.start + len <= this.b.length) {
      raw = this.b.subarray(s.start, s.start + len);
      /* 길이가 거짓말인 경우가 있어 endstream 위치로 검산한다 */
      var after = str(this.b, s.start + len, s.start + len + 20);
      if (!/^\s*endstream/.test(after)) raw = null;
    }
    if (!raw) {
      var end = indexOfStr(this.b, 'endstream', s.start);
      if (end < 0) return null;
      var e = end;
      while (e > s.start && (this.b[e - 1] === 10 || this.b[e - 1] === 13)) e--;
      raw = this.b.subarray(s.start, e);
    }
    s.data = this.decodeStream(s.dict, raw);
    return s.data;
  };

  Doc.prototype.decodeStream = function (dict, raw) {
    var self = this;
    var f = this.get(dict.Filter), parms = this.get(dict.DecodeParms) || this.get(dict.DP);
    var filters = !f ? [] : (Array.isArray(f) ? f : [f]);
    var parmList = !parms ? [] : (Array.isArray(parms) ? parms : [parms]);
    var data = raw;
    for (var i = 0; i < filters.length; i++) {
      var name = filters[i] && filters[i].name;
      var pm = this.get(parmList[i]) || {};
      if (name === 'FlateDecode' || name === 'Fl') {
        try { data = PI.inflate(data); } catch (e) { return null; }
        data = unpredict(data, self.get(pm.Predictor) || 0, self.get(pm.Colors) || 1,
          self.get(pm.BitsPerComponent) || 8, self.get(pm.Columns) || 1);
      } else if (name === 'ASCIIHexDecode' || name === 'AHx') {
        data = hexDecode(data);
      } else if (name === 'ASCII85Decode' || name === 'A85') {
        data = a85Decode(data);
      } else if (name === 'DCTDecode' || name === 'JPXDecode' || name === 'CCITTFaxDecode' || name === 'JBIG2Decode') {
        return { image: name, data: data };     /* 그림은 그대로 넘긴다 */
      } else if (name === 'LZWDecode') {
        data = lzwDecode(data);
        data = unpredict(data, self.get(pm.Predictor) || 0, self.get(pm.Colors) || 1,
          self.get(pm.BitsPerComponent) || 8, self.get(pm.Columns) || 1);
      } else if (name === 'RunLengthDecode' || name === 'RL') {
        data = rleDecode(data);
      }
    }
    return data;
  };

  /* /ObjStm 안에 압축되어 들어간 오브젝트를 꺼내 놓는다 */
  Doc.prototype.expandObjStreams = function () {
    var self = this;
    Object.keys(this.streams).forEach(function (num) {
      var d = self.streams[num].dict;
      if (!d || !d.Type || d.Type.name !== 'ObjStm') return;
      var data = self.stream(+num);
      if (!data || data.image) return;
      var n = self.get(d.N) || 0, first = self.get(d.First) || 0;
      var head = new Lexer(data, 0), pairs = [];
      for (var i = 0; i < n; i++) {
        var a = head.token(), b2 = head.token();
        if (!a || !b2) break;
        pairs.push([a.v, b2.v]);
      }
      pairs.forEach(function (pr) {
        if (self.objs[pr[0]] !== undefined) return;   /* 파일 본문 쪽이 우선 */
        var lx = new Lexer(data, first + pr[1]);
        try { self.objs[pr[0]] = parseValue(lx); } catch (e) { }
      });
    });
  };

  function indexOfStr(b, s, from) {
    var first = s.charCodeAt(0);
    outer: for (var i = from; i <= b.length - s.length; i++) {
      if (b[i] !== first) continue;
      for (var j = 1; j < s.length; j++) if (b[i + j] !== s.charCodeAt(j)) continue outer;
      return i;
    }
    return -1;
  }
  function hexDecode(b) {
    var out = [], hi = -1;
    for (var i = 0; i < b.length; i++) {
      if (b[i] === 62) break;
      var d = hexVal(b[i]);
      if (d < 0) continue;
      if (hi < 0) hi = d; else { out.push(hi * 16 + d); hi = -1; }
    }
    if (hi >= 0) out.push(hi * 16);
    return new Uint8Array(out);
  }
  function a85Decode(b) {
    var out = [], tup = [], i = 0;
    if (b[0] === 60 && b[1] === 126) i = 2;
    for (; i < b.length; i++) {
      var c = b[i];
      if (c === 126) break;
      if (isWS(c)) continue;
      if (c === 122 && !tup.length) { out.push(0, 0, 0, 0); continue; }
      tup.push(c - 33);
      if (tup.length === 5) {
        var v = 0;
        for (var k = 0; k < 5; k++) v = v * 85 + tup[k];
        out.push((v >>> 24) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255);
        tup = [];
      }
    }
    if (tup.length) {
      var n = tup.length;
      for (var f = n; f < 5; f++) tup.push(84);
      var v2 = 0;
      for (var k2 = 0; k2 < 5; k2++) v2 = v2 * 85 + tup[k2];
      var bytes = [(v2 >>> 24) & 255, (v2 >>> 16) & 255, (v2 >>> 8) & 255, v2 & 255];
      for (var q = 0; q < n - 1; q++) out.push(bytes[q]);
    }
    return new Uint8Array(out);
  }
  function rleDecode(b) {
    var out = [], i = 0;
    while (i < b.length) {
      var l = b[i++];
      if (l === 128) break;
      if (l < 128) { for (var k = 0; k <= l; k++) out.push(b[i++]); }
      else { var v = b[i++]; for (var j = 0; j < 257 - l; j++) out.push(v); }
    }
    return new Uint8Array(out);
  }
  function lzwDecode(b) {
    var out = [], dict = [], i, bitPos = 0, codeLen = 9, prev = null;
    function reset() { dict = []; for (i = 0; i < 256; i++) dict[i] = [i]; dict[256] = null; dict[257] = null; codeLen = 9; prev = null; }
    reset();
    function next() {
      var v = 0;
      for (var k = 0; k < codeLen; k++) {
        var byteI = bitPos >> 3;
        if (byteI >= b.length) return -1;
        v = (v << 1) | ((b[byteI] >> (7 - (bitPos & 7))) & 1);
        bitPos++;
      }
      return v;
    }
    for (;;) {
      var code = next();
      if (code < 0 || code === 257) break;
      if (code === 256) { reset(); continue; }
      var entry;
      if (dict[code]) entry = dict[code];
      else if (prev) entry = prev.concat([prev[0]]);
      else break;
      for (i = 0; i < entry.length; i++) out.push(entry[i]);
      if (prev) dict.push(prev.concat([entry[0]]));
      prev = entry;
      if (dict.length + 1 >= (1 << codeLen) && codeLen < 12) codeLen++;
    }
    return new Uint8Array(out);
  }

  /* =====================================================================
     3. 페이지 찾기
     ===================================================================== */
  Doc.prototype.pages = function () {
    var self = this, out = [];
    /* Catalog -> Pages 트리를 따라가고, 없으면 /Type /Page 를 그냥 긁는다 */
    var root = null;
    Object.keys(this.objs).forEach(function (k) {
      var o = self.objs[k];
      if (o && o.Type && o.Type.name === 'Catalog') root = o;
    });
    var pagesNode = root ? this.get(root.Pages) : null;
    if (pagesNode) {
      (function walk(node, inherited, depth) {
        if (!node || depth > 32) return;
        var inh = {
          Resources: node.Resources !== undefined ? node.Resources : inherited.Resources,
          MediaBox: node.MediaBox !== undefined ? node.MediaBox : inherited.MediaBox,
          CropBox: node.CropBox !== undefined ? node.CropBox : inherited.CropBox,
          Rotate: node.Rotate !== undefined ? node.Rotate : inherited.Rotate
        };
        var kids = self.get(node.Kids);
        if (Array.isArray(kids)) {
          kids.forEach(function (k) { walk(self.get(k), inh, depth + 1); });
          return;
        }
        if (node.Type && node.Type.name === 'Page') {
          out.push({
            dict: node,
            Resources: self.get(inh.Resources) || {},
            MediaBox: self.get(inh.MediaBox) || [0, 0, 612, 792],
            Rotate: self.get(inh.Rotate) || 0
          });
        }
      })(pagesNode, {}, 0);
    }
    if (!out.length) {
      Object.keys(this.objs).sort(function (a, b) { return a - b; }).forEach(function (k) {
        var o = self.objs[k];
        if (o && o.Type && o.Type.name === 'Page') {
          out.push({
            dict: o, Resources: self.get(o.Resources) || {},
            MediaBox: self.get(o.MediaBox) || [0, 0, 612, 792], Rotate: self.get(o.Rotate) || 0
          });
        }
      });
    }
    return out;
  };

  Doc.prototype.pageContent = function (page) {
    var self = this;
    var c = page.dict.Contents;
    var list = Array.isArray(this.get(c)) ? this.get(c) : [c];
    var parts = [];
    list.forEach(function (ref) {
      if (!(ref instanceof Ref)) return;
      var d = self.stream(ref.num);
      if (d && !d.image) parts.push(d);
    });
    if (!parts.length) return new Uint8Array(0);
    var total = parts.reduce(function (a, p) { return a + p.length + 1; }, 0);
    var out = new Uint8Array(total), off = 0;
    parts.forEach(function (p) { out.set(p, off); off += p.length; out[off++] = 10; });
    return out;
  };

  PI.parse = function (bytes) { return new Doc(bytes); };


  /* =====================================================================
     4. 콘텐츠 스트림 해석 — 연산자를 오브젝트로
     ---------------------------------------------------------------------
     PDF 좌표는 좌하단 원점 · y 위 방향이다. 페이지 기준 행렬 하나로 우리
     좌표(좌상단 · y 아래)로 옮긴 뒤, 점을 아예 문서 좌표로 구워 넣는다.
     아이템 행렬을 비워 두면 렌더러 · 히트 · 편집이 전부 평소대로 동작한다.
     ===================================================================== */

  var STD_ENC_HIGH = {   /* WinAnsi 에서 Latin-1 과 다른 구간만 */
    128: 0x20AC, 130: 0x201A, 131: 0x0192, 132: 0x201E, 133: 0x2026, 134: 0x2020,
    135: 0x2021, 136: 0x02C6, 137: 0x2030, 138: 0x0160, 139: 0x2039, 140: 0x0152,
    142: 0x017D, 145: 0x2018, 146: 0x2019, 147: 0x201C, 148: 0x201D, 149: 0x2022,
    150: 0x2013, 151: 0x2014, 152: 0x02DC, 153: 0x2122, 154: 0x0161, 155: 0x203A,
    156: 0x0153, 158: 0x017E, 159: 0x0178
  };

  /* /ToUnicode CMap — bfchar · bfrange 만 읽는다 (실무 파일은 이 둘이 전부다) */
  function parseToUnicode(bytes) {
    var map = {}, lx = new Lexer(bytes, 0), stack = [];
    for (;;) {
      var t;
      try { t = lx.token(); } catch (e) { break; }
      if (!t) break;
      if (t.t === 'op' && t.v === 'endbfchar') {
        for (var i = 0; i + 1 < stack.length; i += 2) {
          if (stack[i] && stack[i].t === 'str' && stack[i + 1] && stack[i + 1].t === 'str') {
            map[codeOf(stack[i].v)] = utf16be(stack[i + 1].v);
          }
        }
        stack = [];
      } else if (t.t === 'op' && t.v === 'endbfrange') {
        for (var j = 0; j + 2 < stack.length; j += 3) {
          var lo = stack[j], hi = stack[j + 1], dst = stack[j + 2];
          if (!lo || !hi || !dst || lo.t !== 'str' || hi.t !== 'str') continue;
          var a = codeOf(lo.v), b = codeOf(hi.v);
          if (b - a > 65535) continue;
          if (dst.t === 'str') {
            var base = utf16be(dst.v);
            for (var c = a; c <= b; c++) {
              map[c] = base.length === 1
                ? String.fromCharCode(base.charCodeAt(0) + (c - a)) : base;
            }
          }
        }
        stack = [];
      } else if (t.t === 'op' && (t.v === 'beginbfchar' || t.v === 'beginbfrange')) {
        stack = [];
      } else if (t.t === 'str' || t.t === 'num') {
        stack.push(t);
        if (stack.length > 3000) stack = [];
      } else if (t.t === '[' || t.t === ']') {
        /* bfrange 의 배열 형태는 건너뛴다 */
      }
    }
    return map;
  }
  function codeOf(bytes) {
    var v = 0;
    for (var i = 0; i < bytes.length; i++) v = (v << 8) | bytes[i];
    return v;
  }
  function utf16be(bytes) {
    var out = '';
    for (var i = 0; i + 1 < bytes.length; i += 2) out += String.fromCharCode((bytes[i] << 8) | bytes[i + 1]);
    if (bytes.length === 1) out = String.fromCharCode(bytes[0]);
    return out;
  }

  function fontInfo(doc, fdict) {
    if (!fdict) return { two: false, map: null, base: 'Helvetica', widths: null, first: 0 };
    var sub = doc.dictGet(fdict, 'Subtype');
    var two = !!(sub && sub.name === 'Type0');
    var map = null;
    var tu = fdict.ToUnicode;
    if (tu instanceof Ref) {
      var d = doc.stream(tu.num);
      if (d && !d.image) { try { map = parseToUnicode(d); } catch (e) { map = null; } }
    }
    var base = doc.dictGet(fdict, 'BaseFont');
    var widths = doc.dictGet(fdict, 'Widths');
    return {
      two: two, map: map,
      base: base && base.name ? String(base.name).replace(/^[A-Z]{6}\+/, '') : 'Helvetica',
      widths: Array.isArray(widths) ? widths.map(function (w) { return doc.get(w) || 0; }) : null,
      first: doc.dictGet(fdict, 'FirstChar') || 0,
      missing: 500
    };
  }

  /* 바이트열 -> {text, codes} */
  function decodeText(f, bytes) {
    var out = '', codes = [];
    if (f.two) {
      for (var i = 0; i + 1 < bytes.length; i += 2) {
        var c = (bytes[i] << 8) | bytes[i + 1];
        codes.push(c);
        out += f.map && f.map[c] !== undefined ? f.map[c] : ' ';
      }
    } else {
      for (var j = 0; j < bytes.length; j++) {
        var b = bytes[j];
        codes.push(b);
        if (f.map && f.map[b] !== undefined) out += f.map[b];
        else if (STD_ENC_HIGH[b]) out += String.fromCharCode(STD_ENC_HIGH[b]);
        else out += String.fromCharCode(b);
      }
    }
    return { text: out, codes: codes };
  }

  /* 글자 이동량 — /Widths 가 있으면 정확히, 없으면 0.5em 근사 */
  function advance(f, codes) {
    var sum = 0;
    for (var i = 0; i < codes.length; i++) {
      var w = null;
      if (f.widths && !f.two) {
        var idx = codes[i] - f.first;
        if (idx >= 0 && idx < f.widths.length) w = f.widths[idx];
      }
      sum += (w == null ? 500 : w) / 1000;
    }
    return sum;
  }

  /* ---------- 색 ---------- */
  function grayPaint(v) { var h = Col.rgbToHex(v * 255, v * 255, v * 255); return { type: 'solid', color: h, alpha: 1 }; }
  function rgbPaint(r, g, b) { return { type: 'solid', color: Col.rgbToHex(r * 255, g * 255, b * 255), alpha: 1 }; }
  function cmykPaint(c, m, y, k) {
    var PP = AI.prepress;
    var v = PP.cmyk(c * 100, m * 100, y * 100, k * 100);
    return { type: 'solid', color: PP.cmykToHex(v), alpha: 1, cmyk: v };
  }

  /* /Separation … 별색이다. 이름을 살려 두면 칼선이 칼선인 채로 들어온다. */
  function separationPaint(doc, cs, tint, target) {
    var PP = AI.prepress;
    var name = cs.name || 'Spot';
    var alt = cs.alt, fn = cs.fn;
    var full = null;
    if (fn && fn.C1) full = PP.cmyk(fn.C1[0] * 100, fn.C1[1] * 100, fn.C1[2] * 100, fn.C1[3] * 100);
    if (!full && alt === 'DeviceCMYK') full = PP.cmyk(0, 100, 0, 0);
    if (!full) full = PP.cmyk(0, 100, 0, 0);
    if (target && !PP.findSpot(target, name)) PP.addSpot(target, { name: name, cmyk: full });
    var t = U.clamp(tint == null ? 1 : tint, 0, 1);
    var scaled = PP.cmyk(full.c * t, full.m * t, full.y * t, full.k * t);
    return { type: 'solid', color: PP.cmykToHex(scaled), alpha: 1, cmyk: scaled, spot: name, tint: U.round(t * 100, 2) };
  }

  function readColorSpace(doc, cs) {
    cs = doc.get(cs);
    if (!cs) return { kind: 'gray', n: 1 };
    if (cs.name) {
      var nm = cs.name;
      if (nm === 'DeviceRGB' || nm === 'RGB' || nm === 'CalRGB') return { kind: 'rgb', n: 3 };
      if (nm === 'DeviceCMYK' || nm === 'CMYK') return { kind: 'cmyk', n: 4 };
      if (nm === 'DeviceGray' || nm === 'G' || nm === 'CalGray') return { kind: 'gray', n: 1 };
      if (nm === 'Pattern') return { kind: 'pattern', n: 1 };
      return { kind: 'gray', n: 1 };
    }
    if (Array.isArray(cs)) {
      var head = doc.get(cs[0]);
      var name = head && head.name;
      if (name === 'ICCBased') {
        var st = doc.get(cs[1]);
        var n = (st && doc.get(st.N)) || (st && st.dict && doc.get(st.dict.N)) || 3;
        if (cs[1] instanceof Ref && doc.streams[cs[1].num]) n = doc.get(doc.streams[cs[1].num].dict.N) || n;
        return { kind: n === 4 ? 'cmyk' : n === 1 ? 'gray' : 'rgb', n: n };
      }
      if (name === 'Separation' || name === 'DeviceN') {
        var spotName = doc.get(cs[1]);
        var nmv = Array.isArray(spotName) ? (doc.get(spotName[0]) || {}).name : (spotName || {}).name;
        var altCs = readColorSpace(doc, cs[2]);
        var fnObj = doc.get(cs[3]);
        var fn = null;
        if (fnObj && fnObj.C1) fn = { C1: (doc.get(fnObj.C1) || []).map(function (x) { return doc.get(x); }) };
        else if (cs[3] instanceof Ref && doc.streams[cs[3].num]) {
          var fd = doc.streams[cs[3].num].dict;
          if (fd && fd.C1) fn = { C1: (doc.get(fd.C1) || []).map(function (x) { return doc.get(x); }) };
        }
        if (fn && fn.C1 && altCs.kind !== 'cmyk') {
          var c1 = fn.C1;
          if (altCs.kind === 'rgb' && c1.length >= 3) {
            var v = AI.prepress.rgbToCmyk(Col.rgbToHex(c1[0] * 255, c1[1] * 255, c1[2] * 255));
            fn = { C1: [v.c / 100, v.m / 100, v.y / 100, v.k / 100] };
          } else if (altCs.kind === 'gray' && c1.length >= 1) {
            fn = { C1: [0, 0, 0, 1 - c1[0]] };
          }
        }
        return { kind: 'spot', n: Array.isArray(spotName) ? spotName.length : 1, name: nmv || 'Spot', alt: 'DeviceCMYK', fn: fn };
      }
      if (name === 'Indexed') return { kind: 'gray', n: 1, indexed: true };
      if (name === 'Pattern') return { kind: 'pattern', n: 1 };
      if (name === 'CalRGB' || name === 'Lab') return { kind: 'rgb', n: 3 };
      if (name === 'CalGray') return { kind: 'gray', n: 1 };
    }
    return { kind: 'gray', n: 1 };
  }

  function paintFrom(doc, space, args, target) {
    switch (space.kind) {
      case 'rgb': return rgbPaint(args[0] || 0, args[1] || 0, args[2] || 0);
      case 'cmyk': return cmykPaint(args[0] || 0, args[1] || 0, args[2] || 0, args[3] || 0);
      case 'spot': return separationPaint(doc, space, args[args.length - 1], target);
      case 'pattern': return null;
      default: return grayPaint(args[0] == null ? 0 : args[0]);
    }
  }

  /* ---------- 이미지 ---------- */
  function imageDataUrl(doc, num, dict) {
    var f = doc.get(dict.Filter), names = [];
    (Array.isArray(f) ? f : (f ? [f] : [])).forEach(function (x) { var g = doc.get(x); if (g && g.name) names.push(g.name); });
    var data = doc.stream(num);
    if (!data) return null;
    if (data.image === 'DCTDecode' || names.indexOf('DCTDecode') >= 0) {
      return 'data:image/jpeg;base64,' + b64(data.data || data);
    }
    if (data.image) return null;              /* JPX · CCITT · JBIG2 는 못 푼다 */
    if (!U.hasDOM) return null;               /* 원시 픽셀 -> PNG 는 캔버스가 필요 */
    var w = doc.get(dict.Width), h = doc.get(dict.Height);
    var bpc = doc.get(dict.BitsPerComponent) || 8;
    if (bpc !== 8 || !w || !h) return null;
    var sp = readColorSpace(doc, dict.ColorSpace);
    var comps = sp.kind === 'rgb' ? 3 : sp.kind === 'cmyk' ? 4 : 1;
    if (data.length < w * h * comps) return null;
    var cv = document.createElement('canvas');
    cv.width = w; cv.height = h;
    var ctx = cv.getContext('2d');
    var img = ctx.createImageData(w, h), px = img.data;
    for (var i = 0, o = 0, s = 0; i < w * h; i++, o += 4, s += comps) {
      if (comps === 3) { px[o] = data[s]; px[o + 1] = data[s + 1]; px[o + 2] = data[s + 2]; }
      else if (comps === 4) {
        var k = data[s + 3] / 255;
        px[o] = 255 * (1 - data[s] / 255) * (1 - k);
        px[o + 1] = 255 * (1 - data[s + 1] / 255) * (1 - k);
        px[o + 2] = 255 * (1 - data[s + 2] / 255) * (1 - k);
      } else { px[o] = px[o + 1] = px[o + 2] = data[s]; }
      px[o + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    return cv.toDataURL('image/png');
  }
  function b64(bytes) {
    if (typeof btoa === 'function') {
      var s = '';
      for (var i = 0; i < bytes.length; i += 8192) {
        s += String.fromCharCode.apply(null, bytes.subarray(i, i + 8192));
      }
      return btoa(s);
    }
    if (typeof Buffer !== 'undefined') return Buffer.from(bytes).toString('base64');
    return '';
  }

  /* ---------- 본체 ---------- */
  PI.importPage = function (doc, page, opts) {
    opts = opts || {};
    var target = opts.doc || null;               /* 별색을 등록할 우리 문서 */
    var mb = (page.MediaBox || [0, 0, 612, 792]).map(function (v) { return doc.get(v) || 0; });
    var mx = Math.min(mb[0], mb[2]), my = Math.min(mb[1], mb[3]);
    var W = Math.abs(mb[2] - mb[0]), H = Math.abs(mb[3] - mb[1]);
    var base = [1, 0, 0, -1, -mx, my + H];

    var out = [], report = { paths: 0, texts: 0, images: 0, skipped: {}, spots: [] };
    function skip(k) { report.skipped[k] = (report.skipped[k] || 0) + 1; }

    function run(content, res, ctm0, depth) {
      if (depth > 8) { skip('중첩이 너무 깊은 폼'); return; }
      var lx = new Lexer(content, 0), stack = [];
      var gs = {
        ctm: ctm0, fill: grayPaint(0), stroke: grayPaint(0),
        fillCS: { kind: 'gray', n: 1 }, strokeCS: { kind: 'gray', n: 1 },
        lw: 1, cap: 'butt', join: 'miter', dash: [], alpha: 1, salpha: 1
      };
      var st = [];
      var cur = [], sub = null, startPt = null;
      var tm = null, tlm = null, tf = null, tfSize = 12, tc = 0, tw = 0, tl = 0, trise = 0, thz = 100, tmode = 0;
      var pendingClip = null;

      function clone(g) {
        return {
          ctm: g.ctm.slice(), fill: U.deepCopy(g.fill), stroke: U.deepCopy(g.stroke),
          fillCS: g.fillCS, strokeCS: g.strokeCS,
          lw: g.lw, cap: g.cap, join: g.join, dash: g.dash.slice(), alpha: g.alpha, salpha: g.salpha
        };
      }
      function pt(x, y) { return M.apply(M.mul(base, gs.ctm), x, y); }
      function moveTo(x, y) { sub = { closed: false, pts: [] }; cur.push(sub); var p = pt(x, y); sub.pts.push(Model.pt(p.x, p.y)); startPt = { x: x, y: y }; }
      function lineTo(x, y) { if (!sub) moveTo(x, y); else { var p = pt(x, y); sub.pts.push(Model.pt(p.x, p.y)); } }
      function curveTo(x1, y1, x2, y2, x3, y3) {
        if (!sub) moveTo(x1, y1);
        var a = sub.pts[sub.pts.length - 1];
        var c1 = pt(x1, y1), c2 = pt(x2, y2), e = pt(x3, y3);
        a.ox = c1.x; a.oy = c1.y;
        var np = Model.pt(e.x, e.y); np.ix = c2.x; np.iy = c2.y;
        sub.pts.push(np);
      }
      function closeSub() { if (sub) sub.closed = true; }

      function scaleOf(m) { return Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2])) || 1; }

      function emitPath(fillIt, strokeIt, evenOdd) {
        if (!cur.length) return;
        var subs = cur.filter(function (s2) { return s2.pts.length >= 2; });
        if (subs.length) {
          var it = Model.newPath(subs);
          it.name = 'PDF 패스';
          it.fill = fillIt ? U.deepCopy(gs.fill) : Col.none();
          if (it.fill && it.fill.type === 'solid') it.fill.alpha = gs.alpha;
          if (evenOdd) it.fillRule = 'evenodd';
          if (strokeIt) {
            var s2 = Model.defaultStroke();
            var sp = gs.stroke || grayPaint(0);
            s2.type = 'solid'; s2.color = sp.color; s2.alpha = gs.salpha;
            if (sp.cmyk) s2.cmyk = sp.cmyk;
            if (sp.spot) { s2.spot = sp.spot; s2.tint = sp.tint; }
            s2.width = Math.max(gs.lw * scaleOf(M.mul(base, gs.ctm)), 0.001);
            s2.cap = gs.cap; s2.join = gs.join;
            s2.dash = gs.dash.map(function (d) { return d * scaleOf(gs.ctm); });
            it.stroke = s2;
          } else it.stroke = Model.defaultStroke();
          out.push(it);
          report.paths++;
        }
        cur = []; sub = null;
      }

      function drawText(bytes) {
        if (!tm || tmode === 3 || tmode === 7) { skip(tmode === 3 || tmode === 7 ? '보이지 않는 문자' : '문자'); return; }
        var f = tf || { two: false, map: null, base: 'Helvetica' };
        var d = decodeText(f, bytes);
        if (d.text.replace(/\s/g, '') !== '') {
          var full = M.mul(base, M.mul(gs.ctm, M.mul(tm, [thz / 100, 0, 0, 1, 0, trise])));
          /* PDF 문자는 y 가 위로 간다 — 우리 문자는 아래로 간다 */
          var im = M.mul(full, [1, 0, 0, -1, 0, 0]);
          var it = Model.newText(0, 0, d.text);
          it.m = im;
          it.text.size = tfSize;
          it.text.font = mapFont(f.base);
          if (/Bold/i.test(f.base)) it.text.weight = 700;
          if (/Italic|Oblique/i.test(f.base)) it.text.italic = true;
          it.fill = U.deepCopy(tmode === 1 ? gs.stroke : gs.fill);
          if (it.fill && it.fill.type === 'solid') it.fill.alpha = gs.alpha;
          it.stroke = Model.defaultStroke();
          it.name = d.text.slice(0, 20);
          out.push(it);
          report.texts++;
        }
        /* 다음 글자 위치로 진행 */
        var adv = (advance(f, d.codes) * tfSize + d.codes.length * tc + spacesIn(d) * tw) * (thz / 100);
        tm = M.mul(tm, [1, 0, 0, 1, adv, 0]);
      }
      function spacesIn(d) {
        var n = 0;
        for (var i = 0; i < d.codes.length; i++) if (d.codes[i] === 32) n++;
        return n;
      }

      for (;;) {
        var t;
        try { t = lx.token(); } catch (e) { break; }
        if (!t) break;
        if (t.t !== 'op') {
          var v = parseValue(lx, t);
          stack.push(v);
          if (stack.length > 500) stack.splice(0, 400);
          continue;
        }
        var op = t.v, a = stack;
        var num = function (i) { var x = a[a.length - i]; return typeof x === 'number' ? x : 0; };

        switch (op) {
          case 'q': st.push(clone(gs)); break;
          case 'Q': if (st.length) gs = st.pop(); break;
          case 'cm': gs.ctm = M.mul(gs.ctm, [num(6), num(5), num(4), num(3), num(2), num(1)]); break;
          case 'w': gs.lw = num(1); break;
          case 'J': gs.cap = num(1) === 1 ? 'round' : num(1) === 2 ? 'square' : 'butt'; break;
          case 'j': gs.join = num(1) === 1 ? 'round' : num(1) === 2 ? 'bevel' : 'miter'; break;
          case 'd': {
            var arr = a[a.length - 2];
            gs.dash = Array.isArray(arr) ? arr.filter(function (x) { return typeof x === 'number'; }) : [];
            break;
          }
          case 'gs': {
            var gname = a[a.length - 1];
            var eg = gname && gname.name && doc.dictGet(doc.dictGet(res, 'ExtGState') || {}, gname.name);
            if (eg) {
              var ca = doc.get(eg.ca), CA = doc.get(eg.CA);
              if (typeof ca === 'number') gs.alpha = ca;
              if (typeof CA === 'number') gs.salpha = CA;
              if (doc.get(eg.LW) != null) gs.lw = doc.get(eg.LW);
            }
            break;
          }
          /* --- 색 --- */
          case 'g': gs.fillCS = { kind: 'gray', n: 1 }; gs.fill = grayPaint(num(1)); break;
          case 'G': gs.strokeCS = { kind: 'gray', n: 1 }; gs.stroke = grayPaint(num(1)); break;
          case 'rg': gs.fillCS = { kind: 'rgb', n: 3 }; gs.fill = rgbPaint(num(3), num(2), num(1)); break;
          case 'RG': gs.strokeCS = { kind: 'rgb', n: 3 }; gs.stroke = rgbPaint(num(3), num(2), num(1)); break;
          case 'k': gs.fillCS = { kind: 'cmyk', n: 4 }; gs.fill = cmykPaint(num(4), num(3), num(2), num(1)); break;
          case 'K': gs.strokeCS = { kind: 'cmyk', n: 4 }; gs.stroke = cmykPaint(num(4), num(3), num(2), num(1)); break;
          case 'cs': case 'CS': {
            var cn = a[a.length - 1];
            var spDict = doc.dictGet(res, 'ColorSpace') || {};
            var space = cn && cn.name
              ? (spDict[cn.name] !== undefined ? readColorSpace(doc, spDict[cn.name]) : readColorSpace(doc, cn))
              : { kind: 'gray', n: 1 };
            if (op === 'cs') { gs.fillCS = space; gs.fill = paintFrom(doc, space, [space.kind === 'cmyk' ? 0 : 0], target) || gs.fill; }
            else { gs.strokeCS = space; gs.stroke = paintFrom(doc, space, [0], target) || gs.stroke; }
            break;
          }
          case 'sc': case 'scn': case 'SC': case 'SCN': {
            var stroking = (op === 'SC' || op === 'SCN');
            var space2 = stroking ? gs.strokeCS : gs.fillCS;
            var nums = a.filter(function (x) { return typeof x === 'number'; });
            var argsN = nums.slice(-Math.max(1, space2.n));
            var pnt = paintFrom(doc, space2, argsN, target);
            if (!pnt) { skip('패턴 칠'); pnt = grayPaint(0.5); }
            if (stroking) gs.stroke = pnt; else gs.fill = pnt;
            break;
          }
          /* --- 패스 --- */
          case 'm': moveTo(num(2), num(1)); break;
          case 'l': lineTo(num(2), num(1)); break;
          case 'c': curveTo(num(6), num(5), num(4), num(3), num(2), num(1)); break;
          case 'v': {
            var lastP = sub && sub.pts[sub.pts.length - 1];
            var cx = lastP ? M.apply(M.invert(M.mul(base, gs.ctm)), lastP.x, lastP.y) : { x: num(4), y: num(3) };
            curveTo(cx.x, cx.y, num(4), num(3), num(2), num(1));
            break;
          }
          case 'y': curveTo(num(4), num(3), num(2), num(1), num(2), num(1)); break;
          case 'h': closeSub(); break;
          case 're': {
            var x = num(4), y = num(3), rw = num(2), rh = num(1);
            moveTo(x, y); lineTo(x + rw, y); lineTo(x + rw, y + rh); lineTo(x, y + rh); closeSub();
            sub = null;
            break;
          }
          case 'n': if (pendingClip) { pendingClip = null; } cur = []; sub = null; break;
          case 'f': case 'F': emitPath(true, false, false); break;
          case 'f*': emitPath(true, false, true); break;
          case 'S': emitPath(false, true, false); break;
          case 's': closeSub(); emitPath(false, true, false); break;
          case 'B': emitPath(true, true, false); break;
          case 'B*': emitPath(true, true, true); break;
          case 'b': closeSub(); emitPath(true, true, false); break;
          case 'b*': closeSub(); emitPath(true, true, true); break;
          case 'W': case 'W*': pendingClip = true; skip('클리핑 패스'); break;
          case 'sh': skip('셰이딩'); break;
          /* --- 문자 --- */
          case 'BT': tm = M.ident(); tlm = M.ident(); break;
          case 'ET': tm = null; tlm = null; break;
          case 'Tf': {
            tfSize = num(1);
            var fname = a[a.length - 2];
            var fres = doc.dictGet(res, 'Font') || {};
            tf = fontInfo(doc, fname && fname.name ? doc.get(fres[fname.name]) : null);
            break;
          }
          case 'Td': tlm = M.mul(tlm || M.ident(), [1, 0, 0, 1, num(2), num(1)]); tm = tlm.slice(); break;
          case 'TD': tl = -num(1); tlm = M.mul(tlm || M.ident(), [1, 0, 0, 1, num(2), num(1)]); tm = tlm.slice(); break;
          case 'Tm': tlm = [num(6), num(5), num(4), num(3), num(2), num(1)]; tm = tlm.slice(); break;
          case 'T*': tlm = M.mul(tlm || M.ident(), [1, 0, 0, 1, 0, -tl]); tm = tlm.slice(); break;
          case 'TL': tl = num(1); break;
          case 'Tc': tc = num(1); break;
          case 'Tw': tw = num(1); break;
          case 'Tz': thz = num(1) || 100; break;
          case 'Ts': trise = num(1); break;
          case 'Tr': tmode = num(1); break;
          case 'Tj': { var sv = a[a.length - 1]; if (sv instanceof Uint8Array) drawText(sv); break; }
          case "'": {
            tlm = M.mul(tlm || M.ident(), [1, 0, 0, 1, 0, -tl]); tm = tlm.slice();
            var sv2 = a[a.length - 1]; if (sv2 instanceof Uint8Array) drawText(sv2);
            break;
          }
          case '"': {
            tw = num(3); tc = num(2);
            tlm = M.mul(tlm || M.ident(), [1, 0, 0, 1, 0, -tl]); tm = tlm.slice();
            var sv3 = a[a.length - 1]; if (sv3 instanceof Uint8Array) drawText(sv3);
            break;
          }
          case 'TJ': {
            var arr2 = a[a.length - 1];
            if (Array.isArray(arr2)) {
              arr2.forEach(function (e) {
                if (e instanceof Uint8Array) drawText(e);
                else if (typeof e === 'number' && tm) tm = M.mul(tm, [1, 0, 0, 1, -e / 1000 * tfSize * (thz / 100), 0]);
              });
            }
            break;
          }
          /* --- XObject --- */
          case 'Do': {
            var xn = a[a.length - 1];
            var xres = doc.dictGet(res, 'XObject') || {};
            var refv = xn && xn.name ? xres[xn.name] : null;
            if (!(refv instanceof Ref)) { skip('XObject'); break; }
            var sdef = doc.streams[refv.num];
            if (!sdef) { skip('XObject'); break; }
            var sub2 = doc.get(sdef.dict.Subtype);
            if (sub2 && sub2.name === 'Form') {
              var fm = doc.get(sdef.dict.Matrix);
              var fmm = Array.isArray(fm) ? fm.map(function (z) { return doc.get(z) || 0; }) : [1, 0, 0, 1, 0, 0];
              var fres2 = doc.get(sdef.dict.Resources) || res;
              var body = doc.stream(refv.num);
              if (body && !body.image) {
                var saved = gs, savedStack = st.length;
                gs = clone(gs);
                gs.ctm = M.mul(gs.ctm, fmm);
                run(body, fres2, gs.ctm, depth + 1);
                gs = saved; st.length = savedStack;
              }
            } else if (sub2 && sub2.name === 'Image') {
              var url = imageDataUrl(doc, refv.num, sdef.dict);
              if (!url) { skip('이미지(못 푸는 형식)'); break; }
              /* 이미지는 단위 정사각형에 그려진다 — CTM 이 크기와 위치를 정한다 */
              var im2 = M.mul(M.mul(base, gs.ctm), [1, 0, 0, -1, 0, 1]);
              var iw = doc.get(sdef.dict.Width) || 1, ih = doc.get(sdef.dict.Height) || 1;
              var itI = Model.newImage(url, 0, 0, 1, 1);
              itI.m = M.mul(im2, [1 / 1, 0, 0, 1 / 1, 0, 0]);
              itI.w = 1; itI.h = 1;
              itI.name = '이미지 ' + iw + '×' + ih;
              out.push(itI);
              report.images++;
            } else skip('XObject');
            break;
          }
          case 'BI': {
            /* 인라인 이미지 — EI 까지 건너뛴다 */
            var ei = indexOfStr(content, 'EI', lx.p);
            lx.p = ei < 0 ? content.length : ei + 2;
            skip('인라인 이미지');
            break;
          }
          default: break;
        }
        if (t.t === 'op') stack = [];
      }
    }

    var content = doc.pageContent(page);
    run(content, page.Resources || {}, M.ident(), 0);

    report.width = W; report.height = H;
    if (target && AI.prepress) report.spots = AI.prepress.spots(target).map(function (s) { return s.name; });
    return { items: out, report: report, width: W, height: H };
  };

  function mapFont(base) {
    var b = String(base || '');
    if (/Times|Serif|Georgia|Garamond|Batang|Myeongjo/i.test(b)) return 'serif';
    if (/Courier|Mono/i.test(b)) return 'monospace';
    return 'sans-serif';
  }

  /* 파일 하나를 통째로 우리 문서로 */
  PI.importInto = function (app, bytes, opts) {
    opts = opts || {};
    var doc = new Doc(bytes);
    var pages = doc.pages();
    if (!pages.length) throw new Error('PDF 에서 페이지를 찾지 못했습니다');
    var want = opts.pages && opts.pages.length
      ? opts.pages.map(function (i) { return U.clamp(Math.round(i), 0, pages.length - 1); })
      : pages.map(function (_, i) { return i; });
    if (opts.maxPages) want = want.slice(0, opts.maxPages);

    var target = app.doc;
    var totals = { paths: 0, texts: 0, images: 0, skipped: {}, pages: [] };
    var gapX = 0;

    want.forEach(function (pi, n) {
      var r = PI.importPage(doc, pages[pi], { doc: target });
      var layer = Model.newLayer(want.length > 1 ? ('PDF 페이지 ' + (pi + 1)) : 'PDF');
      /* 페이지를 가로로 나란히 놓는다 — 대지도 함께 만든다 */
      var ox = gapX;
      if (ox) {
        r.items.forEach(function (it) { it.m = M.mul(M.translate(ox, 0), it.m || M.ident()); });
      }
      layer.children = r.items;
      target.layers.push(layer);
      if (n === 0 && !opts.keepArtboards) {
        target.artboards[0].w = r.width; target.artboards[0].h = r.height;
        target.artboards[0].x = 0; target.artboards[0].y = 0;
        target.artboards[0].name = '페이지 ' + (pi + 1);
        target.width = r.width; target.height = r.height;
      } else if (!opts.keepArtboards) {
        target.artboards.push({ id: U.uid('AB'), name: '페이지 ' + (pi + 1), x: ox, y: 0, w: r.width, h: r.height });
      }
      gapX += r.width + 24;
      totals.paths += r.report.paths;
      totals.texts += r.report.texts;
      totals.images += r.report.images;
      Object.keys(r.report.skipped).forEach(function (k) {
        totals.skipped[k] = (totals.skipped[k] || 0) + r.report.skipped[k];
      });
      totals.pages.push({ page: pi + 1, paths: r.report.paths, texts: r.report.texts, images: r.report.images });
    });

    /* 빈 기본 레이어는 치운다 */
    if (target.layers.length > 1 && !target.layers[0].children.length) target.layers.shift();
    target.activeLayer = 0;
    if (AI.prepress && AI.prepress.spots(target).length) totals.spots = AI.prepress.spots(target).map(function (s) { return s.name; });
    totals.totalPages = pages.length;
    totals.imported = want.length;
    return totals;
  };

})(typeof globalThis !== 'undefined' ? globalThis.AI : window.AI);
