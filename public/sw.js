const CACHE_NAME = 'fk-elite-v2';

// 預快取的核心資源
const PRECACHE_URLS = [
  '/',
  '/manifest.json',
];

// 安裝：預快取核心資源
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(PRECACHE_URLS);
    })
  );
  // 立即接管，不等待舊 SW 退出
  self.skipWaiting();
});

// 啟動：清理舊版本快取
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames
          .filter((name) => name !== CACHE_NAME)
          .map((name) => caches.delete(name))
      );
    })
  );
  // 立即控制所有頁面
  self.clients.claim();
});

// 攔截請求：Network First 策略（適合動態管理系統）
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // 只處理 GET 請求
  if (request.method !== 'GET') return;

  // 只處理同源 http(s) 靜態資源；頁面、API、Next RSC 請求全部交給瀏覽器網路流程。
  if (url.origin !== self.location.origin || !['http:', 'https:'].includes(url.protocol)) {
    return;
  }

  // 跳過 Supabase API、認證、API、Next 動態/RSC 請求
  if (
    request.url.includes('supabase.co') ||
    request.url.includes('/auth/') ||
    request.url.includes('/api/') ||
    request.headers.get('RSC') === '1' ||
    request.headers.has('Next-Router-State-Tree') ||
    request.mode === 'navigate'
  ) {
    return;
  }

  // 靜態資源使用 Cache First 策略
  if (
    request.url.includes('/_next/static/') ||
    request.url.includes('/icons/') ||
    request.url.match(/\.(png|jpg|jpeg|svg|gif|ico|woff2?|ttf)$/)
  ) {
    event.respondWith(
      caches.match(request).then((cached) => {
        if (cached) return cached;
        return fetch(request).then((response) => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME)
              .then((cache) => cache.put(request, clone))
              .catch(() => {});
          }
          return response;
        }).catch(() => {
          return new Response('Offline', { status: 503 });
        });
      })
    );
    return;
  }
});
