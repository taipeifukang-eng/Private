'use client';

import { useEffect } from 'react';

export default function PWARegister() {
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;

    const isProduction = process.env.NODE_ENV === 'production';

    // 開發模式：避免快取舊版 /_next/static 造成 hydration mismatch。
    if (!isProduction) {
      navigator.serviceWorker.getRegistrations().then((registrations) => {
        registrations.forEach((registration) => registration.unregister());
      });

      if ('caches' in window) {
        caches.keys().then((keys) => {
          keys.forEach((key) => caches.delete(key));
        });
      }

      return;
    }

    navigator.serviceWorker
      .register('/sw.js')
      .then((registration) => {
        console.log('SW registered:', registration.scope);
      })
      .catch((err) => {
        console.log('SW registration failed:', err);
      });
  }, []);

  return null;
}
