/* =========================================================================
   styles.js — 문자 스타일 · 단락 스타일
   -------------------------------------------------------------------------
   일러스트레이터의 [문자 스타일] · [단락 스타일] 패널에 대응한다.
   이름 붙인 서식 묶음을 문서에 저장해 두고 여러 텍스트에 걸어 쓴다.

     doc.charStyles = [ {id, name, attrs:{family,size,weight,italic,tracking}}, … ]
     doc.paraStyles = [ {id, name, attrs:{leading,align}}, … ]
     it.text.charStyle / it.text.paraStyle = 스타일 id

   스타일을 고치면 그 스타일을 쓰는 텍스트에 곧바로 다시 적용된다(라이브).
   텍스트를 직접 고쳐 스타일과 달라지면 재정의(override) 로 보고 패널에 `+`
   를 붙인다 — 일러스트레이터와 같은 규칙이다.
   ========================================================================= */
(function (AI) {
  'use strict';
  var U = AI.util, Model = AI.model;
  var ST = AI.styles = {};

  ST.KEYS = {
    char: ['family', 'size', 'weight', 'italic', 'tracking'],
    para: ['leading', 'align']
  };
  ST.LABEL = { char: '문자 스타일', para: '단락 스타일' };
  var FIELD = { char: 'charStyle', para: 'paraStyle' };
  var LIST = { char: 'charStyles', para: 'paraStyles' };

  ST.field = function (kind) { return FIELD[kind]; };

  ST.list = function (doc, kind) {
    if (!doc) return [];
    return doc[LIST[kind]] || (doc[LIST[kind]] = []);
  };

  ST.find = function (doc, kind, key) {
    if (key == null) return null;
    var list = ST.list(doc, kind);
    for (var i = 0; i < list.length; i++) {
      if (list[i].id === key || list[i].name === key) return list[i];
    }
    return null;
  };

  /* 텍스트의 현재 서식에서 스타일 속성만 뽑아낸다 */
  ST.attrsFrom = function (kind, t) {
    var o = {};
    ST.KEYS[kind].forEach(function (k) { if (t[k] !== undefined) o[k] = t[k]; });
    return o;
  };

  ST.create = function (doc, kind, name, attrs) {
    var list = ST.list(doc, kind);
    var base = name || (kind === 'char' ? '문자 스타일' : '단락 스타일');
    var nm = base, n = 1;
    while (list.some(function (s) { return s.name === nm; })) nm = base + ' ' + (++n);
    var st = { id: U.uid(kind === 'char' ? 'CS' : 'PS'), name: nm, attrs: attrs || {} };
    list.push(st);
    return st;
  };

  ST.remove = function (doc, kind, st) {
    var list = ST.list(doc, kind);
    var i = list.indexOf(st);
    if (i < 0) return false;
    list.splice(i, 1);
    /* 연결만 끊는다 — 텍스트의 서식은 그대로 둔다 (일러스트레이터와 같다) */
    ST.textsUsing(doc, kind, st.id).forEach(function (it) { delete it.text[FIELD[kind]]; });
    return true;
  };

  ST.textsUsing = function (doc, kind, id) {
    var out = [];
    Model.walk(doc, function (it) {
      if (it.type === 'text' && it.text && it.text[FIELD[kind]] === id) out.push(it);
    });
    return out;
  };

  /* 스타일을 텍스트에 건다 (속성 복사 + 연결) */
  ST.applyTo = function (it, kind, st) {
    if (!it || it.type !== 'text' || !st) return false;
    ST.KEYS[kind].forEach(function (k) {
      if (st.attrs[k] !== undefined) it.text[k] = st.attrs[k];
    });
    it.text[FIELD[kind]] = st.id;
    return true;
  };

  /* 스타일을 고친 뒤 — 이 스타일을 쓰는 모든 텍스트에 다시 적용 */
  ST.sync = function (doc, kind, st) {
    var n = 0;
    ST.textsUsing(doc, kind, st.id).forEach(function (it) {
      ST.KEYS[kind].forEach(function (k) {
        if (st.attrs[k] !== undefined) it.text[k] = st.attrs[k];
      });
      n++;
    });
    return n;
  };

  /* 지금 텍스트의 서식을 스타일의 새 정의로 삼는다 (스타일 재정의) */
  ST.redefine = function (doc, kind, st, it) {
    st.attrs = ST.attrsFrom(kind, it.text);
    return ST.sync(doc, kind, st);
  };

  ST.unlink = function (it, kind) {
    if (!it || it.type !== 'text') return false;
    if (it.text[FIELD[kind]] == null) return false;
    delete it.text[FIELD[kind]];
    return true;
  };

  /* 텍스트가 걸린 스타일과 달라졌는가 (패널의 `+` 표시) */
  ST.hasOverride = function (doc, it, kind) {
    if (!it || it.type !== 'text') return false;
    var st = ST.find(doc, kind, it.text[FIELD[kind]]);
    if (!st) return false;
    return ST.KEYS[kind].some(function (k) {
      return st.attrs[k] !== undefined && it.text[k] !== st.attrs[k];
    });
  };

  ST.styleOf = function (doc, it, kind) {
    if (!it || it.type !== 'text') return null;
    return ST.find(doc, kind, it.text[FIELD[kind]]);
  };

  /* 사람이 읽을 요약 (패널 두 번째 줄) */
  ST.summary = function (kind, st) {
    var a = st.attrs || {};
    if (kind === 'char') {
      var f = String(a.family || '').split(',')[0];
      return [f, a.size != null ? U.fmt(a.size) + 'pt' : null,
        a.weight && a.weight !== 400 ? a.weight : null,
        a.italic ? '기울임' : null,
        a.tracking ? '자간 ' + U.fmt(a.tracking) : null].filter(Boolean).join(' · ');
    }
    var AL = { left: '왼쪽', center: '가운데', right: '오른쪽' };
    return [a.leading != null ? '행간 ' + U.fmt(a.leading) : null,
      a.align ? AL[a.align] || a.align : null].filter(Boolean).join(' · ');
  };

  /* 오래된 문서 보정 */
  ST.normalize = function (doc) {
    ST.list(doc, 'char');
    ST.list(doc, 'para');
  };
})(typeof globalThis !== 'undefined' ? globalThis.AI : window.AI);
