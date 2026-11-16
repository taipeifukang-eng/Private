'use client';

import { useCallback, useEffect, useState } from 'react';
import { AlertCircle, ChevronDown, ChevronRight, Pencil, Plus, Save, Trash2, X } from 'lucide-react';

type AliasItem = {
  id: string;
  alias: string;
  store_id: string;
  store_code: string;
  store_name: string;
  editable: boolean;
};
type StoreOption = { id: string; store_code: string; store_name: string };

/** 門市簡稱對照表：匯入 Google Sheet 時，表上的簡稱靠這張表對到門市。 */
export default function PrescriptionAliasPanel({ stores, canEdit, refreshKey }: { stores: StoreOption[]; canEdit: boolean; refreshKey: number }) {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<AliasItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftAlias, setDraftAlias] = useState('');
  const [draftStore, setDraftStore] = useState('');
  const [newAlias, setNewAlias] = useState('');
  const [newStore, setNewStore] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const response = await fetch('/api/prescription-monthly/aliases', { cache: 'no-store' });
      const json = await response.json();
      if (!response.ok) throw new Error(json.error || '讀取對照表失敗');
      setItems(json.aliases || []);
    } catch (e: any) {
      setError(e.message || '讀取對照表失敗');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { if (open) void load(); }, [open, load, refreshKey]);

  async function call(url: string, init: RequestInit, failure: string) {
    setBusy(true);
    setError('');
    try {
      const response = await fetch(url, { ...init, headers: { 'Content-Type': 'application/json' } });
      const json = await response.json();
      if (!response.ok) throw new Error(json.error || failure);
      await load();
      return true;
    } catch (e: any) {
      setError(e.message || failure);
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function add() {
    if (!newAlias.trim() || !newStore) { setError('請填簡稱並選擇門市'); return; }
    if (await call('/api/prescription-monthly/aliases', { method: 'POST', body: JSON.stringify({ alias: newAlias, store_id: newStore }) }, '新增失敗')) {
      setNewAlias('');
      setNewStore('');
    }
  }

  async function saveEdit(id: string) {
    if (await call(`/api/prescription-monthly/aliases/${id}`, { method: 'PATCH', body: JSON.stringify({ alias: draftAlias, store_id: draftStore }) }, '修改失敗')) setEditingId(null);
  }

  async function remove(item: AliasItem) {
    if (!window.confirm(`確定刪除簡稱「${item.alias}」的對照？之後匯入時這個簡稱會重新比對或請你選擇。`)) return;
    await call(`/api/prescription-monthly/aliases/${item.id}`, { method: 'DELETE' }, '刪除失敗');
  }

  const select = 'h-9 min-w-[200px] rounded border border-slate-300 bg-white px-2 text-sm focus:border-orange-500 focus:outline-none focus:ring-2 focus:ring-orange-200';
  const input = 'h-9 w-36 rounded border border-slate-300 bg-white px-2 text-sm focus:border-orange-500 focus:outline-none focus:ring-2 focus:ring-orange-200';

  return (
    <section className="mt-6 rounded-md border border-slate-200 bg-white" aria-label="門市簡稱對照表">
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 px-4 py-3 text-left text-sm font-medium text-slate-800 hover:bg-slate-50"
      >
        {open ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
        門市簡稱對照表
        <span className="font-normal text-slate-500">（匯入 Google Sheet 時，表上的簡稱靠這張表對到門市）</span>
      </button>
      {open && (
        <div className="border-t border-slate-200 px-4 py-3">
          <p className="mb-3 text-sm text-slate-600">
            一個簡稱只對一家門市；一家門市可以有好幾個簡稱。匯入時先看這張表，沒有才用門市名稱自動比對，再對不上就請你選。
            {canEdit ? '' : '（你只有查看權限，無法修改。）'}
          </p>
          {error && (
            <div role="alert" className="mb-3 flex items-start gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
              <AlertCircle size={16} className="mt-0.5 shrink-0" /><span>{error}</span>
            </div>
          )}
          {canEdit && (
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <input value={newAlias} onChange={e => setNewAlias(e.target.value)} placeholder="簡稱，例如：南港" aria-label="新增簡稱" className={input} maxLength={40} />
              <select value={newStore} onChange={e => setNewStore(e.target.value)} aria-label="新增簡稱的門市" className={select}>
                <option value="">請選擇門市…</option>
                {stores.map(s => <option key={s.id} value={s.id}>{s.store_code} {s.store_name}</option>)}
              </select>
              <button type="button" onClick={add} disabled={busy} className="inline-flex h-9 items-center gap-1 rounded border border-orange-700 bg-orange-700 px-3 text-sm text-white hover:bg-orange-800 disabled:opacity-50"><Plus size={14} />新增</button>
            </div>
          )}
          <div className="overflow-x-auto rounded border border-slate-200">
            <table className="w-full min-w-[560px] border-collapse text-sm">
              <thead className="bg-slate-50 text-left text-xs font-medium text-slate-600">
                <tr><th className="px-3 py-2">簡稱</th><th className="px-3 py-2">對應門市</th>{canEdit && <th className="px-3 py-2 w-40">操作</th>}</tr>
              </thead>
              <tbody>
                {loading && <tr><td colSpan={3} className="px-3 py-4 text-center text-slate-500">讀取中…</td></tr>}
                {!loading && items.length === 0 && <tr><td colSpan={3} className="px-3 py-4 text-center text-slate-500">還沒有任何對照。第一次匯入時選的門市會自動記在這裡。</td></tr>}
                {items.map(item => (
                  <tr key={item.id} className="border-t border-slate-100" data-testid="rx-alias-row">
                    {editingId === item.id ? (
                      <>
                        <td className="px-3 py-2"><input value={draftAlias} onChange={e => setDraftAlias(e.target.value)} aria-label="修改簡稱" className={input} maxLength={40} /></td>
                        <td className="px-3 py-2">
                          <select value={draftStore} onChange={e => setDraftStore(e.target.value)} aria-label="修改對應門市" className={select}>
                            {stores.map(s => <option key={s.id} value={s.id}>{s.store_code} {s.store_name}</option>)}
                          </select>
                        </td>
                        <td className="px-3 py-2">
                          <div className="flex gap-1">
                            <button type="button" onClick={() => saveEdit(item.id)} disabled={busy} aria-label="儲存簡稱" className="inline-flex h-8 items-center gap-1 rounded border border-orange-700 bg-orange-700 px-2 text-xs text-white disabled:opacity-50"><Save size={13} />儲存</button>
                            <button type="button" onClick={() => setEditingId(null)} aria-label="取消修改" className="inline-flex h-8 items-center rounded border border-slate-300 px-2 text-xs text-slate-700"><X size={13} /></button>
                          </div>
                        </td>
                      </>
                    ) : (
                      <>
                        <td className="px-3 py-2 font-medium text-slate-900">{item.alias}</td>
                        <td className="px-3 py-2 text-slate-700">{item.store_code} {item.store_name}</td>
                        {canEdit && (
                          <td className="px-3 py-2">
                            {item.editable ? (
                              <div className="flex gap-1">
                                <button type="button" onClick={() => { setEditingId(item.id); setDraftAlias(item.alias); setDraftStore(item.store_id); }} aria-label={`修改簡稱 ${item.alias}`} className="inline-flex h-8 items-center gap-1 rounded border border-slate-300 px-2 text-xs text-slate-700 hover:bg-slate-50"><Pencil size={13} />修改</button>
                                <button type="button" onClick={() => remove(item)} disabled={busy} aria-label={`刪除簡稱 ${item.alias}`} className="inline-flex h-8 items-center gap-1 rounded border border-red-300 px-2 text-xs text-red-700 hover:bg-red-50 disabled:opacity-50"><Trash2 size={13} />刪除</button>
                              </div>
                            ) : <span className="text-xs text-slate-400">非你管理的門市</span>}
                          </td>
                        )}
                      </>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </section>
  );
}
