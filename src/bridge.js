/* =========================================================================
   bridge.js — 원격 제어 브리지 (postMessage RPC)
   -------------------------------------------------------------------------
   Illymolly 를 iframe 으로 임베드한 호스트(또는 에이전트 런타임)가
   창 밖에서 API 를 호출할 수 있게 한다.

     iframe.contentWindow.postMessage(
       { illy: 1, id: 'req-1', op: 'addRect', args: {x:0,y:0,width:100,height:100} }, '*');

     window.addEventListener('message', e => {
       if (e.data && e.data.illy === 1 && e.data.response) console.log(e.data.response);
     });

   op 특수값:
     '__batch'    args = [{op,args},…]   원자적 실행
     '__ops'      도구 매니페스트
     '__ping'     연결 확인
   ========================================================================= */
(function (AI) {
  'use strict';
  var B = AI.bridge = {};
  var allow = null;              /* null = 모든 오리진 허용 */
  var bound = false;

  B.setAllowedOrigins = function (list) { allow = list && list.length ? list.slice() : null; };

  B.install = function (illy, win) {
    if (bound) return;
    bound = true;
    var w = win || window;
    w.addEventListener('message', function (ev) {
      var d = ev.data;
      if (!d || d.illy !== 1 || d.response) return;
      if (allow && allow.indexOf(ev.origin) < 0) return;
      var res;
      try {
        if (d.op === '__ping') res = { ok: true, result: { version: illy.version, ready: true } };
        else if (d.op === '__ops') res = { ok: true, result: illy.ops(d.args && d.args.group) };
        else if (d.op === '__batch') res = illy.batch(d.args, d.label);
        else res = illy.run(d.op, d.args);
      } catch (e) {
        res = { ok: false, error: { code: e.code || 'ERROR', message: e.message } };
      }
      var target = ev.source || w.parent;
      if (target && target.postMessage) {
        target.postMessage({ illy: 1, id: d.id, response: res }, ev.origin && ev.origin !== 'null' ? ev.origin : '*');
      }
    });
    /* 호스트에게 준비 완료를 알린다 */
    try {
      if (w.parent && w.parent !== w) {
        w.parent.postMessage({ illy: 1, event: 'ready', version: illy.version }, '*');
      }
    } catch (e) { /* 크로스 오리진 */ }
  };
})(typeof globalThis !== 'undefined' ? globalThis.AI : window.AI);
