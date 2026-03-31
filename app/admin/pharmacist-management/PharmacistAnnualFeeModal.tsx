'use client';

import { useState, useEffect } from 'react';

const MOBILE_SAFE_MAX_UPLOAD_BYTES = 3.5 * 1024 * 1024;

async function readResponseError(res: Response, fallback: string): Promise<string> {
  try {
    const body = await res.json();
    if (typeof body?.error === 'string' && body.error) return body.error;
  } catch {
    // ignore json parse errors and fallback to status text
  }
  return `${fallback}（${res.status}）`;
}

async function compressImageForMobile(file: File): Promise<File> {
  if (!file.type.startsWith('image/')) return file;
  if (file.size <= MOBILE_SAFE_MAX_UPLOAD_BYTES) return file;

  const objectUrl = URL.createObjectURL(file);

  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error('無法讀取圖片'));
      el.src = objectUrl;
    });

    let targetW = img.naturalWidth;
    let targetH = img.naturalHeight;
    const longest = Math.max(targetW, targetH);
    if (longest > 1920) {
      const ratio = 1920 / longest;
      targetW = Math.max(1, Math.round(targetW * ratio));
      targetH = Math.max(1, Math.round(targetH * ratio));
    }

    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    if (!ctx) return file;

    canvas.width = targetW;
    canvas.height = targetH;
    ctx.drawImage(img, 0, 0, targetW, targetH);

    let bestBlob: Blob | null = null;
    const qualitySteps = [0.86, 0.78, 0.7, 0.62, 0.54];

    for (const quality of qualitySteps) {
      const blob = await new Promise<Blob | null>((resolve) => {
        canvas.toBlob((b) => resolve(b), 'image/jpeg', quality);
      });
      if (!blob) continue;
      bestBlob = blob;
      if (blob.size <= MOBILE_SAFE_MAX_UPLOAD_BYTES) break;
    }

    if (!bestBlob) return file;
    if (bestBlob.size >= file.size) return file;

    const baseName = (file.name || 'photo').replace(/\.[^.]+$/, '');
    return new File([bestBlob], `${baseName}.jpg`, { type: 'image/jpeg' });
  } catch {
    return file;
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

const TAIWAN_CITIES = [
  '台北市',
  '新北市',
  '基隆市',
  '新竹市',
  '高雄市',
] as const;

type FeeRecord = {
  id: string;
  employee_code: string;
  association_city: string;
  fee_year: number;
  fee_period_start: string | null;
  fee_period_end: string | null;
  payment_proof_path: string | null;
  notes: string | null;
  created_by: string | null;
  created_at: string;
};

type FormState = {
  association_city: string;
  fee_year: number;
  fee_period_start: string;
  fee_period_end: string;
  notes: string;
};

export default function PharmacistAnnualFeeModal({
  employeeCode,
  employeeName,
  canEdit,
  onClose,
}: {
  employeeCode: string;
  employeeName: string;
  canEdit: boolean;
  onClose: () => void;
}) {
  const [records, setRecords] = useState<FeeRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');

  // 新增表單
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<FormState>({
    association_city: '',
    fee_year: new Date().getFullYear(),
    fee_period_start: '',
    fee_period_end: '',
    notes: '',
  });
  const [cityQuery, setCityQuery] = useState('');
  const [cityOpen, setCityOpen] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState('');

  // 查看證明
  const [viewingProof, setViewingProof] = useState<string | null>(null);

  useEffect(() => {
    fetchRecords();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [employeeCode]);

  useEffect(() => {
    if (!form.association_city || !form.fee_year) return;

    // 基隆市採 12 個月區間，需人工指定起迄，不自動預設整年
    if (form.association_city === '基隆市') {
      setForm((prev) => ({
        ...prev,
        fee_period_start: '',
        fee_period_end: '',
      }));
      return;
    }

    // 其他縣市：選擇年度後預設該年度 1/1 ~ 12/31
    setForm((prev) => ({
      ...prev,
      fee_period_start: `${prev.fee_year}-01-01`,
      fee_period_end: `${prev.fee_year}-12-31`,
    }));
  }, [form.association_city, form.fee_year]);

  async function fetchRecords() {
    setLoading(true);
    setLoadError('');
    try {
      const res = await fetch(`/api/pharmacist-annual-fees?employee_code=${encodeURIComponent(employeeCode)}`);
      if (!res.ok) throw new Error('載入失敗');
      const { data } = await res.json();
      setRecords(data || []);
    } catch {
      setLoadError('載入失敗，請重試');
    } finally {
      setLoading(false);
    }
  }

  const filteredCities = TAIWAN_CITIES.filter((c) => c.includes(cityQuery));

  function resetForm() {
    setForm({
      association_city: '',
      fee_year: new Date().getFullYear(),
      fee_period_start: '',
      fee_period_end: '',
      notes: '',
    });
    setCityQuery('');
    setSelectedFile(null);
    setFormError('');
  }

  async function handleSubmit() {
    if (!form.association_city) {
      setFormError('請選擇縣市公會');
      return;
    }
    if (!form.fee_year || form.fee_year < 2000 || form.fee_year > 2100) {
      setFormError('請輸入正確申請年度');
      return;
    }

    setSubmitting(true);
    setFormError('');

    try {
      let payment_proof_path: string | null = null;

      // 1. 上傳照片（若有選擇）
      if (selectedFile) {
        const uploadFile = await compressImageForMobile(selectedFile);

        if (uploadFile.size > MOBILE_SAFE_MAX_UPLOAD_BYTES) {
          setFormError('照片過大，請改用較低解析度或先裁切後再上傳（建議 3.5 MB 以內）');
          setSubmitting(false);
          return;
        }

        const fd = new FormData();
        fd.append('file', uploadFile);
        fd.append('employee_code', employeeCode);
        const upRes = await fetch('/api/pharmacist-annual-fees/upload', {
          method: 'POST',
          body: fd,
        });
        if (!upRes.ok) {
          const msg = await readResponseError(upRes, '上傳失敗');
          setFormError(msg);
          setSubmitting(false);
          return;
        }
        const { path } = await upRes.json();
        payment_proof_path = path;
      }

      // 2. 建立資料庫記錄
      const res = await fetch('/api/pharmacist-annual-fees', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          employee_code: employeeCode,
          association_city: form.association_city,
          fee_year: form.fee_year,
          fee_period_start: form.fee_period_start || null,
          fee_period_end: form.fee_period_end || null,
          payment_proof_path,
          notes: form.notes || null,
        }),
      });
      if (!res.ok) {
        const msg = await readResponseError(res, '儲存失敗');
        setFormError(msg);
        setSubmitting(false);
        return;
      }

      resetForm();
      setShowForm(false);
      await fetchRecords();
    } catch (error) {
      setFormError(`網路或上傳異常，請稍後再試（${error instanceof Error ? error.message : 'unknown'}）`);
    } finally {
      setSubmitting(false);
    }
  }

  async function handleViewProof(path: string) {
    setViewingProof(path);
    try {
      const res = await fetch(`/api/pharmacist-annual-fees/upload?path=${encodeURIComponent(path)}`);
      if (!res.ok) throw new Error();
      const { url } = await res.json();
      window.open(url, '_blank', 'noopener,noreferrer');
    } catch {
      alert('無法取得繳費證明，請稍後再試');
    } finally {
      setViewingProof(null);
    }
  }

  async function handleDelete(id: string) {
    if (!confirm('確定刪除此筆年費記錄？此操作無法復原。')) return;
    const res = await fetch(`/api/pharmacist-annual-fees?id=${encodeURIComponent(id)}`, {
      method: 'DELETE',
    });
    if (!res.ok) {
      alert('刪除失敗，請稍後再試');
      return;
    }
    setRecords((prev) => prev.filter((r) => r.id !== id));
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="relative w-full max-w-3xl max-h-[90vh] overflow-y-auto rounded-2xl bg-white shadow-2xl">
        {/* Header */}
        <div className="sticky top-0 z-10 flex items-center justify-between rounded-t-2xl border-b border-gray-200 bg-white px-6 py-4">
          <div>
            <h2 className="text-lg font-bold text-gray-900">常年會費申請記錄</h2>
            <p className="text-sm text-gray-500 mt-0.5">
              <span className="font-mono">{employeeCode}</span>　{employeeName}
            </p>
          </div>
          <button
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-full text-gray-400 hover:bg-gray-100 hover:text-gray-600 transition-colors text-xl"
          >
            ×
          </button>
        </div>

        <div className="p-6 space-y-5">
          {/* 記錄列表 */}
          {loading ? (
            <p className="py-10 text-center text-sm text-gray-400">載入中…</p>
          ) : loadError ? (
            <p className="py-10 text-center text-sm text-rose-500">{loadError}</p>
          ) : records.length === 0 ? (
            <p className="py-10 text-center text-sm text-gray-400">尚無年費記錄</p>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-gray-200">
              <table className="min-w-full text-sm">
                <thead className="bg-gray-50 text-gray-700">
                  <tr>
                    <th className="px-3 py-2.5 text-left font-semibold whitespace-nowrap">縣市公會</th>
                    <th className="px-3 py-2.5 text-left font-semibold whitespace-nowrap">年度</th>
                    <th className="px-3 py-2.5 text-left font-semibold whitespace-nowrap">繳費期間</th>
                    <th className="px-3 py-2.5 text-left font-semibold whitespace-nowrap">繳費證明</th>
                    <th className="px-3 py-2.5 text-left font-semibold whitespace-nowrap">備註</th>
                    <th className="px-3 py-2.5 text-left font-semibold whitespace-nowrap">登記人</th>
                    {canEdit && <th className="px-3 py-2.5 text-center font-semibold">操作</th>}
                  </tr>
                </thead>
                <tbody>
                  {records.map((r) => (
                    <tr key={r.id} className="border-t border-gray-100 hover:bg-gray-50">
                      <td className="px-3 py-2 font-medium text-gray-800">{r.association_city}</td>
                      <td className="px-3 py-2 whitespace-nowrap">
                        <span className="inline-flex items-center rounded-full bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-700">
                          {r.fee_year} 年
                        </span>
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap text-xs text-gray-600">
                        {r.fee_period_start
                          ? r.fee_period_start.slice(0, 10)
                          : '—'}
                        {r.fee_period_start && r.fee_period_end ? ' ~ ' : ''}
                        {r.fee_period_end ? r.fee_period_end.slice(0, 10) : ''}
                      </td>
                      <td className="px-3 py-2">
                        {r.payment_proof_path ? (
                          <button
                            type="button"
                            disabled={viewingProof === r.payment_proof_path}
                            onClick={() => handleViewProof(r.payment_proof_path!)}
                            className="text-blue-600 hover:underline text-xs disabled:opacity-50"
                          >
                            {viewingProof === r.payment_proof_path ? '取得中…' : '查看'}
                          </button>
                        ) : (
                          <span className="text-gray-300 text-xs">無</span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-xs text-gray-600 max-w-[140px]">
                        <span title={r.notes || ''} className="line-clamp-2">{r.notes || '—'}</span>
                      </td>
                      <td className="px-3 py-2 text-xs text-gray-400">
                        {r.created_by ? r.created_by.split('@')[0] : '—'}
                      </td>
                      {canEdit && (
                        <td className="px-3 py-2 text-center">
                          <button
                            type="button"
                            onClick={() => handleDelete(r.id)}
                            className="text-rose-400 hover:text-rose-600 text-xs font-medium"
                          >
                            刪除
                          </button>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* 新增按鈕 / 表單 */}
          {canEdit && (
            !showForm ? (
              <button
                type="button"
                onClick={() => setShowForm(true)}
                className="flex items-center gap-1.5 rounded-lg border border-dashed border-gray-300 px-4 py-2 text-sm text-gray-600 hover:border-blue-400 hover:text-blue-600 transition-colors"
              >
                <span className="text-base leading-none">+</span> 新增年費記錄
              </button>
            ) : (
              <div className="rounded-xl border border-blue-200 bg-blue-50/60 p-5 space-y-4">
                <h3 className="text-sm font-semibold text-blue-900">新增常年會費申請記錄</h3>

                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  {/* 縣市公會（datalist 可打字篩選） */}
                  <div>
                    <label className="mb-1 block text-xs font-medium text-gray-700">
                      縣市公會 <span className="text-rose-500">*</span>
                    </label>
                    <input
                      list="taiwan-cities-datalist"
                      value={cityQuery}
                      onChange={(e) => {
                        setCityQuery(e.target.value);
                        setForm((f) => ({ ...f, association_city: e.target.value }));
                      }}
                      onFocus={() => setCityOpen(true)}
                      onBlur={() => setTimeout(() => setCityOpen(false), 100)}
                      placeholder="輸入或選擇縣市，例：基隆市"
                      className="w-full rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm focus:border-blue-500 focus:outline-none"
                    />
                    <datalist id="taiwan-cities-datalist">
                      {TAIWAN_CITIES.map((c) => (
                        <option key={c} value={c} />
                      ))}
                    </datalist>
                    {/* 自訂下拉補充（datalist 樣式限制時） */}
                    {cityOpen && cityQuery && filteredCities.length > 0 && !TAIWAN_CITIES.includes(cityQuery as typeof TAIWAN_CITIES[number]) && (
                      <ul className="mt-1 rounded-lg border border-gray-200 bg-white shadow-md max-h-40 overflow-y-auto">
                        {filteredCities.map((c) => (
                          <li
                            key={c}
                            onMouseDown={() => {
                              setCityQuery(c);
                              setForm((f) => ({ ...f, association_city: c }));
                              setCityOpen(false);
                            }}
                            className="cursor-pointer px-3 py-1.5 text-sm hover:bg-blue-50"
                          >
                            {c}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>

                  {/* 申請年度 */}
                  <div>
                    <label className="mb-1 block text-xs font-medium text-gray-700">
                      申請年度 <span className="text-rose-500">*</span>
                    </label>
                    <input
                      type="number"
                      min={2000}
                      max={2100}
                      value={form.fee_year}
                      onChange={(e) => setForm((f) => ({ ...f, fee_year: Number(e.target.value) }))}
                      className="w-full rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm focus:border-blue-500 focus:outline-none"
                    />
                  </div>

                  {/* 繳費期間 起 */}
                  <div>
                    <label className="mb-1 block text-xs font-medium text-gray-700">繳費期間（起）</label>
                    <input
                      type="date"
                      value={form.fee_period_start}
                      onChange={(e) => setForm((f) => ({ ...f, fee_period_start: e.target.value }))}
                      className="w-full rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm focus:border-blue-500 focus:outline-none"
                    />
                  </div>

                  {/* 繳費期間 迄 */}
                  <div>
                    <label className="mb-1 block text-xs font-medium text-gray-700">繳費期間（迄）</label>
                    <input
                      type="date"
                      value={form.fee_period_end}
                      onChange={(e) => setForm((f) => ({ ...f, fee_period_end: e.target.value }))}
                      className="w-full rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm focus:border-blue-500 focus:outline-none"
                    />
                  </div>
                </div>

                {/* 繳費證明上傳 */}
                <div>
                  <label className="mb-1 block text-xs font-medium text-gray-700">
                    繳費證明（照片或 PDF，最大 10 MB）
                  </label>
                  <input
                    type="file"
                    accept="image/*,application/pdf,.heic,.heif,.pdf"
                    onChange={(e) => setSelectedFile(e.target.files?.[0] ?? null)}
                    className="w-full text-sm text-gray-600
                      file:mr-3 file:cursor-pointer file:rounded-md file:border-0
                      file:bg-blue-100 file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-blue-700
                      hover:file:bg-blue-200"
                  />
                  {selectedFile && (
                    <p className="mt-1 text-xs text-gray-500">
                      已選擇：{selectedFile.name}　（{(selectedFile.size / 1024).toFixed(0)} KB）
                    </p>
                  )}
                </div>

                {/* 備註 */}
                <div>
                  <label className="mb-1 block text-xs font-medium text-gray-700">備註</label>
                  <input
                    type="text"
                    value={form.notes}
                    onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
                    placeholder="選填"
                    className="w-full rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm focus:border-blue-500 focus:outline-none"
                  />
                </div>

                {formError && (
                  <p className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-600">
                    {formError}
                  </p>
                )}

                <div className="flex gap-2">
                  <button
                    type="button"
                    disabled={submitting}
                    onClick={handleSubmit}
                    className="rounded-lg bg-blue-600 px-5 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50 transition-colors"
                  >
                    {submitting ? '儲存中…' : '儲存'}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setShowForm(false);
                      resetForm();
                    }}
                    className="rounded-lg border border-gray-300 px-4 py-1.5 text-sm text-gray-600 hover:bg-gray-50"
                  >
                    取消
                  </button>
                </div>
              </div>
            )
          )}
        </div>
      </div>
    </div>
  );
}
