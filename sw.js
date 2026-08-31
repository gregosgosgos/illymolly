/* =========================================================================
   sw.js — 서비스 워커 (오프라인 · 앱 설치)
   -------------------------------------------------------------------------
   앱으로 설치했을 때 인터넷 없이도 열리도록, 앱을 이루는 파일을 처음
   방문에서 모두 받아 둔다. 이후에는 캐시에서 바로 내주고 뒤에서 조용히 새
   것을 받아 둔다(stale-while-revalidate) — 켜자마자 뜨고, 다음 실행에
   최신이 반영된다.

   받아 둘 목록은 index.html 을 읽어 그 안의 <script src> · <link href> 에서
   직접 뽑는다. 파일을 더하거나 지워도 이 파일은 손댈 필요가 없다.

   문서 요청(네비게이션)은 네트워크를 먼저 보고, 안 되면 캐시의 index.html
   을 내준다. VERSION 을 올리면 옛 캐시는 activate 에서 지워진다.
   ========================================================================= */
'use strict';

var VERSION = 'illymolly-v1';
var EXTRA = [
  './',
  'index.html',
  'manifest.webmanifest',
  'icons/icon.svg',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/icon-maskable-512.png'
];

/* index.html 에서 같은 출처의 스크립트·스타일 경로를 뽑아낸다 */
function shellList() {
  return fetch(new Request('index.html', { cache: 'reload' })).then(function (res) {
    if (!res || !res.ok) return EXTRA.slice();
    return res.text().then(function (html) {
      var out = EXTRA.slice(), re = /(?:src|href)="([^":]+)"/g, m;
      while ((m = re.exec(html))) {
        var u = m[1];
        if (u.charAt(0) === '#' || u.charAt(0) === '/') continue;
        if (out.indexOf(u) < 0) out.push(u);
      }
      return out;
    });
  }).catch(function () { return EXTRA.slice(); });
}

self.addEventListener('install', function (e) {
  e.waitUntil(Promise.all([caches.open(VERSION), shellList()]).then(function (r) {
    var c = r[0];
    /* 하나가 실패해도 설치는 끝낸다 — 나중에 요청될 때 다시 받는다 */
    return Promise.all(r[1].map(function (u) {
      return c.add(new Request(u, { cache: 'reload' })).catch(function () { });
    }));
  }).then(function () { return self.skipWaiting(); }));
});

self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.map(function (k) {
      return k === VERSION ? null : caches.delete(k);
    }));
  }).then(function () { return self.clients.claim(); }));
});

self.addEventListener('message', function (e) {
  if (e.data === 'skipWaiting') self.skipWaiting();
});

self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') return;
  var url;
  try { url = new URL(req.url); } catch (err) { return; }
  if (url.origin !== self.location.origin) return;

  if (req.mode === 'navigate') {
    e.respondWith(fetch(req).catch(function () {
      return caches.match('index.html').then(function (r) { return r || caches.match('./'); });
    }));
    return;
  }

  e.respondWith(caches.match(req).then(function (hit) {
    var net = fetch(req).then(function (res) {
      if (res && res.ok && res.type === 'basic') {
        var copy = res.clone();
        caches.open(VERSION).then(function (c) { c.put(req, copy); });
      }
      return res;
    }).catch(function () { return hit; });
    return hit || net;
  }));
});
