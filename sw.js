/* 环线 SILKLOOP Service Worker
   策略（与站点静态导出、Cloudflare 缓存头协同）：
   - 页面 HTML：网络优先（保证内容新鲜），断网回退到缓存副本——看过的页面离线可查
   - /_next/static、/icons：内容哈希/极少变动，缓存优先
   - /images：缓存优先 + 条目上限（hero/抠图体积大，防止无限占用手机存储）
   - 跨域请求（天气/汇率/统计）一律不拦截
   版本号变更即整体换缓存；sw.js 本身经 _headers 设 no-cache，更新可及时下发 */
const VERSION = "silkloop-v1";
const PAGE_CACHE = `${VERSION}-pages`;
const ASSET_CACHE = `${VERSION}-assets`;
const IMAGE_CACHE = `${VERSION}-images`;
const IMAGE_LIMIT = 400;

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(PAGE_CACHE).then((c) => c.addAll(["/"])).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => !k.startsWith(VERSION)).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

async function trimCache(name, limit) {
  const cache = await caches.open(name);
  const keys = await cache.keys();
  if (keys.length > limit) await cache.delete(keys[0]).then(() => trimCache(name, limit));
}

async function networkFirst(req, cacheName) {
  const cache = await caches.open(cacheName);
  try {
    const res = await fetch(req);
    if (res.ok) cache.put(req, res.clone());
    return res;
  } catch {
    const hit = await cache.match(req);
    if (hit) return hit;
    // 未缓存过的页面断网时回退首页（好过浏览器错误页）
    return (await cache.match("/")) || Response.error();
  }
}

async function cacheFirst(req, cacheName, limit) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok) {
    cache.put(req, res.clone());
    if (limit) trimCache(cacheName, limit);
  }
  return res;
}

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // 天气/汇率/统计等第三方直连

  if (req.mode === "navigate") {
    e.respondWith(networkFirst(req, PAGE_CACHE));
  } else if (url.pathname.startsWith("/_next/static/") || url.pathname.startsWith("/icons/")) {
    e.respondWith(cacheFirst(req, ASSET_CACHE));
  } else if (url.pathname.startsWith("/images/")) {
    e.respondWith(cacheFirst(req, IMAGE_CACHE, IMAGE_LIMIT));
  } else if (url.pathname.endsWith(".json") || url.pathname.startsWith("/data/")) {
    e.respondWith(networkFirst(req, ASSET_CACHE));
  }
});
