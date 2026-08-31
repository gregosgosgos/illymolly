/* =========================================================================
   ui/dialog.js — Illustrator 스타일 모달 대화상자
   -------------------------------------------------------------------------
   AI.dialog.open({
     title, fields:[{id,label,type,value,unit,options,min,max,step,width}],
     buttons:[{id,label,primary}], onChange(values, changedId, api),
     onDone(values, buttonId), onCancel()
   })
   type: 'num' | 'text' | 'check' | 'select' | 'radio' | 'color' | 'info' | 'sep' | 'ref'
   ========================================================================= */
(function (AI) {
  'use strict';
  var U = AI.util;
  var D = AI.dialog = {};
  var cur = null;

  D.isOpen = function () { return !!cur; };

  function fieldEl(f, api) {
    if (f.type === 'sep') return U.el('div', 'dlg-sep');
    if (f.type === 'info') {
      var i = U.el('div', 'dlg-info');
      i.textContent = f.label;
      return i;
    }
    /* 표처럼 직접 짠 내용을 넣을 자리 (단축키 목록 등) */
    if (f.type === 'html') {
      var h = U.el('div', 'dlg-html' + (f.cls ? ' ' + f.cls : ''));
      h.innerHTML = f.html || '';
      return h;
    }
    var row = U.el('div', 'dlg-row');
    if (f.type === 'check') {
      var lab = U.el('label', 'dlg-check');
      var cb = U.el('input');
      cb.type = 'checkbox'; cb.checked = !!f.value; cb.id = 'dlgf-' + f.id;
      lab.appendChild(cb);
      lab.appendChild(document.createTextNode(' ' + f.label));
      row.appendChild(lab);
      U.on(cb, 'change', function () { api.changed(f.id); });
      return row;
    }
    if (f.type === 'radio') {
      row.appendChild(U.el('span', 'dlg-label', f.label || ''));
      var wrap = U.el('div', 'dlg-radios');
      f.options.forEach(function (o) {
        var l = U.el('label', 'dlg-check');
        var r = U.el('input');
        r.type = 'radio'; r.name = 'dlgf-' + f.id; r.value = o[0];
        r.checked = (o[0] === f.value);
        l.appendChild(r);
        l.appendChild(document.createTextNode(' ' + o[1]));
        wrap.appendChild(l);
        U.on(r, 'change', function () { api.changed(f.id); });
      });
      row.appendChild(wrap);
      return row;
    }
    if (f.type === 'ref') {
      row.appendChild(U.el('span', 'dlg-label', f.label || '기준점'));
      var grid = U.el('div', 'refpoint');
      grid.id = 'dlgf-' + f.id;
      for (var i2 = 0; i2 < 9; i2++) {
        var d = U.el('div', 'rp' + (i2 === (f.value == null ? 4 : f.value) ? ' on' : ''));
        d.dataset.i = i2;
        grid.appendChild(d);
      }
      U.on(grid, 'click', function (ev) {
        if (!ev.target.dataset.i) return;
        U.qa('.rp', grid).forEach(function (x) { x.classList.remove('on'); });
        ev.target.classList.add('on');
        api.changed(f.id);
      });
      row.appendChild(grid);
      return row;
    }
    row.appendChild(U.el('span', 'dlg-label', f.label));
    if (f.type === 'color') {
      var ci = U.el('input', 'dlg-color');
      ci.type = 'color';
      ci.id = 'dlgf-' + f.id;
      ci.value = f.value || '#000000';
      row.appendChild(ci);
      U.on(ci, 'input', function () { api.changed(f.id); });
      U.on(ci, 'change', function () { api.changed(f.id); });
      return row;
    }
    if (f.type === 'select') {
      var sel = U.el('select', 'dlg-input');
      sel.id = 'dlgf-' + f.id;
      f.options.forEach(function (o) {
        var op = U.el('option');
        op.value = o[0]; op.textContent = o[1];
        if (String(o[0]) === String(f.value)) op.selected = true;
        sel.appendChild(op);
      });
      if (f.width) sel.style.width = f.width + 'px';
      row.appendChild(sel);
      U.on(sel, 'change', function () { api.changed(f.id); });
      return row;
    }
    var inp = U.el('input', 'dlg-input');
    inp.id = 'dlgf-' + f.id;
    inp.value = f.type === 'num' ? U.fmt(f.value == null ? 0 : f.value) : (f.value == null ? '' : f.value);
    inp.style.width = (f.width || 76) + 'px';
    row.appendChild(inp);
    if (f.unit) row.appendChild(U.el('span', 'dlg-unit', f.unit));
    var fire = function () { api.changed(f.id); };
    U.on(inp, 'change', fire);
    U.on(inp, 'keydown', function (ev) {
      ev.stopPropagation();
      if (ev.key === 'ArrowUp' || ev.key === 'ArrowDown') {
        ev.preventDefault();
        var step = (f.step || 1) * (ev.shiftKey ? 10 : 1);
        inp.value = U.fmt(U.parseNum(inp.value, 0) + (ev.key === 'ArrowUp' ? step : -step));
        fire();
      }
    });
    return row;
  }

  D.open = function (opts) {
    D.close(true);
    var fields = (opts.fields || []).filter(Boolean);
    var buttons = opts.buttons || [{ id: 'cancel', label: '취소' }, { id: 'ok', label: '확인', primary: true }];

    var back = U.el('div', 'dlg-backdrop');
    var box = U.el('div', 'dlg');
    box.appendChild(U.el('div', 'dlg-title', opts.title || ''));
    var body = U.el('div', 'dlg-body');
    box.appendChild(body);

    var api = {
      values: function () { return read(); },
      set: function (id, v) {
        var radio = document.querySelector('input[name="dlgf-' + id + '"][value="' + v + '"]');
        if (radio) { radio.checked = true; return; }
        var el = document.getElementById('dlgf-' + id);
        if (!el) return;
        if (el.type === 'checkbox') el.checked = !!v;
        else if (el.classList.contains('refpoint')) {
          U.qa('.rp', el).forEach(function (x, i) { x.classList.toggle('on', i === v); });
        } else if (document.activeElement !== el) el.value = (typeof v === 'number') ? U.fmt(v) : v;
      },
      close: function () { D.close(); },
      changed: function (id) { onChange(id); }
    };

    fields.forEach(function (f) { body.appendChild(fieldEl(f, api)); });

    var foot = U.el('div', 'dlg-foot');
    var right = U.el('div', 'dlg-buttons');
    buttons.forEach(function (b) {
      var btn = U.el('button', 'dlg-btn' + (b.primary ? ' primary' : ''), b.label);
      U.on(btn, 'click', function () { done(b.id); });
      right.appendChild(btn);
    });
    foot.appendChild(right);
    box.appendChild(foot);
    back.appendChild(box);
    document.body.appendChild(back);

    function read() {
      var v = {};
      fields.forEach(function (f) {
        if (!f.id) return;
        if (f.type === 'radio') {
          var r = document.querySelector('input[name="dlgf-' + f.id + '"]:checked');
          v[f.id] = r ? r.value : f.value;
          return;
        }
        var el = document.getElementById('dlgf-' + f.id);
        if (!el) { v[f.id] = f.value; return; }
        if (f.type === 'check') v[f.id] = el.checked;
        else if (f.type === 'ref') {
          var on = el.querySelector('.rp.on');
          v[f.id] = on ? +on.dataset.i : 4;
        } else if (f.type === 'num') v[f.id] = U.parseNum(el.value, f.value || 0);
        else v[f.id] = el.value;
      });
      return v;
    }

    function onChange(id) {
      if (opts.onChange) opts.onChange(read(), id, api);
    }
    function done(id) {
      var b = buttons.filter(function (x) { return x.id === id; })[0];
      var vals = read();
      D.close(true);
      if (id === 'cancel') { if (opts.onCancel) opts.onCancel(); return; }
      if (opts.onDone) opts.onDone(vals, id);
    }

    cur = {
      back: back,
      key: function (ev) {
        ev.stopPropagation();
        if (ev.key === 'Escape') { ev.preventDefault(); done('cancel'); }
        else if (ev.key === 'Enter') {
          ev.preventDefault();
          var prim = buttons.filter(function (b) { return b.primary; })[0] || buttons[0];
          done(prim.id);
        }
      },
      cancel: function () { done('cancel'); }
    };
    document.addEventListener('keydown', cur.key, true);
    U.on(back, 'mousedown', function (ev) { if (ev.target === back) done('cancel'); });

    var first = box.querySelector('input:not([type=checkbox]):not([type=radio]):not([type=color]), select');
    if (first) { first.focus(); if (first.select) first.select(); }
    if (opts.onChange) opts.onChange(read(), null, api);
    return api;
  };

  D.close = function (silent) {
    if (!cur) return;
    document.removeEventListener('keydown', cur.key, true);
    cur.back.remove();
    var c = cur;
    cur = null;
    if (!silent && c.onCancel) c.onCancel();
  };
})(typeof globalThis !== 'undefined' ? globalThis.AI : window.AI);
