/* =========================================================================
   pwa.js — 앱으로 설치 · 오프라인
   -------------------------------------------------------------------------
   브라우저 탭 안에서는 Ctrl+1~8 · Ctrl+N · Ctrl+W · Ctrl+Tab 을 브라우저가
   먼저 가져가 버려 앱에 도달하지 않는다. 앱으로 설치해 탭 없는 창(standalone)
   으로 띄우면 탭과 관련된 이 단축키들이 풀려 일러스트레이터와 같은 키를
   그대로 쓸 수 있다. 덤으로 오프라인에서도 열린다.

   여기서는 세 가지만 한다.
     1. 서비스 워커 등록 (오프라인 · 설치 자격)
     2. beforeinstallprompt 를 잡아 두었다가 [파일 > 앱으로 설치] 에서 띄우기
     3. 설치된 창인지 알려 주기 — keymap 이 이 값으로 대체 단축키를 켜고 끈다
   ========================================================================= */
(function (AI) {
  'use strict';
  var U = AI.util;
  var P = AI.pwa = {};

  var deferred = null;      /* beforeinstallprompt 이벤트 — 나중에 띄우려고 잡아 둔다 */
  P.installed = false;      /* 이번 세션에서 설치를 마쳤는가 */
  P.ready = false;          /* 서비스 워커가 살아 있는가 */

  P.standalone = function () { return AI.keymap ? AI.keymap.standalone() : false; };

  /* 설치 버튼을 지금 누를 수 있는가 */
  P.canInstall = function () {
    return !!deferred && !P.standalone();
  };

  /* 왜 못 누르는지 — 메뉴 툴팁과 대화상자에 그대로 쓴다 */
  P.reason = function () {
    if (P.standalone()) return '이미 앱으로 실행 중입니다';
    if (deferred) return '';
    if (!U.hasDOM) return '';
    var ua = navigator.userAgent || '';
    if (/iPhone|iPad|iPod/.test(ua)) return 'Safari 의 [공유 > 홈 화면에 추가] 로 설치할 수 있습니다';
    if (/Firefox/.test(ua)) return 'Firefox 데스크톱은 앱 설치를 지원하지 않습니다 — Chrome · Edge 를 써 주세요';
    if (typeof isSecureContext !== 'undefined' && !isSecureContext) {
      return 'HTTPS 로 접속해야 설치할 수 있습니다';
    }
    return '브라우저 주소창의 설치 아이콘을 눌러 주세요';
  };

  /* 설치 창을 띄운다 — 사용자 제스처 안에서만 동작한다 */
  P.install = function () {
    if (!deferred) { U.toast(P.reason() || '지금은 설치할 수 없습니다'); return Promise.resolve(false); }
    var d = deferred;
    deferred = null;                       /* 한 번 쓰면 다시 못 쓴다 */
    return d.prompt().then(function () {
      return d.userChoice;
    }).then(function (r) {
      var ok = r && r.outcome === 'accepted';
      U.toast(ok ? '설치했습니다 — 앱 창에서는 Ctrl+1~8 · Ctrl+N · Ctrl+W 도 그대로 씁니다'
                 : '설치를 취소했습니다');
      P.sync();
      return ok;
    }).catch(function () { return false; });
  };

  P.sync = function (app) {
    var a = app || AI.app;
    if (a && AI.ui && AI.ui.syncAll) AI.ui.syncAll(a);
  };

  P.init = function (app) {
    if (!U.hasDOM) return;

    U.on(window, 'beforeinstallprompt', function (ev) {
      ev.preventDefault();                 /* 브라우저 기본 배너를 막고 우리가 띄운다 */
      deferred = ev;
      P.sync(app);
    });
    U.on(window, 'appinstalled', function () {
      deferred = null;
      P.installed = true;
      P.sync(app);
    });

    if (!('serviceWorker' in navigator)) return;
    /* file:// 로 연 경우엔 등록이 실패한다 — 조용히 넘긴다 */
    if (location.protocol === 'file:') return;
    navigator.serviceWorker.register('sw.js').then(function () {
      P.ready = true;
    }).catch(function () { });
  };
})(typeof globalThis !== 'undefined' ? globalThis.AI : window.AI);
