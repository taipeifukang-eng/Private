'use client';

import { useState, useEffect, useRef } from 'react';
import { X, User, Search, Loader2, Plus } from 'lucide-react';

interface StaffItem {
  employee_code: string;
  employee_name: string;
  position: string;
  from_store_name?: string;
  source?: 'monthly_status' | 'movement_history';
}

interface StaffPickerInputProps {
  /** 逗號分隔的人員姓名字串，例如 "張三,李四" */
  value: string;
  onChange: (value: string) => void;
  storeId: string;
  placeholder?: string;
  inputClassName?: string;
}

export default function StaffPickerInput({
  value,
  onChange,
  storeId,
  placeholder = '新增人員...',
  inputClassName = '',
}: StaffPickerInputProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [localStaff, setLocalStaff] = useState<StaffItem[]>([]);
  const [searchResults, setSearchResults] = useState<StaffItem[]>([]);
  const [loadingLocal, setLoadingLocal] = useState(false);
  const [searching, setSearching] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const loadedStoreId = useRef<string>('');
  const cachedStaff = useRef<StaffItem[]>([]);

  // 解析逗號分隔字串為陣列
  const selected: string[] = value
    ? value.split(',').map((s) => s.trim()).filter(Boolean)
    : [];

  // 開啟下拉時載入本店人員（快取）
  useEffect(() => {
    if (!isOpen || !storeId) return;
    if (loadedStoreId.current === storeId) {
      setLocalStaff(cachedStaff.current);
      return;
    }
    setLoadingLocal(true);
    fetch(`/api/monthly-staff-by-store?store_id=${storeId}`)
      .then((r) => r.json())
      .then((data) => {
        const staff: StaffItem[] = data.success ? (data.data || []) : [];
        cachedStaff.current = staff;
        loadedStoreId.current = storeId;
        setLocalStaff(staff);
      })
      .catch(() => {})
      .finally(() => setLoadingLocal(false));
  }, [isOpen, storeId]);

  // 點外部關閉
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
        setQuery('');
        setSearchResults([]);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const handleQueryChange = (v: string) => {
    setQuery(v);
    if (searchTimer.current) clearTimeout(searchTimer.current);
    setSearchResults([]);

    // 本月名單為空時做全公司搜尋
    if (localStaff.length === 0 && v.length >= 1) {
      searchTimer.current = setTimeout(async () => {
        setSearching(true);
        try {
          const res = await fetch(`/api/monthly-staff-by-store/search?q=${encodeURIComponent(v)}`);
          const data = await res.json();
          if (data.success) setSearchResults(data.data || []);
        } catch {}
        setSearching(false);
      }, 400);
    }
  };

  const addPerson = (name: string) => {
    const trimmed = name.trim();
    if (!trimmed || selected.includes(trimmed)) return;
    const next = [...selected, trimmed];
    onChange(next.join(','));
    setQuery('');
    setSearchResults([]);
    // 保持開啟繼續選
    inputRef.current?.focus();
  };

  const removePerson = (name: string) => {
    onChange(selected.filter((s) => s !== name).join(','));
  };

  // 過濾本月名單（排除已選）
  const filteredLocal = localStaff.filter((s) => {
    if (selected.includes(s.employee_name)) return false;
    const q = query.toLowerCase();
    if (!q) return true;
    return (
      s.employee_name.toLowerCase().includes(q) ||
      s.employee_code.toLowerCase().includes(q)
    );
  });

  // 全公司搜尋結果也排除已選
  const filteredSearch = searchResults.filter((s) => !selected.includes(s.employee_name));

  const displayList = localStaff.length > 0 ? filteredLocal : filteredSearch;
  const noLocalStaff = !loadingLocal && localStaff.length === 0;

  return (
    <div ref={containerRef} className="relative">
      {/* 已選 Tags */}
      {selected.length > 0 && (
        <div className="flex flex-wrap gap-1 mb-1.5">
          {selected.map((name) => (
            <span
              key={name}
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-purple-100 text-purple-800"
            >
              <User className="w-2.5 h-2.5" />
              {name}
              <button
                type="button"
                onMouseDown={(e) => { e.preventDefault(); removePerson(name); }}
                className="ml-0.5 hover:text-purple-600"
              >
                <X className="w-3 h-3" />
              </button>
            </span>
          ))}
        </div>
      )}

      {/* 搜尋輸入框 */}
      <div className="relative">
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => handleQueryChange(e.target.value)}
          onFocus={() => setIsOpen(true)}
          onKeyDown={(e) => {
            // Enter 時若有輸入文字直接新增
            if (e.key === 'Enter' && query.trim()) {
              e.preventDefault();
              addPerson(query);
            }
          }}
          placeholder={selected.length > 0 ? '繼續新增...' : placeholder}
          className={inputClassName}
        />
        <Plus className="absolute right-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400 pointer-events-none" />
      </div>

      {/* 下拉選單 */}
      {isOpen && (
        <div className="absolute z-[200] left-0 right-0 mt-1 bg-white border border-gray-200 rounded-xl shadow-lg max-h-52 overflow-y-auto">
          {loadingLocal && (
            <div className="flex items-center gap-2 px-3 py-2.5 text-xs text-gray-400">
              <Loader2 className="w-3 h-3 animate-spin" />
              載入本店人員...
            </div>
          )}

          {noLocalStaff && query.length === 0 && (
            <div className="px-3 py-2.5 space-y-1">
              <p className="text-xs text-gray-400">此門市本月無人員資料</p>
              <p className="text-xs text-purple-500 flex items-center gap-1">
                <Search className="w-3 h-3" />
                輸入員編或姓名搜尋全公司人員，或直接 Enter 新增
              </p>
            </div>
          )}

          {searching && (
            <div className="flex items-center gap-2 px-3 py-2.5 text-xs text-gray-400">
              <Loader2 className="w-3 h-3 animate-spin" />
              搜尋中...
            </div>
          )}

          {!loadingLocal && !searching && displayList.map((staff, i) => (
            <button
              key={i}
              type="button"
              onMouseDown={(e) => { e.preventDefault(); addPerson(staff.employee_name); }}
              className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-purple-50 transition-colors"
            >
              <User className="w-3.5 h-3.5 text-gray-400 flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <span className="text-xs font-medium text-gray-900">{staff.employee_name}</span>
                <span className="text-xs text-gray-400 ml-1.5">({staff.employee_code})</span>
                {staff.position && (
                  <span className="text-xs text-purple-600 ml-1.5">{staff.position}</span>
                )}
                {staff.from_store_name && (
                  <span className="text-xs text-gray-400 ml-1.5">· {staff.from_store_name}</span>
                )}
                {staff.source === 'movement_history' && (
                  <span className="text-xs text-orange-500 ml-1.5">人事異動</span>
                )}
              </div>
            </button>
          ))}

          {!loadingLocal && !searching && displayList.length === 0 && query.length > 0 && (
            <div className="px-3 py-2.5 text-xs text-gray-400">
              查無符合的人員，按 Enter 直接新增「{query}」
            </div>
          )}
        </div>
      )}
    </div>
  );
}
