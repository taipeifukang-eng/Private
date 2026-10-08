'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  CirclePlus,
  FileUp,
  History,
  Pencil,
  Search,
  Share2,
  Trash2,
  X,
} from 'lucide-react';
import {
  ORGANIZATION_CALENDAR_EVENT_TYPE_LABELS,
  ORGANIZATION_CALENDAR_HOLIDAY_TYPE_LABELS,
  ORGANIZATION_CALENDAR_HOLIDAY_TYPES,
  isCalendarDate,
  type OrganizationCalendarEventType,
  type OrganizationCalendarHolidayType,
} from '@/lib/admin/organization-calendar';

type SourceKind = 'company' | 'personal' | 'holiday';
type CalendarEntry = {
  id: string;
  key: string;
  source: SourceKind;
  title: string;
  start_date: string;
  end_date: string;
  description?: string | null;
  event_type?: OrganizationCalendarEventType;
  day_type?: string;
  owner_id?: string;
};
type Person = { id: string; name: string; employee_code: string | null };
type Share = {
  id: string;
  event_id: string;
  parent_share_id: string | null;
  shared_by_user_id: string;
  shared_with_user_id: string;
  created_at: string;
  revoked_at: string | null;
  is_effective: boolean;
};
type ShareData = {
  shares: Share[];
  isOwner: boolean;
  currentUserId: string;
  owner: Person | null;
  people: Record<string, Person>;
};
type CalendarAudit = {
  id: string;
  action: 'created' | 'updated' | 'cancelled';
  actor_name: string;
  changed_at: string;
  before_data: Record<string, unknown> | null;
  after_data: Record<string, unknown>;
};
type Draft = {
  title: string;
  event_type: OrganizationCalendarEventType;
  start_date: string;
  end_date: string;
  description: string;
};

const SOURCE_LABELS: Record<SourceKind, string> = {
  company: '公司行事',
  personal: '個人行程',
  holiday: '政府假日',
};

const SOURCE_STYLES: Record<SourceKind, { dot: string; chip: string; marker: string }> = {
  company: {
    dot: 'bg-blue-600',
    chip: 'border-blue-200 bg-blue-50 text-blue-800',
    marker: 'border-l-blue-600',
  },
  personal: {
    dot: 'bg-emerald-600',
    chip: 'border-emerald-200 bg-emerald-50 text-emerald-800',
    marker: 'border-l-emerald-600',
  },
  holiday: {
    dot: 'bg-rose-600',
    chip: 'border-rose-200 bg-rose-50 text-rose-800',
    marker: 'border-l-rose-600',
  },
};

const EVENT_TYPE_VALUES = Object.keys(ORGANIZATION_CALENDAR_EVENT_TYPE_LABELS) as OrganizationCalendarEventType[];
const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六'];

function localDateString(date: Date) {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function shiftDate(value: string, days: number) {
  const date = new Date(`${value}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function formatDate(value: string) {
  const [year, month, day] = value.split('-');
  return `${year}/${Number(month)}/${Number(day)}`;
}

function parseHolidayRows(text: string) {
  const typeAliases: Record<string, OrganizationCalendarHolidayType> = {
    國定假日: 'national_holiday',
    假日: 'national_holiday',
    national_holiday: 'national_holiday',
    補假日: 'substitute_holiday',
    補假: 'substitute_holiday',
    substitute_holiday: 'substitute_holiday',
    補行上班: 'makeup_workday',
    補班: 'makeup_workday',
    makeup_workday: 'makeup_workday',
  };
  const lines = text.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  const rows = lines.map((line, index) => {
    const columns = line.split(line.includes('\t') ? '\t' : ',').map(value => value.trim());
    const [holiday_date, name, rawType] = columns;
    const day_type = typeAliases[rawType || ''];
    if (!isCalendarDate(holiday_date) || !name || !day_type || columns.length !== 3) {
      throw new Error(`第 ${index + 1} 列格式錯誤，請依序填寫日期、名稱、類型`);
    }
    return { holiday_date, name, day_type };
  });
  if (rows.length === 0) throw new Error('請貼上至少一筆日期資料');
  if (rows.length > 500) throw new Error('單次最多匯入 500 筆日期');
  return rows;
}

function auditValue(field: string, value: unknown) {
  if (value == null || value === '') return '未填寫';
  if (field === 'start_date' || field === 'end_date') return formatDate(String(value));
  if (field === 'event_type') return ORGANIZATION_CALENDAR_EVENT_TYPE_LABELS[value as OrganizationCalendarEventType] || String(value);
  if (field === 'status') return value === 'cancelled' ? '已取消' : '有效';
  return String(value);
}

function monthLabel(year: number, month: number) {
  return `${year} 年 ${month + 1} 月`;
}

function getMonthDays(year: number, month: number) {
  const firstWeekday = new Date(Date.UTC(year, month, 1)).getUTCDay();
  const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const count = Math.ceil((firstWeekday + daysInMonth) / 7) * 7;
  return Array.from({ length: count }, (_, index) => {
    const dayNumber = index - firstWeekday + 1;
    const date = new Date(Date.UTC(year, month, dayNumber));
    return {
      value: date.toISOString().slice(0, 10),
      day: date.getUTCDate(),
      inMonth: date.getUTCMonth() === month,
    };
  });
}

async function readResponse(response: Response) {
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || '操作失敗，請稍後再試');
  return payload;
}

function PeoplePicker({
  selected,
  onChange,
  label = '分享對象',
}: {
  selected: Person[];
  onChange: (people: Person[]) => void;
  label?: string;
}) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Person[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed.length < 2) {
      setResults([]);
      setLoading(false);
      return;
    }
    let cancelled = false;
    const timer = window.setTimeout(async () => {
      setLoading(true);
      try {
        const response = await fetch(`/api/organization/calendar/people?q=${encodeURIComponent(trimmed)}`, { cache: 'no-store' });
        const payload = await readResponse(response);
        if (!cancelled) setResults(payload.people || []);
      } catch {
        if (!cancelled) setResults([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, 250);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [query]);

  const selectedIds = new Set(selected.map(person => person.id));
  const available = results.filter(person => !selectedIds.has(person.id));

  return (
    <div>
      <label className="mb-1.5 block text-sm font-medium text-slate-700">{label}</label>
      <div className="flex min-h-10 items-center gap-2 rounded border border-slate-300 bg-white px-3 focus-within:border-blue-600 focus-within:ring-2 focus-within:ring-blue-100">
        <Search aria-hidden="true" className="h-4 w-4 shrink-0 text-slate-400" />
        <input
          value={query}
          onChange={event => setQuery(event.target.value)}
          placeholder="搜尋姓名或員編"
          className="h-9 min-w-0 flex-1 border-0 bg-transparent text-sm outline-none placeholder:text-slate-400 focus:ring-0"
        />
        {loading && <span className="text-xs text-slate-500">搜尋中</span>}
      </div>
      {selected.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-2">
          {selected.map(person => (
            <span key={person.id} className="inline-flex items-center gap-1.5 rounded border border-emerald-200 bg-emerald-50 px-2 py-1 text-xs text-emerald-900">
              {person.name}{person.employee_code ? ` · ${person.employee_code}` : ''}
              <button
                type="button"
                onClick={() => onChange(selected.filter(item => item.id !== person.id))}
                aria-label={`移除 ${person.name}`}
                className="rounded p-0.5 hover:bg-emerald-100"
              >
                <X aria-hidden="true" className="h-3.5 w-3.5" />
              </button>
            </span>
          ))}
        </div>
      )}
      {available.length > 0 && (
        <ul className="mt-1 max-h-36 overflow-auto rounded border border-slate-200 bg-white shadow-sm" role="listbox" aria-label={`${label}搜尋結果`}>
          {available.map(person => (
            <li key={person.id}>
              <button
                type="button"
                onClick={() => {
                  onChange([...selected, person]);
                  setQuery('');
                  setResults([]);
                }}
                className="flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-slate-50"
              >
                <span className="font-medium text-slate-800">{person.name}</span>
                <span className="text-xs text-slate-500">{person.employee_code || '無員編'}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {query.trim().length >= 2 && !loading && available.length === 0 && (
        <p className="mt-1 text-xs text-slate-500">沒有符合的人員</p>
      )}
    </div>
  );
}

export default function OrganizationCalendarClient({
  currentUserId,
  canCreateCompanyEvents,
  canEditCompanyEvents,
  canManageHolidays,
}: {
  currentUserId: string;
  canCreateCompanyEvents: boolean;
  canEditCompanyEvents: boolean;
  canManageHolidays: boolean;
}) {
  const today = localDateString(new Date());
  const [year, setYear] = useState(Number(today.slice(0, 4)));
  const [month, setMonth] = useState(Number(today.slice(5, 7)) - 1);
  const [selectedDate, setSelectedDate] = useState(today);
  const [view, setView] = useState<'month' | 'year'>('month');
  const [companyEvents, setCompanyEvents] = useState<any[]>([]);
  const [personalEvents, setPersonalEvents] = useState<any[]>([]);
  const [holidays, setHolidays] = useState<any[]>([]);
  const [holidaySource, setHolidaySource] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [visibleSources, setVisibleSources] = useState<Record<SourceKind, boolean>>({
    company: true,
    personal: true,
    holiday: true,
  });
  const [showForm, setShowForm] = useState(false);
  const [formKind, setFormKind] = useState<SourceKind>('personal');
  const [editingEntry, setEditingEntry] = useState<CalendarEntry | null>(null);
  const [saving, setSaving] = useState(false);
  const [draft, setDraft] = useState<Draft>({
    title: '',
    event_type: 'meeting',
    start_date: today,
    end_date: today,
    description: '',
  });
  const [formRecipients, setFormRecipients] = useState<Person[]>([]);
  const [shareEntry, setShareEntry] = useState<CalendarEntry | null>(null);
  const [shareData, setShareData] = useState<ShareData | null>(null);
  const [shareRecipients, setShareRecipients] = useState<Person[]>([]);
  const [shareLoading, setShareLoading] = useState(false);
  const [shareError, setShareError] = useState('');
  const [showHolidayImport, setShowHolidayImport] = useState(false);
  const [savingHolidayImport, setSavingHolidayImport] = useState(false);
  const [holidayImportDraft, setHolidayImportDraft] = useState({
    source_name: '行政院人事行政總處',
    source_url: '',
    source_revision: `${year} 年辦公日曆表`,
    rows: '',
  });
  const [historyEntry, setHistoryEntry] = useState<CalendarEntry | null>(null);
  const [history, setHistory] = useState<CalendarAudit[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState('');

  const loadCalendar = useCallback(async (targetYear = year) => {
    setLoading(true);
    setError('');
    try {
      const response = await fetch(`/api/organization/calendar?year=${targetYear}`, { cache: 'no-store' });
      const payload = await readResponse(response);
      setCompanyEvents(payload.companyEvents || []);
      setPersonalEvents(payload.personalEvents || []);
      setHolidays(payload.holidays || []);
      setHolidaySource(payload.holidaySource || null);
    } catch (loadError: any) {
      setError(loadError.message || '無法載入年度行事曆');
    } finally {
      setLoading(false);
    }
  }, [year]);

  useEffect(() => {
    void loadCalendar(year);
  }, [loadCalendar, year]);

  const entries = useMemo<CalendarEntry[]>(() => [
    ...companyEvents.map(event => ({
      ...event,
      key: `company:${event.id}`,
      source: 'company' as const,
    })),
    ...personalEvents.map(event => ({
      ...event,
      key: `personal:${event.id}`,
      source: 'personal' as const,
    })),
    ...holidays.map(holiday => ({
      id: holiday.id,
      key: `holiday:${holiday.id}`,
      source: 'holiday' as const,
      title: holiday.name,
      start_date: holiday.holiday_date,
      end_date: holiday.holiday_date,
      day_type: holiday.day_type,
    })),
  ].filter(entry => visibleSources[entry.source as SourceKind]).sort((a, b) => (
    a.start_date.localeCompare(b.start_date) || a.title.localeCompare(b.title, 'zh-Hant')
  )), [companyEvents, personalEvents, holidays, visibleSources]);

  const entriesForDate = useCallback((date: string) => entries.filter(entry => (
    entry.start_date <= date && entry.end_date >= date
  )), [entries]);

  const monthDays = useMemo(() => getMonthDays(year, month), [year, month]);
  const currentDayEntries = entriesForDate(selectedDate);
  const yearMonths = useMemo(() => Array.from({ length: 12 }, (_, index) => ({
    month: index,
    events: entries.filter(entry => Number(entry.start_date.slice(5, 7)) - 1 === index),
  })), [entries]);

  function moveMonth(delta: number) {
    const next = new Date(Date.UTC(year, month + delta, 1));
    setYear(next.getUTCFullYear());
    setMonth(next.getUTCMonth());
    setSelectedDate(`${next.getUTCFullYear()}-${`${next.getUTCMonth() + 1}`.padStart(2, '0')}-01`);
  }

  function selectDate(date: string) {
    setSelectedDate(date);
    const [nextYear, nextMonth] = date.split('-').map(Number);
    setYear(nextYear);
    setMonth(nextMonth - 1);
  }

  function beginCreate(kind: 'company' | 'personal', date = selectedDate) {
    setFormKind(kind);
    setEditingEntry(null);
    setDraft({ title: '', event_type: 'meeting', start_date: date, end_date: date, description: '' });
    setFormRecipients([]);
    setShowForm(true);
  }

  function beginEdit(entry: CalendarEntry) {
    setFormKind(entry.source as 'company' | 'personal');
    setEditingEntry(entry);
    setDraft({
      title: entry.title,
      event_type: entry.event_type || 'meeting',
      start_date: entry.start_date,
      end_date: entry.end_date,
      description: entry.description || '',
    });
    setFormRecipients([]);
    setShowForm(true);
  }

  async function saveEvent(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setNotice('');
    try {
      const isCompany = formKind === 'company';
      const url = isCompany
        ? '/api/organization/calendar/company-events'
        : '/api/organization/calendar/personal-events';
      const method = editingEntry ? 'PATCH' : 'POST';
      const body: Record<string, unknown> = { ...draft };
      if (editingEntry) body.id = editingEntry.id;
      if (!editingEntry && !isCompany && formRecipients.length > 0) {
        body.share_with_user_ids = formRecipients.map(person => person.id);
      }
      const response = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      await readResponse(response);
      setShowForm(false);
      setNotice(editingEntry ? '行事已更新' : '行事已建立');
      await loadCalendar(year);
    } catch (saveError: any) {
      setError(saveError.message || '儲存失敗');
    } finally {
      setSaving(false);
    }
  }

  async function cancelCompanyEvent(entry: CalendarEntry) {
    if (!window.confirm(`確定取消「${entry.title}」？`)) return;
    try {
      const response = await fetch('/api/organization/calendar/company-events', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: entry.id, status: 'cancelled' }),
      });
      await readResponse(response);
      setNotice('公司行事已取消');
      await loadCalendar(year);
    } catch (cancelError: any) {
      setError(cancelError.message || '取消失敗');
    }
  }

  async function deletePersonalEvent(entry: CalendarEntry) {
    if (!window.confirm(`確定刪除「${entry.title}」？`)) return;
    try {
      const response = await fetch(`/api/organization/calendar/personal-events?id=${encodeURIComponent(entry.id)}`, {
        method: 'DELETE',
      });
      await readResponse(response);
      setNotice('個人行程已刪除');
      await loadCalendar(year);
    } catch (deleteError: any) {
      setError(deleteError.message || '刪除失敗');
    }
  }

  async function openShare(entry: CalendarEntry) {
    setShareEntry(entry);
    setShareData(null);
    setShareRecipients([]);
    setShareError('');
    setShareLoading(true);
    try {
      const response = await fetch(`/api/organization/calendar/shares?event_id=${encodeURIComponent(entry.id)}`, { cache: 'no-store' });
      setShareData(await readResponse(response));
    } catch (loadError: any) {
      setShareError(loadError.message || '無法載入分享設定');
    } finally {
      setShareLoading(false);
    }
  }

  async function refreshShares() {
    if (!shareEntry) return;
    setShareLoading(true);
    try {
      const response = await fetch(`/api/organization/calendar/shares?event_id=${encodeURIComponent(shareEntry.id)}`, { cache: 'no-store' });
      setShareData(await readResponse(response));
    } catch (loadError: any) {
      setShareError(loadError.message || '無法更新分享設定');
    } finally {
      setShareLoading(false);
    }
  }

  async function addShares() {
    if (!shareEntry || !shareData || shareRecipients.length === 0) return;
    setShareLoading(true);
    setShareError('');
    try {
      const currentGrant = shareData.shares.find(share => (
        share.shared_with_user_id === currentUserId && share.is_effective
      ));
      const parentShareId = shareData.isOwner ? null : currentGrant?.id;
      if (!shareData.isOwner && !parentShareId) throw new Error('目前沒有有效的分享權限');

      for (const person of shareRecipients) {
        const response = await fetch('/api/organization/calendar/shares', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            event_id: shareEntry.id,
            shared_with_user_id: person.id,
            parent_share_id: parentShareId,
          }),
        });
        await readResponse(response);
      }
      setShareRecipients([]);
      setNotice('分享對象已新增');
      await refreshShares();
    } catch (shareError: any) {
      setShareError(shareError.message || '分享失敗');
      setShareLoading(false);
    }
  }

  async function revokeShare(shareId: string) {
    if (!window.confirm('撤回後，此分享及其轉分享對象都將無法查看。確定撤回？')) return;
    setShareLoading(true);
    setShareError('');
    try {
      const response = await fetch(`/api/organization/calendar/shares?id=${encodeURIComponent(shareId)}`, { method: 'DELETE' });
      await readResponse(response);
      setNotice('分享已撤回');
      await refreshShares();
    } catch (revokeError: any) {
      setShareError(revokeError.message || '撤回分享失敗');
      setShareLoading(false);
    }
  }

  async function importHolidays(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSavingHolidayImport(true);
    setError('');
    setNotice('');
    try {
      const holidays = parseHolidayRows(holidayImportDraft.rows);
      if (holidays.some(row => Number(row.holiday_date.slice(0, 4)) !== year)) {
        throw new Error(`每筆日期都必須是 ${year} 年`);
      }
      const response = await fetch('/api/organization/calendar/holidays', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          calendar_year: year,
          source_name: holidayImportDraft.source_name,
          source_url: holidayImportDraft.source_url,
          source_revision: holidayImportDraft.source_revision,
          holidays,
        }),
      });
      await readResponse(response);
      setShowHolidayImport(false);
      setHolidayImportDraft(current => ({ ...current, rows: '' }));
      setNotice(`${year} 年政府假日資料已發布（${holidays.length} 筆）`);
      await loadCalendar(year);
    } catch (importError: any) {
      setError(importError.message || '匯入政府假日失敗');
    } finally {
      setSavingHolidayImport(false);
    }
  }

  async function openHistory(entry: CalendarEntry) {
    setHistoryEntry(entry);
    setHistory([]);
    setHistoryError('');
    setHistoryLoading(true);
    try {
      const response = await fetch(`/api/organization/calendar/company-events?event_id=${encodeURIComponent(entry.id)}`, { cache: 'no-store' });
      const payload = await readResponse(response);
      setHistory(payload.history || []);
    } catch (loadError: any) {
      setHistoryError(loadError.message || '無法載入異動紀錄');
    } finally {
      setHistoryLoading(false);
    }
  }

  function renderEntry(entry: CalendarEntry, compact = false) {
    const isOwner = entry.source === 'personal' && entry.owner_id === currentUserId;
    const canEdit = entry.source === 'company'
      ? canEditCompanyEvents
      : isOwner;
    const typeLabel = entry.source === 'company' && entry.event_type
      ? ORGANIZATION_CALENDAR_EVENT_TYPE_LABELS[entry.event_type]
      : entry.source === 'holiday'
        ? ORGANIZATION_CALENDAR_HOLIDAY_TYPE_LABELS[entry.day_type as OrganizationCalendarHolidayType]
        : '';

    return (
      <article key={entry.key} className={`border-l-2 ${SOURCE_STYLES[entry.source].marker} pl-3 ${compact ? 'py-1.5' : 'py-3'}`}>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <span className="font-medium text-slate-900">{entry.title}</span>
              {typeLabel && <span className="text-xs text-slate-500">{typeLabel}</span>}
            </div>
            {!compact && entry.start_date !== entry.end_date && (
              <div className="mt-1 text-xs text-slate-500">{formatDate(entry.start_date)} - {formatDate(entry.end_date)}</div>
            )}
            {!compact && entry.description && (
              <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-600">{entry.description}</p>
            )}
          </div>
          {!compact && (
            <div className="flex shrink-0 items-center gap-1">
              {entry.source === 'personal' && (
                <button
                  type="button"
                  onClick={() => void openShare(entry)}
                  title={isOwner ? '管理分享' : '轉分享'}
                  aria-label={isOwner ? '管理分享' : '轉分享'}
                  className="rounded p-2 text-slate-600 hover:bg-slate-100 hover:text-slate-900"
                >
                  <Share2 aria-hidden="true" className="h-4 w-4" />
                </button>
              )}
              {entry.source === 'company' && (
                <button
                  type="button"
                  onClick={() => void openHistory(entry)}
                  title="查看異動紀錄"
                  aria-label={`查看「${entry.title}」異動紀錄`}
                  className="rounded p-2 text-slate-600 hover:bg-slate-100 hover:text-slate-900"
                >
                  <History aria-hidden="true" className="h-4 w-4" />
                </button>
              )}
              {canEdit && (
                <button
                  type="button"
                  onClick={() => beginEdit(entry)}
                  title="編輯行事"
                  aria-label="編輯行事"
                  className="rounded p-2 text-slate-600 hover:bg-slate-100 hover:text-slate-900"
                >
                  <Pencil aria-hidden="true" className="h-4 w-4" />
                </button>
              )}
              {entry.source === 'company' && canEditCompanyEvents && (
                <button
                  type="button"
                  onClick={() => void cancelCompanyEvent(entry)}
                  title="取消公司行事"
                  aria-label="取消公司行事"
                  className="rounded p-2 text-rose-700 hover:bg-rose-50"
                >
                  <X aria-hidden="true" className="h-4 w-4" />
                </button>
              )}
              {entry.source === 'personal' && isOwner && (
                <button
                  type="button"
                  onClick={() => void deletePersonalEvent(entry)}
                  title="刪除個人行程"
                  aria-label="刪除個人行程"
                  className="rounded p-2 text-rose-700 hover:bg-rose-50"
                >
                  <Trash2 aria-hidden="true" className="h-4 w-4" />
                </button>
              )}
            </div>
          )}
        </div>
      </article>
    );
  }

  const shareIsOwner = Boolean(shareData?.isOwner);
  const currentShare = shareData?.shares.find(share => (
    share.shared_with_user_id === currentUserId && share.is_effective
  ));
  const canReshare = shareIsOwner || Boolean(currentShare);

  return (
    <main className="mx-auto min-h-[calc(100vh-64px)] max-w-[1600px] px-4 py-6 text-slate-900 sm:px-6 lg:px-8">
      <header className="mb-5 flex flex-wrap items-end justify-between gap-4 border-b border-slate-200 pb-4">
        <div>
          <div className="mb-1 flex items-center gap-2 text-sm text-slate-500">
            <CalendarDays aria-hidden="true" className="h-4 w-4" />
            組織管理
          </div>
          <h1 className="text-2xl font-semibold">年度行事曆</h1>
        </div>
        <button
          type="button"
          onClick={() => beginCreate(canCreateCompanyEvents ? 'company' : 'personal')}
          className="inline-flex h-10 items-center gap-2 rounded bg-slate-900 px-4 text-sm font-medium text-white hover:bg-slate-700"
        >
          <CirclePlus aria-hidden="true" className="h-4 w-4" />
          新增行事
        </button>
      </header>

      {(error || notice) && (
        <div className={`mb-4 flex items-start justify-between gap-3 rounded border px-4 py-3 text-sm ${error ? 'border-rose-200 bg-rose-50 text-rose-900' : 'border-emerald-200 bg-emerald-50 text-emerald-900'}`} role={error ? 'alert' : 'status'}>
          <span>{error || notice}</span>
          <button type="button" onClick={() => { setError(''); setNotice(''); }} aria-label="關閉訊息" className="rounded p-0.5 hover:bg-black/5">
            <X aria-hidden="true" className="h-4 w-4" />
          </button>
        </div>
      )}

      <section className="mb-4 flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 pb-4" aria-label="行事曆檢視設定">
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => moveMonth(-1)} aria-label="上一個月" title="上一個月" className="rounded border border-slate-300 p-2 hover:bg-slate-50">
            <ChevronLeft aria-hidden="true" className="h-4 w-4" />
          </button>
          <button type="button" onClick={() => moveMonth(1)} aria-label="下一個月" title="下一個月" className="rounded border border-slate-300 p-2 hover:bg-slate-50">
            <ChevronRight aria-hidden="true" className="h-4 w-4" />
          </button>
          <h2 className="min-w-36 text-lg font-semibold">{view === 'month' ? monthLabel(year, month) : `${year} 年`}</h2>
          <button
            type="button"
            onClick={() => selectDate(today)}
            className="ml-1 rounded border border-slate-300 px-3 py-2 text-sm hover:bg-slate-50"
          >
            今天
          </button>
        </div>
        <div className="inline-flex rounded border border-slate-300 p-0.5" role="group" aria-label="日曆範圍">
          <button type="button" onClick={() => setView('month')} aria-pressed={view === 'month'} className={`rounded px-3 py-1.5 text-sm ${view === 'month' ? 'bg-slate-900 text-white' : 'text-slate-700 hover:bg-slate-50'}`}>
            月檢視
          </button>
          <button type="button" onClick={() => setView('year')} aria-pressed={view === 'year'} className={`rounded px-3 py-1.5 text-sm ${view === 'year' ? 'bg-slate-900 text-white' : 'text-slate-700 hover:bg-slate-50'}`}>
            全年清單
          </button>
        </div>
      </section>

      <div className="mb-4 flex flex-wrap items-center gap-2" aria-label="顯示行事來源">
        {(['company', 'personal', 'holiday'] as SourceKind[]).map(source => (
          <button
            key={source}
            type="button"
            aria-pressed={visibleSources[source]}
            onClick={() => setVisibleSources(current => ({ ...current, [source]: !current[source] }))}
            className={`inline-flex items-center gap-2 rounded border px-3 py-1.5 text-sm ${visibleSources[source] ? 'border-slate-300 bg-white text-slate-800' : 'border-slate-200 bg-slate-50 text-slate-400'}`}
          >
            <span className={`h-2 w-2 rounded-full ${SOURCE_STYLES[source].dot}`} />
            {SOURCE_LABELS[source]}
          </button>
        ))}
        {holidaySource && (
          <span className="ml-auto text-xs text-slate-500" title={holidaySource.source_url}>
            假日來源：{holidaySource.source_name}{holidaySource.source_revision ? ` · ${holidaySource.source_revision}` : ''} · 匯入 {new Date(holidaySource.imported_at).toLocaleDateString('zh-TW')}
          </span>
        )}
        {canManageHolidays && (
          <button
            type="button"
            onClick={() => {
              setHolidayImportDraft(current => ({
                ...current,
                source_revision: `${year} 年辦公日曆表`,
              }));
              setShowHolidayImport(true);
            }}
            className="ml-auto inline-flex h-9 items-center gap-2 rounded border border-slate-300 bg-white px-3 text-sm text-slate-700 hover:bg-slate-50"
          >
            <FileUp aria-hidden="true" className="h-4 w-4" />
            {holidaySource ? '更新假日資料' : '匯入政府假日'}
          </button>
        )}
      </div>

      {loading ? (
        <div className="border-y border-slate-200 py-16 text-center text-sm text-slate-500" role="status">載入行事曆…</div>
      ) : (
        <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
          <section aria-label={view === 'month' ? '月曆' : '全年行事清單'}>
            {view === 'month' ? (
              <div className="overflow-hidden border border-slate-200 bg-white">
                <div className="grid grid-cols-7 border-b border-slate-200 bg-slate-50">
                  {WEEKDAYS.map((weekday, index) => (
                    <div key={weekday} className={`py-2 text-center text-xs font-medium ${index === 0 ? 'text-rose-700' : index === 6 ? 'text-blue-800' : 'text-slate-600'}`}>
                      {weekday}
                    </div>
                  ))}
                </div>
                <div className="grid grid-cols-7">
                  {monthDays.map(cell => {
                    const dayEntries = entriesForDate(cell.value);
                    const isSelected = selectedDate === cell.value;
                    const isToday = today === cell.value;
                    return (
                      <button
                        key={cell.value}
                        type="button"
                        onClick={() => selectDate(cell.value)}
                        onDoubleClick={() => beginCreate(canCreateCompanyEvents ? 'company' : 'personal', cell.value)}
                        className={`min-h-24 border-b border-r border-slate-200 p-1.5 text-left align-top transition-colors sm:min-h-32 sm:p-2 ${!cell.inMonth ? 'bg-slate-50/70' : 'bg-white'} ${isSelected ? 'relative z-10 outline outline-2 outline-inset outline-blue-700' : 'hover:bg-blue-50/40'}`}
                        aria-label={`${formatDate(cell.value)}，${dayEntries.length} 件行事`}
                        aria-pressed={isSelected}
                      >
                        <span className={`inline-flex h-6 min-w-6 items-center justify-center rounded-full px-1 text-sm ${isToday ? 'bg-slate-900 font-semibold text-white' : cell.inMonth ? 'text-slate-800' : 'text-slate-400'}`}>
                          {cell.day}
                        </span>
                        <span className="mt-1 block space-y-1">
                          {dayEntries.slice(0, 2).map(entry => (
                            <span key={entry.key} className={`block truncate rounded border px-1 py-0.5 text-[11px] leading-4 ${SOURCE_STYLES[entry.source].chip}`}>
                              {entry.title}
                            </span>
                          ))}
                          {dayEntries.length > 2 && <span className="block px-1 text-[11px] text-slate-500">+{dayEntries.length - 2} 項</span>}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            ) : (
              <div className="divide-y divide-slate-200 border-y border-slate-200">
                {yearMonths.map(({ month: monthIndex, events: monthEvents }) => (
                  <section key={monthIndex} className="grid gap-3 py-4 sm:grid-cols-[120px_minmax(0,1fr)]">
                    <button
                      type="button"
                      onClick={() => { setMonth(monthIndex); setView('month'); selectDate(`${year}-${`${monthIndex + 1}`.padStart(2, '0')}-01`); }}
                      className="h-fit text-left text-base font-semibold text-slate-800 hover:text-blue-700"
                    >
                      {monthIndex + 1} 月 <span className="ml-1 text-sm font-normal text-slate-500">{monthEvents.length}</span>
                    </button>
                    {monthEvents.length > 0 ? (
                      <div className="divide-y divide-slate-100">
                        {monthEvents.map(entry => (
                          <button key={entry.key} type="button" onClick={() => selectDate(entry.start_date)} className="flex w-full items-start gap-3 py-2 text-left hover:bg-slate-50">
                            <span className="w-14 shrink-0 pt-0.5 text-sm tabular-nums text-slate-500">{Number(entry.start_date.slice(8, 10))} 日</span>
                            <span className={`min-w-0 flex-1 border-l-2 pl-3 ${SOURCE_STYLES[entry.source].marker}`}>
                              <span className="block truncate text-sm font-medium text-slate-800">{entry.title}</span>
                              <span className="text-xs text-slate-500">{SOURCE_LABELS[entry.source]}{entry.start_date !== entry.end_date ? ` · 至 ${formatDate(entry.end_date)}` : ''}</span>
                            </span>
                          </button>
                        ))}
                      </div>
                    ) : <p className="py-1 text-sm text-slate-400">沒有行事</p>}
                  </section>
                ))}
              </div>
            )}
          </section>

          <aside className="border-t border-slate-200 pt-4 xl:border-l xl:border-t-0 xl:pl-5 xl:pt-0" aria-label="所選日期行事">
            <div className="mb-3 flex items-start justify-between gap-3">
              <div>
                <p className="text-xs font-medium text-slate-500">所選日期</p>
                <h2 className="mt-1 text-lg font-semibold">{formatDate(selectedDate)}</h2>
              </div>
              <div className="flex gap-1">
                {canCreateCompanyEvents && (
                  <button type="button" onClick={() => beginCreate('company')} title="新增公司行事" aria-label="新增公司行事" className="rounded border border-slate-300 p-2 text-blue-800 hover:bg-blue-50">
                    <CalendarDays aria-hidden="true" className="h-4 w-4" />
                  </button>
                )}
                <button type="button" onClick={() => beginCreate('personal')} title="新增個人行程" aria-label="新增個人行程" className="rounded border border-slate-300 p-2 text-emerald-800 hover:bg-emerald-50">
                  <CirclePlus aria-hidden="true" className="h-4 w-4" />
                </button>
              </div>
            </div>
            {currentDayEntries.length > 0 ? (
              <div className="divide-y divide-slate-200">
                {currentDayEntries.map(entry => (
                  <div key={entry.key} className="py-1">
                    <div className="mb-1 flex items-center gap-2 pt-2 text-xs text-slate-500">
                      <span className={`h-2 w-2 rounded-full ${SOURCE_STYLES[entry.source].dot}`} />
                      {SOURCE_LABELS[entry.source]}
                    </div>
                    {renderEntry(entry)}
                  </div>
                ))}
              </div>
            ) : (
              <p className="border-y border-slate-200 py-6 text-sm text-slate-500">這天沒有行事</p>
            )}
            {visibleSources.holiday && !holidaySource && (
              <p className="mt-4 text-xs text-slate-500">
                尚無 {year} 年政府假日資料
              </p>
            )}
          </aside>
        </div>
      )}

      {showForm && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/40 p-3 sm:p-6" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) setShowForm(false); }}>
          <section role="dialog" aria-modal="true" aria-labelledby="calendar-form-title" className="max-h-[92vh] w-full max-w-xl overflow-auto rounded border border-slate-200 bg-white shadow-xl">
            <header className="flex items-start justify-between gap-4 border-b border-slate-200 px-5 py-4">
              <div>
                <p className="text-xs font-medium text-slate-500">{editingEntry ? '編輯行事' : '新增行事'}</p>
                <h2 id="calendar-form-title" className="mt-1 text-lg font-semibold">
                  {editingEntry ? editingEntry.title : formKind === 'company' ? '公司行事' : '個人行程'}
                </h2>
              </div>
              <button type="button" onClick={() => setShowForm(false)} title="關閉" aria-label="關閉" className="rounded p-2 text-slate-500 hover:bg-slate-100">
                <X aria-hidden="true" className="h-5 w-5" />
              </button>
            </header>
            <form onSubmit={saveEvent} className="space-y-4 px-5 py-5">
              {!editingEntry && (
                <div className="inline-flex rounded border border-slate-300 p-0.5" role="group" aria-label="行事類型">
                  {canCreateCompanyEvents && (
                    <button type="button" onClick={() => setFormKind('company')} aria-pressed={formKind === 'company'} className={`rounded px-3 py-2 text-sm ${formKind === 'company' ? 'bg-blue-700 text-white' : 'text-slate-700 hover:bg-slate-50'}`}>
                      公司行事
                    </button>
                  )}
                  <button type="button" onClick={() => setFormKind('personal')} aria-pressed={formKind === 'personal'} className={`rounded px-3 py-2 text-sm ${formKind === 'personal' ? 'bg-emerald-700 text-white' : 'text-slate-700 hover:bg-slate-50'}`}>
                    個人行程
                  </button>
                </div>
              )}
              <div>
                <label htmlFor="calendar-event-title" className="mb-1.5 block text-sm font-medium text-slate-700">名稱</label>
                <input id="calendar-event-title" value={draft.title} onChange={event => setDraft({ ...draft, title: event.target.value })} maxLength={160} required className="h-10 w-full rounded border border-slate-300 px-3 text-sm outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-100" autoFocus />
              </div>
              {formKind === 'company' && (
                <div>
                  <label htmlFor="calendar-event-type" className="mb-1.5 block text-sm font-medium text-slate-700">類型</label>
                  <select id="calendar-event-type" value={draft.event_type} onChange={event => setDraft({ ...draft, event_type: event.target.value as OrganizationCalendarEventType })} className="h-10 w-full rounded border border-slate-300 bg-white px-3 text-sm outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-100">
                    {EVENT_TYPE_VALUES.map(type => <option key={type} value={type}>{ORGANIZATION_CALENDAR_EVENT_TYPE_LABELS[type]}</option>)}
                  </select>
                </div>
              )}
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label htmlFor="calendar-start-date" className="mb-1.5 block text-sm font-medium text-slate-700">開始日期</label>
                  <input id="calendar-start-date" type="date" value={draft.start_date} onChange={event => setDraft({ ...draft, start_date: event.target.value, end_date: draft.end_date < event.target.value ? event.target.value : draft.end_date })} required className="h-10 w-full rounded border border-slate-300 px-3 text-sm outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-100" />
                </div>
                <div>
                  <label htmlFor="calendar-end-date" className="mb-1.5 block text-sm font-medium text-slate-700">結束日期</label>
                  <input id="calendar-end-date" type="date" min={draft.start_date} value={draft.end_date} onChange={event => setDraft({ ...draft, end_date: event.target.value })} required className="h-10 w-full rounded border border-slate-300 px-3 text-sm outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-100" />
                </div>
              </div>
              <div>
                <label htmlFor="calendar-description" className="mb-1.5 block text-sm font-medium text-slate-700">補充說明</label>
                <textarea id="calendar-description" value={draft.description} onChange={event => setDraft({ ...draft, description: event.target.value })} maxLength={3000} rows={3} className="w-full rounded border border-slate-300 px-3 py-2 text-sm outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-100" />
              </div>
              {!editingEntry && formKind === 'personal' && (
                <PeoplePicker selected={formRecipients} onChange={setFormRecipients} label="分享對象（選填）" />
              )}
              <footer className="flex justify-end gap-2 border-t border-slate-200 pt-4">
                <button type="button" onClick={() => setShowForm(false)} className="h-10 rounded border border-slate-300 px-4 text-sm hover:bg-slate-50">取消</button>
                <button type="submit" disabled={saving} className="h-10 rounded bg-slate-900 px-4 text-sm font-medium text-white hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-50">
                  {saving ? '儲存中…' : editingEntry ? '儲存變更' : '建立行事'}
                </button>
              </footer>
            </form>
          </section>
        </div>
      )}

      {shareEntry && (
        <div className="fixed inset-0 z-[110] flex items-center justify-center bg-slate-950/40 p-3 sm:p-6" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) setShareEntry(null); }}>
          <section role="dialog" aria-modal="true" aria-labelledby="calendar-share-title" className="max-h-[90vh] w-full max-w-2xl overflow-auto rounded border border-slate-200 bg-white shadow-xl">
            <header className="flex items-start justify-between gap-4 border-b border-slate-200 px-5 py-4">
              <div>
                <p className="text-xs text-slate-500">個人行程 · 唯讀分享</p>
                <h2 id="calendar-share-title" className="mt-1 text-lg font-semibold">{shareEntry.title}</h2>
              </div>
              <button type="button" onClick={() => setShareEntry(null)} title="關閉" aria-label="關閉" className="rounded p-2 text-slate-500 hover:bg-slate-100">
                <X aria-hidden="true" className="h-5 w-5" />
              </button>
            </header>
            <div className="space-y-5 px-5 py-5">
              {shareError && <p role="alert" className="rounded border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-900">{shareError}</p>}
              {canReshare && (
                <div className="space-y-3">
                  <PeoplePicker selected={shareRecipients} onChange={setShareRecipients} label={shareIsOwner ? '新增分享對象' : '轉分享給'} />
                  <div className="flex justify-end">
                    <button type="button" onClick={() => void addShares()} disabled={shareLoading || shareRecipients.length === 0} className="h-9 rounded bg-slate-900 px-3 text-sm font-medium text-white hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-50">
                      {shareLoading ? '處理中…' : '分享行程'}
                    </button>
                  </div>
                </div>
              )}
              <div>
                <div className="mb-2 flex items-center justify-between border-b border-slate-200 pb-2">
                  <h3 className="text-sm font-semibold">分享對象</h3>
                  <span className="text-xs text-slate-500">可轉分享 · 建立者可撤回</span>
                </div>
                {shareLoading && !shareData ? (
                  <p className="py-5 text-sm text-slate-500">載入分享設定…</p>
                ) : (shareData?.shares.length || 0) > 0 ? (
                  <ul className="divide-y divide-slate-100">
                    {shareData?.shares.map(share => {
                      const recipient = shareData.people[share.shared_with_user_id];
                      const sharer = shareData.people[share.shared_by_user_id];
                      const canRevoke = shareData.isOwner || share.shared_by_user_id === currentUserId;
                      return (
                        <li key={share.id} className="flex items-center justify-between gap-3 py-3">
                          <div className="min-w-0">
                            <p className="truncate text-sm font-medium text-slate-800">{recipient?.name || '使用者'}{recipient?.employee_code ? ` · ${recipient.employee_code}` : ''}</p>
                            <p className="mt-0.5 text-xs text-slate-500">由 {sharer?.name || '使用者'} 分享</p>
                          </div>
                          <div className="flex shrink-0 items-center gap-2">
                            <span className={`text-xs ${share.is_effective ? 'text-emerald-700' : 'text-slate-400'}`}>{share.is_effective ? '可查看' : '已失效'}</span>
                            {canRevoke && share.is_effective && (
                              <button type="button" onClick={() => void revokeShare(share.id)} title="撤回此分享及下游轉分享" aria-label={`撤回分享給${recipient?.name || '使用者'}`} className="rounded p-2 text-rose-700 hover:bg-rose-50">
                                <X aria-hidden="true" className="h-4 w-4" />
                              </button>
                            )}
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                ) : (
                  <p className="py-5 text-sm text-slate-500">尚未分享給其他人</p>
                )}
              </div>
              {shareData && !shareData.isOwner && (
                <p className="border-t border-slate-200 pt-3 text-xs text-slate-500">行程建立者：{shareData.owner?.name || '使用者'}。你只能查看，也可以轉分享給其他同仁。</p>
              )}
            </div>
          </section>
        </div>
      )}

      {historyEntry && (
        <div className="fixed inset-0 z-[115] flex items-center justify-center bg-slate-950/40 p-3 sm:p-6" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) setHistoryEntry(null); }}>
          <section role="dialog" aria-modal="true" aria-labelledby="calendar-history-title" className="max-h-[90vh] w-full max-w-2xl overflow-auto rounded border border-slate-200 bg-white shadow-xl">
            <header className="flex items-start justify-between gap-4 border-b border-slate-200 px-5 py-4">
              <div>
                <p className="text-xs text-slate-500">公司行事</p>
                <h2 id="calendar-history-title" className="mt-1 text-lg font-semibold">{historyEntry.title} · 異動紀錄</h2>
              </div>
              <button type="button" onClick={() => setHistoryEntry(null)} title="關閉" aria-label="關閉" className="rounded p-2 text-slate-500 hover:bg-slate-100">
                <X aria-hidden="true" className="h-5 w-5" />
              </button>
            </header>
            <div className="px-5 py-4">
              {historyError ? (
                <p role="alert" className="rounded border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-900">{historyError}</p>
              ) : historyLoading ? (
                <p role="status" className="py-6 text-sm text-slate-500">載入異動紀錄…</p>
              ) : history.length > 0 ? (
                <ol className="divide-y divide-slate-200">
                  {history.map(record => {
                    const before = record.before_data;
                    const after = record.after_data;
                    const fields = ['title', 'event_type', 'start_date', 'end_date', 'description', 'status'];
                    const changes = fields.filter(field => !before || before[field] !== after[field]);
                    const actionLabel = record.action === 'created' ? '新增' : record.action === 'cancelled' ? '取消' : '修改';
                    return (
                      <li key={record.id} className="py-4 first:pt-0 last:pb-0">
                        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                          <p className="text-sm font-medium text-slate-900">{actionLabel} · {record.actor_name}</p>
                          <time className="text-xs text-slate-500" dateTime={record.changed_at}>
                            {new Intl.DateTimeFormat('zh-TW', { timeZone: 'Asia/Taipei', dateStyle: 'medium', timeStyle: 'short' }).format(new Date(record.changed_at))}
                          </time>
                        </div>
                        <dl className="mt-2 space-y-1.5">
                          {changes.map(field => (
                            <div key={field} className="grid gap-1 text-sm sm:grid-cols-[96px_minmax(0,1fr)]">
                              <dt className="text-slate-500">{{ title: '名稱', event_type: '類型', start_date: '開始日期', end_date: '結束日期', description: '說明', status: '狀態' }[field]}</dt>
                              <dd className="min-w-0 break-words text-slate-800">
                                {before && <><span className="text-slate-500">{auditValue(field, before[field])}</span><span aria-hidden="true" className="px-1.5 text-slate-400">→</span></>}
                                {auditValue(field, after[field])}
                              </dd>
                            </div>
                          ))}
                        </dl>
                      </li>
                    );
                  })}
                </ol>
              ) : (
                <p className="py-6 text-sm text-slate-500">目前沒有異動紀錄</p>
              )}
            </div>
          </section>
        </div>
      )}

      {showHolidayImport && canManageHolidays && (
        <div className="fixed inset-0 z-[120] flex items-center justify-center bg-slate-950/40 p-3 sm:p-6" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) setShowHolidayImport(false); }}>
          <section role="dialog" aria-modal="true" aria-labelledby="holiday-import-title" className="max-h-[92vh] w-full max-w-2xl overflow-auto rounded border border-slate-200 bg-white shadow-xl">
            <header className="flex items-start justify-between gap-4 border-b border-slate-200 px-5 py-4">
              <div>
                <p className="text-xs text-slate-500">{year} 年 · 政府公告參考資料</p>
                <h2 id="holiday-import-title" className="mt-1 text-lg font-semibold">{holidaySource ? '更新政府假日資料' : '匯入政府假日'}</h2>
              </div>
              <button type="button" onClick={() => setShowHolidayImport(false)} title="關閉" aria-label="關閉" className="rounded p-2 text-slate-500 hover:bg-slate-100">
                <X aria-hidden="true" className="h-5 w-5" />
              </button>
            </header>
            <form onSubmit={importHolidays} className="space-y-4 px-5 py-5">
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label htmlFor="holiday-source-name" className="mb-1.5 block text-sm font-medium text-slate-700">公告來源</label>
                  <input id="holiday-source-name" required maxLength={120} value={holidayImportDraft.source_name} onChange={event => setHolidayImportDraft({ ...holidayImportDraft, source_name: event.target.value })} className="h-10 w-full rounded border border-slate-300 px-3 text-sm outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-100" />
                </div>
                <div>
                  <label htmlFor="holiday-source-revision" className="mb-1.5 block text-sm font-medium text-slate-700">公告版本</label>
                  <input id="holiday-source-revision" maxLength={120} value={holidayImportDraft.source_revision} onChange={event => setHolidayImportDraft({ ...holidayImportDraft, source_revision: event.target.value })} className="h-10 w-full rounded border border-slate-300 px-3 text-sm outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-100" />
                </div>
              </div>
              <div>
                <label htmlFor="holiday-source-url" className="mb-1.5 block text-sm font-medium text-slate-700">公告網址</label>
                <input id="holiday-source-url" type="url" required value={holidayImportDraft.source_url} onChange={event => setHolidayImportDraft({ ...holidayImportDraft, source_url: event.target.value })} placeholder="https://…" className="h-10 w-full rounded border border-slate-300 px-3 text-sm outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-100" />
              </div>
              <div>
                <label htmlFor="holiday-rows" className="mb-1.5 block text-sm font-medium text-slate-700">日期資料</label>
                <textarea
                  id="holiday-rows"
                  required
                  rows={9}
                  value={holidayImportDraft.rows}
                  onChange={event => setHolidayImportDraft({ ...holidayImportDraft, rows: event.target.value })}
                  placeholder={'2026-01-01\t元旦\t國定假日\n2026-02-20\t補假\t補假日\n2026-02-07\t補行上班\t補行上班'}
                  className="w-full rounded border border-slate-300 px-3 py-2 font-mono text-sm leading-6 outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-100"
                />
                <p className="mt-1.5 text-xs leading-5 text-slate-500">
                  每列依序貼上日期、名稱、類型，可直接從試算表複製。類型：國定假日、補假日、補行上班；只接受 {year} 年日期。發布後會立即取代該年度舊版本。
                </p>
              </div>
              <footer className="flex justify-end gap-2 border-t border-slate-200 pt-4">
                <button type="button" onClick={() => setShowHolidayImport(false)} className="h-10 rounded border border-slate-300 px-4 text-sm hover:bg-slate-50">取消</button>
                <button type="submit" disabled={savingHolidayImport} className="h-10 rounded bg-slate-900 px-4 text-sm font-medium text-white hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-50">
                  {savingHolidayImport ? '驗證並發布中…' : '發布年度資料'}
                </button>
              </footer>
            </form>
          </section>
        </div>
      )}
    </main>
  );
}
