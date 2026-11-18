/* 人设聊天室（本机版）Service Worker（契约 34）
 * 缓存应用外壳（同源 GET cache-first + 网络更新）；跨域（DeepSeek API）直连不缓存。
 * 版本常量：外壳文件变化时递增，旧缓存自动清理。 */
'use strict';

var CACHE_VERSION = 'pcl-shell-v1';
var PRECACHE = [
  './',
  './index.html',
  './manifest.webmanifest',
  './tutorial.md',
  './css/style.css',
  './js/app.js',
  './js/store.js',
  './js/time.js',
  './js/ios-hint.js',
  './js/local-store.js',
  './js/local-api.js',
  './js/markdown.js',
  './js/router.js',
  './js/components/toast.js',
  './js/components/topbar.js',
  './js/components/tutorial.js',
  './js/views/setup.js',
  './js/views/login.js',
  './js/views/chat.js',
  './js/views/personas.js',
  './js/views/import.js',
  './js/views/settings.js',
  './js/views/admin.js',
  './vendor/vue.global.prod.js',
  './vendor/marked.umd.js',
  './vendor/purify.min.js',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon-180.png',
];

self.addEventListener('install', function (event) {
  event.waitUntil(
    caches.open(CACHE_VERSION)
      .then(function (cache) { return cache.addAll(PRECACHE); })
      .then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.map(function (key) {
        if (key !== CACHE_VERSION) return caches.delete(key);
        return null;
      }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function (event) {
  var req = event.request;
  if (req.method !== 'GET') return; // 非 GET 不处理

  var url;
  try { url = new URL(req.url); } catch (e) { return; }

  // 跨域（如 api.deepseek.com）直连网络，不缓存
  if (url.origin !== self.location.origin) {
    return;
  }

  // 同源 GET：cache-first + 网络更新
  event.respondWith(
    caches.match(req).then(function (cached) {
      var network = fetch(req).then(function (res) {
        if (res && res.status === 200) {
          var copy = res.clone();
          caches.open(CACHE_VERSION).then(function (cache) { cache.put(req, copy); });
        }
        return res;
      }).catch(function () {
        return cached;
      });
      return cached || network;
    })
  );
});
