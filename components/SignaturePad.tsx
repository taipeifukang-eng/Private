'use client';

import { useRef, useState, useEffect, useCallback } from 'react';
import { X, RotateCcw } from 'lucide-react';

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
  const [isDrawing, setIsDrawing] = useState(false);
  const [hasSignature, setHasSignature] = useState(!!initialSignature);
  const [canvasSize, setCanvasSize] = useState({ width, height });
  const lastPoint = useRef<{ x: number; y: number } | null>(null);

  // Responsive canvas sizing
  useEffect(() => {
    const updateSize = () => {
      if (containerRef.current) {
        const containerWidth = containerRef.current.clientWidth;
        const newWidth = Math.min(containerWidth - 4, width); // 4px for border
        const newHeight = Math.round((newWidth / width) * height);
        setCanvasSize({ width: newWidth, height: newHeight });
      }
    };

    updateSize();
    window.addEventListener('resize', updateSize);
    return () => window.removeEventListener('resize', updateSize);
  }, [width, height]);

  // Initialize canvas
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // High DPI support
    const dpr = window.devicePixelRatio || 1;
    canvas.width = canvasSize.width * dpr;
    canvas.height = canvasSize.height * dpr;
    canvas.style.width = `${canvasSize.width}px`;
    canvas.style.height = `${canvasSize.height}px`;
    ctx.scale(dpr, dpr);

    // Set drawing style
    ctx.strokeStyle = penColor;
    ctx.lineWidth = penWidth;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    // Fill white background
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvasSize.width, canvasSize.height);

    // Load initial signature if provided
    if (initialSignature) {
      const img = new Image();
      img.onload = () => {
        ctx.drawImage(img, 0, 0, canvasSize.width, canvasSize.height);
      };
      img.src = initialSignature;
    }
  }, [canvasSize, penColor, penWidth, initialSignature]);

  const getPoint = useCallback((e: React.TouchEvent | React.MouseEvent) => {
    const canvas = canvasRef.current;
    if (!canvas) return null;

    const rect = canvas.getBoundingClientRect();
    
    if ('touches' in e) {
      const touch = e.touches[0] || e.changedTouches[0];
      return {
        x: touch.clientX - rect.left,
        y: touch.clientY - rect.top,
      };
    }
    
    return {
      x: (e as React.MouseEvent).clientX - rect.left,
      y: (e as React.MouseEvent).clientY - rect.top,
    };
  }, []);

  const startDrawing = useCallback((e: React.TouchEvent | React.MouseEvent) => {
    e.preventDefault();
    const point = getPoint(e);
    if (!point) return;

    setIsDrawing(true);
    lastPoint.current = point;

    const ctx = canvasRef.current?.getContext('2d');
    if (ctx) {
      ctx.beginPath();
      ctx.moveTo(point.x, point.y);
      // Draw a dot for single taps
      ctx.lineTo(point.x + 0.1, point.y + 0.1);
      ctx.stroke();
    }
  }, [getPoint]);

  const draw = useCallback((e: React.TouchEvent | React.MouseEvent) => {
    e.preventDefault();
    if (!isDrawing) return;

    const point = getPoint(e);
    if (!point || !lastPoint.current) return;

    const ctx = canvasRef.current?.getContext('2d');
    if (!ctx) return;

    ctx.beginPath();
    ctx.moveTo(lastPoint.current.x, lastPoint.current.y);
    ctx.lineTo(point.x, point.y);
    ctx.stroke();

    lastPoint.current = point;
  }, [isDrawing, getPoint]);

  const stopDrawing = useCallback(() => {
    if (isDrawing) {
      setIsDrawing(false);
      lastPoint.current = null;
      setHasSignature(true);

      // Export signature as data URL
      const canvas = canvasRef.current;
      if (canvas) {
        const dataUrl = canvas.toDataURL('image/png');
        onSignatureChange(dataUrl);
      }
    }
  }, [isDrawing, onSignatureChange]);

  const clearSignature = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    ctx.clearRect(0, 0, canvas.width / dpr, canvas.height / dpr);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width / dpr, canvas.height / dpr);

    // Reset drawing style after clear
    ctx.strokeStyle = penColor;
    ctx.lineWidth = penWidth;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    setHasSignature(false);
    onSignatureChange('');
  }, [penColor, penWidth, onSignatureChange]);

  return (
    <div ref={containerRef} className={`relative ${className}`}>
      <canvas
        ref={canvasRef}
        className="border-2 border-dashed border-blue-300 rounded-lg cursor-crosshair bg-white touch-none"
        style={{ width: canvasSize.width, height: canvasSize.height }}
        onMouseDown={startDrawing}
        onMouseMove={draw}
        onMouseUp={stopDrawing}
        onMouseLeave={stopDrawing}
        onTouchStart={startDrawing}
        onTouchMove={draw}
        onTouchEnd={stopDrawing}
        onTouchCancel={stopDrawing}
      />

      {/* Placeholder text when empty */}
      {!hasSignature && !isDrawing && (
        <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
          <p className="text-gray-400 text-sm">請在此處簽名</p>
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
