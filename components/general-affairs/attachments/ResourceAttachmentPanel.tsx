'use client';

import { ChangeEvent, useCallback, useEffect, useRef, useState } from 'react';
import { AlertCircle, FileText, ImageIcon, Loader2, Paperclip, Trash2, Upload } from 'lucide-react';

type ResourceType =
  | 'EQUIPMENT'
  | 'FACILITY'
  | 'PART'
  | 'MAINTENANCE_REQUEST'
  | 'MAINTENANCE_UPDATE'
  | 'SERVICE_REQUEST'
  | 'SERVICE_REQUEST_COMMENT'
  | 'UTILITY_BILL';

type ResourceAttachment = {
  id: string;
  purpose: string;
  file_name: string;
  content_type: string;
  size_bytes: number;
  is_primary: boolean;
  uploaded_at: string;
  signed_url: string | null;
  storage_path_display: string;
};

type ResourceAttachmentPanelProps = {
  resourceType: ResourceType;
  resourceId: string;
  purpose?: string;
  uploadButtonLabel?: string;
  accept?: string;
  helpText?: string;
  canManage?: boolean;
  title?: string;
  emptyLabel?: string;
};

const ALLOWED_CONTENT_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif',
  'application/pdf',
]);
const MAX_FILE_SIZE_BYTES = 20 * 1024 * 1024;

function formatFileSize(bytes: number) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '-';
  if (bytes < 1024 * 1024) return `${Math.ceil(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function safeErrorMessage(error: unknown, fallback = '附件操作失敗') {
  if (error instanceof Error) return error.message || fallback;
  if (typeof error === 'string') return error || fallback;
  if (error && typeof error === 'object') {
    const record = error as Record<string, unknown>;
    for (const key of ['message', 'error', 'details', 'hint', 'code']) {
      const value = record[key];
      if (typeof value === 'string' && value.trim()) return value.trim();
    }
    try {
      return JSON.stringify(error);
    } catch {
      return fallback;
    }
  }
  return fallback;
}

async function parseResponse(response: Response) {
  const text = await response.text();
  let json: Record<string, any> = {};
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    json = { error: text.slice(0, 300) };
  }
  if (!response.ok) throw new Error(safeErrorMessage(json.error, `附件操作失敗 (${response.status})`));
  return json;
}

export default function ResourceAttachmentPanel({
  resourceType,
  resourceId,
  purpose = 'GENERAL',
  uploadButtonLabel = '上傳附件',
  accept = 'image/jpeg,image/png,image/webp,image/heic,image/heif,application/pdf',
  helpText = '支援 JPG、PNG、WebP、HEIC 與 PDF，單檔上限 20MB。',
  canManage = false,
  title = '圖片與附件',
  emptyLabel = '尚未上傳附件',
}: ResourceAttachmentPanelProps) {
  const [attachments, setAttachments] = useState<ResourceAttachment[]>([]);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const inputRef = useRef<HTMLInputElement | null>(null);

  const loadAttachments = useCallback(async () => {
    if (!resourceId) return;
    setLoading(true);
    setError('');
    try {
      const query = new URLSearchParams({ resourceType, resourceId });
      if (purpose) query.set('purpose', purpose);
      const response = await fetch(`/api/general-affairs/attachments?${query.toString()}`);
      const json = await parseResponse(response);
      setAttachments(json.data || []);
    } catch (err) {
      setError(safeErrorMessage(err, '附件載入失敗'));
    } finally {
      setLoading(false);
    }
  }, [purpose, resourceId, resourceType]);

  useEffect(() => {
    loadAttachments();
  }, [loadAttachments]);

  async function uploadFiles(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files || []);
    event.target.value = '';
    setMessage('');
    setError('');
    if (!files.length) return;

    for (const file of files) {
      if (!ALLOWED_CONTENT_TYPES.has(file.type)) {
        setError(`${file.name} 檔案格式不支援，請上傳圖片或 PDF。`);
        return;
      }
      if (file.size > MAX_FILE_SIZE_BYTES) {
        setError(`${file.name} 超過 20MB 限制。`);
        return;
      }
    }

    setUploading(true);
    try {
      const formData = new FormData();
      formData.append('resource_type', resourceType);
      formData.append('resource_id', resourceId);
      formData.append('purpose', purpose);
      if (purpose === 'PRIMARY_IMAGE') formData.append('is_primary', 'true');
      files.forEach((file) => formData.append('files', file));

      const response = await fetch('/api/general-affairs/attachments', {
        method: 'POST',
        body: formData,
      });
      await parseResponse(response);
      setMessage('附件已上傳。');
      await loadAttachments();
    } catch (err) {
      setError(safeErrorMessage(err, '附件上傳失敗'));
    } finally {
      setUploading(false);
    }
  }

  async function deleteAttachment(attachment: ResourceAttachment) {
    const reason = window.prompt(`請輸入刪除「${attachment.file_name}」的原因`);
    if (!reason?.trim()) return;
    setMessage('');
    setError('');
    try {
      const response = await fetch(`/api/general-affairs/attachments/${attachment.id}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deletion_reason: reason.trim() }),
      });
      const json = await parseResponse(response);
      setMessage(json.warning || '附件已刪除。');
      await loadAttachments();
    } catch (err) {
      setError(safeErrorMessage(err, '附件刪除失敗'));
    }
  }

  return (
    <section className="rounded-lg border border-slate-200 bg-white p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="flex items-center gap-2 text-sm font-bold text-slate-900">
            <Paperclip className="h-4 w-4 text-orange-600" />
            {title}
          </h3>
          <p className="mt-1 text-xs text-slate-500">{helpText}</p>
        </div>
        {canManage && (
          <>
            <input ref={inputRef} type="file" accept={accept} multiple className="hidden" onChange={uploadFiles} />
            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              disabled={uploading}
              className="inline-flex h-9 items-center gap-2 rounded-md bg-orange-600 px-3 text-sm font-semibold text-white shadow-sm hover:bg-orange-700 disabled:cursor-not-allowed disabled:bg-orange-300"
            >
              {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
              {uploadButtonLabel}
            </button>
          </>
        )}
      </div>

      {message && <div className="mt-3 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-700">{message}</div>}
      {error && <div className="mt-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{error}</div>}

      {loading ? (
        <div className="mt-4 flex h-24 items-center justify-center gap-2 rounded-md border border-dashed border-slate-200 text-sm text-slate-500">
          <Loader2 className="h-4 w-4 animate-spin" />
          載入附件
        </div>
      ) : attachments.length === 0 ? (
        <div className="mt-4 flex h-24 items-center justify-center rounded-md border border-dashed border-slate-200 text-sm text-slate-500">
          {emptyLabel}
        </div>
      ) : (
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          {attachments.map((attachment) => {
            const isImage = attachment.content_type.startsWith('image/');
            return (
              <div key={attachment.id} className="overflow-hidden rounded-md border border-slate-200 bg-slate-50">
                <a href={attachment.signed_url || '#'} target="_blank" rel="noreferrer" className="block">
                  <div className="flex aspect-[4/3] items-center justify-center bg-white">
                    {isImage && attachment.signed_url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={attachment.signed_url} alt={attachment.file_name} className="h-full w-full object-cover" />
                    ) : attachment.content_type === 'application/pdf' ? (
                      <FileText className="h-10 w-10 text-orange-500" />
                    ) : (
                      <ImageIcon className="h-10 w-10 text-slate-400" />
                    )}
                  </div>
                </a>
                <div className="space-y-2 p-3">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-semibold text-slate-900" title={attachment.file_name}>{attachment.file_name}</div>
                    <div className="mt-1 text-xs text-slate-500">{formatFileSize(attachment.size_bytes)}</div>
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs text-slate-500">{new Date(attachment.uploaded_at).toLocaleString('zh-TW')}</span>
                    {canManage && (
                      <button type="button" onClick={() => deleteAttachment(attachment)} className="inline-flex items-center gap-1 text-xs font-semibold text-red-600 hover:text-red-700">
                        <Trash2 className="h-3.5 w-3.5" />
                        刪除
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {!canManage && (
        <div className="mt-3 flex items-start gap-2 text-xs text-slate-500">
          <AlertCircle className="mt-0.5 h-3.5 w-3.5" />
          目前帳號僅可查看附件，新增與刪除需具備對應資源管理權限。
        </div>
      )}
    </section>
  );
}
