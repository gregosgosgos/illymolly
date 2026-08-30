/* =========================================================================
   ui/colorui.js — 색상 선택 팝오버 (HSB)
   ========================================================================= */
(function (AI) {
  'use strict';
  var U = AI.util, Col = AI.color, E = AI.edit;
  var UI = AI.ui = AI.ui || {};

  var pop = null, state = null, appRef = null;

  function build() {
    pop = document.getElementById('colorpop');
    pop.innerHTML =
      '<div class="sv" id="cp-sv"><div class="knob" id="cp-knob"></div></div>' +
      '<div class="hue" id="cp-hue"><div class="hknob" id="cp-hknob"></div></div>' +
      '<div class="row" style="margin-top:8px">' +
      '<div class="prev" id="cp-prev"></div>' +
      '<input class="fld" id="cp-hex" style="flex:1">' +
      '<button class="mini-btn" id="cp-none" title="없음">∅</button>' +
      '</div>' +
      '<div class="grid6" id="cp-sw" style="margin-top:6px"></div>';

    var sw = U.q('#cp-sw', pop);
    Col.SWATCHES.slice(0, 18).forEach(function (hex) {
      var s = U.el('div', 'sw');
      s.style.cssText = 'width:100%;aspect-ratio:1/1;border:1px solid #555;cursor:pointer;background:' + hex;
      U.on(s, 'click', function () { setHex(hex); });
      sw.appendChild(s);
    });

    var svEl = U.q('#cp-sv', pop), hueEl = U.q('#cp-hue', pop);
    drag(svEl, function (px, py, r) {
      state.s = U.clamp(px / r.width, 0, 1);
      state.v = 1 - U.clamp(py / r.height, 0, 1);
      apply();
    });
    drag(hueEl, function (px, py, r) {
      state.h = U.clamp(px / r.width, 0, 1) * 360;
      apply();
    });
    U.on(U.q('#cp-hex', pop), 'keydown', function (ev) { ev.stopPropagation(); if (ev.key === 'Enter') this.blur(); });
    U.on(U.q('#cp-hex', pop), 'change', function () {
      var v = this.value.trim();
      if (v[0] !== '#') v = '#' + v;
      setHex(v);
    });
    U.on(U.q('#cp-none', pop), 'click', function () { AI.commands.run('noneFill'); close(); });
    U.on(document, 'mousedown', function (ev) {
      if (pop.hidden) return;
      if (pop.contains(ev.target)) return;
      if (ev.target.closest && ev.target.closest('.swatch-btn,.fs-fill,.fs-stroke')) return;
      close();
    });
  }

  function drag(el, fn) {
    U.on(el, 'mousedown', function (ev) {
      ev.preventDefault();
      var r = el.getBoundingClientRect();
      var move = function (e) { fn(e.clientX - r.left, e.clientY - r.top, r); };
      move(ev);
      var up = function () { document.removeEventListener('mousemove', move); document.removeEventListener('mouseup', up); };
      document.addEventListener('mousemove', move);
      document.addEventListener('mouseup', up);
    });
  }

  function setHex(hex) {
    var rgb = Col.hexToRgb(hex);
    var hsb = Col.rgbToHsb(rgb.r, rgb.g, rgb.b);
    state.h = hsb.h; state.s = hsb.s; state.v = hsb.b;
    apply();
  }

  function currentHex() {
    var rgb = Col.hsbToRgb(state.h, state.s, state.v);
    return Col.rgbToHex(rgb.r, rgb.g, rgb.b);
  }

  function apply() {
    var hex = currentHex();
    var pure = Col.hsbToRgb(state.h, 1, 1);
    U.q('#cp-sv', pop).style.background =
      'linear-gradient(to top,#000,transparent),linear-gradient(to right,#fff,' + Col.rgbToHex(pure.r, pure.g, pure.b) + ')';
    var k = U.q('#cp-knob', pop);
    k.style.left = (state.s * 100) + '%';
    k.style.top = ((1 - state.v) * 100) + '%';
    U.q('#cp-hknob', pop).style.left = (state.h / 360 * 100) + '%';
    U.q('#cp-prev', pop).style.background = hex;
    var hx = U.q('#cp-hex', pop);
    if (document.activeElement !== hx) hx.value = hex;

    var a = appRef;
    if (a.gradStopEdit) {
      if (!state.began && a.sel.length) { a.history.begin('정지점 색상', a.doc); state.began = true; }
      if (UI.setGradientStopColor(a, hex)) { a.lastColor = hex; return; }
    }
    var paint = Col.solid(hex);
    if (a.fillFocus) a.fill = paint; else a.stroke = paint;
    a.lastColor = hex;
    if (a.sel.length) {
      if (!state.began) { a.history.begin('색상', a.doc); state.began = true; }
      E.applyPaint(a, paint, a.fillFocus ? 'fill' : 'stroke');
    }
    a.invalidate();
    UI.syncStyle(a);
  }

  function close() {
    if (!pop) return;
    if (state && state.began) { appRef.history.commit(); state.began = false; }
    if (appRef) appRef.gradStopEdit = false;
    pop.hidden = true;
  }
  UI.closeColorPicker = close;

  UI.openColorPicker = function (app, anchor) {
    appRef = app;
    if (!pop) build();
    var cur = app.fillFocus ? app.fill : app.stroke;
    var hex = (cur && cur.type === 'solid') ? cur.color : (app.lastColor || '#000000');
    if (app.gradStopEdit) {
      var sw = document.querySelector('#gr-color i');
      if (sw && sw.style.background) {
        var probe = document.createElement('div');
        probe.style.color = sw.style.background;
        document.body.appendChild(probe);
        var m = getComputedStyle(probe).color.match(/\d+/g);
        probe.remove();
        if (m) hex = Col.rgbToHex(+m[0], +m[1], +m[2]);
      }
    }
    var rgb = Col.hexToRgb(hex), hsb = Col.rgbToHsb(rgb.r, rgb.g, rgb.b);
    state = { h: hsb.h, s: hsb.s, v: hsb.b, began: false };
    pop.hidden = false;
    var r = anchor.getBoundingClientRect();
    pop.style.left = Math.min(r.left, innerWidth - 240) + 'px';
    pop.style.top = Math.min(r.bottom + 4, innerHeight - 280) + 'px';
    apply();
  };
})(window.AI);
