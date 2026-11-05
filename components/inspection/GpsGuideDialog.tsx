'use client';

import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import {
  GPS_GUIDE_TABS,
  GPS_LINE_BROWSER_NOTICE,
  getDefaultGuideTab,
  getGpsFailureNote,
  isLineInAppBrowser,
  type GpsFailureKind,
  type GpsGuideTabId,
} from '@/lib/inspection/gps-policy';

interface GpsGuideDialogProps {
  open: boolean;
  failureKind?: GpsFailureKind | null;
  failureMessage?: string;
  onClose: () => void;
  onRetry: () => void;
}

// 開啟定位的教學視窗：依裝置預設分頁、依失敗原因加註、LINE 內建瀏覽器提示。
export default function GpsGuideDialog({ open, failureKind, failureMessage, onClose, onRetry }: GpsGuideDialogProps) {
  const [tab, setTab] = useState<GpsGuideTabId>('windows');
  const [inLine, setInLine] = useState(false);

  useEffect(() => {
    if (!open || typeof navigator === 'undefined') return;
    const ua = navigator.userAgent;
    setInLine(isLineInAppBrowser(ua));
    setTab(getDefaultGuideTab(ua, { maxTouchPoints: navigator.maxTouchPoints }));
  }, [open]);

  if (!open) return null;

  const current = GPS_GUIDE_TABS.find((t) => t.id === tab) || GPS_GUIDE_TABS[0];
  const note = getGpsFailureNote(failureKind);

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 p-0 sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="gps-guide-title"
      data-testid="gps-guide-dialog"
    >
      <div className="w-full max-w-lg max-h-[92vh] flex flex-col bg-white rounded-t-2xl sm:rounded-2xl shadow-xl overflow-hidden">
        <div className="flex items-start justify-between gap-2 px-4 py-3 border-b border-gray-200">
          <div className="min-w-0">
            <h2 id="gps-guide-title" className="text-base font-semibold text-gray-900">開啟定位教學</h2>
            {failureMessage && <p className="mt-0.5 text-xs text-red-600 break-words">{failureMessage}</p>}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="關閉"
            className="shrink-0 p-1 text-gray-500 hover:text-gray-800"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto overflow-x-hidden px-4 py-3 space-y-3">
          {inLine && (
            <div className="p-2.5 rounded-lg bg-amber-50 border border-amber-300 text-xs text-amber-900 break-words" data-testid="gps-guide-line-notice">
              {GPS_LINE_BROWSER_NOTICE}
            </div>
          )}
          {note && (
            <div className="p-2.5 rounded-lg bg-red-50 border border-red-200 text-xs text-red-800 break-words" data-testid="gps-guide-note">
              {note}
            </div>
          )}

          <div className="flex flex-wrap gap-1.5" role="tablist">
            {GPS_GUIDE_TABS.map((t) => (
              <button
                key={t.id}
                type="button"
                role="tab"
                aria-selected={t.id === tab}
                onClick={() => setTab(t.id)}
                className={`px-2.5 py-1.5 text-xs rounded-full border transition-colors ${
                  t.id === tab ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>

          <ol className="space-y-2" data-testid={`gps-guide-steps-${current.id}`}>
            {current.steps.map((step, index) => (
              <li key={index} className="flex items-start gap-2.5 p-2.5 rounded-lg bg-gray-50 border border-gray-200">
                <span className="shrink-0 w-6 h-6 rounded-full bg-blue-100 text-blue-700 text-xs font-semibold flex items-center justify-center">
                  {index + 1}
                </span>
                <span className="shrink-0 text-base leading-6" aria-hidden="true">{step.icon}</span>
                <span className="min-w-0 text-sm text-gray-800 leading-6 break-words">{step.text}</span>
              </li>
            ))}
          </ol>
        </div>

        <div className="px-4 py-3 border-t border-gray-200 flex flex-col-reverse sm:flex-row gap-2 sm:justify-end">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-sm rounded-lg bg-gray-100 text-gray-700 hover:bg-gray-200"
          >
            關閉
          </button>
          <button
            type="button"
            onClick={onRetry}
            data-testid="gps-guide-retry"
            className="px-4 py-2 text-sm rounded-lg bg-blue-600 text-white hover:bg-blue-700"
          >
            我開好了，重新定位
          </button>
        </div>
      </div>
    </div>
  );
}
