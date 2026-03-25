'use client';

import { useState } from 'react';
import { X, ChevronLeft, ChevronRight, Camera } from 'lucide-react';

interface Props {
  photoUrls: string[];
}

export default function InspectionPhotoViewer({ photoUrls }: Props) {
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);

  if (!photoUrls || photoUrls.length === 0) return null;

  const open = (idx: number) => setLightboxIndex(idx);
  const close = () => setLightboxIndex(null);
  const prev = () => setLightboxIndex(i => (i !== null ? (i - 1 + photoUrls.length) % photoUrls.length : null));
  const next = () => setLightboxIndex(i => (i !== null ? (i + 1) % photoUrls.length : null));

  return (
    <>
      <div className="mt-3">
        <p className="text-sm font-medium text-gray-700 mb-2 flex items-center gap-1">
          <Camera className="w-4 h-4" />
          問題照片 ({photoUrls.length})
        </p>
        <div className="flex flex-wrap gap-2">
          {photoUrls.map((url, idx) => (
            <button
              key={idx}
              type="button"
              onClick={() => open(idx)}
              className="group relative block focus:outline-none"
              aria-label={`查看照片 ${idx + 1}`}
            >
              <img
                src={url}
                alt={`問題照片 ${idx + 1}`}
                className="w-24 h-24 object-cover rounded-lg border-2 border-gray-300 group-hover:border-blue-500 transition-colors cursor-pointer"
              />
              <div className="absolute inset-0 bg-black bg-opacity-0 group-hover:bg-opacity-10 rounded-lg transition-opacity" />
            </button>
          ))}
        </div>
      </div>

      {/* 燈箱 */}
      {lightboxIndex !== null && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80"
          onClick={close}
        >
          {/* 關閉 */}
          <button
            type="button"
            onClick={close}
            className="absolute top-4 right-4 text-white hover:text-gray-300 transition-colors bg-black/40 rounded-full p-2"
            aria-label="關閉"
          >
            <X size={28} />
          </button>

          {/* 上一張 */}
          {photoUrls.length > 1 && (
            <button
              type="button"
              onClick={e => { e.stopPropagation(); prev(); }}
              className="absolute left-4 text-white hover:text-gray-300 transition-colors bg-black/40 rounded-full p-2"
              aria-label="上一張"
            >
              <ChevronLeft size={32} />
            </button>
          )}

          {/* 圖片 */}
          <img
            src={photoUrls[lightboxIndex]}
            alt={`問題照片 ${lightboxIndex + 1}`}
            className="max-w-[90vw] max-h-[90vh] object-contain rounded-lg shadow-2xl"
            onClick={e => e.stopPropagation()}
          />

          {/* 下一張 */}
          {photoUrls.length > 1 && (
            <button
              type="button"
              onClick={e => { e.stopPropagation(); next(); }}
              className="absolute right-4 text-white hover:text-gray-300 transition-colors bg-black/40 rounded-full p-2"
              aria-label="下一張"
            >
              <ChevronRight size={32} />
            </button>
          )}

          {/* 計數 */}
          {photoUrls.length > 1 && (
            <div className="absolute bottom-4 left-1/2 -translate-x-1/2 text-white text-sm bg-black/40 px-3 py-1 rounded-full">
              {lightboxIndex + 1} / {photoUrls.length}
            </div>
          )}
        </div>
      )}
    </>
  );
}
