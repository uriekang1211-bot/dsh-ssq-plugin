/* 双色球助手 · 移动版 Service Worker：同源资源缓存优先，离线可用 */
const CACHE = "ssq-mobile-v1";

self.addEventListener("install", (e) => {
  self.skipWaiting();
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  if (e.request.method !== "GET") return;
  const url = new URL(e.request.url);
  if (url.origin !== location.origin) return; // 跨域（在线更新数据源）不拦截
  e.respondWith(
    caches.open(CACHE).then(async (cache) => {
      const cached = await cache.match(e.request);
      if (cached) return cached;
      const resp = await fetch(e.request);
      if (resp.ok) cache.put(e.request, resp.clone());
      return resp;
    }).catch(() => caches.match(e.request))
  );
});
