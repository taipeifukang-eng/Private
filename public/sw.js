const CACHE_NAME = 'fk-elite-v1';

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

  // 只處理 GET 請求
  if (request.method !== 'GET') return;

  // 跳過 Supabase API 和認證相關請求
  if (
    request.url.includes('supabase.co') ||
    request.url.includes('/auth/') ||
    request.url.includes('/api/')
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
            caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
          }
          return response;
        });
      })
    );
    return;
  }

  // 頁面和其他資源使用 Network First 策略
  event.respondWith(
    fetch(request)
      .then((response) => {
        if (response.ok) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
        }
        return response;
      })
      .catch(() => {
        return caches.match(request).then((cached) => {
          if (cached) return cached;
          // 離線時導回首頁快取
          if (request.mode === 'navigate') {
            return caches.match('/');
          }
          return new Response('Offline', { status: 503 });
        });
      })
  );
});
