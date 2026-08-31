/* =========================================================================
   clipboard.js — 시스템 클립보드 · 드래그 앤 드롭
   -------------------------------------------------------------------------
   여기까지는 [편집 > 복사/붙이기] 가 앱 안에서만 통했다. 다른 프로그램에서
   복사한 이미지를 Ctrl+V 로 가져올 수 없었고, 앱에서 복사한 것을 다른
   프로그램에 붙일 수도 없었다. 브라우저의 clipboard 이벤트를 keymap 이
   preventDefault 로 막아 버린 탓도 있다.

   그래서 클립보드는 한곳에서 다룬다.

     붙여넣기 (paste 이벤트 · 드롭 · 메뉴)
       1. 우리 형식(illymolly-clip) 이면 그대로 — 완전한 벡터로 되살아난다
          (다른 탭 · 다른 문서에서 복사한 것도 여기로 들어온다)
       2. 이미지 파일 · 이미지 데이터  -> 이미지 오브젝트
       3. SVG 문자열 (파일 · text/html 안의 <svg> 포함) -> 벡터로 가져오기
       4. 그냥 글자 -> 문자 오브젝트
       5. 아무것도 없으면 앱 안 클립보드로 되돌아간다

     복사 (copy · cut 이벤트)
       우리 형식 JSON 과 SVG 를 함께 써 둔다. 그래서 앱끼리는 완전한 벡터로,
       다른 프로그램에는 SVG · 그림으로 붙는다.

   붙는 자리는 일러스트레이터를 따른다 — Ctrl+V 는 화면 가운데,
   Ctrl+Shift+V 는 원래 자리, 드롭은 마우스를 놓은 자리.
   ========================================================================= */
(function (AI) {
  'use strict';
  var U = AI.util, M = AI.mat, R = AI.rect, Model = AI.model;
  var CB = AI.clipboard = {};

  CB.MARK = 'illymolly-clip';
  var MAX_TEXT = 4 * 1024 * 1024;      /* 이 이상은 문자 오브젝트로 만들지 않는다 */

  /* ---------------- 쓰기 ---------------- */

  /* 선택한 것을 우리 형식 JSON 으로 */
  CB.serialize = function (app, items) {
    return JSON.stringify({
      format: CB.MARK, version: 1,
      doc: app.doc.name,
      /* 그룹 안에서 복사한 것도 제자리에 붙도록 행렬을 문서 기준으로 펴 둔다 */
      items: items.map(function (it) {
        var c = U.deepCopy(it);
        c.m = M.mul(Model.worldMatrix(app.doc, it), M.ident());
        return c;
      })
    });
  };

  CB.parse = function (text) {
    if (!text || text.indexOf(CB.MARK) < 0) return null;
    try {
      var o = JSON.parse(text);
      if (!o || o.format !== CB.MARK || !o.items || !o.items.length) return null;
      return o.items;
    } catch (e) { return null; }
  };

  /* 고른 것만 담은 작은 SVG — 다른 프로그램이 읽는 몫이다 */
  CB.toSVG = function (app, items) {
    if (!AI.io || !AI.io.toSVG) return '';
    var keep = app.sel, keepPts = app.selPts;
    /* toSVG 는 문서 전체를 그리므로, 고른 것만 담은 임시 문서를 만들어 넘긴다 */
    var r = R.empty();
    items.forEach(function (it) {
      r = R.union(r, AI.render.xformBounds(AI.render.localBounds(it), it.m));
    });
    if (R.isEmpty(r)) return '';
    var pad = 1;
    var doc = Model.newDoc(Math.max(1, R.w(r) + pad * 2), Math.max(1, R.h(r) + pad * 2));
    doc.artboards = [{ id: 'AB', name: '1', x: r.x - pad, y: r.y - pad, w: R.w(r) + pad * 2, h: R.h(r) + pad * 2 }];
    doc.activeArtboard = 0;
    doc.layers = [Model.newLayer()];
    doc.layers[0].children = items.map(function (it) { return U.deepCopy(it); });
    doc.symbols = app.doc.symbols;
    doc.patterns = app.doc.patterns;
    var fake = { doc: doc, sel: [], selPts: [] };
    var out = '';
    try { out = AI.io.toSVG(fake, 0); } catch (e) { out = ''; }
    app.sel = keep; app.selPts = keepPts;
    return out;
  };

  /* 메뉴에서 [복사] 를 눌렀을 때 — 이벤트가 없으므로 비동기 API 로 써 둔다.
     못 써도 앱 안 클립보드는 이미 채워져 있으므로 조용히 넘어간다. */
  CB.writeAsync = function (app) {
    if (!U.hasDOM || !navigator.clipboard || !navigator.clipboard.write || !app.sel.length) {
      return Promise.resolve(false);
    }
    var items = app.sel.slice();
    var payload = { 'text/plain': CB.serialize(app, items) };
    var svg = CB.toSVG(app, items);
    if (svg) payload['text/html'] = svg;
    try {
      var data = {};
      Object.keys(payload).forEach(function (ty) {
        data[ty] = new Blob([payload[ty]], { type: ty });
      });
      return navigator.clipboard.write([new ClipboardItem(data)])
        .then(function () { return true; }).catch(function () { return false; });
    } catch (e) { return Promise.resolve(false); }
  };

  /* copy · cut 이벤트에서 시스템 클립보드에 써 넣는다 */
  CB.write = function (app, dt) {
    if (!app.sel.length || !dt) return false;
    var items = app.sel.slice();
    try {
      dt.setData('text/plain', CB.serialize(app, items));
      var svg = CB.toSVG(app, items);
      if (svg) dt.setData('image/svg+xml', svg);
    } catch (e) { return false; }
    return true;
  };

  /* ---------------- 읽기 ---------------- */

  /* 붙일 항목을 문서에 넣고 고른다 — 모든 경로의 마지막 단계 */
  function place(app, items, mode, at, label) {
    if (!items || !items.length) return false;
    var layer = Model.activeLayer(app.doc);
    if (!layer || layer.locked) { U.toast('레이어가 잠겨 있습니다'); return false; }

    var r = R.empty();
    items.forEach(function (it) {
      it.m = it.m || M.ident();
      r = R.union(r, AI.render.xformBounds(AI.render.localBounds(it), it.m));
    });
    /* 자리 — center · drop 만 옮긴다. place · front · back 은 원래 자리 그대로. */
    var dx = 0, dy = 0;
    if ((mode === 'center' || mode === 'drop' || !mode) && !R.isEmpty(r)) {
      var c = at || AI.viewT.toDoc(app, app.canvas.clientWidth / 2, app.canvas.clientHeight / 2);
      dx = c.x - R.cx(r); dy = c.y - R.cy(r);
    }
    if (dx || dy) items.forEach(function (it) { it.m = M.mul(M.translate(dx, dy), it.m); });

    app.history.begin(label || '붙이기', app.doc);
    if (mode === 'back') layer.children = items.concat(layer.children);
    else layer.children = layer.children.concat(items);
    AI.sel.set(app, items);
    app.history.commit();
    app.invalidate();
    AI.ui.syncAll(app);
    return true;
  }

  /* 새 id 를 준다 — 같은 문서에 두 번 붙여도 겹치지 않는다 */
  function fresh(items) {
    return items.map(function (it) { return AI.edit.cloneItem(it); });
  }

  /* 이미지 데이터 URL 하나를 오브젝트로 — 크기를 알아야 하므로 비동기다 */
  CB.placeImageSrc = function (app, src, name, mode, at) {
    return new Promise(function (res) {
      var probe = new Image();
      probe.onload = function () {
        var ab = app.doc.artboards[app.doc.activeArtboard];
        var iw = probe.naturalWidth || 100, ih = probe.naturalHeight || 100;
        /* 대지보다 크면 줄여서 넣는다 (일러스트레이터의 배치와 같다) */
        var k = Math.min(1, ab.w * 0.8 / iw, ab.h * 0.8 / ih);
        var it = Model.newImage(src, 0, 0, iw * k, ih * k);
        it.name = name || '이미지';
        var ok = place(app, [it], mode, at, '이미지 붙이기');
        if (ok) U.toast('이미지 붙여넣기: ' + iw + '×' + ih + (k < 1 ? ' (' + Math.round(k * 100) + '% 로 축소)' : ''));
        res(ok);
      };
      probe.onerror = function () { U.toast('이미지를 읽을 수 없습니다'); res(false); };
      probe.src = src;
    });
  };

  function readAsDataURL(file) {
    return new Promise(function (res, rej) {
      var r = new FileReader();
      r.onload = function () { res(String(r.result)); };
      r.onerror = function () { rej(r.error); };
      r.readAsDataURL(file);
    });
  }
  function readAsText(file) {
    return new Promise(function (res, rej) {
      var r = new FileReader();
      r.onload = function () { res(String(r.result)); };
      r.onerror = function () { rej(r.error); };
      r.readAsText(file);
    });
  }

  /* text/html 안에 들어 있는 <svg> 를 꺼낸다 (피그마 등이 이렇게 준다) */
  function svgFromHtml(html) {
    if (!html || html.indexOf('<svg') < 0) return null;
    var i = html.indexOf('<svg'), j = html.lastIndexOf('</svg>');
    if (j < 0) return null;
    return html.slice(i, j + 6);
  }

  function looksSVG(t) {
    return !!t && /^\s*(<\?xml[^>]*\?>\s*)?(<!--[\s\S]*?-->\s*)*(<!DOCTYPE[^>]*>\s*)?<svg[\s>]/i.test(t);
  }

  /* 클립보드에서 아무것도 못 건졌을 때 왜 그런지 — 안내 문구에 그대로 쓴다 */
  CB.lastReason = '';

  function typeList(dt) {
    var t = [];
    try { t = Array.prototype.slice.call(dt.types || []); } catch (e) { }
    return t;
  }

  /* DataTransfer 하나를 놓고 무엇으로 붙일지 고른다 */
  CB.fromTransfer = function (app, dt, mode, at) {
    CB.lastReason = '';
    if (!dt) { CB.lastReason = '클립보드를 읽을 수 없습니다'; return Promise.resolve(false); }

    /* 1 · 파일이 있으면 파일이 우선이다 (탐색기에서 끌어 온 경우 포함) */
    var files = dt.files && dt.files.length ? Array.prototype.slice.call(dt.files) : [];
    if (!files.length && dt.items) {
      for (var i = 0; i < dt.items.length; i++) {
        if (dt.items[i].kind === 'file') {
          var f = dt.items[i].getAsFile();
          if (f) files.push(f);
        }
      }
    }
    if (files.length) return CB.fromFiles(app, files, mode, at);

    var text = '';
    try { text = dt.getData('text/plain') || ''; } catch (e) { }

    /* 2 · 우리 형식 — 완전한 벡터로 되살린다 */
    var mine = CB.parse(text);
    if (mine) return Promise.resolve(place(app, fresh(mine), mode, at, '붙이기'));

    /* 3 · SVG */
    var svg = '';
    try { svg = dt.getData('image/svg+xml') || ''; } catch (e) { }
    if (!svg && looksSVG(text)) svg = text;
    if (!svg) {
      var html = '';
      try { html = dt.getData('text/html') || ''; } catch (e) { }
      svg = svgFromHtml(html) || '';
    }
    if (svg) {
      var items = AI.io.svgToItems(svg);
      if (items) {
        var ok = place(app, items, mode, at, 'SVG 붙이기');
        if (ok) U.toast(items.length + '개 오브젝트를 붙여넣었습니다');
        return Promise.resolve(ok);
      }
    }

    /* 4 · 그냥 글자 */
    if (text && text.length < MAX_TEXT) return Promise.resolve(CB.placeText(app, text, mode, at));

    var types = typeList(dt);
    CB.lastReason = !types.length
      ? '클립보드가 비어 있습니다'
      : (text && text.length >= MAX_TEXT)
        ? '글자가 너무 깁니다'
        : '붙일 수 있는 것이 없습니다 (클립보드: ' + types.join(', ') + ')';
    return Promise.resolve(false);
  };

  CB.placeText = function (app, text, mode, at) {
    var t = Model.newText(0, 0, text.replace(/\r\n?/g, '\n'));
    t.fill = AI.color.solid('#000000');
    var ok = place(app, [t], mode, at, '문자 붙이기');
    if (ok) U.toast('문자로 붙여넣었습니다');
    return ok;
  };

  /* 파일 여러 개 — 이미지·SVG·문서 파일을 섞어 놓아도 된다 */
  CB.fromFiles = function (app, files, mode, at) {
    var jobs = files.map(function (f) {
      return function () {
        if (/^image\/svg/.test(f.type) || /\.svg$/i.test(f.name)) {
          return readAsText(f).then(function (t) {
            var items = AI.io.svgToItems(t);
            if (!items) { U.toast('SVG 를 읽을 수 없습니다: ' + f.name); return false; }
            var ok = place(app, items, mode, at, 'SVG 붙이기');
            if (ok) U.toast(f.name + ' — 오브젝트 ' + items.length + '개');
            return ok;
          });
        }
        if (/^image\//.test(f.type)) {
          return readAsDataURL(f).then(function (src) {
            return CB.placeImageSrc(app, src, f.name, mode, at);
          });
        }
        if (/\.json$/i.test(f.name) || f.type === 'application/json') {
          return readAsText(f).then(function (t) {
            var mine = CB.parse(t);
            if (mine) return place(app, fresh(mine), mode, at, '붙이기');
            try {
              var o = JSON.parse(t), doc = o.doc || o;
              if (!doc.layers) throw new Error('문서가 아닙니다');
              AI.io.normalizeDoc(doc);
              AI.docs.add(app, doc, { label: '열기' });
              U.toast(f.name + ' 열기 완료');
              return true;
            } catch (e) { U.toast('파일을 읽을 수 없습니다: ' + f.name); return false; }
          });
        }
        U.toast('지원하지 않는 파일입니다: ' + f.name);
        return Promise.resolve(false);
      };
    });
    /* 하나씩 차례대로 — 여러 개를 붙여도 실행 취소가 한 단계씩 남는다 */
    return jobs.reduce(function (p, job) {
      return p.then(function (any) { return job().then(function (ok) { return any || ok; }); });
    }, Promise.resolve(false));
  };

  /* ---------------- 메뉴에서 부르는 붙이기 (이벤트가 없다) ----------------
     메뉴 클릭에는 clipboardData 가 없으므로 비동기 Clipboard API 로 읽는다.
     권한이 없거나 지원하지 않으면 앱 안 클립보드로 되돌아간다. */
  CB.pasteAsync = function (app, mode) {
    var fallback = function () {
      if (AI.commands.clipboard && AI.commands.clipboard.length) return AI.commands.pasteInternal(app, mode);
      CB.explain();
      return false;
    };
    if (!U.hasDOM || !navigator.clipboard || !navigator.clipboard.read) {
      CB.lastReason = '이 브라우저는 메뉴에서 클립보드를 읽지 못합니다 — Ctrl+V 를 눌러 주세요';
      return Promise.resolve(fallback());
    }
    return navigator.clipboard.read().then(function (list) {
      if (!list || !list.length) { CB.lastReason = '클립보드가 비어 있습니다'; return fallback(); }
      var dt = new DataTransfer();
      var reads = [];
      list.forEach(function (item) {
        item.types.forEach(function (ty) {
          reads.push(item.getType(ty).then(function (blob) {
            if (/^image\/(?!svg)/.test(ty)) {
              var ext = (ty.split('/')[1] || 'png').replace(/\+.*/, '');
              dt.items.add(new File([blob], '클립보드.' + ext, { type: ty }));
            } else {
              return blob.text().then(function (t) { try { dt.setData(ty, t); } catch (e) { } });
            }
          }).catch(function () { }));
        });
      });
      return Promise.all(reads).then(function () {
        return CB.fromTransfer(app, dt, mode).then(function (ok) { return ok || fallback(); });
      });
    }).catch(function (e) {
      CB.lastReason = '브라우저가 클립보드 읽기를 막았습니다 — Ctrl+V 를 눌러 주세요';
      return fallback();
    });
  };

  /* ---------------- 붙여넣기 싱크 ----------------
     캔버스는 포커스를 받지 못한다. 그런데 브라우저에 따라 — 특히 iframe 안이나
     포커스가 아무 데도 없을 때 — paste 이벤트가 아예 안 오거나 빈 clipboardData
     로 온다. 그래서 화면 밖에 눈에 안 보이는 편집 요소 하나를 두고 늘 포커스를
     잡아 둔다. 캔버스 앱들이 쓰는 방식이고, 이게 있으면 붙여넣기가 확실해진다.
     이 요소는 글자를 담지 않는다 — 들어오는 족족 비운다. */
  var sink = null;

  CB.isSink = function (el) { return !!sink && (el === sink || sink.contains(el)); };

  /* 터치 기기에서는 두지 않는다 — 편집 요소에 포커스가 가면 소프트 키보드가
     올라온다. 어차피 Ctrl+V 가 없고, 붙이기는 메뉴(비동기 API)로 한다. */
  function wantSink() {
    if (!U.hasDOM) return false;
    return !(window.matchMedia && window.matchMedia('(pointer: coarse)').matches);
  }

  function makeSink() {
    if (!wantSink()) return;
    sink = document.createElement('div');
    sink.id = 'paste-sink';
    sink.contentEditable = 'true';
    sink.tabIndex = -1;
    sink.setAttribute('aria-hidden', 'true');
    sink.setAttribute('inputmode', 'none');      /* 혹시라도 소프트 키보드가 뜨지 않게 */
    sink.setAttribute('autocorrect', 'off');
    sink.setAttribute('spellcheck', 'false');
    document.body.appendChild(sink);
    /* 글자는 절대 들어가지 않는다 — 한글 입력기의 조합까지 여기서 막는다.
       붙여넣기는 paste 이벤트에서 이미 preventDefault 하므로 잃는 게 없다. */
    U.on(sink, 'beforeinput', function (ev) { ev.preventDefault(); });
    U.on(sink, 'input', function () { sink.textContent = ''; });
    U.on(sink, 'compositionend', function () { sink.textContent = ''; });
  }

  /* 진짜 입력란에 포커스가 있으면 건드리지 않는다 — 사용자가 거기 타이핑 중이다 */
  function realInputFocused() {
    var el = document.activeElement;
    if (!el || el === document.body || CB.isSink(el)) return false;
    var tag = (el.tagName || '').toLowerCase();
    return tag === 'input' || tag === 'textarea' || tag === 'select' || !!el.isContentEditable;
  }

  CB.focusSink = function () {
    if (!sink || realInputFocused()) return;
    if (AI.dialog && AI.dialog.isOpen()) return;
    if (AI.tools && AI.tools.isEditingText && AI.tools.isEditingText()) return;
    if (document.activeElement !== sink) sink.focus({ preventScroll: true });
  };

  /* ---------------- 설치 ---------------- */
  CB.pendingMode = 'center';       /* keydown 이 알려 주는 붙이는 자리 */

  function busy(app) {
    if (AI.dialog && AI.dialog.isOpen()) return true;
    if (AI.tools && AI.tools.isEditingText && AI.tools.isEditingText()) return true;
    return realInputFocused();
  }

  /* 시스템 클립보드에서 못 건졌고 앱 안 클립보드도 비었을 때 — 왜인지 말해 준다 */
  CB.explain = function () {
    var why = CB.lastReason || '클립보드가 비어 있습니다';
    U.toast(why + ' — 파일에서 가져오려면 [파일 > 가져오기] 를 쓰세요');
  };

  CB.install = function (app) {
    if (!U.hasDOM) return;
    makeSink();
    CB.focusSink();

    /* 캔버스나 도구를 누르면 포커스를 싱크로 되돌린다 (입력란은 건드리지 않는다) */
    U.on(document, 'pointerdown', function (ev) {
      if (CB.isSink(ev.target)) return;
      var tag = (ev.target && ev.target.tagName || '').toLowerCase();
      if (tag === 'input' || tag === 'textarea' || tag === 'select' ||
          (ev.target && ev.target.isContentEditable)) return;
      setTimeout(CB.focusSink, 0);
    }, true);
    U.on(window, 'focus', function () { setTimeout(CB.focusSink, 0); });
    U.on(document, 'focusout', function () { setTimeout(CB.focusSink, 0); });

    U.on(document, 'paste', function (ev) {
      if (busy(app)) return;                       /* 입력란에 붙이는 중이면 브라우저 몫 */
      var dt = ev.clipboardData;
      ev.preventDefault();
      if (sink) sink.textContent = '';
      var mode = CB.pendingMode;
      CB.pendingMode = 'center';
      CB.fromTransfer(app, dt, mode).then(function (ok) {
        if (ok) return;
        /* 시스템 클립보드가 비었거나 막혔다 — 앱 안 클립보드로 */
        if (AI.commands.clipboard && AI.commands.clipboard.length) {
          AI.commands.pasteInternal(app, mode);
        } else {
          CB.explain();
        }
      });
    });

    U.on(document, 'copy', function (ev) {
      if (busy(app) || !app.sel.length) return;
      AI.commands.copyToBuffer(app);          /* 시스템 쪽이 막혀도 앱 안에서는 붙는다 */
      if (CB.write(app, ev.clipboardData)) {
        ev.preventDefault();
        U.toast(app.sel.length + '개 복사됨');
      }
    });

    U.on(document, 'cut', function (ev) {
      if (busy(app) || !app.sel.length) return;
      AI.commands.copyToBuffer(app);
      if (!CB.write(app, ev.clipboardData)) return;
      ev.preventDefault();
      var n = app.sel.length;
      app.history.begin('오려내기', app.doc);
      AI.edit.remove(app);
      app.history.commit();
      app.invalidate();
      AI.ui.syncAll(app);
      U.toast(n + '개 오려냄');
    });

    /* ---- 드래그 앤 드롭 ---- */
    var wrap = document.getElementById('canvas-wrap') || document.body;
    var depth = 0;
    function hasPayload(ev) {
      var dt = ev.dataTransfer;
      if (!dt) return false;
      var t = dt.types || [];
      return Array.prototype.indexOf.call(t, 'Files') >= 0 ||
        Array.prototype.indexOf.call(t, 'text/plain') >= 0 ||
        Array.prototype.indexOf.call(t, 'text/html') >= 0;
    }
    U.on(wrap, 'dragenter', function (ev) {
      if (!hasPayload(ev)) return;
      ev.preventDefault();
      if (++depth === 1) wrap.classList.add('drop-target');
    });
    U.on(wrap, 'dragover', function (ev) {
      if (!hasPayload(ev)) return;
      ev.preventDefault();
      ev.dataTransfer.dropEffect = 'copy';
    });
    U.on(wrap, 'dragleave', function () {
      if (--depth <= 0) { depth = 0; wrap.classList.remove('drop-target'); }
    });
    U.on(wrap, 'drop', function (ev) {
      if (!hasPayload(ev)) return;
      ev.preventDefault();
      depth = 0;
      wrap.classList.remove('drop-target');
      var r = app.canvas.getBoundingClientRect();
      var at = AI.viewT.toDoc(app, ev.clientX - r.left, ev.clientY - r.top);
      CB.fromTransfer(app, ev.dataTransfer, 'drop', at);
    });
  };
})(typeof globalThis !== 'undefined' ? globalThis.AI : window.AI);
