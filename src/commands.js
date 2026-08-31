/* =========================================================================
   commands.js — 명령 레지스트리 (메뉴 + 단축키 공용)
   ========================================================================= */
(function (AI) {
  'use strict';
  var U = AI.util, M = AI.mat, R = AI.rect, Model = AI.model, E = AI.edit, Rn = AI.render, T = AI.tools, Col = AI.color;

  var C = AI.commands = {};
  var defs = C.defs = {};
  var app = null;
  C.bind = function (a) { app = a; };

  function def(id, label, key, run, opt) {
    defs[id] = { id: id, label: label, key: key, run: run };
    if (opt) for (var k in opt) defs[id][k] = opt[k];
    return defs[id];
  }
  C.def = def;

  C.run = function (id) {
    var d = defs[id];
    if (!d) return false;
    if (d.enabled && !d.enabled(app)) return false;
    d.run(app);
    app.invalidate();
    AI.ui && AI.ui.syncAll && AI.ui.syncAll(app);
    return true;
  };

  function hist(label, fn) {
    return function (a) {
      a.history.begin(label, a.doc);
      var ok = fn(a);
      if (ok === false) a.history.abort(); else a.history.commit();
    };
  }
  var hasSel = function (a) { return a.sel.length > 0; };
  /* 기하 효과(왜곡 및 변형)는 패스에만 얹힌다 */
  var hasPathSel = function (a) {
    return a.sel.some(function (it) { return it.type === 'path'; });
  };

  /* ================= 파일 ================= */
  def('new', '새로 만들기...', 'Ctrl+N', function (a) { AI.dialogs.newDocument(a); });
  def('open', '열기...', 'Ctrl+O', function (a) { AI.io.openFile(a); });
  def('save', '저장', 'Ctrl+S', function (a) { AI.io.save(a); });
  def('saveAs', '다른 이름으로 저장...', 'Ctrl+Shift+S', function (a) { AI.io.save(a, true); });
  def('place', '가져오기(이미지)...', 'Ctrl+Shift+P', function (a) { AI.io.placeImage(a); });
  def('exportSvg', 'SVG로 내보내기...', 'Ctrl+Alt+Shift+S', function (a) { AI.io.exportSVG(a); });
  def('exportPng', 'PNG로 내보내기...', 'Ctrl+Alt+E', function (a) { AI.io.exportPNG(a); });
  def('exportPdf', 'PDF로 내보내기...', null, function (a) { AI.io.exportPDF(a); });
  def('exportArtboards', '대지별로 내보내기...', null, function (a) { AI.io.exportArtboards(a, 'png'); });
  def('closeDoc', '닫기', 'Ctrl+W', function (a) { AI.docs.close(a); });
  def('nextDoc', '다음 문서', 'Ctrl+Tab', function (a) { AI.docs.next(a, 1); },
    { enabled: function (a) { return AI.docs.count(a) > 1; } });
  def('prevDoc', '이전 문서', 'Ctrl+Shift+Tab', function (a) { AI.docs.next(a, -1); },
    { enabled: function (a) { return AI.docs.count(a) > 1; } });
  def('docSetup', '문서 설정...', 'Ctrl+Alt+P', function (a) { AI.dialogs.documentSetup(a); });
  def('preferences', '환경 설정...', 'Ctrl+K', function (a) { AI.dialogs.preferences(a); });
  def('fullKeyboard', '단축키 완전 사용 (전체 화면)', null, function (a) { AI.keymap.toggleLock(a); }, {
    label2: function () { return AI.keymap.locked ? '단축키 완전 사용 해제' : '단축키 완전 사용 (전체 화면)'; },
    checked: function () { return AI.keymap.locked; },
    enabled: function () { return AI.keymap.canLock(); }
  });
  def('shortcutList', '단축키...', null, function (a) { AI.dialogs.shortcuts(a); });
  def('commandSearch', '검색...', 'Ctrl+/', function (a) { AI.ui.openSearch(a); });
  def('installApp', '앱으로 설치...', null, function () { AI.pwa.install(); }, {
    label2: function () { return AI.pwa.standalone() ? '앱으로 실행 중' : '앱으로 설치...'; },
    enabled: function () { return AI.pwa.canInstall(); }
  });

  /* ================= 편집 ================= */
  def('undo', '실행 취소', 'Ctrl+Z', function (a) {
    var s = a.history.undo(a.doc);
    if (!s) { U.toast('더 이상 취소할 수 없습니다'); return; }
    a.setDoc(s);
    U.toast('실행 취소');
  }, {
    label2: function (a) { var l = a.history.undoLabel(); return l ? '실행 취소 ' + l : '실행 취소'; },
    enabled: function (a) { return a.history.canUndo(); }
  });
  def('redo', '다시 실행', 'Ctrl+Shift+Z', function (a) {
    var s = a.history.redo(a.doc);
    if (!s) { U.toast('다시 실행할 항목이 없습니다'); return; }
    a.setDoc(s);
    U.toast('다시 실행');
  }, {
    label2: function (a) { var l = a.history.redoLabel(); return l ? '다시 실행 ' + l : '다시 실행'; },
    enabled: function (a) { return a.history.canRedo(); }
  });
  /* 앱 안 클립보드 — 시스템 클립보드를 못 쓸 때의 바탕이자 되돌아갈 자리 */
  C.copyToBuffer = function (a) {
    C.clipboard = a.sel.map(function (it) {
      var c = U.deepCopy(it);
      c.m = M.mul(Model.worldMatrix(a.doc, it), M.ident());
      return c;
    });
    return C.clipboard.length;
  };
  def('cut', '오려두기', 'Ctrl+X', hist('오려두기', function (a) {
    if (!a.sel.length) return false;
    C.copyToBuffer(a);
    AI.clipboard.writeAsync(a);
    E.remove(a);
  }), { enabled: hasSel });
  def('copy', '복사', 'Ctrl+C', function (a) {
    if (!a.sel.length) return;
    var n = C.copyToBuffer(a);
    AI.clipboard.writeAsync(a);
    U.toast(n + '개 복사됨');
  }, { enabled: hasSel });

  /* 앱 안 클립보드로 붙이기 — 시스템 클립보드에 쓸 만한 게 없을 때 */
  C.pasteInternal = function (a, mode) {
    if (!C.clipboard || !C.clipboard.length) { U.toast('붙여넣을 항목이 없습니다'); return false; }
    var layer = Model.activeLayer(a.doc);
    if (!layer || layer.locked) { U.toast('레이어가 잠겨 있습니다'); return false; }
    var items = C.clipboard.map(function (it) { return E.cloneItem(it); });
    var r = R.empty();
    items.forEach(function (it) {
      r = R.union(r, Rn.xformBounds(Rn.localBounds(it), it.m));
    });
    var dx = 0, dy = 0;
    if (mode === 'center' || !mode) {
      var c = AI.viewT.toDoc(a, a.canvas.clientWidth / 2, a.canvas.clientHeight / 2);
      dx = c.x - R.cx(r); dy = c.y - R.cy(r);
    }
    if (dx || dy) items.forEach(function (it) { it.m = M.mul(M.translate(dx, dy), it.m); });
    a.history.begin(LABEL[mode] || '붙이기', a.doc);
    if (mode === 'back') layer.children = items.concat(layer.children);
    else layer.children = layer.children.concat(items);
    AI.sel.set(a, items);
    a.history.commit();
    a.invalidate();
    AI.ui.syncAll(a);
    return true;
  };
  var LABEL = { center: '붙이기', place: '제자리에 붙이기', front: '앞에 붙이기', back: '뒤에 붙이기', drop: '붙이기' };

  /* 메뉴에서 부를 때는 clipboardData 가 없으므로 비동기 Clipboard API 로 읽는다.
     Ctrl+V 는 keymap 이 브라우저에 넘겨 paste 이벤트로 들어온다 (clipboard.js). */
  def('paste', '붙이기', 'Ctrl+V', function (a) { AI.clipboard.pasteAsync(a, 'center'); });
  def('pasteFront', '앞에 붙이기', 'Ctrl+F', function (a) { AI.clipboard.pasteAsync(a, 'front'); });
  def('pasteBack', '뒤에 붙이기', 'Ctrl+B', function (a) { AI.clipboard.pasteAsync(a, 'back'); });
  def('pasteInPlace', '제자리에 붙이기', 'Ctrl+Shift+V', function (a) { AI.clipboard.pasteAsync(a, 'place'); });
  def('clear', '지우기', 'Delete', hist('삭제', function (a) {
    if (a.selPts.length && T.current(a) && T.current(a).direct) {
      var np = a.selPts.length;
      E.deleteAnchors(a);
      U.toast('앵커 ' + np + '개 삭제 — 되돌리려면 ' + AI.keymap.display('Ctrl+Z'));
      return;
    }
    if (!a.sel.length) return false;
    var n = a.sel.length;
    E.remove(a);
    /* 되돌릴 수 있다는 것을 그 자리에서 알려 준다 — 지웠다는 사실보다 중요하다 */
    U.toast(n + '개 삭제 — 되돌리려면 ' + AI.keymap.display('Ctrl+Z'));
  }), { enabled: function (a) { return a.sel.length > 0 || a.selPts.length > 0; } });
  def('duplicate', '복제', 'Ctrl+Alt+D', hist('복제', function (a) {
    if (!a.sel.length) return false;
    E.duplicate(a, 10, 10);
  }), { enabled: hasSel });

  /* ================= 선택 ================= */
  def('selectAll', '모두 선택', 'Ctrl+A', function (a) {
    var all = [];
    a.doc.layers.forEach(function (ly) {
      if (!ly.visible || ly.locked) return;
      ly.children.forEach(function (it) { if (it.visible && !it.locked) all.push(it); });
    });
    AI.sel.set(a, all);
    U.toast(all.length + '개 선택됨');
  });
  def('deselectAll', '선택 해제', 'Ctrl+Shift+A', function (a) { a.lastSel = a.sel.slice(); AI.sel.clear(a); });
  def('reselect', '재선택', 'Ctrl+6', function (a) { if (a.lastSel) AI.sel.set(a, a.lastSel.filter(function (it) { return !!Model.locate(a.doc, it); })); });
  def('selectInverse', '반전', null, function (a) {
    var all = [], cur = a.sel;
    a.doc.layers.forEach(function (ly) { ly.children.forEach(function (it) { if (cur.indexOf(it) < 0 && it.visible && !it.locked) all.push(it); }); });
    AI.sel.set(a, all);
  });
  /* 선택 > 동일 — 기준 오브젝트와 같은 속성을 가진 것을 모두 고른다 */
  C.SAME_ITEMS = [];
  Object.keys(E.SAME).forEach(function (kind) {
    var id = 'selectSame_' + kind;
    C.SAME_ITEMS.push(id);
    def(id, E.SAME[kind].name, null, function (a) { E.selectSame(a, kind); }, { enabled: hasSel });
  });
  /* 예전 이름도 남겨 둔다 (단축키·자동화 호환) */
  def('selectSameFill', '같은 칠 색상', null, function (a) { E.selectSame(a, 'fill'); }, { enabled: hasSel });
  def('selectSameStroke', '같은 획 색상', null, function (a) { E.selectSame(a, 'stroke'); }, { enabled: hasSel });

  /* 선택 > 오브젝트 */
  C.OBJSEL_ITEMS = [];
  Object.keys(E.OBJSEL).forEach(function (kind) {
    var id = 'selectObj_' + kind;
    C.OBJSEL_ITEMS.push(id);
    def(id, E.OBJSEL[kind].name, null, function (a) { E.selectObject(a, kind); });
  });

  /* ================= 오브젝트 ================= */
  /* ---------------- 반복 (방사형 · 격자 · 미러) ---------------- */
  C.REPEAT_ITEMS = [];
  Object.keys(AI.repeat.DEFS).forEach(function (kind) {
    var id = 'repeat_' + kind;
    C.REPEAT_ITEMS.push(id);
    def(id, AI.repeat.DEFS[kind].name, null, hist('반복: ' + AI.repeat.DEFS[kind].name, function (a) {
      var n = 0;
      a.sel.forEach(function (it) {
        it.repeat = (it.repeat && it.repeat.kind === kind)
          ? it.repeat : AI.repeat.defaults(kind);
        n++;
      });
      if (!n) return false;
      U.toast(AI.repeat.DEFS[kind].name + ' 반복 — 옵션은 [오브젝트 > 반복 > 옵션]');
    }), { enabled: hasSel });
  });
  def('repeatOptions', '반복 옵션...', null, function (a) { AI.dialogs.repeat(a); }, {
    enabled: function (a) { return a.sel.some(AI.repeat.has); }
  });
  def('repeatExpand', '반복 확장', null, hist('반복 확장', function (a) {
    var list = a.sel.filter(AI.repeat.has);
    if (!list.length) return false;
    var out = list.map(function (it) { return AI.repeat.expand(a, it); }).filter(Boolean);
    AI.sel.set(a, out);
    U.toast(out.length + '개 반복을 오브젝트로 확장');
  }), { enabled: function (a) { return a.sel.some(AI.repeat.has); } });
  def('repeatRelease', '반복 해제', null, hist('반복 해제', function (a) {
    var n = 0;
    a.sel.forEach(function (it) { if (AI.repeat.has(it)) { delete it.repeat; n++; } });
    if (!n) return false;
    U.toast(n + '개 반복 해제');
  }), { enabled: function (a) { return a.sel.some(AI.repeat.has); } });

  def('corners', '모퉁이...', null, function (a) { AI.dialogs.corners(a); }, {
    enabled: function (a) {
      return a.sel.some(function (it) { return it.type === 'path' && it.shape && it.shape.kind === 'rect'; });
    }
  });
  def('transformAgain', '변형 반복', 'Ctrl+D', hist('변형 반복', function (a) {
    if (!a.lastTransform || !a.sel.length) return false;
    E.transformSelection(a, a.lastTransform);
  }));
  def('moveDialog', '이동...', 'Ctrl+Shift+M', function (a) { AI.dialogs.move(a); }, { enabled: hasSel });
  def('rotateDialog', '회전...', null, function (a) { AI.dialogs.rotate(a); }, { enabled: hasSel });
  def('scaleDialog', '크기 조절...', null, function (a) { AI.dialogs.scale(a); }, { enabled: hasSel });
  def('reflectDialog', '반사...', null, function (a) { AI.dialogs.reflect(a); }, { enabled: hasSel });
  def('shearDialog', '기울이기...', null, function (a) { AI.dialogs.shear(a); }, { enabled: hasSel });
  def('reflectH', '가로 반사', null, hist('반사', function (a) { if (!a.sel.length) return false; E.reflect(a, 'v'); }), { enabled: hasSel });
  def('reflectV', '세로 반사', null, hist('반사', function (a) { if (!a.sel.length) return false; E.reflect(a, 'h'); }), { enabled: hasSel });

  def('bringToFront', '맨 앞으로 가져오기', 'Ctrl+Shift+]', hist('맨 앞으로', function (a) { if (!a.sel.length) return false; E.arrange(a, 'front'); }), { enabled: hasSel });
  def('bringForward', '앞으로 가져오기', 'Ctrl+]', hist('앞으로', function (a) { if (!a.sel.length) return false; E.arrange(a, 'forward'); }), { enabled: hasSel });
  def('sendBackward', '뒤로 보내기', 'Ctrl+[', hist('뒤로', function (a) { if (!a.sel.length) return false; E.arrange(a, 'backward'); }), { enabled: hasSel });
  def('sendToBack', '맨 뒤로 보내기', 'Ctrl+Shift+[', hist('맨 뒤로', function (a) { if (!a.sel.length) return false; E.arrange(a, 'back'); }), { enabled: hasSel });

  def('group', '그룹', 'Ctrl+G', hist('그룹', function (a) { if (a.sel.length < 2) return false; E.group(a); }), { enabled: function (a) { return a.sel.length > 1; } });
  var hasGroupSel = function (a) { return a.sel.some(function (it) { return it.type === 'group'; }); };
  def('ungroup', '그룹 풀기', 'Ctrl+Shift+G', hist('그룹 풀기', function (a) {
    if (!hasGroupSel(a)) return false;
    E.ungroup(a);
  }), { enabled: hasGroupSel });
  def('lock', '잠금', 'Ctrl+2', hist('잠금', function (a) { if (!a.sel.length) return false; E.lock(a); }), { enabled: hasSel });
  var anyIs = function (key) {
    return function (a) {
      var found = false;
      Model.walk(a.doc, function (it) { if (it[key]) found = true; });
      return found;
    };
  };
  def('unlockAll', '모두 잠금 해제', 'Ctrl+Alt+2', hist('잠금 해제', function (a) { E.unlockAll(a); }),
    { enabled: anyIs('locked') });
  def('hide', '숨기기', 'Ctrl+3', hist('숨기기', function (a) { if (!a.sel.length) return false; E.hide(a); }), { enabled: hasSel });
  def('showAll', '모두 표시', 'Ctrl+Alt+3', hist('모두 표시', function (a) { E.showAll(a); }),
    { enabled: function (a) {
      var hidden = false;
      Model.walk(a.doc, function (it) { if (it.visible === false) hidden = true; });
      return hidden;
    } });

  def('clipMake', '클리핑 마스크 만들기', 'Ctrl+7', hist('클리핑 마스크', function (a) { if (a.sel.length < 2) return false; E.makeClipMask(a); }),
    { enabled: function (a) { return a.sel.length >= 2; } });
  def('clipRelease', '클리핑 마스크 해제', 'Ctrl+Alt+7', hist('마스크 해제', function (a) { E.releaseClipMask(a); }),
    { enabled: function (a) { return a.sel.some(function (it) { return it.type === 'group' && it.clip; }); } });

  def('compoundMake', '컴파운드 패스 만들기', 'Ctrl+8', hist('컴파운드 패스', function (a) {
    var paths = a.sel.filter(function (i) { return i.type === 'path'; });
    if (paths.length < 2) return false;
    var base = paths[paths.length - 1];
    /* 일러스트레이터: 컴파운드 패스는 맨 뒤 오브젝트의 칠·획을 물려받는다.
       (자리는 맨 앞 오브젝트 자리를 그대로 쓴다) */
    var backmost = null;
    Model.walk(a.doc, function (it) { if (!backmost && paths.indexOf(it) >= 0) backmost = it; });
    if (backmost && backmost !== base) {
      base.fill = U.deepCopy(backmost.fill);
      base.stroke = U.deepCopy(backmost.stroke);
      base.opacity = backmost.opacity;
      base.blend = backmost.blend;
      if (backmost.appearance) base.appearance = U.deepCopy(backmost.appearance);
      else delete base.appearance;
    }
    var wmBase = Model.worldMatrix(a.doc, base), inv = M.invert(wmBase);
    var subs = [];
    paths.forEach(function (it) {
      var wm = Model.worldMatrix(a.doc, it), rel = M.mul(inv, wm);
      Model.expandShape(it);
      it.subs.forEach(function (sub) {
        subs.push({
          closed: true, pts: sub.pts.map(function (p) {
            var q = M.apply(rel, p.x, p.y), o = { x: q.x, y: q.y };
            if (p.ix != null) { var i2 = M.apply(rel, p.ix, p.iy); o.ix = i2.x; o.iy = i2.y; }
            if (p.ox != null) { var o2 = M.apply(rel, p.ox, p.oy); o.ox = o2.x; o.oy = o2.y; }
            return o;
          })
        });
      });
      if (it !== base) { var loc = Model.locate(a.doc, it); if (loc) loc.list.splice(loc.index, 1); }
    });
    base.subs = subs;
    base.shape = null;
    base.name = '컴파운드 패스';
    AI.sel.set(a, [base]);
  }));
  def('compoundRelease', '컴파운드 패스 해제', 'Ctrl+Alt+8', hist('컴파운드 해제', function (a) {
    var out = [];
    a.sel.forEach(function (it) {
      if (it.type !== 'path' || it.subs.length < 2) { out.push(it); return; }
      var loc = Model.locate(a.doc, it);
      if (!loc) return;
      var made = it.subs.map(function (sub) {
        var ni = Model.newPath([U.deepCopy(sub)]);
        ni.m = it.m.slice(); ni.fill = U.deepCopy(it.fill); ni.stroke = U.deepCopy(it.stroke);
        return ni;
      });
      Array.prototype.splice.apply(loc.list, [loc.index, 1].concat(made));
      out = out.concat(made);
    });
    AI.sel.set(a, out);
  }), {
    enabled: function (a) {
      return a.sel.some(function (it) { return it.type === 'path' && it.subs && it.subs.length > 1; });
    }
  });

  def('joinPath', '연결', 'Ctrl+J', hist('연결', function (a) { return E.joinPath(a); }),
    { enabled: function (a) { return a.sel.length >= 1 && a.sel.some(function (it) { return it.type === 'path'; }); } });
  def('averagePath', '평균점 연결...', 'Ctrl+Alt+J', function (a) {
    if (a.selPts.length < 2) { U.toast('앵커를 2개 이상 선택하세요'); return; }
    AI.dialogs.average(a, function (axis) {
      a.history.begin('평균', a.doc);
      if (E.averagePoints(a, axis) === false) a.history.abort(); else a.history.commit();
      a.invalidate();
    });
  });
  def('outlineStroke', '패스 > 윤곽선', null, function (a) { E.pathfinder(a, 'outline'); });

  /* 패스파인더 */
  ['unite', 'minusFront', 'intersect', 'exclude', 'divide', 'trim', 'merge', 'crop', 'outline', 'minusBack'].forEach(function (op) {
    var names = {
      unite: '합치기', minusFront: '앞면 오브젝트 제외', intersect: '교차 영역', exclude: '교차 영역 제외',
      divide: '나누기', trim: '자르기', merge: '병합', crop: '오리기', outline: '윤곽선', minusBack: '뒷면 오브젝트 제외'
    };
    def('pf_' + op, '패스파인더: ' + names[op], null, hist(names[op], function (a) { return E.pathfinder(a, op); }), { enabled: hasSel });
  });

  /* 정렬 */
  [['alignLeft', '왼쪽 정렬', 'left'], ['alignHCenter', '가로 가운데 정렬', 'hcenter'], ['alignRight', '오른쪽 정렬', 'right'],
  ['alignTop', '위쪽 정렬', 'top'], ['alignVCenter', '세로 가운데 정렬', 'vcenter'], ['alignBottom', '아래쪽 정렬', 'bottom']
  ].forEach(function (o) {
    def(o[0], o[1], null, hist(o[1], function (a) { if (!a.sel.length) return false; E.align(a, o[2], a.alignTo); }), { enabled: hasSel });
  });
  def('distH', '가로 균등 배분', null, hist('배분', function (a) { E.distribute(a, 'h'); }));
  def('distV', '세로 균등 배분', null, hist('배분', function (a) { E.distribute(a, 'v'); }));

  /* ================= 문자 ================= */
  def('fontBigger', '글꼴 크기 확대', 'Ctrl+Shift+.', hist('글꼴 크기', function (a) { return scaleFont(a, 2); }));
  def('fontSmaller', '글꼴 크기 축소', 'Ctrl+Shift+,', hist('글꼴 크기', function (a) { return scaleFont(a, -2); }));
  function scaleFont(a, d) {
    var any = false;
    a.sel.forEach(function (it) { if (it.type === 'text') { it.text.size = Math.max(1, it.text.size + d); any = true; } });
    return any ? undefined : false;
  }
  /* ---- 문자 · 단락 스타일 ---- */
  var textSel = function (a) { return a.sel.some(function (i) { return i.type === 'text'; }); };
  function selTexts(a) { return a.sel.filter(function (i) { return i.type === 'text'; }); }

  def('newCharStyle', '새 문자 스타일', null, hist('문자 스타일 만들기', function (a) {
    var t = selTexts(a);
    var attrs = AI.styles.attrsFrom('char', t.length ? t[0].text : (a.typeOpts || {}));
    var st = AI.styles.create(a.doc, 'char', null, attrs);
    t.forEach(function (it) { AI.styles.applyTo(it, 'char', st); });
    AI.ui && AI.ui.showPanel && AI.ui.showPanel('styles');
    U.toast('문자 스타일 "' + st.name + '" 만듦');
  }));
  def('newParaStyle', '새 단락 스타일', null, hist('단락 스타일 만들기', function (a) {
    var t = selTexts(a);
    var attrs = AI.styles.attrsFrom('para', t.length ? t[0].text : (a.typeOpts || {}));
    var st = AI.styles.create(a.doc, 'para', null, attrs);
    t.forEach(function (it) { AI.styles.applyTo(it, 'para', st); });
    AI.ui && AI.ui.showPanel && AI.ui.showPanel('styles');
    U.toast('단락 스타일 "' + st.name + '" 만듦');
  }));
  def('redefineStyle', '스타일 재정의', null, hist('스타일 재정의', function (a) {
    var t = selTexts(a);
    if (!t.length) { U.toast('텍스트를 선택하세요'); return false; }
    var n = 0;
    ['char', 'para'].forEach(function (kind) {
      var st = AI.styles.styleOf(a.doc, t[0], kind);
      if (st) n += AI.styles.redefine(a.doc, kind, st, t[0]);
    });
    if (!n) { U.toast('스타일이 걸린 텍스트가 아닙니다'); return false; }
    U.toast(n + '개 텍스트에 반영');
  }), { enabled: textSel });
  def('clearTextStyle', '스타일 연결 끊기', null, hist('스타일 연결 끊기', function (a) {
    var t = selTexts(a), n = 0;
    t.forEach(function (it) {
      if (AI.styles.unlink(it, 'char')) n++;
      if (AI.styles.unlink(it, 'para')) n++;
    });
    if (!n) { U.toast('연결된 스타일이 없습니다'); return false; }
  }), { enabled: textSel });

  /* ---- 패스 상의 문자 ---- */
  var pathTextSel = function (a) {
    return a.sel.some(function (it) { return it.type === 'text' && it.text.path; });
  };
  def('typeOnPath', '패스 상의 문자 만들기', null, hist('패스 상의 문자', function (a) {
    var paths = a.sel.filter(function (it) { return it.type === 'path'; });
    var txt = a.sel.filter(function (it) { return it.type === 'text' && !it.text.path; })[0];
    if (!paths.length) { U.toast('기준선이 될 패스를 선택하세요'); return false; }
    var made = [];
    paths.forEach(function (src) {
      var it = E.makePathText(a, src, 0);
      if (txt) {
        /* 함께 선택한 점 문자가 있으면 그 내용과 서식을 그대로 가져온다 */
        it.text.content = txt.text.content;
        it.text.family = txt.text.family; it.text.size = txt.text.size;
        it.text.weight = txt.text.weight; it.text.italic = txt.text.italic;
        it.text.tracking = txt.text.tracking; it.text.align = txt.text.align;
        it.fill = U.deepCopy(txt.fill); it.stroke = U.deepCopy(txt.stroke);
      } else if (!it.text.content) {
        it.text.content = '패스 상의 문자';
      }
      made.push(it);
    });
    if (txt) {
      var loc = Model.locate(a.doc, txt);
      if (loc) loc.list.splice(loc.index, 1);
    }
    AI.sel.set(a, made);
    U.toast(made.length + '개 패스에 문자 배치');
  }), { enabled: function (a) { return a.sel.some(function (i) { return i.type === 'path'; }); } });

  def('typePathOptions', '패스 상의 문자 옵션...', null, function (a) {
    if (!pathTextSel(a)) { U.toast('패스 상의 문자를 선택하세요'); return; }
    AI.dialogs.typePath(a);
  }, { enabled: pathTextSel });

  def('typePathFlip', '패스 뒤집기', null, hist('패스 뒤집기', function (a) {
    var n = 0;
    a.sel.forEach(function (it) {
      if (it.type !== 'text' || !it.text.path) return;
      it.text.path.flip = !it.text.path.flip;
      n++;
    });
    if (!n) { U.toast('패스 상의 문자를 선택하세요'); return false; }
  }), { enabled: pathTextSel });

  def('releaseTypePath', '패스 상의 문자 풀기', null, hist('패스 상의 문자 풀기', function (a) {
    var made = [], n = 0;
    a.sel.slice().forEach(function (it) {
      if (it.type !== 'text' || !it.text.path) { made.push(it); return; }
      /* 기준선 패스를 다시 독립된 패스 오브젝트로 되돌린다 */
      var pth = Model.newPath(U.deepCopy(it.text.path.subs));
      pth.m = it.m.slice();
      pth.name = '패스';
      pth.fill = Col.none();
      pth.stroke = Model.defaultStroke();
      var loc = Model.locate(a.doc, it);
      if (loc) loc.list.splice(loc.index, 1, pth); else Model.activeLayer(a.doc).children.push(pth);
      made.push(pth);
      n++;
    });
    if (!n) { U.toast('패스 상의 문자를 선택하세요'); return false; }
    AI.sel.set(a, made);
    U.toast(n + '개 패스로 되돌림');
  }), { enabled: pathTextSel });

  def('createOutlines', '윤곽선 만들기', 'Ctrl+Shift+O', hist('윤곽선 만들기', function (a) {
    var texts = a.sel.filter(function (it) { return it.type === 'text'; });
    if (!texts.length) { U.toast('텍스트를 선택하세요'); return false; }
    if (!AI.trace || !U.hasDOM) { U.toast('브라우저에서만 사용할 수 있습니다'); return false; }
    var made = [], ok = 0;
    texts.forEach(function (it) {
      var outline = AI.trace.textToOutlines(a, it);
      if (!outline) { made.push(it); return; }
      var loc = Model.locate(a.doc, it);
      if (loc) loc.list.splice(loc.index, 1, outline);
      else Model.activeLayer(a.doc).children.push(outline);
      made.push(outline);
      ok++;
    });
    if (!ok) { U.toast('윤곽선으로 바꿀 수 없었습니다'); return false; }
    AI.sel.set(a, made);
    U.toast(ok + '개 텍스트를 윤곽선으로 변환');
  }), { enabled: function (a) { return a.sel.some(function (i) { return i.type === 'text'; }); } });

  /* ================= 보기 ================= */
  def('outlineMode', '윤곽선 보기', 'Ctrl+Y', function (a) { a.prefs.outline = !a.prefs.outline; }, { checked: function (a) { return a.prefs.outline; } });
  def('zoomIn', '확대', 'Ctrl+=', function (a) { AI.viewT.zoomStep(a, 1); });
  def('zoomOut', '축소', 'Ctrl+-', function (a) { AI.viewT.zoomStep(a, -1); });
  def('fitArtboard', '대지에 맞추기', 'Ctrl+0', function (a) { AI.viewT.fitArtboard(a); });
  def('fitAll', '전체 대지 맞추기', 'Ctrl+Alt+0', function (a) { AI.viewT.fitAll(a); });
  def('fitSelection', '선택 항목에 맞추기', 'Ctrl+Alt+0', function (a) {
    if (!a.sel.length) { U.toast('오브젝트를 선택하세요'); return; }
    AI.viewT.fitRect(a, Rn.selectionBounds(a, false), 24);
  }, { enabled: hasSel });
  def('actualSize', '실제 크기', 'Ctrl+1', function (a) { AI.viewT.setZoom(a, 1); });
  def('rotateViewCW', '화면 시계 방향 회전', null, function (a) { AI.viewT.rotateView(a, Math.PI / 12); });
  def('rotateViewCCW', '화면 반시계 방향 회전', null, function (a) { AI.viewT.rotateView(a, -Math.PI / 12); });
  def('resetRotation', '화면 회전 초기화', 'Shift+Ctrl+1', function (a) { AI.viewT.resetRotation(a); U.toast('화면 회전 초기화'); });
  def('hideEdges', '가장자리 숨기기', 'Ctrl+H', function (a) { a.hideEdges = !a.hideEdges; }, { checked: function (a) { return a.hideEdges; } });
  def('showRulers', '눈금자', 'Ctrl+R', function (a) {
    a.prefs.rulers = !a.prefs.rulers;
    document.body.classList.toggle('no-rulers', !a.prefs.rulers);
    a.resize();
  }, { checked: function (a) { return a.prefs.rulers; } });
  def('showGrid', '격자 표시', "Ctrl+'", function (a) { a.prefs.grid = !a.prefs.grid; }, { checked: function (a) { return a.prefs.grid; } });
  def('snapGrid', '격자에 물리기', "Ctrl+Shift+'", function (a) { a.prefs.snapGrid = !a.prefs.snapGrid; }, { checked: function (a) { return a.prefs.snapGrid; } });
  def('smartGuides', '고급 안내선', 'Ctrl+U', function (a) { a.prefs.smart = !a.prefs.smart; }, { checked: function (a) { return a.prefs.smart; } });
  def('showGuides', '안내선 표시', 'Ctrl+;', function (a) { a.prefs.guides = !a.prefs.guides; }, { checked: function (a) { return a.prefs.guides; } });
  def('makeGuides', '안내선 만들기', 'Ctrl+5', hist('안내선 만들기', function (a) {
    if (!a.sel.length) return false;
    a.sel.forEach(function (it) {
      var b = Rn.worldBounds(a.doc, it, true);
      if (R.isEmpty(b)) return;
      if (R.w(b) < 1) a.doc.guides.push({ axis: 'v', pos: R.cx(b) });
      else if (R.h(b) < 1) a.doc.guides.push({ axis: 'h', pos: R.cy(b) });
      else {
        a.doc.guides.push({ axis: 'v', pos: b.x }, { axis: 'v', pos: b.x2 },
          { axis: 'h', pos: b.y }, { axis: 'h', pos: b.y2 });
      }
    });
    E.remove(a);
  }), { enabled: hasSel });
  def('clearGuides', '안내선 지우기', null, hist('안내선 지우기', function (a) { a.doc.guides = []; }));
  def('showBBox', '테두리 상자 표시', 'Ctrl+Shift+B', function (a) { a.prefs.bbox = a.prefs.bbox === false; }, { checked: function (a) { return a.prefs.bbox !== false; } });

  /* ================= 대지 ================= */
  function gotoArtboard(a, i) {
    a.doc.activeArtboard = U.clamp(i, 0, a.doc.artboards.length - 1);
    AI.viewT.fitArtboard(a);
    AI.ui.syncStatus(a);
  }
  def('nextArtboard', '다음 대지', 'Alt+PageDown', function (a) { gotoArtboard(a, a.doc.activeArtboard + 1); });
  def('prevArtboard', '이전 대지', 'Alt+PageUp', function (a) { gotoArtboard(a, a.doc.activeArtboard - 1); });
  def('firstArtboard', '첫 대지', null, function (a) { gotoArtboard(a, 0); });
  def('lastArtboard', '마지막 대지', null, function (a) { gotoArtboard(a, a.doc.artboards.length - 1); });
  def('newArtboard', '새 대지', null, hist('새 대지', function (a) {
    var last = a.doc.artboards[a.doc.artboards.length - 1];
    a.doc.artboards.push({
      id: U.uid('AB'), name: '대지 ' + (a.doc.artboards.length + 1),
      x: last.x + last.w + 40, y: last.y, w: last.w, h: last.h
    });
    a.doc.activeArtboard = a.doc.artboards.length - 1;
    AI.viewT.fitArtboard(a);
  }));
  def('deleteArtboard', '대지 삭제', null, hist('대지 삭제', function (a) {
    if (a.doc.artboards.length < 2) { U.toast('대지는 최소 1개 필요합니다'); return false; }
    a.doc.artboards.splice(a.doc.activeArtboard, 1);
    a.doc.activeArtboard = Math.max(0, a.doc.activeArtboard - 1);
    AI.viewT.fitArtboard(a);
  }));


  /* ================= 효과 (비파괴) ================= */
  function fxDialog(a, type) {
    if (!a.sel.length) { U.toast('오브젝트를 먼저 선택하세요'); return; }
    AI.dialogs.effect(a, type);
  }
  def('fxBlur', '가우시안 흐림...', null, function (a) { fxDialog(a, 'blur'); }, { enabled: hasSel });
  def('fxShadow', '그림자 만들기...', null, function (a) { fxDialog(a, 'shadow'); }, { enabled: hasSel });
  def('fxGlow', '외부 광선...', null, function (a) { fxDialog(a, 'glow'); }, { enabled: hasSel });
  /* --- 왜곡 및 변형 (벡터 효과) --- */
  function geoDialog(a, type) {
    if (!hasPathSel(a)) { U.toast('이 효과는 패스에만 적용됩니다'); return; }
    fxDialog(a, type);
  }
  def('fxZigzag', '지그재그...', null, function (a) { geoDialog(a, 'zigzag'); }, { enabled: hasPathSel });
  def('fxRoughen', '거칠게 하기...', null, function (a) { geoDialog(a, 'roughen'); }, { enabled: hasPathSel });
  def('fxPuckerBloat', '오목· 볼록...', null, function (a) { geoDialog(a, 'puckerBloat'); }, { enabled: hasPathSel });
  def('fxTwist', '비틀기...', null, function (a) { geoDialog(a, 'twist'); }, { enabled: hasPathSel });
  def('fxTransform', '변형...', null, function (a) { geoDialog(a, 'transformFx'); }, { enabled: hasPathSel });
  def('fxFreeDistort', '자유 왜곡...', null, function (a) { geoDialog(a, 'freeDistort'); }, { enabled: hasPathSel });

  /* --- 3D --- */
  def('fx3dExtrude', '돌출과 경사...', null, function (a) { geoDialog(a, 'extrude'); }, { enabled: hasPathSel });
  def('fx3dRotate', '회전...', null, function (a) { geoDialog(a, 'rotate3d'); }, { enabled: hasPathSel });

  def('fxLast', '마지막 효과 적용', 'Ctrl+Shift+E', hist('효과 적용', function (a) {
    if (!a.sel.length) return false;
    var last = a.lastEffect;
    if (!last) { U.toast('적용할 효과가 없습니다'); return false; }
    a.sel.forEach(function (it) {
      it.effects = (it.effects || []).concat([U.deepCopy(last)]);
    });
    U.toast(AI.effects.label(last));
  }), { enabled: function (a) { return a.sel.length > 0 && !!a.lastEffect; } });
  def('fxLastDialog', '마지막 효과 옵션...', 'Ctrl+Alt+Shift+E', function (a) {
    if (!a.lastEffect) { U.toast('적용할 효과가 없습니다'); return; }
    fxDialog(a, a.lastEffect.type);
  }, { enabled: function (a) { return a.sel.length > 0 && !!a.lastEffect; } });
  def('fxClear', '모양 지우기', null, hist('모양 지우기', function (a) {
    var any = false;
    a.sel.forEach(function (it) { if (AI.effects.hasAny(it)) { AI.effects.clear(it); any = true; } });
    if (!any) { U.toast('적용된 효과가 없습니다'); return false; }
    U.toast('효과 지움');
  }), { enabled: hasSel });
  /* 3D 를 실제 면 오브젝트로 굳힌다 — 면 하나가 패스 하나가 된다 */
  function bake3D(a, it) {
    var faces = AI.threed.expand(it);
    if (!faces || !faces.length) return null;
    var made = faces.map(function (f, i) {
      var pth = Model.newPath(f.rings.map(function (r) {
        return { closed: true, pts: r.map(function (p) { return { x: p.x, y: p.y }; }) };
      }));
      pth.name = '면 ' + (i + 1);
      pth.fill = Col.solid(f.color);
      pth.stroke = Model.defaultStroke();
      pth.m = M.ident();
      return pth;
    });
    var g = Model.newGroup(made);
    g.name = it.name + ' (3D 확장)';
    g.m = it.m.slice();
    g.opacity = it.opacity;
    g.blend = it.blend;
    return g;
  }

  /* 왜곡 및 변형(기하 효과)을 실제 패스로 굳힌다 — 결과가 여럿이면 사본마다 하나씩 */
  function bakeGeo(it) {
    var res = AI.distort.expand(it);
    if (!res) return null;
    var raster = (it.effects || []).filter(function (e) { return !AI.distort.isGeo(e.type); });
    return res.map(function (entry, i) {
      var c = U.deepCopy(it);
      c.id = U.uid(it.type);
      c.subs = entry.subs;
      c.m = M.mul(it.m, entry.m);
      if (res.length > 1) c.name = it.name + ' ' + (i + 1);
      if (raster.length) c.effects = raster.map(function (e) { return U.deepCopy(e); });
      else delete c.effects;
      return c;
    });
  }

  def('expandAppearance', '모양 확장', null, hist('모양 확장', function (a) {
    var made = [], expanded = 0, rasterLeft = 0;
    a.sel.slice().forEach(function (it) {
      /* 3D 는 색이 다른 면들로 펼쳐지므로 먼저 처리한다 */
      var g3 = AI.threed.has(it) ? bake3D(a, it) : null;
      if (g3) {
        var loc3 = Model.locate(a.doc, it);
        if (loc3) loc3.list.splice(loc3.index, 1, g3); else Model.activeLayer(a.doc).children.push(g3);
        made.push(g3);
        expanded++;
        return;
      }
      var baked = bakeGeo(it);
      var units = baked || [it];
      var repl = [];
      units.forEach(function (u) {
        var parts = AI.appearance.expand(u);
        if (!parts) { repl.push(u); return; }
        /* 각 겹을 실제 오브젝트로 펼치고 원본 자리에 그룹으로 넣는다 */
        var g = Model.newGroup(parts);
        g.name = u.name + ' (확장)';
        g.m = u.m.slice();
        g.opacity = u.opacity;
        g.blend = u.blend;
        if (AI.effects.has(u)) g.effects = U.deepCopy(u.effects);
        parts.forEach(function (c) { c.m = M.ident(); });
        repl.push(g);
      });
      if (!baked && repl[0] === it) {
        if (AI.effects.has(it)) rasterLeft++;
        made.push(it);
        return;
      }
      var node = repl[0];
      if (repl.length > 1) {
        node = Model.newGroup(repl);
        node.name = it.name + ' (확장)';
      }
      var loc = Model.locate(a.doc, it);
      if (loc) loc.list.splice(loc.index, 1, node); else Model.activeLayer(a.doc).children.push(node);
      made.push(node);
      expanded++;
    });
    if (!expanded) {
      U.toast(rasterLeft ? '래스터 효과(흐림·그림자·광선)는 벡터로 확장되지 않습니다' : '확장할 모양이 없습니다');
      return false;
    }
    AI.sel.set(a, made);
    U.toast(expanded + '개 모양 확장됨' + (rasterLeft ? ' (래스터 효과는 유지)' : ''));
  }), { enabled: hasSel });

  /* ================= 투명도 · 블렌드 ================= */
  def('opacityMaskMake', '불투명도 마스크 만들기', null, hist('불투명도 마스크', function (a) {
    return E.makeOpacityMask(a);
  }), { enabled: function (a) { return a.sel.length > 1; } });
  def('opacityMaskRelease', '불투명도 마스크 해제', null, hist('마스크 해제', function (a) {
    return E.releaseOpacityMask(a);
  }));
  def('opacityMaskInvert', '마스크 반전', null, hist('마스크 반전', function (a) {
    var any = false;
    a.sel.forEach(function (it) { if (it.opacityMask) { it.maskInvert = !it.maskInvert; any = true; } });
    if (!any) { U.toast('불투명도 마스크가 없습니다'); return false; }
  }));
  def('blendMake', '블렌드 만들기', 'Ctrl+Alt+B', hist('블렌드', function (a) {
    return E.blend(a, (a.blendOpts && a.blendOpts.steps) || 5);
  }), { enabled: function (a) { return a.sel.length > 1; } });
  def('blendOptions', '블렌드 옵션...', null, function (a) { AI.dialogs.blendOptions(a); });
  def('blendRelease', '블렌드 해제', 'Ctrl+Alt+Shift+B', hist('블렌드 해제', function (a) {
    if (!a.sel.some(function (i) { return i.type === 'group' && i.blendSpine; })) {
      U.toast('블렌드 그룹을 선택하세요'); return false;
    }
    E.ungroup(a);
  }));

  /* ================= 심볼 · 패턴 ================= */
  def('newSymbol', '새 심볼', null, hist('새 심볼', function (a) {
    if (!a.sel.length) { U.toast('심볼로 만들 아트웍을 선택하세요'); return false; }
    var d = AI.assets.defineSymbol(a);
    if (!d) { U.toast('심볼을 만들 수 없습니다'); return false; }
    U.toast('심볼 "' + d.name + '" 등록됨');
  }), { enabled: hasSel });
  def('breakSymbolLink', '심볼 링크 끊기', null, hist('심볼 링크 끊기', function (a) {
    if (AI.assets.breakLink(a) === false) { U.toast('심볼 인스턴스를 선택하세요'); return false; }
  }), { enabled: hasSel });
  def('redefineSymbol', '심볼 재정의', null, hist('심볼 재정의', function (a) {
    if (a.sel.length !== 1) { U.toast('오브젝트 하나만 선택하세요'); return false; }
    AI.assets.ensure(a.doc);
    if (!a.doc.symbols.length) { U.toast('등록된 심볼이 없습니다'); return false; }
    var id = a.lastSymbolId || a.doc.symbols[a.doc.symbols.length - 1].id;
    if (!AI.assets.redefineFromSelection(a, id)) { U.toast('재정의할 수 없습니다'); return false; }
    U.toast('심볼 재정의됨');
  }));
  def('newPattern', '새 패턴', null, hist('새 패턴', function (a) {
    if (!a.sel.length) { U.toast('패턴 타일로 만들 아트웍을 선택하세요'); return false; }
    var d = AI.assets.definePattern(a);
    if (!d) { U.toast('패턴을 만들 수 없습니다'); return false; }
    AI.assets.invalidateTiles();
    U.toast('패턴 "' + d.name + '" 등록됨 (' + U.fmt(d.w) + '×' + U.fmt(d.h) + ')');
  }), { enabled: hasSel });
  def('patternOptions', '패턴 옵션...', null, function (a) { AI.dialogs.patternOptions(a); }, { enabled: hasSel });

  /* ================= 브러시 ================= */
  def('brushOptions', '브러시 옵션...', null, function (a) { AI.dialogs.brushOptions(a); });

  /* ================= 색상 ================= */
  def('recolor', '아트웍 재색상화...', null, function (a) { AI.dialogs.recolor(a); }, { enabled: hasSel });

  /* ================= 패스 ================= */
  def('offsetPath', '패스 이동...', null, function (a) { AI.dialogs.offsetPath(a); }, { enabled: hasSel });
  def('simplifyPath', '단순화...', null, function (a) { AI.dialogs.simplify(a); }, { enabled: hasSel });

  /* ================= 이미지 ================= */
  def('cropImage', '이미지 자르기', null, hist('이미지 자르기', function (a) { return E.cropImage(a); }), {
    enabled: function (a) { return a.sel.some(function (i) { return i.type === 'image'; }); }
  });
  def('imageTrace', '이미지 추적 만들기...', null, function (a) { AI.dialogs.imageTrace(a); }, {
    enabled: function (a) { return a.sel.some(function (i) { return i.type === 'image'; }); }
  });

  /* ================= 개별 변형 ================= */
  def('transformEach', '개별 변형...', 'Ctrl+Alt+Shift+D', function (a) { AI.dialogs.transformEach(a); }, { enabled: hasSel });

  /* ================= 안내선 ================= */
  def('lockGuides', '안내선 잠금', 'Ctrl+Alt+;', function (a) {
    a.prefs.guidesLocked = a.prefs.guidesLocked === false;
    U.toast(a.prefs.guidesLocked ? '안내선 잠금' : '안내선 잠금 해제');
  }, { checked: function (a) { return a.prefs.guidesLocked !== false; } });
  def('releaseGuides', '안내선 해제', 'Ctrl+Alt+5', hist('안내선 해제', function (a) { return E.releaseGuides(a); }));

  /* ================= 레이어 ================= */
  def('mergeLayers', '선택한 레이어 병합', null, hist('레이어 병합', function (a) {
    if (E.mergeLayers(a, a.selLayers) === false) { U.toast('병합할 레이어가 없습니다'); return false; }
    U.toast('레이어 병합됨');
  }));
  def('releaseToLayers', '레이어로 배포(순차)', null, hist('레이어로 배포', function (a) {
    if (E.releaseToLayers(a) === false) { U.toast('배포할 오브젝트가 2개 이상 필요합니다'); return false; }
    U.toast('레이어로 배포됨');
  }));
  def('collectInNewLayer', '새 레이어로 모으기', null, hist('새 레이어로 모으기', function (a) {
    if (E.collectInNewLayer(a) === false) { U.toast('오브젝트를 먼저 선택하세요'); return false; }
  }), { enabled: hasSel });

  /* ================= 대지 (추가) ================= */
  def('fitArtboardToSelection', '대지를 선택 항목에 맞추기', 'Ctrl+Alt+C', hist('대지 맞추기', function (a) {
    if (E.fitArtboardTo(a, 'selection') === false) return false;
    AI.viewT.fitArtboard(a);
  }), { enabled: hasSel });
  def('fitArtboardToArtwork', '대지를 아트웍에 맞추기', null, hist('대지 맞추기', function (a) {
    if (E.fitArtboardTo(a, 'artwork') === false) return false;
    AI.viewT.fitArtboard(a);
  }));
  def('rearrangeArtboards', '모든 대지 재정렬...', null, function (a) { AI.dialogs.rearrangeArtboards(a); });
  def('artboardOptions', '대지 옵션...', null, function (a) { AI.dialogs.artboardOptions(a); });
  def('duplicateArtboard', '대지 복제', null, hist('대지 복제', function (a) {
    var ab = a.doc.artboards[a.doc.activeArtboard];
    var n = U.deepCopy(ab);
    n.id = U.uid('AB');
    n.name = ab.name + ' 복사';
    n.x = ab.x + ab.w + 40;
    a.doc.artboards.splice(a.doc.activeArtboard + 1, 0, n);
    a.doc.activeArtboard++;
    AI.viewT.fitArtboard(a);
  }));

  /* ================= 단위 ================= */
  def('setUnit', '단위', null, function () { });
  C.setUnit = function (a, u) {
    a.prefs.unit = u;
    a.invalidate();
    AI.ui.syncAll(a);
    U.toast('단위: ' + u);
  };

  /* ================= 윈도우 ================= */
  def('togglePanels', '패널 숨기기/표시', 'Tab', function (a) {
    a.panelsHidden = !a.panelsHidden;
    document.getElementById('panels').style.display = a.panelsHidden ? 'none' : '';
    document.getElementById('toolbar').style.display = a.panelsHidden ? 'none' : '';
    a.resize();
  });
  def('togglePanelsKeepTools', '도구만 남기고 패널 숨기기', 'Shift+Tab', function (a) {
    a.sidePanelsHidden = !a.sidePanelsHidden;
    document.getElementById('panels').style.display = a.sidePanelsHidden ? 'none' : '';
    a.resize();
  });

  /* 윈도우 메뉴에서 패널을 이름으로 꺼낸다 (일러스트레이터와 같은 구성) */
  C.PANELS = [
    ['properties', '속성'], ['transform', '변형'],
    ['color', '색상'], ['gradient', '그레이디언트'], ['swatches', '견본'],
    ['stroke', '획'], ['type', '문자'], ['styles', '문자 · 단락 스타일'],
    ['align', '정렬'], ['pathfinder', '패스파인더'],
    ['appearance', '모양'], ['effects', '효과'], ['symbols', '심볼 · 패턴'],
    ['layers', '레이어'], ['history', '작업 내역'], ['artboards', '대지']
  ];
  C.PANELS.forEach(function (o) {
    def('panel_' + o[0], o[1], null, function (a) {
      if (a.panelsHidden || a.sidePanelsHidden) {
        a.panelsHidden = a.sidePanelsHidden = false;
        document.getElementById('panels').style.display = '';
        document.getElementById('toolbar').style.display = '';
        a.resize();
      }
      if (AI.ui.showPanel) AI.ui.showPanel(o[0]);
    }, {
      /* 지금 앞에 나와 있는 패널에 체크 표시 */
      checked: function () {
        var sec = document.querySelector('.panel[data-panel="' + o[0] + '"]');
        return !!sec && !sec.classList.contains('tab-hidden') &&
          !(sec.parentNode && sec.parentNode.classList.contains('collapsed'));
      }
    });
  });

  /* ================= 칠 / 획 단축키 ================= */
  def('swapFillStroke', '칠/획 교체', 'Shift+X', function (a) {
    var f = a.fill, s = a.stroke;
    a.fill = s && s.type !== 'none' ? U.deepCopy(s) : Col.none();
    a.stroke = f && f.type !== 'none' ? U.deepCopy(f) : Col.none();
    if (a.sel.length) { a.history.begin('칠/획 교체', a.doc); E.swapFillStroke(a); a.history.commit(); }
  });
  def('toggleFillStroke', '칠/획 포커스 전환', 'X', function (a) { a.fillFocus = !a.fillFocus; });
  def('defaultFillStroke', '기본 칠/획', 'D', function (a) {
    a.fill = Col.solid('#ffffff');
    a.stroke = Col.solid('#000000');
    a.strokeWidth = 1;
    if (a.sel.length) {
      a.history.begin('기본 칠/획', a.doc);
      E.applyPaint(a, Col.solid('#ffffff'), 'fill');
      E.applyPaint(a, Col.solid('#000000'), 'stroke');
      E.applyStrokeProp(a, 'width', 1);
      a.history.commit();
    }
  });
  def('noneFill', '없음', '/', function (a) {
    var none = Col.none();
    if (a.fillFocus) a.fill = none; else a.stroke = none;
    if (a.sel.length) { a.history.begin('없음', a.doc); E.applyPaint(a, none, a.fillFocus ? 'fill' : 'stroke'); a.history.commit(); }
  });
  def('solidColor', '단색', ',', function (a) {
    var cur = a.fillFocus ? a.fill : a.stroke;
    var hex = (cur && cur.type === 'solid') ? cur.color : (a.lastColor || '#000000');
    var p = Col.solid(hex);
    if (a.fillFocus) a.fill = p; else a.stroke = p;
    if (a.sel.length) { a.history.begin('단색', a.doc); E.applyPaint(a, p, a.fillFocus ? 'fill' : 'stroke'); a.history.commit(); }
  });
  def('gradientFill', '그레이디언트', '.', function (a) {
    var g = Col.gradient('linear', '#ffffff', '#000000');
    if (a.fillFocus) a.fill = g;
    if (a.sel.length) { a.history.begin('그레이디언트', a.doc); E.applyPaint(a, g, 'fill'); a.history.commit(); }
  });

  /* ================= 격리 모드 ================= */
  def('exitIsolation', '격리 모드 종료', null, function (a) {
    if (a.isolation && a.isolation.length) {
      var g = a.isolation.pop();
      AI.sel.set(a, [g]);
      U.toast('격리 모드 종료');
    }
  });

  /* ================= 넛지 ================= */
  C.nudge = function (a, dx, dy) {
    if (!a.sel.length) return;
    a.history.begin('이동', a.doc);
    if (a.selPts.length && T.current(a) && T.current(a).direct) E.movePoints(a, dx, dy);
    else E.move(a, dx, dy);
    a.lastTransform = M.translate(dx, dy);
    a.history.commit();
    a.invalidate();
    AI.ui && AI.ui.syncSelection && AI.ui.syncSelection(a);
  };

  /* ================= 도움말 ================= */
  def('shortcutHelp', '단축키 목록', null, function () { window.open('docs/SHORTCUTS.md', '_blank'); });
  def('about', 'Illymolly 정보', null, function () {
    U.toast('Illymolly — 웹 벡터 편집기 (Illustrator 호환 단축키)');
  });

  /* ================= 메뉴 구조 ================= */
  C.MENUS = [
    {
      title: '파일', items: ['new', 'open', 'closeDoc', '-', 'save', 'saveAs', '-', 'place', '-', 'exportSvg', 'exportPng', 'exportPdf', 'exportArtboards', '-', 'installApp', '-', 'docSetup']
    },
    {
      title: '편집', items: ['undo', 'redo', '-', 'cut', 'copy', 'paste', 'pasteFront', 'pasteBack', 'pasteInPlace', '-', 'clear', 'duplicate', '-', 'preferences']
    },
    {
      title: '오브젝트', items: [
        'transformAgain', 'moveDialog', 'rotateDialog', 'scaleDialog', 'reflectDialog', 'shearDialog', 'transformEach', '-',
        'reflectH', 'reflectV', '-',
        'corners', { label: '반복', items: C.REPEAT_ITEMS.concat(['-', 'repeatOptions', 'repeatExpand', 'repeatRelease']) }, '-',
        'bringToFront', 'bringForward', 'sendBackward', 'sendToBack', '-',
        'group', 'ungroup', '-', 'lock', 'unlockAll', 'hide', 'showAll', '-',
        'clipMake', 'clipRelease', '-', 'opacityMaskMake', 'opacityMaskRelease', 'opacityMaskInvert', '-',
        'blendMake', 'blendOptions', 'blendRelease', '-',
        'compoundMake', 'compoundRelease', '-',
        'joinPath', 'averagePath', 'outlineStroke', 'offsetPath', 'simplifyPath', '-',
        'expandAppearance', 'recolor', '-',
        'newSymbol', 'breakSymbolLink', 'redefineSymbol', 'newPattern', 'brushOptions', '-',
        'imageTrace', 'cropImage', '-',
        'mergeLayers', 'releaseToLayers', 'collectInNewLayer', '-',
        'fitArtboardToSelection', 'fitArtboardToArtwork', '-',
        'pf_unite', 'pf_minusFront', 'pf_intersect', 'pf_exclude', 'pf_divide', 'pf_trim', 'pf_merge', 'pf_crop', 'pf_outline', 'pf_minusBack'
      ]
    },
    {
      title: '문자', items: [
        'fontBigger', 'fontSmaller', '-',
        'typeOnPath', 'typePathOptions', 'typePathFlip', 'releaseTypePath', '-',
        'newCharStyle', 'newParaStyle', 'redefineStyle', 'clearTextStyle', '-',
        'createOutlines'
      ]
    },
    {
      title: '선택', items: ['selectAll', 'deselectAll', 'reselect', 'selectInverse', '-',
        { label: '동일', items: C.SAME_ITEMS },
        { label: '오브젝트', items: C.OBJSEL_ITEMS }]
    },
    {
      title: '효과', items: [
        'fxLast', 'fxLastDialog', '-',
        { label: '3D', items: ['fx3dExtrude', 'fx3dRotate'] },
        { label: '왜곡 및 변형', items: ['fxZigzag', 'fxRoughen', 'fxPuckerBloat', 'fxTwist', 'fxTransform', 'fxFreeDistort'] },
        '-',
        { label: '흐림 효과', items: ['fxBlur'] },
        { label: '스타일화', items: ['fxShadow', 'fxGlow'] },
        '-',
        'expandAppearance', 'fxClear'
      ]
    },
    {
      title: '보기', items: [
        'commandSearch', 'fullKeyboard', 'shortcutList', '-',
        'outlineMode', '-', 'zoomIn', 'zoomOut', 'fitArtboard', 'fitAll', 'fitSelection', 'actualSize', '-',
        'rotateViewCW', 'rotateViewCCW', 'resetRotation', '-',
        'hideEdges', 'showBBox', '-', 'showRulers', 'showGrid', 'snapGrid', 'smartGuides', '-',
        'showGuides', 'lockGuides', 'makeGuides', 'releaseGuides', 'clearGuides'
      ]
    },
    {
      title: '윈도우', items: ['nextDoc', 'prevDoc', '-', 'togglePanels', 'togglePanelsKeepTools', '-'].concat(
        C.PANELS.map(function (o) { return 'panel_' + o[0]; }))
    },
    {
      title: '대지', items: [
        'newArtboard', 'duplicateArtboard', 'deleteArtboard', '-',
        'artboardOptions', 'rearrangeArtboards', '-',
        'fitArtboardToSelection', 'fitArtboardToArtwork', '-',
        'prevArtboard', 'nextArtboard', 'firstArtboard', 'lastArtboard', '-', 'docSetup'
      ]
    },
    {
      title: '도움말', items: ['shortcutHelp', 'about']
    }
  ];
})(typeof globalThis !== 'undefined' ? globalThis.AI : window.AI);
