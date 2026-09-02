'use client';

import { LocateFixed, MapPin, X } from 'lucide-react';

type StoreGpsFieldsProps = {
  latitude: string;
  longitude: string;
  onLatitudeChange: (value: string) => void;
  onLongitudeChange: (value: string) => void;
  locating: boolean;
  locateMessage: string;
  onLocatingChange: (value: boolean) => void;
  onLocateMessageChange: (value: string) => void;
};

function parseCoordinatePair(value: string) {
  const normalized = value
    .replace(/[，、\s]+/g, ',')
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);

  if (normalized.length < 2) return null;

  const lat = Number(normalized[0]);
  const lng = Number(normalized[1]);

  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;

  return {
    latitude: lat.toFixed(7),
    longitude: lng.toFixed(7),
  };
}

function geolocationErrorMessage(error: GeolocationPositionError | unknown) {
  const code = typeof error === 'object' && error && 'code' in error ? Number((error as GeolocationPositionError).code) : 0;
  if (code === 1) return '定位權限未開啟，請允許瀏覽器使用位置。';
  if (code === 2) return '目前無法取得位置，請確認 GPS 或網路定位已開啟。';
  if (code === 3) return '定位逾時，請移到收訊較好的位置後再試一次。';
  return '無法取得目前位置。';
}

export default function StoreGpsFields({
  latitude,
  longitude,
  onLatitudeChange,
  onLongitudeChange,
  locating,
  locateMessage,
  onLocatingChange,
  onLocateMessageChange,
}: StoreGpsFieldsProps) {
  const handlePairChange = (value: string) => {
    const parsed = parseCoordinatePair(value);
    if (!parsed) {
      onLocateMessageChange(value.trim() ? '格式需為「緯度, 經度」，例如 25.033964, 121.564468。' : '');
      return;
    }
    onLatitudeChange(parsed.latitude);
    onLongitudeChange(parsed.longitude);
    onLocateMessageChange('已帶入 GPS 座標。');
  };

  const handleUseCurrentLocation = () => {
    if (!navigator.geolocation) {
      onLocateMessageChange('此裝置或瀏覽器不支援 GPS 定位。');
      return;
    }

    onLocatingChange(true);
    onLocateMessageChange('正在取得目前位置...');
    navigator.geolocation.getCurrentPosition(
      (position) => {
        onLatitudeChange(position.coords.latitude.toFixed(7));
        onLongitudeChange(position.coords.longitude.toFixed(7));
        const accuracy = Math.round(position.coords.accuracy || 0);
        onLocateMessageChange(accuracy ? `已帶入目前位置，精準度約 ${accuracy} 公尺。` : '已帶入目前位置。');
        onLocatingChange(false);
      },
      (error) => {
        onLocateMessageChange(geolocationErrorMessage(error));
        onLocatingChange(false);
      },
      {
        enableHighAccuracy: true,
        timeout: 15000,
        maximumAge: 0,
      }
    );
  };

  const handleClear = () => {
    onLatitudeChange('');
    onLongitudeChange('');
    onLocateMessageChange('已清除 GPS 座標。');
  };

  return (
    <section className="rounded-lg border border-blue-100 bg-blue-50/60 p-4 md:col-span-2">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-base font-semibold text-gray-900">
            <MapPin size={18} className="text-blue-600" />
            Google 地圖 GPS
          </h2>
          <p className="mt-1 text-sm text-gray-600">
            可貼上 Google 複製的「緯度, 經度」，或在門市現場按定位帶入。
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={handleUseCurrentLocation}
            disabled={locating}
            className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <LocateFixed size={16} />
            {locating ? '定位中...' : '使用目前位置'}
          </button>
          {(latitude || longitude) && (
            <button
              type="button"
              onClick={handleClear}
              className="inline-flex items-center gap-2 rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-semibold text-gray-700 transition-colors hover:bg-gray-50"
            >
              <X size={16} />
              清除
            </button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <label className="block md:col-span-3">
          <span className="mb-2 block text-sm font-medium text-gray-700">貼上 Google 座標</span>
          <input
            type="text"
            onChange={(event) => handlePairChange(event.target.value)}
            onPaste={(event) => {
              const text = event.clipboardData.getData('text');
              const parsed = parseCoordinatePair(text);
              if (!parsed) return;
              event.preventDefault();
              onLatitudeChange(parsed.latitude);
              onLongitudeChange(parsed.longitude);
              onLocateMessageChange('已從貼上的 Google 座標帶入。');
            }}
            className="w-full rounded-lg border border-gray-300 px-4 py-2 focus:border-transparent focus:ring-2 focus:ring-blue-500"
            placeholder="例如：25.033964, 121.564468"
          />
        </label>
        <label className="block">
          <span className="mb-2 block text-sm font-medium text-gray-700">緯度</span>
          <input
            type="number"
            step="0.0000001"
            min="-90"
            max="90"
            value={latitude}
            onChange={(event) => onLatitudeChange(event.target.value)}
            className="w-full rounded-lg border border-gray-300 px-4 py-2 focus:border-transparent focus:ring-2 focus:ring-blue-500"
            placeholder="25.033964"
          />
        </label>
        <label className="block">
          <span className="mb-2 block text-sm font-medium text-gray-700">經度</span>
          <input
            type="number"
            step="0.0000001"
            min="-180"
            max="180"
            value={longitude}
            onChange={(event) => onLongitudeChange(event.target.value)}
            className="w-full rounded-lg border border-gray-300 px-4 py-2 focus:border-transparent focus:ring-2 focus:ring-blue-500"
            placeholder="121.564468"
          />
        </label>
        <div className="flex items-end text-sm text-gray-600">
          {latitude && longitude ? `${latitude}, ${longitude}` : '尚未設定座標'}
        </div>
      </div>
      {locateMessage && (
        <p className={`mt-3 text-sm ${locateMessage.includes('無法') || locateMessage.includes('格式') || locateMessage.includes('權限') || locateMessage.includes('逾時') ? 'text-amber-700' : 'text-blue-700'}`}>
          {locateMessage}
        </p>
      )}
    </section>
  );
}
