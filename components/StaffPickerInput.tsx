'use client';

import { useState, useEffect, useRef } from 'react';
import { ChevronDown, User, Search, Loader2 } from 'lucide-react';

interface StaffItem {
  employee_code: string;
  employee_name: string;
  position: string;
  from_store_name?: string;
  source?: 'monthly_status' | 'movement_history';
}

interface StaffPickerInputProps {
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
  placeholder = '填寫實際負責的人員...',
  inputClassName = '',
}: StaffPickerInputProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [inputValue, setInputValue] = useState(value);
  const [localStaff, setLocalStaff] = useState<StaffItem[]>([]);
  const [searchResults, setSearchResults] = useState<StaffItem[]>([]);
  const [loadingLocal, setLoadingLocal] = useState(false);
  const [searching, setSearching] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // 快取：避免重複呼叫 API
  const loadedStoreId = useRef<string>('');
  const cachedStaff = useRef<StaffItem[]>([]);

  // 同步外部 value 到 inputValue
  useEffect(() => {
    setInputValue(value);
  }, [value]);

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
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const handleInputChange = (v: string) => {
    setInputValue(v);
    onChange(v);

    if (searchTimer.current) clearTimeout(searchTimer.current);
    setSearchResults([]);

    // 本月名單為空時，才做全公司搜尋
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

  const selectStaff = (staff: StaffItem) => {
    const display = staff.employee_name;
    setInputValue(display);
    onChange(display);
    setIsOpen(false);
    setSearchResults([]);
  };

  // 過濾本月名單
  const filteredLocal = localStaff.filter((s) => {
    const q = inputValue.toLowerCase();
    if (!q) return true;
    return (
      s.employee_name.toLowerCase().includes(q) ||
      s.employee_code.toLowerCase().includes(q)
    );
  });

  const displayList = localStaff.length > 0 ? filteredLocal : searchResults;
  const noLocalStaff = !loadingLocal && localStaff.length === 0;

  return (
    <div ref={containerRef} className="relative">
      {/* 輸入框 */}
      <div className="relative">
        <input
          type="text"
          value={inputValue}
          onChange={(e) => handleInputChange(e.target.value)}
          onFocus={() => setIsOpen(true)}
          placeholder={placeholder}
          className={inputClassName}
        />
        <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400 pointer-events-none" />
      </div>

      {/* 下拉選單 */}
      {isOpen && (
        <div className="absolute z-[200] left-0 right-0 mt-1 bg-white border border-gray-200 rounded-xl shadow-lg max-h-52 overflow-y-auto">
          {/* 載入本月名單中 */}
          {loadingLocal && (
            <div className="flex items-center gap-2 px-3 py-2.5 text-xs text-gray-400">
              <Loader2 className="w-3 h-3 animate-spin" />
              載入本店人員...
            </div>
          )}

          {/* 本月無名單 → 提示搜尋 */}
          {noLocalStaff && inputValue.length === 0 && (
            <div className="px-3 py-2.5 space-y-1">
              <p className="text-xs text-gray-400">此門市本月無人員資料</p>
              <p className="text-xs text-purple-500 flex items-center gap-1">
                <Search className="w-3 h-3" />
                輸入員編或姓名，搜尋全公司人員
              </p>
            </div>
          )}

          {/* 搜尋全公司中 */}
          {searching && (
            <div className="flex items-center gap-2 px-3 py-2.5 text-xs text-gray-400">
              <Loader2 className="w-3 h-3 animate-spin" />
              搜尋中...
            </div>
          )}

          {/* 人員列表 */}
          {!loadingLocal && !searching && displayList.map((staff, i) => (
            <button
              key={i}
              type="button"
              onMouseDown={(e) => { e.preventDefault(); selectStaff(staff); }}
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

          {/* 無搜尋結果 */}
          {!loadingLocal && !searching && displayList.length === 0 && inputValue.length > 0 && (
            <div className="px-3 py-2.5 text-xs text-gray-400">查無符合的人員</div>
          )}
        </div>
      )}
    </div>
  );
}
