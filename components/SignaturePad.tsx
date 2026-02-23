'use client';

import { useRef, useState, useEffect } from 'react';
import { RotateCcw, Check, X, PenTool } from 'lucide-react';

interface SignaturePadProps {
  onSignatureChange: (dataUrl: string) => void;
  initialSignature?: string;
  width?: number;
  height?: number;
  penColor?: string;
  penWidth?: number;
  className?: string;
}

/**
 * 全螢幕橫式簽名元件
 * 點擊觸發區開啟全螢幕簽名彈窗，簽完按確認回傳 dataUrl
 */
export default function SignaturePad({
  onSignatureChange,
  initialSignature = '',
  className = '',
}: SignaturePadProps) {
  const [showModal, setShowModal] = useState(false);

  return (
    <div className={className}>
      {/* 觸發區：顯示已簽名圖或提示 */}
      <div
        className="border-2 border-dashed border-blue-300 rounded-lg overflow-hidden cursor-pointer hover:bg-blue-50 active:bg-blue-100 transition-colors"
        onClick={() => setShowModal(true)}
      >
        {initialSignature ? (
          <div className="relative group bg-white">
            <img
              src={initialSignature}
              alt="督導簽名"
              className="w-full h-auto max-h-32 object-contain p-2"
            />
            <div className="absolute inset-0 bg-black bg-opacity-0 group-hover:bg-opacity-10 transition-all flex items-center justify-center">
              <span className="text-sm text-gray-600 opacity-0 group-hover:opacity-100 bg-white px-3 py-1 rounded-full shadow">
                點擊重新簽名
              </span>
            </div>
          </div>
        ) : (
          <div className="p-8 text-center">
            <PenTool className="w-10 h-10 text-blue-500 mx-auto mb-2" />
            <p className="text-sm text-blue-600 font-medium">點擊開啟簽名板</p>
          </div>
        )}
      </div>

      {/* 全螢幕簽名彈窗 */}
      {showModal && (
        <SignatureModal
          initialSignature={initialSignature}
          onConfirm={(dataUrl) => {
            onSignatureChange(dataUrl);
            setShowModal(false);
          }}
          onCancel={() => setShowModal(false)}
        />
      )}
    </div>
  );
}

// ============================================================
// 全螢幕橫式簽名 Modal
// ============================================================
function SignatureModal({
  initialSignature,
  onConfirm,
  onCancel,
}: {
  initialSignature?: string;
  onConfirm: (dataUrl: string) => void;
  onCancel: () => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const isDrawingRef = useRef(false);
  const lastPointRef = useRef<{ x: number; y: number } | null>(null);
  const [hasContent, setHasContent] = useState(!!initialSignature);
  const [canvasReady, setCanvasReady] = useState(false);

  // Lock body scroll when modal is open
  useEffect(() => {
    const originalOverflow = document.body.style.overflow;
    const originalPosition = document.body.style.position;
    const originalTop = document.body.style.top;
    const originalWidth = document.body.style.width;
    const scrollY = window.scrollY;

    document.body.style.overflow = 'hidden';
    document.body.style.position = 'fixed';
    document.body.style.top = `-${scrollY}px`;
    document.body.style.width = '100%';

    return () => {
      document.body.style.overflow = originalOverflow;
      document.body.style.position = originalPosition;
      document.body.style.top = originalTop;
      document.body.style.width = originalWidth;
      window.scrollTo(0, scrollY);
    };
  }, []);

  // Initialize canvas
  useEffect(() => {
    const initCanvas = () => {
      const canvas = canvasRef.current;
      const container = containerRef.current;
      if (!canvas || !container) return;

      const rect = container.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;

      canvas.width = rect.width * dpr;
      canvas.height = rect.height * dpr;
      canvas.style.width = `${rect.width}px`;
      canvas.style.height = `${rect.height}px`;

      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      ctx.scale(dpr, dpr);

      // White background
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, rect.width, rect.height);

      // Drawing style
      ctx.strokeStyle = '#1a1a2e';
      ctx.lineWidth = 3;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';

      // Load existing signature if any
      if (initialSignature) {
        const img = new Image();
        img.onload = () => {
          const scale = Math.min(rect.width / img.width, rect.height / img.height) * 0.9;
          const x = (rect.width - img.width * scale) / 2;
          const y = (rect.height - img.height * scale) / 2;
          ctx.drawImage(img, x, y, img.width * scale, img.height * scale);
          ctx.strokeStyle = '#1a1a2e';
          ctx.lineWidth = 3;
          ctx.lineCap = 'round';
          ctx.lineJoin = 'round';
          setCanvasReady(true);
        };
        img.src = initialSignature;
      } else {
        setCanvasReady(true);
      }
    };

    // Delay to ensure layout is settled
    const timer = setTimeout(initCanvas, 100);
    return () => clearTimeout(timer);
  }, [initialSignature]);

  // Touch / mouse event handlers
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !canvasReady) return;

    const getPoint = (e: TouchEvent | MouseEvent) => {
      const rect = canvas.getBoundingClientRect();
      if ('touches' in e) {
        const touch = e.touches[0] || e.changedTouches[0];
        if (!touch) return null;
        return { x: touch.clientX - rect.left, y: touch.clientY - rect.top };
      }
      return { x: (e as MouseEvent).clientX - rect.left, y: (e as MouseEvent).clientY - rect.top };
    };

    const startDraw = (e: TouchEvent | MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const pt = getPoint(e);
      if (!pt) return;
      isDrawingRef.current = true;
      lastPointRef.current = pt;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.beginPath();
        ctx.moveTo(pt.x, pt.y);
        ctx.lineTo(pt.x + 0.1, pt.y + 0.1);
        ctx.stroke();
      }
    };

    const drawing = (e: TouchEvent | MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (!isDrawingRef.current) return;
      const pt = getPoint(e);
      if (!pt || !lastPointRef.current) return;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.beginPath();
      ctx.moveTo(lastPointRef.current.x, lastPointRef.current.y);
      ctx.lineTo(pt.x, pt.y);
      ctx.stroke();
      lastPointRef.current = pt;
    };

    const stopDraw = (e: TouchEvent | MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (isDrawingRef.current) {
        isDrawingRef.current = false;
        lastPointRef.current = null;
        setHasContent(true);
      }
    };

    canvas.addEventListener('touchstart', startDraw, { passive: false });
    canvas.addEventListener('touchmove', drawing, { passive: false });
    canvas.addEventListener('touchend', stopDraw, { passive: false });
    canvas.addEventListener('touchcancel', stopDraw, { passive: false });
    canvas.addEventListener('mousedown', startDraw);
    canvas.addEventListener('mousemove', drawing);
    canvas.addEventListener('mouseup', stopDraw);
    canvas.addEventListener('mouseleave', stopDraw);

    return () => {
      canvas.removeEventListener('touchstart', startDraw);
      canvas.removeEventListener('touchmove', drawing);
      canvas.removeEventListener('touchend', stopDraw);
      canvas.removeEventListener('touchcancel', stopDraw);
      canvas.removeEventListener('mousedown', startDraw);
      canvas.removeEventListener('mousemove', drawing);
      canvas.removeEventListener('mouseup', stopDraw);
      canvas.removeEventListener('mouseleave', stopDraw);
    };
  }, [canvasReady]);

  const handleClear = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.width / dpr;
    const h = canvas.height / dpr;
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = '#1a1a2e';
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    setHasContent(false);
  };

  const handleConfirm = () => {
    const canvas = canvasRef.current;
    if (!canvas || !hasContent) return;
    onConfirm(canvas.toDataURL('image/png'));
  };

  return (
    <div
      className="fixed inset-0 z-[9999] bg-black"
      style={{ touchAction: 'none', userSelect: 'none', WebkitUserSelect: 'none' } as React.CSSProperties}
    >
      {/* Toolbar */}
      <div className="absolute top-0 left-0 right-0 z-10 flex items-center justify-between px-3 py-2 bg-gray-900 bg-opacity-80 backdrop-blur-sm safe-area-top">
        <button
          type="button"
          onClick={onCancel}
          className="flex items-center gap-1 px-3 py-2 text-white text-sm rounded-lg hover:bg-white/20 active:bg-white/30 transition-colors"
        >
          <X className="w-4 h-4" />
          取消
        </button>

        <span className="text-white text-sm font-medium">請在此簽名</span>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleClear}
            className="flex items-center gap-1 px-3 py-2 text-white text-sm rounded-lg hover:bg-white/20 active:bg-white/30 transition-colors"
          >
            <RotateCcw className="w-4 h-4" />
            清除
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={!hasContent}
            className={`flex items-center gap-1 px-4 py-2 text-sm font-medium rounded-lg transition-colors ${
              hasContent
                ? 'bg-green-500 text-white hover:bg-green-600 active:bg-green-700'
                : 'bg-gray-600 text-gray-400 cursor-not-allowed'
            }`}
          >
            <Check className="w-4 h-4" />
            確認
          </button>
        </div>
      </div>

      {/* Canvas area */}
      <div
        ref={containerRef}
        className="absolute left-0 right-0 bottom-0 bg-white"
        style={{ top: '48px' }}
      >
        <canvas
          ref={canvasRef}
          className="block w-full h-full cursor-crosshair"
          style={{
            touchAction: 'none',
            WebkitTouchCallout: 'none',
            WebkitUserSelect: 'none',
            userSelect: 'none',
          } as React.CSSProperties}
        />
      </div>
    </div>
  );
}
