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

  /* ================= 파일 ================= */
  def('new', '새로 만들기...', 'Ctrl+N', function (a) { AI.dialogs.newDocument(a); });
  def('open', '열기...', 'Ctrl+O', function (a) { AI.io.openFile(a); });
  def('save', '저장', 'Ctrl+S', function (a) { AI.io.save(a); });
  def('saveAs', '다른 이름으로 저장...', 'Ctrl+Shift+S', function (a) { AI.io.save(a, true); });
  def('place', '가져오기(이미지)...', 'Ctrl+Shift+P', function (a) { AI.io.placeImage(a); });
  def('exportSvg', 'SVG로 내보내기...', 'Ctrl+Shift+E', function (a) { AI.io.exportSVG(a); });
  def('exportPng', 'PNG로 내보내기...', 'Ctrl+Alt+E', function (a) { AI.io.exportPNG(a); });
  def('docSetup', '문서 설정...', 'Ctrl+Alt+P', function (a) { AI.dialogs.documentSetup(a); });
  def('preferences', '환경 설정...', 'Ctrl+K', function (a) { AI.dialogs.preferences(a); });

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
  def('cut', '오려두기', 'Ctrl+X', hist('오려두기', function (a) {
    if (!a.sel.length) return false;
    C.clipboard = a.sel.map(function (it) { return U.deepCopy(it); });
    E.remove(a);
  }), { enabled: hasSel });
  def('copy', '복사', 'Ctrl+C', function (a) {
    if (!a.sel.length) return;
    C.clipboard = a.sel.map(function (it) {
      var c = U.deepCopy(it);
      c.m = M.mul(Model.worldMatrix(a.doc, it), M.ident());
      return c;
    });
    U.toast(a.sel.length + '개 복사됨');
  }, { enabled: hasSel });
  function doPaste(a, mode) {
    if (!C.clipboard || !C.clipboard.length) { U.toast('붙여넣을 항목이 없습니다'); return false; }
    var layer = Model.activeLayer(a.doc);
    var items = C.clipboard.map(function (it) { return E.cloneItem(it); });
    var r = R.empty();
    items.forEach(function (it) {
      var b = Rn.xformBounds(Rn.localBounds(it), it.m);
      r = R.union(r, b);
    });
    var dx = 0, dy = 0;
    if (mode === 'center') {
      var c = AI.viewT.toDoc(a, a.canvas.clientWidth / 2, a.canvas.clientHeight / 2);
      dx = c.x - R.cx(r); dy = c.y - R.cy(r);
    }
    items.forEach(function (it) { it.m = M.mul(M.translate(dx, dy), it.m); });
    if (mode === 'front') layer.children = layer.children.concat(items);
    else if (mode === 'back') layer.children = items.concat(layer.children);
    else layer.children = layer.children.concat(items);
    AI.sel.set(a, items);
  }
  def('paste', '붙이기', 'Ctrl+V', hist('붙이기', function (a) { return doPaste(a, 'center'); }));
  def('pasteFront', '앞에 붙이기', 'Ctrl+F', hist('앞에 붙이기', function (a) { return doPaste(a, 'front'); }));
  def('pasteBack', '뒤에 붙이기', 'Ctrl+B', hist('뒤에 붙이기', function (a) { return doPaste(a, 'back'); }));
  def('pasteInPlace', '제자리에 붙이기', 'Ctrl+Shift+V', hist('제자리에 붙이기', function (a) { return doPaste(a, 'place'); }));
  def('clear', '지우기', 'Delete', hist('삭제', function (a) {
    if (a.selPts.length && T.current(a) && T.current(a).direct) { E.deleteAnchors(a); return; }
    if (!a.sel.length) return false;
    E.remove(a);
  }));
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
  def('selectSameFill', '같은 칠 색상', null, function (a) {
    if (!a.sel.length) return;
    var k = paintKey(a.sel[0].fill), found = [];
    Model.walk(a.doc, function (it) { if (it.type !== 'group' && paintKey(it.fill) === k) found.push(it); });
    AI.sel.set(a, found);
  }, { enabled: hasSel });
  def('selectSameStroke', '같은 획 색상', null, function (a) {
    if (!a.sel.length) return;
    var k = paintKey(a.sel[0].stroke), found = [];
    Model.walk(a.doc, function (it) { if (it.type !== 'group' && paintKey(it.stroke) === k) found.push(it); });
    AI.sel.set(a, found);
  }, { enabled: hasSel });
  function paintKey(p) { return p ? (p.type + ':' + (p.color || '')) : 'none'; }

  /* ================= 오브젝트 ================= */
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
  def('ungroup', '그룹 풀기', 'Ctrl+Shift+G', hist('그룹 풀기', function (a) {
    if (!a.sel.some(function (i) { return i.type === 'group'; })) return false;
    E.ungroup(a);
  }));
  def('lock', '잠금', 'Ctrl+2', hist('잠금', function (a) { if (!a.sel.length) return false; E.lock(a); }), { enabled: hasSel });
  def('unlockAll', '모두 잠금 해제', 'Ctrl+Alt+2', hist('잠금 해제', function (a) { E.unlockAll(a); }));
  def('hide', '숨기기', 'Ctrl+3', hist('숨기기', function (a) { if (!a.sel.length) return false; E.hide(a); }), { enabled: hasSel });
  def('showAll', '모두 표시', 'Ctrl+Alt+3', hist('모두 표시', function (a) { E.showAll(a); }));

  def('clipMake', '클리핑 마스크 만들기', 'Ctrl+7', hist('클리핑 마스크', function (a) { if (a.sel.length < 2) return false; E.makeClipMask(a); }));
  def('clipRelease', '클리핑 마스크 해제', 'Ctrl+Alt+7', hist('마스크 해제', function (a) { E.releaseClipMask(a); }));

  def('compoundMake', '컴파운드 패스 만들기', 'Ctrl+8', hist('컴파운드 패스', function (a) {
    var paths = a.sel.filter(function (i) { return i.type === 'path'; });
    if (paths.length < 2) return false;
    var base = paths[paths.length - 1];
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
  }));

  def('joinPath', '연결', 'Ctrl+J', hist('연결', function (a) { return E.joinPath(a); }));
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
  def('createOutlines', '윤곽선 만들기', 'Ctrl+Shift+O', function (a) {
    U.toast('텍스트 윤곽선 변환은 지원되지 않습니다 (브라우저 글꼴 제약)');
  });

  /* ================= 보기 ================= */
  def('outlineMode', '윤곽선 보기', 'Ctrl+Y', function (a) { a.prefs.outline = !a.prefs.outline; }, { checked: function (a) { return a.prefs.outline; } });
  def('zoomIn', '확대', 'Ctrl+=', function (a) { AI.viewT.zoomStep(a, 1); });
  def('zoomOut', '축소', 'Ctrl+-', function (a) { AI.viewT.zoomStep(a, -1); });
  def('fitArtboard', '대지에 맞추기', 'Ctrl+0', function (a) { AI.viewT.fitArtboard(a); });
  def('fitAll', '전체 대지 맞추기', 'Ctrl+Alt+0', function (a) { AI.viewT.fitAll(a); });
  def('actualSize', '실제 크기', 'Ctrl+1', function (a) { AI.viewT.setZoom(a, 1); });
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
      title: '파일', items: ['new', 'open', '-', 'save', 'saveAs', '-', 'place', '-', 'exportSvg', 'exportPng', '-', 'docSetup']
    },
    {
      title: '편집', items: ['undo', 'redo', '-', 'cut', 'copy', 'paste', 'pasteFront', 'pasteBack', 'pasteInPlace', '-', 'clear', 'duplicate', '-', 'preferences']
    },
    {
      title: '오브젝트', items: [
        'transformAgain', 'moveDialog', 'rotateDialog', 'scaleDialog', 'reflectDialog', 'shearDialog', '-',
        'reflectH', 'reflectV', '-',
        'bringToFront', 'bringForward', 'sendBackward', 'sendToBack', '-',
        'group', 'ungroup', '-', 'lock', 'unlockAll', 'hide', 'showAll', '-',
        'clipMake', 'clipRelease', '-', 'compoundMake', 'compoundRelease', '-',
        'joinPath', 'averagePath', '-',
        'pf_unite', 'pf_minusFront', 'pf_intersect', 'pf_exclude', 'pf_divide', 'pf_trim', 'pf_crop', 'pf_outline'
      ]
    },
    { title: '문자', items: ['fontBigger', 'fontSmaller', '-', 'createOutlines'] },
    { title: '선택', items: ['selectAll', 'deselectAll', 'reselect', 'selectInverse', '-', 'selectSameFill', 'selectSameStroke'] },
    {
      title: '보기', items: [
        'outlineMode', '-', 'zoomIn', 'zoomOut', 'fitArtboard', 'fitAll', 'actualSize', '-',
        'hideEdges', 'showBBox', '-', 'showRulers', 'showGrid', 'snapGrid', 'smartGuides', '-',
        'showGuides', 'makeGuides', 'clearGuides'
      ]
    },
    { title: '윈도우', items: ['togglePanels', 'togglePanelsKeepTools'] },
    { title: '대지', items: ['newArtboard', 'deleteArtboard', '-', 'prevArtboard', 'nextArtboard', 'firstArtboard', 'lastArtboard', '-', 'docSetup'] },
    { title: '도움말', items: ['shortcutHelp', 'about'] }
  ];
})(typeof globalThis !== 'undefined' ? globalThis.AI : window.AI);
