'use client';

import { useRef, useState, useEffect, useCallback } from 'react';
import { RotateCcw } from 'lucide-react';

interface SignaturePadProps {
  onSignatureChange: (dataUrl: string) => void;
  initialSignature?: string;
  width?: number;
  height?: number;
  penColor?: string;
  penWidth?: number;
  className?: string;
}

export default function SignaturePad({
  onSignatureChange,
  initialSignature = '',
  width = 500,
  height = 200,
  penColor = '#1a1a2e',
  penWidth = 2.5,
  className = '',
}: SignaturePadProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const isDrawingRef = useRef(false);
  const lastPointRef = useRef<{ x: number; y: number } | null>(null);
  const hasContentRef = useRef(!!initialSignature);
  const [hasSignature, setHasSignature] = useState(!!initialSignature);
  const [canvasSize, setCanvasSize] = useState({ width, height });
  const savedImageRef = useRef<string>('');

  // Responsive canvas sizing — only measure once on mount
  // Measure container and resize canvas — also on orientation change
  useEffect(() => {
    const measure = () => {
      if (containerRef.current) {
        const containerWidth = containerRef.current.clientWidth;
        const newWidth = Math.min(containerWidth - 4, width);
        const newHeight = Math.round((newWidth / width) * height);

        // Save current drawing before resize
        const canvas = canvasRef.current;
        if (canvas && hasContentRef.current) {
          savedImageRef.current = canvas.toDataURL('image/png');
        }

        setCanvasSize({ width: newWidth, height: newHeight });
      }
    };

    measure();

    // Listen for orientation change (mobile rotate) and resize
    const handleChange = () => {
      // Small delay to let the browser finish layout
      setTimeout(measure, 150);
    };

    window.addEventListener('orientationchange', handleChange);
    window.addEventListener('resize', handleChange);

    return () => {
      window.removeEventListener('orientationchange', handleChange);
      window.removeEventListener('resize', handleChange);
    };
  }, [width, height]);

  // Initialize canvas (only when canvasSize settles)
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    canvas.width = canvasSize.width * dpr;
    canvas.height = canvasSize.height * dpr;
    canvas.style.width = `${canvasSize.width}px`;
    canvas.style.height = `${canvasSize.height}px`;
    ctx.scale(dpr, dpr);

    // Fill white background
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvasSize.width, canvasSize.height);

    // Restore saved content if any
    if (savedImageRef.current) {
      const img = new Image();
      img.onload = () => {
        ctx.drawImage(img, 0, 0, canvasSize.width, canvasSize.height);
        // Re-apply drawing style after drawImage
        ctx.strokeStyle = penColor;
        ctx.lineWidth = penWidth;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
      };
      img.src = savedImageRef.current;
    } else if (initialSignature) {
      const img = new Image();
      img.onload = () => {
        ctx.drawImage(img, 0, 0, canvasSize.width, canvasSize.height);
        ctx.strokeStyle = penColor;
        ctx.lineWidth = penWidth;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
      };
      img.src = initialSignature;
    }

    // Set drawing style
    ctx.strokeStyle = penColor;
    ctx.lineWidth = penWidth;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
  }, [canvasSize, penColor, penWidth, initialSignature]);

  // Use native event listeners to prevent ALL default touch behavior
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const getPoint = (e: TouchEvent | MouseEvent) => {
      const rect = canvas.getBoundingClientRect();
      if ('touches' in e) {
        const touch = e.touches[0] || e.changedTouches[0];
        if (!touch) return null;
        return { x: touch.clientX - rect.left, y: touch.clientY - rect.top };
      }
      return { x: (e as MouseEvent).clientX - rect.left, y: (e as MouseEvent).clientY - rect.top };
    };

    const startDrawing = (e: TouchEvent | MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const point = getPoint(e);
      if (!point) return;

      isDrawingRef.current = true;
      lastPointRef.current = point;

      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.beginPath();
        ctx.moveTo(point.x, point.y);
        ctx.lineTo(point.x + 0.1, point.y + 0.1);
        ctx.stroke();
      }
    };

    const draw = (e: TouchEvent | MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (!isDrawingRef.current) return;

      const point = getPoint(e);
      if (!point || !lastPointRef.current) return;

      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      ctx.beginPath();
      ctx.moveTo(lastPointRef.current.x, lastPointRef.current.y);
      ctx.lineTo(point.x, point.y);
      ctx.stroke();

      lastPointRef.current = point;
    };

    const stopDrawing = (e: TouchEvent | MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (isDrawingRef.current) {
        isDrawingRef.current = false;
        lastPointRef.current = null;
        hasContentRef.current = true;
        setHasSignature(true);

        // Save current canvas content
        const dataUrl = canvas.toDataURL('image/png');
        savedImageRef.current = dataUrl;
        onSignatureChange(dataUrl);
      }
    };

    // Use passive: false to ensure preventDefault works on touch events
    canvas.addEventListener('touchstart', startDrawing, { passive: false });
    canvas.addEventListener('touchmove', draw, { passive: false });
    canvas.addEventListener('touchend', stopDrawing, { passive: false });
    canvas.addEventListener('touchcancel', stopDrawing, { passive: false });
    canvas.addEventListener('mousedown', startDrawing);
    canvas.addEventListener('mousemove', draw);
    canvas.addEventListener('mouseup', stopDrawing);
    canvas.addEventListener('mouseleave', stopDrawing);

    return () => {
      canvas.removeEventListener('touchstart', startDrawing);
      canvas.removeEventListener('touchmove', draw);
      canvas.removeEventListener('touchend', stopDrawing);
      canvas.removeEventListener('touchcancel', stopDrawing);
      canvas.removeEventListener('mousedown', startDrawing);
      canvas.removeEventListener('mousemove', draw);
      canvas.removeEventListener('mouseup', stopDrawing);
      canvas.removeEventListener('mouseleave', stopDrawing);
    };
  }, [canvasSize, onSignatureChange, penColor, penWidth]);

  const clearSignature = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    ctx.clearRect(0, 0, canvas.width / dpr, canvas.height / dpr);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width / dpr, canvas.height / dpr);

    ctx.strokeStyle = penColor;
    ctx.lineWidth = penWidth;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    hasContentRef.current = false;
    savedImageRef.current = '';
    setHasSignature(false);
    onSignatureChange('');
  }, [penColor, penWidth, onSignatureChange]);

  return (
    <div
      ref={containerRef}
      className={`relative select-none ${className}`}
      style={{ touchAction: 'none', WebkitUserSelect: 'none', userSelect: 'none' }}
    >
      <canvas
        ref={canvasRef}
        className="border-2 border-dashed border-blue-300 rounded-lg cursor-crosshair bg-white block"
        style={{
          width: canvasSize.width,
          height: canvasSize.height,
          touchAction: 'none',
          WebkitTouchCallout: 'none',
          WebkitUserSelect: 'none',
          userSelect: 'none',
          msTouchAction: 'none',
        } as React.CSSProperties}
      />

      {/* Placeholder text when empty */}
      {!hasSignature && (
        <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none select-none">
          <p className="text-gray-400 text-sm select-none">請在此處簽名</p>
        </div>
      )}

      {/* Clear button */}
      {hasSignature && (
        <button
          type="button"
          onClick={clearSignature}
          className="absolute top-2 right-2 flex items-center gap-1 px-2 py-1 bg-red-500 text-white text-xs rounded-md shadow hover:bg-red-600 active:scale-95 transition-all"
          title="清除簽名"
        >
          <RotateCcw className="w-3 h-3" />
          清除
        </button>
      )}
    </div>
  );
}
