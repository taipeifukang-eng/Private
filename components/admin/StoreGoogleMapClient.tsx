'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { ExternalLink, LocateFixed, MapPin, Search } from 'lucide-react';

type StoreMapRow = {
  id: string;
  store_code: string;
  store_name: string;
  short_name: string | null;
  address: string | null;
  phone: string | null;
  is_active: boolean;
  gps_latitude: number | string | null;
  gps_longitude: number | string | null;
};

type Props = {
  stores: StoreMapRow[];
  googleMapsApiKey: string;
};

declare global {
  interface Window {
    __fukangGoogleMapsPromise?: Promise<any>;
    google?: any;
  }
}

function toCoordinate(value: number | string | null | undefined) {
  if (value === null || value === undefined || value === '') return null;
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : null;
}

function hasGps(store: StoreMapRow) {
  const lat = toCoordinate(store.gps_latitude);
  const lng = toCoordinate(store.gps_longitude);
  return lat !== null && lng !== null && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180;
}

function storeLabel(store: StoreMapRow) {
  return `${store.store_code} ${store.short_name || store.store_name}`;
}

function mapsSearchUrl(store: StoreMapRow) {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${store.gps_latitude},${store.gps_longitude}`)}`;
}

function loadGoogleMapsScript(apiKey: string) {
  if (window.google?.maps) return Promise.resolve(window.google.maps);
  if (window.__fukangGoogleMapsPromise) return window.__fukangGoogleMapsPromise;

  window.__fukangGoogleMapsPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(apiKey)}&language=zh-TW&region=TW`;
    script.async = true;
    script.defer = true;
    script.onload = () => resolve(window.google.maps);
    script.onerror = () => reject(new Error('Google Maps 載入失敗，請確認 API Key 與網站限制。'));
    document.head.appendChild(script);
  });

  return window.__fukangGoogleMapsPromise;
}

export default function StoreGoogleMapClient({ stores, googleMapsApiKey }: Props) {
  const mapRef = useRef<HTMLDivElement | null>(null);
  const googleMapRef = useRef<any>(null);
  const infoWindowRef = useRef<any>(null);
  const markersRef = useRef<Map<string, any>>(new Map());
  const [search, setSearch] = useState('');
  const [selectedStoreId, setSelectedStoreId] = useState<string>(stores.find(hasGps)?.id || '');
  const [mapStatus, setMapStatus] = useState('');
  const [mapError, setMapError] = useState('');

  const storesWithGps = useMemo(() => stores.filter(hasGps), [stores]);
  const storesWithoutGps = stores.length - storesWithGps.length;
  const filteredStores = useMemo(() => {
    const keyword = search.trim().toLowerCase();
    if (!keyword) return storesWithGps;
    return storesWithGps.filter((store) => [
      store.store_code,
      store.store_name,
      store.short_name,
      store.address,
      store.phone,
    ].some((value) => String(value || '').toLowerCase().includes(keyword)));
  }, [search, storesWithGps]);

  useEffect(() => {
    if (!googleMapsApiKey) {
      setMapError('尚未設定 Google Maps API Key，請設定 NEXT_PUBLIC_GOOGLE_MAPS_API_KEY 或 VITE_GOOGLE_MAPS_API_KEY。');
      return;
    }
    if (!mapRef.current || storesWithGps.length === 0) return;

    let cancelled = false;

    async function renderMap() {
      setMapStatus('正在載入 Google 地圖...');
      setMapError('');

      try {
        const maps = await loadGoogleMapsScript(googleMapsApiKey);
        if (cancelled || !mapRef.current) return;

        markersRef.current.forEach((marker) => marker.setMap(null));
        markersRef.current = new Map();
        infoWindowRef.current = infoWindowRef.current || new maps.InfoWindow();
        googleMapRef.current = new maps.Map(mapRef.current, {
          center: { lat: 23.6978, lng: 120.9605 },
          zoom: 8,
          mapTypeControl: false,
          streetViewControl: false,
          fullscreenControl: true,
        });

        const bounds = new maps.LatLngBounds();
        storesWithGps.forEach((store) => {
          const position = {
            lat: Number(store.gps_latitude),
            lng: Number(store.gps_longitude),
          };
          const marker = new maps.Marker({
            map: googleMapRef.current,
            position,
            title: storeLabel(store),
          });
          marker.addListener('click', () => {
            setSelectedStoreId(store.id);
            openInfoWindow(store, marker);
          });
          markersRef.current.set(store.id, marker);
          bounds.extend(position);
        });

        googleMapRef.current.fitBounds(bounds);
        if (storesWithGps.length === 1) googleMapRef.current.setZoom(16);
        setMapStatus('');

        const targetId = selectedStoreId || storesWithGps[0]?.id;
        if (targetId) focusStore(targetId, false);
      } catch (error) {
        setMapStatus('');
        setMapError(error instanceof Error ? error.message : 'Google Maps 載入失敗。');
      }
    }

    void renderMap();

    return () => {
      cancelled = true;
    };
  }, [googleMapsApiKey, storesWithGps]);

  function openInfoWindow(store: StoreMapRow, marker: any) {
    if (!infoWindowRef.current || !googleMapRef.current || !marker) return;
    const address = store.address ? `<div style="margin-top:6px;color:#64748b;">${escapeHtml(store.address)}</div>` : '';
    const phone = store.phone ? `<div style="margin-top:4px;color:#64748b;">${escapeHtml(store.phone)}</div>` : '';
    infoWindowRef.current.setContent(`
      <div style="font-family:system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;min-width:190px;">
        <strong style="color:#0f172a;">${escapeHtml(storeLabel(store))}</strong>
        ${address}
        ${phone}
        <div style="margin-top:6px;color:#2563eb;font-size:12px;">${escapeHtml(`${store.gps_latitude}, ${store.gps_longitude}`)}</div>
      </div>
    `);
    infoWindowRef.current.open({ map: googleMapRef.current, anchor: marker });
  }

  function focusStore(storeId: string, fromUser = true) {
    const marker = markersRef.current.get(storeId);
    const store = storesWithGps.find((item) => item.id === storeId);
    if (!marker || !store || !googleMapRef.current) return;
    setSelectedStoreId(storeId);
    googleMapRef.current.panTo(marker.getPosition());
    googleMapRef.current.setZoom(Math.max(googleMapRef.current.getZoom() || 15, 15));
    openInfoWindow(store, marker);
    if (fromUser) {
      mapRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }

  return (
    <div className="space-y-6">
      <section className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <div className="rounded-lg border border-blue-100 bg-white p-5 shadow-sm">
          <div className="text-sm text-gray-500">已設定 GPS</div>
          <div className="mt-2 text-3xl font-bold text-blue-700">{storesWithGps.length}</div>
        </div>
        <div className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
          <div className="text-sm text-gray-500">尚未設定</div>
          <div className="mt-2 text-3xl font-bold text-gray-900">{storesWithoutGps}</div>
        </div>
        <div className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
          <div className="text-sm text-gray-500">目前顯示</div>
          <div className="mt-2 text-3xl font-bold text-gray-900">{filteredStores.length}</div>
        </div>
      </section>

      <section className="overflow-hidden rounded-lg bg-white shadow-lg">
        <div className="grid grid-cols-1 lg:grid-cols-[minmax(360px,0.9fr)_minmax(520px,1.4fr)]">
          <div className="border-b border-gray-200 lg:border-b-0 lg:border-r">
            <div className="border-b border-gray-200 p-4">
              <div className="relative">
                <Search className="absolute left-3 top-2.5 h-5 w-5 text-gray-400" />
                <input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  className="w-full rounded-lg border border-gray-300 py-2 pl-10 pr-4 focus:border-transparent focus:ring-2 focus:ring-blue-500"
                  placeholder="搜尋門市代碼、名稱、地址或電話"
                />
              </div>
            </div>
            <div className="max-h-[640px] overflow-auto">
              <div className="grid grid-cols-[88px_minmax(160px,1fr)_110px] gap-3 border-b border-gray-200 bg-gray-50 px-4 py-3 text-xs font-semibold text-gray-600">
                <span>代碼</span>
                <span>門市</span>
                <span className="text-right">操作</span>
              </div>
              {filteredStores.length === 0 ? (
                <div className="p-8 text-center text-sm text-gray-500">沒有符合條件且已設定 GPS 的門市</div>
              ) : filteredStores.map((store) => (
                <button
                  key={store.id}
                  type="button"
                  onClick={() => focusStore(store.id)}
                  className={`grid w-full grid-cols-[88px_minmax(160px,1fr)_110px] gap-3 border-b border-gray-100 px-4 py-3 text-left text-sm transition-colors hover:bg-blue-50 ${selectedStoreId === store.id ? 'bg-blue-50' : 'bg-white'}`}
                >
                  <span className="font-mono font-semibold text-blue-700">{store.store_code}</span>
                  <span className="min-w-0">
                    <span className="block truncate font-semibold text-gray-900">{store.short_name || store.store_name}</span>
                    <span className="mt-1 block truncate text-xs text-gray-500">{store.gps_latitude}, {store.gps_longitude}</span>
                  </span>
                  <span className="flex items-center justify-end gap-2">
                    <span className={`rounded-full px-2 py-1 text-xs ${store.is_active ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-600'}`}>
                      {store.is_active ? '營運中' : '已停止'}
                    </span>
                  </span>
                </button>
              ))}
            </div>
          </div>

          <div className="min-h-[520px] bg-slate-100">
            {storesWithGps.length === 0 ? (
              <div className="flex h-full min-h-[520px] flex-col items-center justify-center p-10 text-center text-gray-500">
                <MapPin className="mb-3 h-12 w-12 text-gray-300" />
                尚未有門市設定 GPS 座標
              </div>
            ) : (
              <div className="relative h-full min-h-[520px]">
                <div ref={mapRef} className="h-full min-h-[520px] w-full" />
                {(mapStatus || mapError) && (
                  <div className="absolute left-4 top-4 max-w-sm rounded-lg border border-white/70 bg-white px-4 py-3 text-sm shadow-lg">
                    {mapStatus && <div className="flex items-center gap-2 text-blue-700"><LocateFixed size={16} />{mapStatus}</div>}
                    {mapError && <div className="text-amber-700">{mapError}</div>}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </section>

      {selectedStoreId && (
        <div className="flex justify-end">
          <a
            href={mapsSearchUrl(storesWithGps.find((store) => store.id === selectedStoreId) || storesWithGps[0])}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-2 rounded-lg border border-blue-200 bg-white px-4 py-2 text-sm font-semibold text-blue-700 hover:bg-blue-50"
          >
            <ExternalLink size={16} />
            在 Google 地圖開啟
          </a>
        </div>
      )}
    </div>
  );
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
