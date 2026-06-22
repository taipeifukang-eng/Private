'use client';

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as XLSX from 'xlsx';
import {
  CheckCircle2,
  Download,
  Edit3,
  FileSpreadsheet,
  Loader2,
  Plus,
  RefreshCw,
  Search,
  Trash2,
  Upload,
  UserRound,
  UsersRound,
  X,
} from 'lucide-react';

type Member = {
  id: string;
  member_name: string;
  phone: string;
  relationship: string;
  member_number: string | null;
  is_approved: boolean;
  approved_at: string | null;
  created_at: string;
  updated_at: string;
  creator?: { full_name?: string | null; email?: string | null } | null;
  approver?: { full_name?: string | null; email?: string | null } | null;
};

type Sale = {
  id: string;
  store_code: string | null;
  sale_datetime: string | null;
  member_number: string;
  member_name: string | null;
  product_code: string;
  product_name: string;
  quantity: number;
  amount: number;
  imported_at: string;
  import?: { file_name?: string } | null;
};

type MemberForm = {
  member_name: string;
  phone: string;
  relationship: string;
  member_number: string;
};

type MemberFilterTab = 'all' | 'approved_missing_number' | 'unapproved';

const EMPTY_FORM: MemberForm = {
  member_name: '',
  phone: '',
  relationship: '',
  member_number: '',
};

function creatorName(member: Member) {
  return member.creator?.full_name || member.creator?.email || '-';
}

function approverName(member: Member) {
  return member.approver?.full_name || member.approver?.email || '-';
}

function formatDateTime(value: string | null) {
  if (!value) return '';
  return new Date(value).toLocaleString('zh-TW', {
    timeZone: 'Asia/Taipei',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

async function readError(response: Response) {
  const payload = await response.json().catch(() => ({}));
  return payload.error || '操作失敗';
}

export default function RelationshipMembersClient({
  canSubmit,
  canViewSales,
  canEdit,
  canDelete,
  canApprove,
}: {
  canSubmit: boolean;
  canViewSales: boolean;
  canEdit: boolean;
  canDelete: boolean;
  canApprove: boolean;
}) {
  const [tab, setTab] = useState<'members' | 'sales'>('members');
  const [members, setMembers] = useState<Member[]>([]);
  const [sales, setSales] = useState<Sale[]>([]);
  const [form, setForm] = useState<MemberForm>(EMPTY_FORM);
  const [editing, setEditing] = useState<Member | null>(null);
  const [loadingMembers, setLoadingMembers] = useState(true);
  const [loadingSales, setLoadingSales] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [approvingId, setApprovingId] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [memberFilterTab, setMemberFilterTab] = useState<MemberFilterTab>('all');
  const [filters, setFilters] = useState({ member_name: '', member_number: '' });
  const fileInputRef = useRef<HTMLInputElement>(null);

  const loadMembers = useCallback(async () => {
    setLoadingMembers(true);
    const response = await fetch('/api/relationship-members', { cache: 'no-store' });
    if (response.ok) {
      const payload = await response.json();
      setMembers(payload.members || []);
    } else {
      setMessage({ type: 'error', text: await readError(response) });
    }
    setLoadingMembers(false);
  }, []);

  const loadSales = useCallback(async (currentFilters = filters) => {
    setLoadingSales(true);
    const params = new URLSearchParams();
    if (currentFilters.member_name.trim()) params.set('member_name', currentFilters.member_name.trim());
    if (currentFilters.member_number.trim()) params.set('member_number', currentFilters.member_number.trim());
    const response = await fetch(`/api/relationship-sales?${params.toString()}`, { cache: 'no-store' });
    if (response.ok) {
      const payload = await response.json();
      setSales(payload.sales || []);
    } else {
      setMessage({ type: 'error', text: await readError(response) });
    }
    setLoadingSales(false);
  }, [filters]);

  useEffect(() => {
    loadMembers();
  }, [loadMembers]);

  useEffect(() => {
    if (tab === 'sales' && sales.length === 0) loadSales();
  }, [tab]);

  async function submitMember(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setMessage(null);
    const response = await fetch(editing ? `/api/relationship-members/${editing.id}` : '/api/relationship-members', {
      method: editing ? 'PATCH' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(form),
    });
    if (response.ok) {
      setMessage({ type: 'success', text: editing ? '關係會員資料已更新' : '關係會員申請已建立' });
      setEditing(null);
      setForm(EMPTY_FORM);
      await loadMembers();
    } else {
      setMessage({ type: 'error', text: await readError(response) });
    }
    setSaving(false);
  }

  function beginEdit(member: Member) {
    setEditing(member);
    setForm({
      member_name: member.member_name,
      phone: member.phone,
      relationship: member.relationship,
      member_number: member.member_number || '',
    });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function cancelEdit() {
    setEditing(null);
    setForm(EMPTY_FORM);
  }

  async function deleteMember(member: Member) {
    if (!window.confirm(`確定要刪除關係會員「${member.member_name}」嗎？\n銷售歷史明細將會保留。`)) return;
    setDeletingId(member.id);
    setMessage(null);
    const response = await fetch(`/api/relationship-members/${member.id}`, { method: 'DELETE' });
    if (response.ok) {
      if (editing?.id === member.id) cancelEdit();
      setMessage({ type: 'success', text: `已刪除關係會員「${member.member_name}」` });
      await loadMembers();
    } else {
      setMessage({ type: 'error', text: await readError(response) });
    }
    setDeletingId(null);
  }

  async function approveMember(member: Member) {
    setApprovingId(member.id);
    setMessage(null);
    const response = await fetch(`/api/relationship-members/${member.id}/approve`, { method: 'POST' });
    if (response.ok) {
      setMessage({ type: 'success', text: `已核可關係會員「${member.member_name}」` });
      await loadMembers();
    } else {
      setMessage({ type: 'error', text: await readError(response) });
    }
    setApprovingId(null);
  }

  function downloadTemplate() {
    const sheet = XLSX.utils.json_to_sheet([
      { 門市代號: 'FK001', 銷售日期: '2026/06/12 14:30', 會員編號: 'M00001', 品號: 'P001', 品名: '範例商品', 數量: 1, 金額: 100 },
    ]);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, sheet, '關係會員銷售明細');
    XLSX.writeFile(workbook, '關係會員銷售明細匯入範本.xlsx');
  }

  async function importFile(file: File) {
    setImporting(true);
    setMessage(null);
    const formData = new FormData();
    formData.append('file', file);
    const response = await fetch('/api/relationship-sales/import', { method: 'POST', body: formData });
    if (response.ok) {
      const payload = await response.json();
      setMessage({ type: 'success', text: `匯入完成，共新增 ${payload.imported} 筆銷售明細` });
      await loadSales({ member_name: '', member_number: '' });
      setTab('sales');
    } else {
      setMessage({ type: 'error', text: await readError(response) });
    }
    if (fileInputRef.current) fileInputRef.current.value = '';
    setImporting(false);
  }

  const totalAmount = sales.reduce((sum, item) => sum + Number(item.amount || 0), 0);
  const totalQuantity = sales.reduce((sum, item) => sum + Number(item.quantity || 0), 0);
  const hasMemberActions = canEdit || canDelete || canApprove;
  const memberColumnCount = hasMemberActions ? 7 : 6;
  const memberFilterCounts = useMemo(() => ({
    all: members.length,
    approved_missing_number: members.filter((member) => member.is_approved && !String(member.member_number || '').trim()).length,
    unapproved: members.filter((member) => !member.is_approved).length,
  }), [members]);
  const filteredMembers = useMemo(() => {
    if (memberFilterTab === 'approved_missing_number') {
      return members.filter((member) => member.is_approved && !String(member.member_number || '').trim());
    }
    if (memberFilterTab === 'unapproved') {
      return members.filter((member) => !member.is_approved);
    }
    return members;
  }, [memberFilterTab, members]);
  const memberFilterTabs: { key: MemberFilterTab; label: string }[] = [
    { key: 'all', label: '全部' },
    { key: 'approved_missing_number', label: '待填寫(已核可)' },
    { key: 'unapproved', label: '未核可' },
  ];

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-6 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-7xl">
        <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="flex items-center gap-3 text-3xl font-bold text-slate-900">
              <UsersRound className="text-indigo-600" />
              關係會員
            </h1>
            <p className="mt-1 text-sm text-slate-600">管理關係會員申請資料與銷售明細</p>
          </div>
          <button
            onClick={() => { loadMembers(); if (tab === 'sales') loadSales(); }}
            className="inline-flex items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100"
          >
            <RefreshCw size={16} />重新整理
          </button>
        </div>

        {message && (
          <div className={`mb-5 whitespace-pre-line rounded-lg border px-4 py-3 text-sm ${message.type === 'success' ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-red-200 bg-red-50 text-red-800'}`}>
            {message.text}
          </div>
        )}

        <div className="mb-6 flex gap-2 border-b border-slate-200">
          <button onClick={() => setTab('members')} className={`border-b-2 px-4 py-3 text-sm font-semibold ${tab === 'members' ? 'border-indigo-600 text-indigo-700' : 'border-transparent text-slate-500 hover:text-slate-800'}`}>
            會員申請與檢視
          </button>
          {canViewSales && (
            <button onClick={() => setTab('sales')} className={`border-b-2 px-4 py-3 text-sm font-semibold ${tab === 'sales' ? 'border-indigo-600 text-indigo-700' : 'border-transparent text-slate-500 hover:text-slate-800'}`}>
              銷售明細報表
            </button>
          )}
        </div>

        {tab === 'members' ? (
          <div className="space-y-6">
            {canSubmit && <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
                <div className="mb-4 flex items-center justify-between">
                  <h2 className="flex items-center gap-2 text-lg font-bold text-slate-900">
                    {editing ? <Edit3 size={20} /> : <Plus size={20} />}
                    {editing ? '再編輯關係會員' : '填寫關係會員申請'}
                  </h2>
                  {editing && <button onClick={cancelEdit} className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-800"><X size={16} />取消編輯</button>}
                </div>
                <form onSubmit={submitMember} className="grid gap-4 md:grid-cols-4">
                  <label className="text-sm font-medium text-slate-700">關係會員姓名
                    <input required value={form.member_name} onChange={(e) => setForm({ ...form, member_name: e.target.value })} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100" />
                  </label>
                  <label className="text-sm font-medium text-slate-700">電話
                    <input required value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100" />
                  </label>
                  <label className="text-sm font-medium text-slate-700">關係
                    <input required value={form.relationship} onChange={(e) => setForm({ ...form, relationship: e.target.value })} placeholder="例如：配偶、父母、朋友" className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100" />
                  </label>
                  <label className="text-sm font-medium text-slate-700">會員編號
                    <input disabled={!editing} value={form.member_number} onChange={(e) => setForm({ ...form, member_number: e.target.value })} placeholder={editing ? '可於再編輯時填寫' : '建立後再編輯填寫'} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 outline-none disabled:bg-slate-100 disabled:text-slate-500 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100" />
                  </label>
                  <div className="md:col-span-4 flex justify-end">
                    <button disabled={saving} className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-5 py-2.5 font-semibold text-white hover:bg-indigo-700 disabled:opacity-60">
                      {saving && <Loader2 size={16} className="animate-spin" />}{editing ? '儲存修改' : '送出申請'}
                    </button>
                  </div>
                </form>
              </section>}

            <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
              <div className="border-b border-slate-200 px-5 py-4">
                <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                  <h2 className="font-bold text-slate-900">關係會員檢視表</h2>
                  <div className="flex flex-wrap gap-2">
                    {memberFilterTabs.map((filterTab) => (
                      <button
                        key={filterTab.key}
                        type="button"
                        onClick={() => setMemberFilterTab(filterTab.key)}
                        className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm font-semibold ${
                          memberFilterTab === filterTab.key
                            ? 'border-indigo-200 bg-indigo-50 text-indigo-700'
                            : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                        }`}
                      >
                        {filterTab.label}
                        <span className={`rounded-full px-2 py-0.5 text-xs ${
                          memberFilterTab === filterTab.key
                            ? 'bg-indigo-100 text-indigo-700'
                            : 'bg-slate-100 text-slate-600'
                        }`}>
                          {memberFilterCounts[filterTab.key]}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              </div>
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-slate-200 text-sm">
                  <thead className="bg-slate-50 text-left text-slate-600">
                    <tr>
                      <th className="px-4 py-3">姓名</th>
                      <th className="px-4 py-3">電話</th>
                      <th className="px-4 py-3">關係</th>
                      <th className="px-4 py-3">填表人</th>
                      <th className="px-4 py-3">會員編號</th>
                      <th className="px-4 py-3">核可</th>
                      {hasMemberActions && <th className="px-4 py-3 text-center">操作</th>}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {loadingMembers ? (
                      <tr>
                        <td colSpan={memberColumnCount} className="px-4 py-12 text-center text-slate-500">
                          <Loader2 className="mx-auto animate-spin" />
                        </td>
                      </tr>
                    ) : filteredMembers.length === 0 ? (
                      <tr>
                        <td colSpan={memberColumnCount} className="px-4 py-12 text-center text-slate-500">
                          {members.length === 0 ? '尚無關係會員資料' : '此篩選條件下沒有關係會員資料'}
                        </td>
                      </tr>
                    ) : filteredMembers.map((member) => (
                      <tr key={member.id} className="hover:bg-slate-50">
                        <td className="px-4 py-3 font-semibold text-slate-900">{member.member_name}</td>
                        <td className="px-4 py-3">{member.phone}</td>
                        <td className="px-4 py-3">{member.relationship}</td>
                        <td className="px-4 py-3">{creatorName(member)}</td>
                        <td className="px-4 py-3 font-mono">
                          {member.member_number || <span className="text-amber-600">待填寫</span>}
                        </td>
                        <td className="px-4 py-3">
                          {member.is_approved ? (
                            <div className="space-y-1">
                              <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700">
                                <CheckCircle2 size={14} />已核可
                              </span>
                              <div className="text-xs text-slate-500">
                                {approverName(member)} {formatDateTime(member.approved_at)}
                              </div>
                            </div>
                          ) : (
                            <span className="inline-flex rounded-full bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-700">
                              待核可
                            </span>
                          )}
                        </td>
                        {hasMemberActions && (
                          <td className="px-4 py-3 text-center">
                            <div className="flex justify-center gap-2">
                              {canApprove && !member.is_approved && (
                                <button
                                  disabled={approvingId === member.id}
                                  onClick={() => approveMember(member)}
                                  className="inline-flex items-center gap-1 rounded-md bg-emerald-50 px-3 py-1.5 font-medium text-emerald-700 hover:bg-emerald-100 disabled:opacity-60"
                                >
                                  {approvingId === member.id ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />}
                                  核可
                                </button>
                              )}
                              {canEdit && (
                                <button onClick={() => beginEdit(member)} className="inline-flex items-center gap-1 rounded-md bg-slate-100 px-3 py-1.5 font-medium text-slate-700 hover:bg-slate-200">
                                  <Edit3 size={14} />再編輯
                                </button>
                              )}
                              {canDelete && (
                                <button disabled={deletingId === member.id} onClick={() => deleteMember(member)} className="inline-flex items-center gap-1 rounded-md bg-red-50 px-3 py-1.5 font-medium text-red-700 hover:bg-red-100 disabled:opacity-60">
                                  {deletingId === member.id ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}刪除
                                </button>
                              )}
                            </div>
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          </div>
        ) : (
          <div className="space-y-5">
            {canEdit && (
              <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
                <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                  <div><h2 className="flex items-center gap-2 font-bold text-slate-900"><FileSpreadsheet size={20} />匯入關係會員銷售明細</h2><p className="mt-1 text-sm text-slate-500">僅支援 .xlsx，欄位順序：門市代號、銷售日期、會員編號、品號、品名、數量、金額；日期格式 YYYY/MM/DD HH:MM</p></div>
                  <div className="flex flex-wrap gap-2">
                    <button onClick={downloadTemplate} className="inline-flex items-center gap-2 rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"><Download size={16} />下載範本</button>
                    <input ref={fileInputRef} type="file" accept=".xlsx" className="hidden" onChange={(e) => { const file = e.target.files?.[0]; if (file) importFile(file); }} />
                    <button disabled={importing} onClick={() => fileInputRef.current?.click()} className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-60">{importing ? <Loader2 size={16} className="animate-spin" /> : <Upload size={16} />}{importing ? '匯入中' : '選擇檔案匯入'}</button>
                  </div>
                </div>
              </section>
            )}

            <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
              <form onSubmit={(e) => { e.preventDefault(); loadSales(); }} className="grid gap-3 md:grid-cols-[1fr_1fr_auto_auto] md:items-end">
                <label className="text-sm font-medium text-slate-700">關係會員姓名<input value={filters.member_name} onChange={(e) => setFilters({ ...filters, member_name: e.target.value })} placeholder="輸入姓名查詢" className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2" /></label>
                <label className="text-sm font-medium text-slate-700">會員編號<input value={filters.member_number} onChange={(e) => setFilters({ ...filters, member_number: e.target.value })} placeholder="輸入會員編號查詢" className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2" /></label>
                <button className="inline-flex items-center justify-center gap-2 rounded-lg bg-slate-900 px-4 py-2 font-semibold text-white hover:bg-slate-800"><Search size={16} />查詢</button>
                <button type="button" onClick={() => { const empty = { member_name: '', member_number: '' }; setFilters(empty); loadSales(empty); }} className="rounded-lg border border-slate-300 px-4 py-2 font-medium text-slate-700 hover:bg-slate-50">清除</button>
              </form>
            </section>

            <div className="grid gap-3 sm:grid-cols-3">
              <div className="rounded-xl border border-slate-200 bg-white p-4"><div className="text-xs text-slate-500">明細筆數</div><div className="mt-1 text-2xl font-bold text-slate-900">{sales.length.toLocaleString('zh-TW')}</div></div>
              <div className="rounded-xl border border-slate-200 bg-white p-4"><div className="text-xs text-slate-500">數量合計</div><div className="mt-1 text-2xl font-bold text-slate-900">{totalQuantity.toLocaleString('zh-TW')}</div></div>
              <div className="rounded-xl border border-slate-200 bg-white p-4"><div className="text-xs text-slate-500">金額合計</div><div className="mt-1 text-2xl font-bold text-indigo-700">NT$ {totalAmount.toLocaleString('zh-TW')}</div></div>
            </div>

            <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
              <div className="overflow-x-auto"><table className="min-w-full divide-y divide-slate-200 text-sm"><thead className="bg-slate-50 text-left text-slate-600"><tr><th className="px-4 py-3">門市代號</th><th className="px-4 py-3">銷售日期</th><th className="px-4 py-3">會員姓名</th><th className="px-4 py-3">會員編號</th><th className="px-4 py-3">品號</th><th className="px-4 py-3">品名</th><th className="px-4 py-3 text-right">數量</th><th className="px-4 py-3 text-right">金額</th></tr></thead><tbody className="divide-y divide-slate-100">{loadingSales ? <tr><td colSpan={8} className="px-4 py-12 text-center"><Loader2 className="mx-auto animate-spin text-slate-500" /></td></tr> : sales.length === 0 ? <tr><td colSpan={8} className="px-4 py-12 text-center text-slate-500">查無銷售明細</td></tr> : sales.map((sale) => <tr key={sale.id} className="hover:bg-slate-50"><td className="px-4 py-3 font-mono">{sale.store_code || '-'}</td><td className="whitespace-nowrap px-4 py-3">{sale.sale_datetime ? new Date(sale.sale_datetime).toLocaleString('zh-TW', { timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }) : '-'}</td><td className="px-4 py-3 font-medium">{sale.member_name || <span className="text-slate-400">未對應</span>}</td><td className="px-4 py-3 font-mono">{sale.member_number}</td><td className="px-4 py-3 font-mono">{sale.product_code}</td><td className="px-4 py-3">{sale.product_name}</td><td className="px-4 py-3 text-right">{Number(sale.quantity).toLocaleString('zh-TW')}</td><td className="px-4 py-3 text-right font-medium">{Number(sale.amount).toLocaleString('zh-TW')}</td></tr>)}</tbody></table></div>
            </section>
          </div>
        )}
      </div>
    </main>
  );
}
