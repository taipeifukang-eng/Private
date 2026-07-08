'use client';

import { useEffect, useState } from 'react';
import * as XLSX from 'xlsx';
import { Upload, Download, FileSpreadsheet, AlertCircle, BarChart3, RefreshCw, Search } from 'lucide-react';

type ProductData = {
  品號: string;
  品名: string;
  UN: string;
  條碼: string;
  庫存: number;
  主要儲位: string;
};

type ExternalInventory = {
  品號: string;
  品名: string;
  條碼: string;
  盤點數量: number;
  盤點儲位?: string; // 可選，模組一不需要，模組二需要
};

type FKS0701Data = {
  品號: string;
  品名: string;
  條碼: string;
  盤點數量: number;
  盤點儲位: string;
};

type PreInventory = {
  品號: string;
  盤點數量: number;
  盤點儲位: string;
};

type InventoryResultBatch = {
  id: string;
  year_month: string;
  store_code: string;
  store_name: string | null;
  inventory_order_no: string;
  closed_text: string | null;
  source_file_name: string | null;
  imported_at: string;
  row_count: number;
  total_difference_qty: number;
  total_difference_amount_member: number;
  total_cost: number;
  shortage_count: number;
  surplus_count: number;
  zero_difference_count: number;
};

type InventoryResultItem = {
  id: string;
  category_code: string | null;
  category_name: string | null;
  product_code: string | null;
  product_name: string | null;
  unit: string | null;
  storage_location_1: string | null;
  storage_location_2: string | null;
  difference_qty: number;
  difference_amount_member: number;
  cost: number;
  unit_cost: number;
  stock_qty: number;
  stock_amount: number;
};

type InventoryCategorySummary = {
  category_code: string;
  category_name: string;
  row_count: number;
  total_difference_qty: number;
  positive_cost_total: number;
  negative_cost_total: number;
  net_cost_total: number;
  stock_amount_total: number;
  total_difference_amount_member: number;
  shortage_count: number;
  surplus_count: number;
};

type InventoryNonExcludedSummary = {
  positive_cost_total: number;
  negative_cost_total: number;
  net_cost_total: number;
  stock_amount_total: number;
  row_count: number;
};

export default function InventoryManagement() {
  const [activeSection, setActiveSection] = useState<'offline' | 'analysis'>('offline');
  const [activeModule, setActiveModule] = useState<1 | 2 | 3>(1);

  // 全局共用的 1F當日商品資料（三個模組共用）
  const [baseData, setBaseData] = useState<ProductData[]>([]);

  // 模組一：狀態
  const [externalOriginal, setExternalOriginal] = useState<ExternalInventory[]>([]);
  const [fks0701Data1, setFks0701Data1] = useState<FKS0701Data[]>([]);

  // 模組二：狀態
  const [preInventory, setPreInventory] = useState<PreInventory[]>([]);
  const [fks0701Data2, setFks0701Data2] = useState<FKS0701Data[]>([]);
  const [externalModified, setExternalModified] = useState<ExternalInventory[]>([]);

  // 模組二產出：盤差為0的盤點結果
  const [noDiffRecords, setNoDiffRecords] = useState<any[]>([]);

  // 模組三：狀態
  const [internalRecount, setInternalRecount] = useState<any[]>([]);
  const [unInventoried, setUnInventoried] = useState<any[]>([]);

  // 盤點結果分析報表
  const [analysisBatches, setAnalysisBatches] = useState<InventoryResultBatch[]>([]);
  const [analysisItems, setAnalysisItems] = useState<InventoryResultItem[]>([]);
  const [analysisCategorySummary, setAnalysisCategorySummary] = useState<InventoryCategorySummary[]>([]);
  const [analysisNonExcludedSummary, setAnalysisNonExcludedSummary] = useState<InventoryNonExcludedSummary | null>(null);
  const [selectedAnalysisBatchId, setSelectedAnalysisBatchId] = useState('');
  const [selectedAnalysisCategoryCode, setSelectedAnalysisCategoryCode] = useState('');
  const [analysisYearMonth, setAnalysisYearMonth] = useState(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  });
  const [analysisImportOrderNo, setAnalysisImportOrderNo] = useState('');
  const [analysisStoreKeyword, setAnalysisStoreKeyword] = useState('');
  const [analysisOrderKeyword, setAnalysisOrderKeyword] = useState('');
  const [analysisLoading, setAnalysisLoading] = useState(false);
  const [analysisImporting, setAnalysisImporting] = useState(false);

  const formatMoney = (value: unknown): string => {
    const n = Number(value) || 0;
    return n.toLocaleString('zh-TW');
  };
  const productCategoryMap: Record<string, string> = {
    '01': '處方藥品',
    '02': '保健食品',
    '03': 'OTC藥品',
    '04': '醫美產品',
    '05': '奶製品',
    '06': '醫療器材/輔具',
    '07': '護具/護理用品/醫療用耗材/隱形眼鏡',
    '08': '生活用品',
    '09': '一般食品',
    '10': '婦嬰用品',
    '11': '寵物用品',
    '12': '尿布',
    '97': '庶務類消耗品',
    '98': '虛擬產品',
    '99': '贈品與展示品',
  };
  const normalizeAnalysisProductCode = (code: unknown): string => {
    const raw = String(code || '').trim();
    if (!raw) return '';
    if (/^\d+$/.test(raw)) return raw.padStart(8, '0');
    if (/^\d+\.0+$/.test(raw)) return raw.replace(/\.0+$/, '').padStart(8, '0');
    const numeric = Number(raw.replace(/,/g, ''));
    if (Number.isFinite(numeric) && numeric > 0) {
      return String(Math.trunc(numeric)).padStart(8, '0');
    }
    return raw;
  };
  const getItemCategoryCode = (item: InventoryResultItem): string => {
    const productCode = normalizeAnalysisProductCode(item.product_code);
    return productCode ? productCode.slice(0, 2) : item.category_code || 'NA';
  };
  const getItemCategoryName = (item: InventoryResultItem): string => {
    const code = getItemCategoryCode(item);
    return productCategoryMap[code] || item.category_name || '未分類';
  };
  // 統一的品號格式化函數（確保 8 位數，不足補零）
  const formatProductCode = (code: any): string => {
    if (!code) return '';
    const str = String(code).trim();
    // 如果是純數字，補零至 8 位
    if (/^\d+$/.test(str)) {
      return str.padStart(8, '0');
    }
    return str;
  };
  // 讀取 Excel 檔案
  const readExcelFile = (file: File): Promise<any[]> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const data = e.target?.result;
          const workbook = XLSX.read(data, { type: 'binary' });
          const sheetName = workbook.SheetNames[0];
          const worksheet = workbook.Sheets[sheetName];
          const json = XLSX.utils.sheet_to_json(worksheet);
          resolve(json);
        } catch (error) {
          reject(error);
        }
      };
      reader.onerror = reject;
      reader.readAsBinaryString(file);
    });
  };

  const loadInventoryResultAnalysis = async (
    batchId = selectedAnalysisBatchId,
    storeKeyword = analysisStoreKeyword,
    orderKeyword = analysisOrderKeyword
  ) => {
    setAnalysisLoading(true);
    try {
      const params = new URLSearchParams();
      if (analysisYearMonth) params.set('year_month', analysisYearMonth);
      if (storeKeyword.trim()) params.set('store', storeKeyword.trim());
      if (orderKeyword.trim()) params.set('order_no', orderKeyword.trim());
      if (batchId) params.set('batch_id', batchId);

      const res = await fetch(`/api/inventory/result-analysis?${params.toString()}`);
      const json = await res.json();
      if (!res.ok || !json.success) {
        throw new Error(json.error || '載入盤點結果分析報表失敗');
      }

      setAnalysisBatches(json.batches || []);
      setAnalysisItems(json.items || []);
      setAnalysisCategorySummary(json.category_summary || []);
      setAnalysisNonExcludedSummary(json.non_excluded_summary || null);
      setSelectedAnalysisBatchId(json.selected_batch_id || '');
      setSelectedAnalysisCategoryCode('');
    } catch (error: any) {
      alert(`❌ ${error.message || '載入盤點結果分析報表失敗'}`);
    } finally {
      setAnalysisLoading(false);
    }
  };

  useEffect(() => {
    if (activeSection === 'analysis') {
      loadInventoryResultAnalysis('');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSection]);

  const handleInventoryResultAnalysisUpload = async (file: File) => {
    setAnalysisImporting(true);
    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('year_month', analysisYearMonth);
      if (analysisImportOrderNo.trim()) {
        formData.append('inventory_order_no', analysisImportOrderNo.trim());
      }

      const res = await fetch('/api/inventory/result-analysis', {
        method: 'POST',
        body: formData,
      });
      const json = await res.json();
      if (!res.ok || !json.success) {
        throw new Error(json.error || '匯入盤點結果分析報表失敗');
      }

      const errorHint = Array.isArray(json.errors) && json.errors.length > 0
        ? `\n略過資料：\n${json.errors.slice(0, 5).join('\n')}${json.errors.length > 5 ? `\n... 另有 ${json.errors.length - 5} 筆` : ''}`
        : '';
      alert(`✅ 匯入完成：${json.imported_batches} 個批次、${json.imported_rows} 筆明細${errorHint}`);
      setAnalysisStoreKeyword('');
      setAnalysisOrderKeyword('');
      setAnalysisImportOrderNo('');
      await loadInventoryResultAnalysis(json.batches?.[0]?.id || '', '', '');
    } catch (error: any) {
      alert(`❌ ${error.message || '匯入盤點結果分析報表失敗'}`);
    } finally {
      setAnalysisImporting(false);
    }
  };

  // 讀取 FKS0701 Excel 檔案（明確處理標題行）
  const readFKS0701ExcelFile = (file: File): Promise<any[]> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const data = e.target?.result;
          const workbook = XLSX.read(data, { type: 'binary' });
          const sheetName = workbook.SheetNames[0];
          const worksheet = workbook.Sheets[sheetName];
          
          // 先讀取為陣列的陣列
          const rawData = XLSX.utils.sheet_to_json(worksheet, { header: 1 }) as any[][];
          
          console.log('🔍 FKS0701 原始資料診斷：');
          console.log('總行數：', rawData.length);
          console.log('第一行（標題行）：', rawData[0]);
          console.log('第二行（第一筆資料）：', rawData[1]);
          
          if (rawData.length < 2) {
            reject(new Error('檔案資料不足'));
            return;
          }
          
          // 第一行是標題
          const headers = rawData[0];
          
          // 找出需要的欄位索引
          const 品號索引 = headers.findIndex((h: any) => String(h).includes('品號'));
          const 品名索引 = headers.findIndex((h: any) => String(h).includes('品名'));
          const 條碼索引 = headers.findIndex((h: any) => String(h).includes('條碼'));
          const 盤點數量索引 = headers.findIndex((h: any) => String(h).includes('盤點數量'));
          const 盤點儲位索引 = headers.findIndex((h: any) => String(h).includes('盤點儲位'));
          
          console.log('✅ 找到的欄位索引：');
          console.log(`品號: ${品號索引} (${headers[品號索引]})`);
          console.log(`品名: ${品名索引} (${headers[品名索引]})`);
          console.log(`條碼: ${條碼索引} (${headers[條碼索引]})`);
          console.log(`盤點數量: ${盤點數量索引} (${headers[盤點數量索引]})`);
          console.log(`盤點儲位: ${盤點儲位索引} (${headers[盤點儲位索引]})`);
          
          if (品號索引 === -1 || 盤點數量索引 === -1) {
            reject(new Error(`找不到必要欄位！標題行內容：${headers.join(' | ')}`));
            return;
          }
          
          // 從第二行開始轉換為物件
          const result = rawData.slice(1).map((row: any[]) => ({
            品號: row[品號索引],
            品名: 品名索引 >= 0 ? row[品名索引] : '',
            條碼: 條碼索引 >= 0 ? row[條碼索引] : '',
            盤點數量: 盤點數量索引 >= 0 ? row[盤點數量索引] : 0,
            盤點儲位: 盤點儲位索引 >= 0 ? row[盤點儲位索引] : ''
          }));
          
          console.log('✅ 成功解析，前3筆範例：', result.slice(0, 3));
          
          resolve(result);
        } catch (error) {
          reject(error);
        }
      };
      reader.onerror = reject;
      reader.readAsBinaryString(file);
    });
  };

  // 驗證必要欄位
  const validateColumns = (data: any[], requiredColumns: string[], fileType: string): boolean => {
    if (data.length === 0) {
      alert(`❌ 檔案沒有資料！`);
      return false;
    }

    const firstRow = data[0];
    const actualColumns = Object.keys(firstRow);
    const missingColumns = requiredColumns.filter(col => !actualColumns.includes(col));

    if (missingColumns.length > 0) {
      console.log('🔍 欄位診斷資訊：');
      console.log('需要的欄位：', requiredColumns);
      console.log('實際的欄位：', actualColumns);
      console.log('缺少的欄位：', missingColumns);
      
      alert(`❌ ${fileType}缺少必要欄位！\n\n缺少的欄位：\n${missingColumns.join('、')}\n\n實際檔案中的欄位：\n${actualColumns.join('、')}\n\n請確認檔案格式是否正確。`);
      return false;
    }

    return true;
  };

  // 匯出 Excel 檔案
  const exportToExcel = (data: any[], filename: string) => {
    const worksheet = XLSX.utils.json_to_sheet(data);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Sheet1');
    XLSX.writeFile(workbook, filename);
  };

  // 統一處理 1F當日商品資料上傳（DPOS 1F 格式：第一列為空白合併儲存格，第二列為標題）
  const handleBaseDataUpload = async (file: File) => {
    try {
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const data = e.target?.result;
          const workbook = XLSX.read(data, { type: 'binary' });
          const sheetName = workbook.SheetNames[0];
          const worksheet = workbook.Sheets[sheetName];
          
          // 手動讀取第二行作為標題行（避免合併儲存格問題）
          const range = XLSX.utils.decode_range(worksheet['!ref'] || 'A1');
          const headers: string[] = [];
          
          // 讀取第二行（索引1）作為標題
          for (let col = range.s.c; col <= range.e.c; col++) {
            const cellAddress = XLSX.utils.encode_cell({ r: 1, c: col });
            const cell = worksheet[cellAddress];
            const headerValue = cell ? (cell.v || '').toString().trim() : '';
            headers.push(headerValue);
          }
          
          console.log('🔍 讀取到的標題行：', headers);
          
          // 從第三行開始讀取資料
          const json: any[] = [];
          for (let row = 2; row <= range.e.r; row++) {
            const rowData: any = {};
            for (let col = range.s.c; col <= range.e.c; col++) {
              const cellAddress = XLSX.utils.encode_cell({ r: row, c: col });
              const cell = worksheet[cellAddress];
              const header = headers[col];
              if (header) {
                rowData[header] = cell ? cell.v : null;
              }
            }
            // 只添加非空行
            if (Object.values(rowData).some(v => v !== null && v !== '')) {
              json.push(rowData);
            }
          }
          
          console.log('🔍 讀取到的資料筆數：', json.length);
          if (json.length > 0) {
            console.log('🔍 第一筆資料範例：', json[0]);
          }
          
          // 驗證必要欄位（嘗試多種可能的欄位名稱）
          const 主要儲位欄位 = json.length > 0 ? Object.keys(json[0]).find(key => 
            key.includes('主要') && (key.includes('儲位') || key.includes('庫位'))
          ) : null;
          
          if (!主要儲位欄位) {
            const actualColumns = json.length > 0 ? Object.keys(json[0]) : [];
            alert(`❌ 1F當日商品資料缺少必要欄位！\n\n找不到「主要儲位」或「主要庫位」欄位\n\n實際檔案中的欄位：\n${actualColumns.join('\n')}\n\n請打開瀏覽器的開發者工具（F12）查看 Console 以獲取更詳細的診斷資訊。`);
            return;
          }
          
          console.log('✅ 找到主要儲位欄位：', 主要儲位欄位);
          
          // 檢查庫存欄位（可能是「庫存」或「重存」）
          const 庫存欄位 = json.length > 0 ? Object.keys(json[0]).find(key => 
            key.includes('庫存') || key.includes('重存')
          ) : null;
          
          if (!庫存欄位) {
            alert(`❌ 找不到「庫存」或「重存」欄位！`);
            return;
          }
          
          console.log('✅ 找到庫存欄位：', 庫存欄位);
          
          // 其他必要欄位驗證
          if (!validateColumns(json, ['品號', '品名', '條碼'], '1F當日商品資料')) {
            return;
          }
          
          // 尋找 UN（單位）欄位
          const UN欄位 = json.length > 0 ? Object.keys(json[0]).find(key => 
            key === 'UN' || key === 'un' || key.includes('單位')
          ) : null;
          console.log('✅ UN欄位：', UN欄位 || '未找到');

          const parsed = json.map((row: any) => ({
            品號: formatProductCode(row['品號']),
            品名: String(row['品名'] || ''),
            UN: UN欄位 ? String(row[UN欄位] || '') : '',
            條碼: String(row['條碼'] || ''),
            庫存: Number(row[庫存欄位] || 0),
            主要儲位: String(row[主要儲位欄位] || '')
          }));
          
          setBaseData(parsed);
          alert(`✅ 已匯入 ${parsed.length} 筆 1F當日商品資料\n\n此資料將供三個模組共用`);
        } catch (error) {
          console.error('讀取失敗:', error);
          alert('❌ 匯入失敗，請檢查檔案格式');
        }
      };
      reader.onerror = () => alert('❌ 檔案讀取失敗');
      reader.readAsBinaryString(file);
    } catch (error) {
      console.error('匯入失敗:', error);
      alert('❌ 匯入失敗，請檢查檔案格式');
    }
  };

  // ========== 模組一：產出外盤複盤清單 ==========
  const handleModule1Upload = async (type: 'external' | 'fks0701', file: File) => {
    try {
      if (type === 'external') {
        const data = await readExcelFile(file);
        
        // 驗證必要欄位
        if (!validateColumns(data, ['品號', '品名', '條碼', '盤點數量'], '外盤公司盤點檔')) {
          return;
        }

        const parsed = data.map((row: any) => ({
          品號: formatProductCode(row['品號']),
          品名: String(row['品名'] || ''),
          條碼: String(row['條碼'] || ''),
          盤點數量: Number(row['盤點數量'] || 0)
        }));

        // 檢查重複品號
        const 品號Set = new Set<string>();
        const 重複品號: string[] = [];
        parsed.forEach(item => {
          if (item.品號 && 品號Set.has(item.品號)) {
            if (!重複品號.includes(item.品號)) {
              重複品號.push(item.品號);
            }
          } else {
            品號Set.add(item.品號);
          }
        });

        if (重複品號.length > 0) {
          alert(`❌ 匯入失敗：外盤公司原始檔中發現重複品號！\n\n重複的品號有：\n${重複品號.join(', ')}\n\n❌ 系統已拒絕匯入此檔案。\n\n請聯繫外盤公司修正檔案後重新上傳，\n每個品號只能出現一次。`);
          return;
        }

        setExternalOriginal(parsed);
        alert(`✅ 已匯入 ${parsed.length} 筆外盤公司原始資料`);
        
      } else if (type === 'fks0701') {
        // 使用專門的 FKS0701 讀取函數
        const parsed = await readFKS0701ExcelFile(file);
        
        // 格式化並過濾資料
        const formatted = parsed
          .filter((row: any) => row.品號) // 過濾掉沒有品號的行
          .map((row: any) => ({
            品號: formatProductCode(row.品號),
            品名: String(row.品名 || ''),
            條碼: String(row.條碼 || ''),
            盤點數量: Number(row.盤點數量 || 0),
            盤點儲位: String(row.盤點儲位 || '')
          }));
        
        setFks0701Data1(formatted);
        alert(`✅ 已匯入 ${formatted.length} 筆 FKS0701 盤點紀錄`);
      }
    } catch (error) {
      console.error('匯入失敗:', error);
      alert(`❌ 匯入失敗：${error instanceof Error ? error.message : '請檢查檔案格式'}`);
    }
  };

  const generateModule1Result = () => {
    if (baseData.length === 0 || externalOriginal.length === 0 || fks0701Data1.length === 0) {
      alert('❌ 請先匯入所有必要檔案');
      return;
    }

    // 建立品號 -> 基準庫存的映射
    const baseMap = new Map<string, number>();
    baseData.forEach(item => {
      baseMap.set(item.品號, item.庫存);
    });

    // 建立品號 -> 盤點數量加總的映射
    const countMap = new Map<string, number>();

    // 加總外盤公司數量
    externalOriginal.forEach(item => {
      const current = countMap.get(item.品號) || 0;
      countMap.set(item.品號, current + item.盤點數量);
    });

    // 加總 FKS0701 數量
    fks0701Data1.forEach(item => {
      const current = countMap.get(item.品號) || 0;
      countMap.set(item.品號, current + item.盤點數量);
    });

    // 篩選：僅針對外盤公司原始檔中存在的品號，且有盤差的
    const needRecount: { 品號: string }[] = [];
    externalOriginal.forEach(item => {
      const 品號 = item.品號;
      const 全店總盤點數 = countMap.get(品號) || 0;
      const 庫存 = baseMap.get(品號) || 0;

      if (全店總盤點數 !== 庫存) {
        needRecount.push({ 品號 });
      }
    });

    if (needRecount.length === 0) {
      alert('✅ 沒有需要複盤的品項');
      return;
    }

    const filename = `外盤應複盤清單_${new Date().toLocaleDateString('zh-TW')}.xlsx`;
    exportToExcel(needRecount, filename);
    alert(`✅ 已產生 ${needRecount.length} 筆應複盤品項清單`);
  };

  // ========== 模組二：產出內部+外盤公司資料整合之複盤表與未盤表 ==========
  const handleModule2Upload = async (type: 'pre' | 'fks0701' | 'external', file: File) => {
    try {
      if (type === 'pre') {
        const data = await readExcelFile(file);
        
        // 驗證必要欄位
        if (!validateColumns(data, ['品號', '盤點數量', '盤點儲位'], '預盤資料')) {
          return;
        }

        const parsed = data.map((row: any) => ({
          品號: formatProductCode(row['品號']),
          盤點數量: Number(row['盤點數量'] || 0),
          盤點儲位: String(row['盤點儲位'] || '')
        }));
        setPreInventory(parsed);
        alert(`✅ 已匯入 ${parsed.length} 筆預盤資料`);
        
      } else if (type === 'fks0701') {
        // 使用專門的 FKS0701 讀取函數
        const parsed = await readFKS0701ExcelFile(file);
        
        // 格式化並過濾資料
        const formatted = parsed
          .filter((row: any) => row.品號) // 過濾掉沒有品號的行
          .map((row: any) => ({
            品號: formatProductCode(row.品號),
            品名: String(row.品名 || ''),
            條碼: String(row.條碼 || ''),
            盤點數量: Number(row.盤點數量 || 0),
            盤點儲位: String(row.盤點儲位 || '')
          }));
        
        setFks0701Data2(formatted);
        alert(`✅ 已匯入 ${formatted.length} 筆 FKS0701 盤點紀錄`);
        
      } else if (type === 'external') {
        const data = await readExcelFile(file);
        
        // 驗證必要欄位（新版外盤檔案格式：貨號、數量、貨架、棚板、序號）
        if (!validateColumns(data, ['貨號', '數量', '貨架', '棚板', '序號'], '外盤公司盤點檔')) {
          return;
        }

        // 先逐列解析並合成儲位
        // 規則：統一為 外${貨架}-${棚板}（不使用序號），同儲位數量自動加總
        const rawParsed = data.map((row: any) => {
          const 貨架 = String(row['貨架'] || '').trim();
          const 棚板 = String(row['棚板'] || '').trim();
          const 盤點儲位 = `外${貨架}-${棚板}`;

          return {
            品號: formatProductCode(row['貨號']),
            品名: String(row['品名'] || ''),
            條碼: String(row['條碼'] || ''),
            盤點數量: Number(row['數量'] || 0),
            盤點儲位
          };
        });

        // 依（品號 + 盤點儲位）做數量加總（序號不納入儲位，所有同儲位自動合併）
        const mergeMap = new Map<string, typeof rawParsed[0]>();
        rawParsed.forEach(item => {
          const key = `${item.品號}__${item.盤點儲位}`;
          const existing = mergeMap.get(key);
          if (existing) {
            existing.盤點數量 += item.盤點數量;
          } else {
            mergeMap.set(key, { ...item });
          }
        });

        const parsed = Array.from(mergeMap.values());

        setExternalModified(parsed);
        alert(`✅ 已匯入 ${data.length} 筆原始資料，合併後共 ${parsed.length} 筆外盤公司盤點資料\n\n支援一品號多行格式（依儲位區分）`);
      }
    } catch (error) {
      console.error('匯入失敗:', error);
      alert(`❌ 匯入失敗：${error instanceof Error ? error.message : '請檢查檔案格式'}`);
    }
  };

  // 處理多個預盤檔案上傳
  const handleMultiplePreInventoryUpload = async (files: File[]) => {
    try {
      const allData: PreInventory[] = [];
      let totalFiles = files.length;
      const failedFiles: string[] = [];

      console.log('=== 多檔案預盤上傳診斷 ===');
      console.log('檔案數量:', totalFiles);
      console.log('檔案清單:', Array.from(files).map(f => f.name));

      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        console.log(`\n📂 開始處理檔案 ${i + 1}/${totalFiles}: ${file.name}`);
        
        try {
          console.log(`  - 正在讀取 Excel...`);
          const data = await readExcelFile(file);
          console.log(`  - ✅ 讀取成功，共 ${data.length} 筆資料`);
          
          // 檢查資料是否為空
          if (data.length === 0) {
            console.log(`  ⚠️ 檔案 ${file.name} 沒有資料，跳過`);
            failedFiles.push(`${file.name} (無資料)`);
            continue;
          }
          
          // 檢查必要欄位
          const actualColumns = Object.keys(data[0]);
          console.log(`  - 檔案欄位:`, actualColumns);
          
          const requiredColumns = ['品號', '盤點數量', '盤點儲位'];
          const missingColumns = requiredColumns.filter(col => !actualColumns.includes(col));
          
          if (missingColumns.length > 0) {
            console.log(`  ⚠️ 檔案 ${file.name} 缺少欄位: ${missingColumns.join(', ')}`);
            console.log(`  - 實際欄位: ${actualColumns.join(', ')}`);
            failedFiles.push(`${file.name} (缺少欄位: ${missingColumns.join(', ')})`);
            continue; // 跳過此檔案，繼續處理下一個
          }
          
          console.log(`  - 開始格式化資料...`);
          const parsed = data.map((row: any) => ({
            品號: formatProductCode(row['品號']),
            盤點數量: Number(row['盤點數量'] || 0),
            盤點儲位: String(row['盤點儲位'] || '')
          }));
          
          console.log(`  ✅ 格式化完成，共 ${parsed.length} 筆`);
          console.log(`  - 前3筆範例:`, parsed.slice(0, 3));
          console.log(`  - 目前 allData 總計: ${allData.length} 筆`);
          
          allData.push(...parsed);
          console.log(`  - 加入後 allData 總計: ${allData.length} 筆`);
          
        } catch (fileError) {
          console.error(`  ❌ 處理檔案 ${file.name} 時發生錯誤:`, fileError);
          failedFiles.push(`${file.name} (讀取錯誤: ${fileError})`);
          continue; // 跳過此檔案，繼續處理下一個
        }
        
        console.log(`✅ 檔案 ${i + 1}/${totalFiles} 處理完成\n`);
      }

      console.log('\n=== 預盤資料合併完成 ===');
      console.log('成功處理檔案數:', totalFiles - failedFiles.length);
      console.log('失敗檔案數:', failedFiles.length);
      console.log('合併後總筆數:', allData.length);
      console.log('包含的品號數:', new Set(allData.map(item => item.品號)).size);
      console.log('合併後所有資料:', allData);

      if (allData.length === 0) {
        alert('❌ 沒有成功匯入任何資料！\n\n' + 
          (failedFiles.length > 0 ? `失敗的檔案：\n${failedFiles.join('\n')}` : ''));
        return;
      }

      console.log('📝 準備保存到 preInventory state...');
      setPreInventory(allData);
      console.log('✅ 已調用 setPreInventory，資料筆數:', allData.length);
      
      let message = `✅ 已匯入 ${totalFiles - failedFiles.length}/${totalFiles} 個預盤檔案，共 ${allData.length} 筆資料`;
      if (failedFiles.length > 0) {
        message += `\n\n⚠️ 以下檔案未成功匯入：\n${failedFiles.join('\n')}`;
      }
      alert(message);
    } catch (error) {
      console.error('❌ 整體匯入失敗:', error);
      alert(`❌ 匯入失敗：${error}`);
    }
  };

  const generateModule2Result = () => {
    if (baseData.length === 0) {
      alert('❌ 請先匯入 1F當日商品資料');
      return;
    }

    console.log('=== 模組二生成診斷 ===');
    console.log('預盤資料筆數:', preInventory.length);
    console.log('FKS0701資料筆數:', fks0701Data2.length);
    console.log('外盤修改檔筆數:', externalModified.length);
    console.log('預盤資料範例（前5筆）:', preInventory.slice(0, 5));

    // 建立基準資料映射
    const baseMap = new Map<string, ProductData>();
    baseData.forEach(item => {
      baseMap.set(item.品號, item);
    });

    // 收集所有盤點記錄（一品號多行）
    const inventoryRecords: any[] = [];

    // 1. 預盤資料
    preInventory.forEach(item => {
      inventoryRecords.push({
        品號: item.品號,
        盤點儲位: item.盤點儲位,
        該儲位盤點數量: item.盤點數量
      });
    });

    // 2. FKS0701
    fks0701Data2.forEach(item => {
      inventoryRecords.push({
        品號: item.品號,
        盤點儲位: item.盤點儲位,
        該儲位盤點數量: item.盤點數量
      });
    });

    // 3. 外盤修改檔（使用合成後的儲位）
    externalModified.forEach(item => {
      inventoryRecords.push({
        品號: item.品號,
        盤點儲位: item.盤點儲位,
        該儲位盤點數量: item.盤點數量
      });
    });

    console.log('合併後的盤點記錄總數:', inventoryRecords.length);
    console.log('盤點記錄範例（前5筆）:', inventoryRecords.slice(0, 5));

    // 按品號分組，計算總量
    const productTotalMap = new Map<string, number>();
    inventoryRecords.forEach(record => {
      const current = productTotalMap.get(record.品號) || 0;
      productTotalMap.set(record.品號, current + record.該儲位盤點數量);
    });
    
    console.log('品號總盤點數量範例:', Array.from(productTotalMap.entries()).slice(0, 5));

    // 建立完整記錄（包含基準資料）
    const fullRecords = inventoryRecords.map(record => {
      const base = baseMap.get(record.品號);
      const 各式盤點數量加總 = productTotalMap.get(record.品號) || 0;
      const 庫存量 = base?.庫存 || 0;
      const 盤差量 = 各式盤點數量加總 - 庫存量;

      return {
        盤點儲位: record.盤點儲位,
        該儲位盤點數量: record.該儲位盤點數量,
        品號: record.品號,
        品名: base?.品名 || '',
        UN: base?.UN || '',
        條碼: base?.條碼 || '',
        庫存量,
        各式盤點數量加總,
        盤差量
      };
    });

    // 篩選有盤差的
    const withDiff = fullRecords.filter(r => r.盤差量 !== 0);
    
    // 篩選盤差為0的（儲存供模組三使用）
    // 按品號去重（因為一品號可能多行多儲位，但盤差為0代表加總已相符）
    const noDiffProductSet = new Set<string>();
    const noDiffItems: any[] = [];
    fullRecords.forEach(r => {
      if (r.盤差量 === 0 && !noDiffProductSet.has(r.品號)) {
        noDiffProductSet.add(r.品號);
        noDiffItems.push({
          品號: r.品號,
          庫存量: r.庫存量,
          實際量: r.各式盤點數量加總
        });
      }
    });
    setNoDiffRecords(noDiffItems);
    console.log('盤差為0的品項數:', noDiffItems.length);

    // 按盤點儲位排序
    withDiff.sort((a, b) => a.盤點儲位.localeCompare(b.盤點儲位, 'zh-TW'));

    // 產生「內部盤點複盤資料」
    if (withDiff.length > 0) {
      const filename = `內部盤點複盤資料_${new Date().toLocaleDateString('zh-TW')}.xlsx`;
      exportToExcel(withDiff, filename);
      alert(`✅ 已產生 ${withDiff.length} 筆內部盤點複盤資料\n\n另有 ${noDiffItems.length} 筆盤差為0的品項已儲存，將在模組三中自動合併輸出`);
    }

    // 找出「系統有庫存但未盤點」
    const inventoriedProducts = new Set<string>();
    inventoryRecords.forEach(r => inventoriedProducts.add(r.品號));

    console.log('=== 未盤點診斷資訊 ===');
    console.log('baseData 總數:', baseData.length);
    console.log('有庫存的品項數:', baseData.filter(item => item.庫存 !== 0).length);
    console.log('已盤點品號數:', inventoriedProducts.size);
    console.log('已盤點品號範例:', Array.from(inventoriedProducts).slice(0, 10));
    console.log('baseData 品號範例:', baseData.slice(0, 5).map(item => ({ 品號: item.品號, 庫存: item.庫存 })));
    
    // 特別檢查 02000215
    const test品號 = '02000215';
    console.log(`=== 特別診斷: ${test品號} ===`);
    console.log(`在 baseData 中? ${baseData.some(item => item.品號 === test品號)}`);
    console.log(`baseData 中的資料:`, baseData.find(item => item.品號 === test品號));
    console.log(`在 preInventory 中? ${preInventory.some(item => item.品號 === test品號)}`);
    console.log(`preInventory 中的資料:`, preInventory.filter(item => item.品號 === test品號));
    console.log(`在 inventoryRecords 中? ${inventoryRecords.some(r => r.品號 === test品號)}`);
    console.log(`inventoryRecords 中的資料:`, inventoryRecords.filter(r => r.品號 === test品號));
    console.log(`在 inventoriedProducts Set 中? ${inventoriedProducts.has(test品號)}`);

    const unInventoriedList = baseData
      .filter(item => {
        const hasStock = item.庫存 !== 0;
        const notInventoried = !inventoriedProducts.has(item.品號);
        
        // 詳細記錄 02000215 的判斷過程
        if (item.品號 === test品號) {
          console.log(`${test品號} 判斷: 庫存=${item.庫存}, 有庫存?${hasStock}, 未盤點?${notInventoried}, 結果=${hasStock && notInventoried}`);
        }
        
        return hasStock && notInventoried;
      })
      .map(item => ({
        品號: item.品號,
        品名: item.品名,
        UN: item.UN || '',
        條碼: item.條碼,
        庫存量: item.庫存,
        主要儲位: item.主要儲位,
        盤點數量: 0
      }));

    console.log('未盤點品項數:', unInventoriedList.length);
    console.log('未盤點品項範例:', unInventoriedList.slice(0, 3));

    if (unInventoriedList.length > 0) {
      const filename = `系統有庫存但未盤點檔案_${new Date().toLocaleDateString('zh-TW')}.xlsx`;
      exportToExcel(unInventoriedList, filename);
      alert(`✅ 已產生 ${unInventoriedList.length} 筆未盤點品項`);
    }

    if (withDiff.length === 0 && unInventoriedList.length === 0) {
      alert('✅ 無盤差且無未盤點品項');
    }
  };

  // ========== 模組三：產出匯入DPOS檔案 ==========
  const handleModule3Upload = async (type: 'internal' | 'uninventoried', file: File) => {
    try {
      const data = await readExcelFile(file);

      if (type === 'internal') {
        // 驗證必要欄位
        if (!validateColumns(data, ['品號', '庫存量', '該儲位盤點數量'], '內部複盤資料')) {
          return;
        }

        setInternalRecount(data);
        alert(`✅ 已匯入 ${data.length} 筆修改完的內部盤點複盤資料`);
      } else if (type === 'uninventoried') {
        // 驗證必要欄位
        if (!validateColumns(data, ['品號', '庫存量', '盤點數量'], '未盤點檔案')) {
          return;
        }

        setUnInventoried(data);
        alert(`✅ 已匯入 ${data.length} 筆修改完的未盤點檔案`);
      }
    } catch (error) {
      console.error('匯入失敗:', error);
      alert('❌ 匯入失敗，請檢查檔案格式');
    }
  };

  const generateModule3Result = () => {
    if (internalRecount.length === 0 && unInventoried.length === 0) {
      alert('❌ 請先匯入至少一個檔案');
      return;
    }

    // 整合所有資料，按品號分組
    const finalMap = new Map<string, { 庫存量: number; 實際量: number }>();

    // 1. 先加入模組二中「盤差為0」的品項（這些不需要修改，直接帶入）
    noDiffRecords.forEach((row: any) => {
      const 品號 = String(row.品號 || '');
      const 庫存量 = Number(row.庫存量 || 0);
      const 實際量 = Number(row.實際量 || 0);

      if (品號 && !finalMap.has(品號)) {
        finalMap.set(品號, { 庫存量, 實際量 });
      }
    });
    console.log('模組三：加入盤差為0的品項數:', noDiffRecords.length);

    // 2. 處理內部複盤資料（一品號可能多行，已包含外盤公司盤點區的數據）
    internalRecount.forEach((row: any) => {
      const 品號 = formatProductCode(row['品號']);
      const 庫存量 = Number(row['庫存量'] || 0);
      const 該儲位盤點數量 = Number(row['該儲位盤點數量'] || 0);

      if (!finalMap.has(品號)) {
        finalMap.set(品號, { 庫存量, 實際量: 0 });
      }
      const item = finalMap.get(品號)!;
      item.實際量 += 該儲位盤點數量;
    });
    console.log('模組三：加入內部複盤資料後品號數:', finalMap.size);

    // 3. 處理未盤點檔案（盤點數量為0或修改後的值）
    unInventoried.forEach((row: any) => {
      const 品號 = formatProductCode(row['品號']);
      const 庫存量 = Number(row['庫存量'] || 0);
      const 盤點數量 = Number(row['盤點數量'] || 0);

      if (!finalMap.has(品號)) {
        finalMap.set(品號, { 庫存量, 實際量: 0 });
      }
      const item = finalMap.get(品號)!;
      item.實際量 += 盤點數量;
    });
    console.log('模組三：加入未盤點資料後品號數:', finalMap.size);

    // 產生最終結果
    const result = Array.from(finalMap.entries()).map(([品號, data]) => ({
      品號,
      庫存量: data.庫存量,
      實際量: data.實際量,
      盤差量: data.實際量 - data.庫存量
    }));

    console.log('模組三：最終結果筆數:', result.length);
    console.log('  - 盤差為0:', result.filter(r => r.盤差量 === 0).length, '筆');
    console.log('  - 有盤差:', result.filter(r => r.盤差量 !== 0).length, '筆');

    const today = new Date();
    const filename = `${today.getMonth() + 1}月${today.getDate()}日盤點結果檔.xlsx`;
    exportToExcel(result, filename);
    alert(`✅ 已產生 ${result.length} 筆盤點結果檔\n\n其中：\n• 盤差為0：${result.filter(r => r.盤差量 === 0).length} 筆\n• 有盤差：${result.filter(r => r.盤差量 !== 0).length} 筆`);
  };

  const selectedAnalysisBatch = analysisBatches.find((batch) => batch.id === selectedAnalysisBatchId) || analysisBatches[0];
  const selectedAnalysisCategory = analysisCategorySummary.find((category) => category.category_code === selectedAnalysisCategoryCode) || null;
  const filteredAnalysisItems = selectedAnalysisCategoryCode
    ? analysisItems.filter((item) => getItemCategoryCode(item) === selectedAnalysisCategoryCode)
    : analysisItems;
  const dashboardSummary = selectedAnalysisCategory
    ? {
      label: `${selectedAnalysisCategory.category_code} ${selectedAnalysisCategory.category_name}`,
      row_count: selectedAnalysisCategory.row_count,
      positive_cost_total: selectedAnalysisCategory.positive_cost_total,
      negative_cost_total: selectedAnalysisCategory.negative_cost_total,
      net_cost_total: selectedAnalysisCategory.net_cost_total,
    }
    : {
      label: '排除 01 / 97 / 98 / 99',
      row_count: analysisNonExcludedSummary?.row_count || 0,
      positive_cost_total: analysisNonExcludedSummary?.positive_cost_total || 0,
      negative_cost_total: analysisNonExcludedSummary?.negative_cost_total || 0,
      net_cost_total: analysisNonExcludedSummary?.net_cost_total || 0,
    };
  const topShortageItems = [...filteredAnalysisItems]
    .filter((item) => Number(item.cost) < 0)
    .sort((a, b) => Number(a.cost) - Number(b.cost))
    .slice(0, 10);
  const topSurplusItems = [...filteredAnalysisItems]
    .filter((item) => Number(item.cost) > 0)
    .sort((a, b) => Number(b.cost) - Number(a.cost))
    .slice(0, 10);

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-indigo-50 to-purple-50 p-6">
      <div className="mx-auto max-w-[1800px]">
        {/* 標題 */}
        <div className="mb-8">
          <h1 className="text-4xl font-bold text-gray-800 mb-2">盤點管理系統</h1>
          <p className="text-gray-600">離線盤點工具與雲端盤點結果分析報表</p>
        </div>

        {/* 功能區切換 */}
        <div className="mb-6 grid grid-cols-1 gap-3 md:grid-cols-2">
          <button
            onClick={() => setActiveSection('offline')}
            className={`rounded-xl border p-5 text-left transition-all ${
              activeSection === 'offline'
                ? 'border-indigo-400 bg-indigo-600 text-white shadow-lg'
                : 'border-gray-200 bg-white text-gray-700 hover:bg-gray-50'
            }`}
          >
            <div className="text-lg font-bold">離線盤點匯入匯出工具</div>
            <div className={`mt-1 text-sm ${activeSection === 'offline' ? 'text-indigo-100' : 'text-gray-500'}`}>
              原本模組一至三，檔案僅在本機流程中處理並輸出 Excel
            </div>
          </button>
          <button
            onClick={() => setActiveSection('analysis')}
            className={`rounded-xl border p-5 text-left transition-all ${
              activeSection === 'analysis'
                ? 'border-emerald-400 bg-emerald-600 text-white shadow-lg'
                : 'border-gray-200 bg-white text-gray-700 hover:bg-gray-50'
            }`}
          >
            <div className="text-lg font-bold">盤點結果分析報表</div>
            <div className={`mt-1 text-sm ${activeSection === 'analysis' ? 'text-emerald-100' : 'text-gray-500'}`}>
              新功能，匯入後依門市與盤點單號保存至 Supabase
            </div>
          </button>
        </div>

        {activeSection === 'offline' && (
          <>
            {/* 全局：1F當日商品資料上傳區 */}
            <div className="bg-gradient-to-r from-indigo-500 to-purple-600 rounded-xl shadow-lg p-6 mb-6">
              <div className="flex items-center justify-between">
                <div className="flex-1">
                  <div className="flex items-center gap-3 mb-2">
                    <FileSpreadsheet className="text-white" size={28} />
                    <h3 className="text-xl font-bold text-white">1F當日商品資料（必填）</h3>
                  </div>
                  <p className="text-indigo-100 text-sm mb-2">
                    此檔案供三個模組共用，請先上傳後再使用各模組功能
                  </p>
                  <p className="text-indigo-200 text-xs">
                    欄位：品號、品名、條碼、庫存、主要儲位
                  </p>
                </div>
                <div className="ml-6">
                  <label className="flex items-center gap-2 px-6 py-3 bg-white text-indigo-600 rounded-lg cursor-pointer hover:bg-indigo-50 transition-colors font-semibold shadow-md">
                    <Upload size={20} />
                    <span>上傳 1F 資料</span>
                    <input
                      type="file"
                      accept=".xlsx,.xls"
                      className="hidden"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) {
                          handleBaseDataUpload(file);
                          e.target.value = ''; // 清空以便可以重新上傳
                        }
                      }}
                    />
                  </label>
                  {baseData.length > 0 && (
                    <div className="mt-2 text-center text-sm text-white font-medium bg-green-500 rounded px-3 py-1">
                      ✓ 已匯入 {baseData.length} 筆
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* 模組選擇 */}
            <div className="flex gap-4 mb-6">
              <button
                onClick={() => setActiveModule(1)}
                className={`px-6 py-3 rounded-lg font-semibold transition-all ${
                  activeModule === 1
                    ? 'bg-indigo-600 text-white shadow-lg'
                    : 'bg-white text-gray-700 hover:bg-gray-50'
                }`}
              >
                模組一：產出外盤複盤清單
              </button>
              <button
                onClick={() => setActiveModule(2)}
                className={`px-6 py-3 rounded-lg font-semibold transition-all ${
                  activeModule === 2
                    ? 'bg-indigo-600 text-white shadow-lg'
                    : 'bg-white text-gray-700 hover:bg-gray-50'
                }`}
              >
                模組二：產出內部+外盤公司資料整合之複盤表與未盤表
              </button>
              <button
                onClick={() => setActiveModule(3)}
                className={`px-6 py-3 rounded-lg font-semibold transition-all ${
                  activeModule === 3
                    ? 'bg-indigo-600 text-white shadow-lg'
                    : 'bg-white text-gray-700 hover:bg-gray-50'
                }`}
              >
                模組三：產出匯入DPOS檔案
              </button>
            </div>
          </>
        )}

        {/* 模組一內容 */}
        {activeSection === 'offline' && activeModule === 1 && (
          <div className="bg-white rounded-xl shadow-lg p-8">
            <div className="mb-6">
              <h2 className="text-2xl font-bold text-gray-800 mb-2">產出外盤複盤清單</h2>
              <p className="text-gray-600">整合外盤公司與內部盤點數據，產生應複盤品項清單</p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
              {/* 外盤公司原始檔 */}
              <div className="border-2 border-dashed border-gray-300 rounded-lg p-6 hover:border-indigo-400 transition-colors">
                <div className="flex items-center gap-2 mb-3">
                  <FileSpreadsheet className="text-indigo-600" size={24} />
                  <h3 className="font-semibold text-gray-800">外盤公司原始檔</h3>
                </div>
                <p className="text-sm text-gray-600 mb-4">
                  欄位：品號、品名、條碼、盤點數量
                </p>
                <label className="flex items-center justify-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-lg cursor-pointer hover:bg-indigo-700 transition-colors">
                  <Upload size={18} />
                  <span>上傳檔案</span>
                  <input
                    type="file"
                    accept=".xlsx,.xls"
                    className="hidden"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) {
                        handleModule1Upload('external', file);
                        e.target.value = ''; // 清空以便可以重新上傳
                      }
                    }}
                  />
                </label>
                {externalOriginal.length > 0 && (
                  <div className="mt-3 text-sm text-green-600 font-medium">
                    ✓ 已匯入 {externalOriginal.length} 筆
                  </div>
                )}
              </div>

              {/* FKS0701盤點紀錄 */}
              <div className="border-2 border-dashed border-gray-300 rounded-lg p-6 hover:border-indigo-400 transition-colors">
                <div className="flex items-center gap-2 mb-3">
                  <FileSpreadsheet className="text-indigo-600" size={24} />
                  <h3 className="font-semibold text-gray-800">FKS0701盤點紀錄</h3>
                </div>
                <p className="text-sm text-gray-600 mb-4">
                  欄位：品號、品名、條碼、盤點數量、盤點儲位
                </p>
                <label className="flex items-center justify-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-lg cursor-pointer hover:bg-indigo-700 transition-colors">
                  <Upload size={18} />
                  <span>上傳檔案</span>
                  <input
                    type="file"
                    accept=".xlsx,.xls"
                    className="hidden"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) {
                        handleModule1Upload('fks0701', file);
                        e.target.value = ''; // 清空以便可以重新上傳
                      }
                    }}
                  />
                </label>
                {fks0701Data1.length > 0 && (
                  <div className="mt-3 text-sm text-green-600 font-medium">
                    ✓ 已匯入 {fks0701Data1.length} 筆
                  </div>
                )}
              </div>
            </div>

            <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 mb-6">
              <div className="flex items-start gap-3">
                <AlertCircle className="text-amber-600 flex-shrink-0 mt-1" size={20} />
                <div className="text-sm text-amber-800">
                  <p className="font-semibold mb-1">處理邏輯說明：</p>
                  <ul className="list-disc list-inside space-y-1">
                    <li>以「品號」為唯一識別碼</li>
                    <li>將外盤原始檔與 FKS0701 的盤點數量加總</li>
                    <li>比對加總數與 1F當日資料的庫存量</li>
                    <li>僅針對外盤原始檔中存在的品號，且有盤差時才輸出</li>
                  </ul>
                </div>
              </div>
            </div>

            <button
              onClick={generateModule1Result}
              className="w-full py-4 bg-gradient-to-r from-indigo-600 to-purple-600 text-white font-bold rounded-lg hover:from-indigo-700 hover:to-purple-700 transition-all shadow-lg flex items-center justify-center gap-3"
            >
              <Download size={20} />
              產生外盤應複盤清單
            </button>
          </div>
        )}

        {/* 模組二內容 */}
        {activeSection === 'offline' && activeModule === 2 && (
          <div className="bg-white rounded-xl shadow-lg p-8">
            <div className="mb-6">
              <h2 className="text-2xl font-bold text-gray-800 mb-2">產出內部+外盤公司資料整合之複盤表與未盤表</h2>
              <p className="text-gray-600">整合預盤、FKS0701、外盤修改檔，產生內部複盤資料與未盤點清單</p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
              {/* 預盤資料 */}
              <div className="border-2 border-dashed border-gray-300 rounded-lg p-6 hover:border-indigo-400 transition-colors">
                <div className="flex items-center gap-2 mb-3">
                  <FileSpreadsheet className="text-indigo-600" size={24} />
                  <h3 className="font-semibold text-gray-800">預盤資料（選填）</h3>
                </div>
                <p className="text-sm text-gray-600 mb-2">
                  欄位：品號、盤點數量、盤點儲位
                </p>
                <p className="text-xs text-amber-600 mb-4">
                  ★ 可同時選擇多個檔案
                </p>
                <label className="flex items-center justify-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-lg cursor-pointer hover:bg-indigo-700 transition-colors">
                  <Upload size={18} />
                  <span>上傳檔案</span>
                  <input
                    type="file"
                    accept=".xlsx,.xls"
                    multiple
                    className="hidden"
                    onChange={async (e) => {
                      const files = e.target.files;
                      if (files && files.length > 0) {
                        // 先複製檔案列表，避免清空 input 後 FileList 被清除
                        const fileArray = Array.from(files);
                        e.target.value = ''; // 先清空以便可以重新上傳
                        await handleMultiplePreInventoryUpload(fileArray);
                      }
                    }}
                  />
                </label>
                {preInventory.length > 0 && (
                  <div className="mt-3 text-sm text-green-600 font-medium">
                    ✓ 已匯入 {preInventory.length} 筆
                  </div>
                )}
              </div>

              {/* FKS0701 */}
              <div className="border-2 border-dashed border-gray-300 rounded-lg p-6 hover:border-indigo-400 transition-colors">
                <div className="flex items-center gap-2 mb-3">
                  <FileSpreadsheet className="text-indigo-600" size={24} />
                  <h3 className="font-semibold text-gray-800">FKS0701盤點紀錄</h3>
                </div>
                <p className="text-sm text-gray-600 mb-4">
                  欄位：品號、品名、條碼、盤點數量、盤點儲位
                </p>
                <label className="flex items-center justify-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-lg cursor-pointer hover:bg-indigo-700 transition-colors">
                  <Upload size={18} />
                  <span>上傳檔案</span>
                  <input
                    type="file"
                    accept=".xlsx,.xls"
                    className="hidden"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) {
                        handleModule2Upload('fks0701', file);
                        e.target.value = ''; // 清空以便可以重新上傳
                      }
                    }}
                  />
                </label>
                {fks0701Data2.length > 0 && (
                  <div className="mt-3 text-sm text-green-600 font-medium">
                    ✓ 已匯入 {fks0701Data2.length} 筆
                  </div>
                )}
              </div>

              {/* 外盤修改檔 */}
              <div className="border-2 border-dashed border-gray-300 rounded-lg p-6 hover:border-indigo-400 transition-colors">
                <div className="flex items-center gap-2 mb-3">
                  <FileSpreadsheet className="text-indigo-600" size={24} />
                  <h3 className="font-semibold text-gray-800">外盤公司盤點Stock明細檔</h3>
                </div>
                <p className="text-sm text-gray-600 mb-4">
                  欄位：貨號、數量、貨架、棚板、序號（序號僅作來源欄位，盤點儲位不使用）
                </p>
                <label className="flex items-center justify-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-lg cursor-pointer hover:bg-indigo-700 transition-colors">
                  <Upload size={18} />
                  <span>上傳檔案</span>
                  <input
                    type="file"
                    accept=".xlsx,.xls"
                    className="hidden"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) {
                        handleModule2Upload('external', file);
                        e.target.value = ''; // 清空以便可以重新上傳
                      }
                    }}
                  />
                </label>
                {externalModified.length > 0 && (
                  <div className="mt-3 text-sm text-green-600 font-medium">
                    ✓ 已匯入 {externalModified.length} 筆
                  </div>
                )}
              </div>
            </div>

            <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 mb-6">
              <div className="flex items-start gap-3">
                <AlertCircle className="text-amber-600 flex-shrink-0 mt-1" size={20} />
                <div className="text-sm text-amber-800">
                  <p className="font-semibold mb-1">處理邏輯說明：</p>
                  <ul className="list-disc list-inside space-y-1">
                    <li>一品號多行格式：同品號若出現在不同檔案/儲位，會顯示多行</li>
                    <li>外盤檔案儲位合成："外" + 貨架 + "-" + 棚板（不使用序號，例：外1001-1）</li>
                    <li>計算各品號的盤點總數，與庫存比對後產生盤差量</li>
                    <li>產生兩個檔案：內部複盤資料（有盤差）、未盤點清單（有庫存但未盤）</li>
                  </ul>
                </div>
              </div>
            </div>

            <button
              onClick={generateModule2Result}
              className="w-full py-4 bg-gradient-to-r from-indigo-600 to-purple-600 text-white font-bold rounded-lg hover:from-indigo-700 hover:to-purple-700 transition-all shadow-lg flex items-center justify-center gap-3"
            >
              <Download size={20} />
              產生內部複盤資料與未盤點清單
            </button>
          </div>
        )}

        {/* 模組三內容 */}
        {activeSection === 'offline' && activeModule === 3 && (
          <div className="bg-white rounded-xl shadow-lg p-8">
            <div className="mb-6">
              <h2 className="text-2xl font-bold text-gray-800 mb-2">產出匯入DPOS檔案</h2>
              <p className="text-gray-600">整合修正後的複盤資料，產生上傳 DPOS 的盤點結果檔</p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
              {/* 內部複盤資料 */}
              <div className="border-2 border-dashed border-gray-300 rounded-lg p-6 hover:border-indigo-400 transition-colors">
                <div className="flex items-center gap-2 mb-3">
                  <FileSpreadsheet className="text-indigo-600" size={24} />
                  <h3 className="font-semibold text-gray-800">修改後內部複盤資料</h3>
                </div>
                <p className="text-sm text-gray-600 mb-4">
                  模組二產生的內部複盤資料（修正後，已包含外盤數據）
                </p>
                <label className="flex items-center justify-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-lg cursor-pointer hover:bg-indigo-700 transition-colors">
                  <Upload size={18} />
                  <span>上傳檔案</span>
                  <input
                    type="file"
                    accept=".xlsx,.xls"
                    className="hidden"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) {
                        handleModule3Upload('internal', file);
                        e.target.value = ''; // 清空以便可以重新上傳
                      }
                    }}
                  />
                </label>
                {internalRecount.length > 0 && (
                  <div className="mt-3 text-sm text-green-600 font-medium">
                    ✓ 已匯入 {internalRecount.length} 筆
                  </div>
                )}
              </div>

              {/* 未盤點檔案 */}
              <div className="border-2 border-dashed border-gray-300 rounded-lg p-6 hover:border-indigo-400 transition-colors">
                <div className="flex items-center gap-2 mb-3">
                  <FileSpreadsheet className="text-indigo-600" size={24} />
                  <h3 className="font-semibold text-gray-800">修改後未盤點檔案</h3>
                </div>
                <p className="text-sm text-gray-600 mb-4">
                  模組二產生的未盤點檔案（修正後）
                </p>
                <label className="flex items-center justify-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-lg cursor-pointer hover:bg-indigo-700 transition-colors">
                  <Upload size={18} />
                  <span>上傳檔案</span>
                  <input
                    type="file"
                    accept=".xlsx,.xls"
                    className="hidden"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) {
                        handleModule3Upload('uninventoried', file);
                        e.target.value = ''; // 清空以便可以重新上傳
                      }
                    }}
                  />
                </label>
                {unInventoried.length > 0 && (
                  <div className="mt-3 text-sm text-green-600 font-medium">
                    ✓ 已匯入 {unInventoried.length} 筆
                  </div>
                )}
              </div>
            </div>

            <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 mb-6">
              <div className="flex items-start gap-3">
                <AlertCircle className="text-amber-600 flex-shrink-0 mt-1" size={20} />
                <div className="text-sm text-amber-800">
                  <p className="font-semibold mb-1">處理邏輯說明：</p>
                  <ul className="list-disc list-inside space-y-1">
                    <li>整合內部複盤與未盤點檔案的盤點數量</li>
                    <li>內部複盤資料已包含外盤公司各儲位的盤點數據（來自模組二）</li>
                    <li>以品號為單位，計算實際量（所有盤點數量加總）</li>
                    <li>盤差量 = 實際量 - 庫存量</li>
                    <li>產生符合 DPOS 上傳格式的 Excel 檔案</li>
                  </ul>
                </div>
              </div>
            </div>

            <button
              onClick={generateModule3Result}
              className="w-full py-4 bg-gradient-to-r from-indigo-600 to-purple-600 text-white font-bold rounded-lg hover:from-indigo-700 hover:to-purple-700 transition-all shadow-lg flex items-center justify-center gap-3"
            >
              <Download size={20} />
              產生盤點結果檔（上傳 DPOS 用）
            </button>
          </div>
        )}

        {/* 盤點結果分析報表 */}
        {activeSection === 'analysis' && (
          <div className="bg-white rounded-xl shadow-lg p-8">
            <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
              <div>
                <h2 className="text-2xl font-bold text-gray-800 mb-2">盤點結果分析報表</h2>
                <p className="text-gray-600">匯入盤點結果檔後，依門市與盤點單號保存並產生基礎分析摘要</p>
              </div>
              <div className="flex flex-wrap items-end gap-3">
                <div>
                  <label className="mb-1 block text-xs font-semibold text-gray-500">此次匯入資料年月</label>
                  <input
                    type="month"
                    value={analysisYearMonth}
                    onChange={(e) => setAnalysisYearMonth(e.target.value)}
                    className="rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-100"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold text-gray-500">盤點批次名稱</label>
                  <input
                    type="text"
                    value={analysisImportOrderNo}
                    onChange={(e) => setAnalysisImportOrderNo(e.target.value)}
                    placeholder="空白時使用檔名"
                    className="w-48 rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-100"
                  />
                </div>
                <label className={`flex items-center gap-2 px-5 py-2.5 rounded-lg font-semibold shadow-md ${
                  analysisImporting
                    ? 'bg-gray-100 text-gray-400 pointer-events-none'
                    : 'bg-indigo-600 text-white cursor-pointer hover:bg-indigo-700'
                }`}>
                  <Upload size={18} />
                  <span>{analysisImporting ? '匯入中...' : '匯入 .xlsx'}</span>
                  <input
                    type="file"
                    accept=".xlsx,.xls"
                    className="hidden"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) {
                        handleInventoryResultAnalysisUpload(file);
                        e.target.value = '';
                      }
                    }}
                  />
                </label>
              </div>
            </div>

            <div className="bg-indigo-50 border border-indigo-200 rounded-lg p-4 mb-6">
              <div className="flex items-start gap-3">
                <AlertCircle className="text-indigo-600 flex-shrink-0 mt-1" size={20} />
                <div className="text-sm text-indigo-900">
                  <p className="font-semibold mb-1">匯入欄位格式</p>
                  <p>店號、店名、盤點單號、結案?、品號、品名、單位、儲位1、儲位2、盤差量、盤差額(會員)、成本、單位成本、庫存量、庫存額</p>
                  <p className="mt-1 text-indigo-700">
                    庫存量為盤點前系統庫存；庫存額 = 庫存量 * 單位成本；盤差量為此次盤點差值；成本 = 盤差量 * 單位成本；盤差額(會員)因未提供會員價，僅作參考。
                  </p>
                  <p className="mt-1 text-indigo-700">
                    品號為 8 碼，前兩碼作為商品分類碼，報表會依分類統計盤差與成本影響。
                  </p>
                  <p className="mt-1 text-indigo-700">
                    匯入檔內盤點單號可為空，系統會優先使用上方「盤點批次名稱」，若未填則使用檔名。同一門市、同年月、同批次名稱重新匯入時，會替換該批次舊明細。
                  </p>
                </div>
              </div>
            </div>

            <div className="mb-6 flex flex-wrap items-center gap-3 rounded-lg border border-gray-200 bg-gray-50 p-4">
              <input
                type="month"
                value={analysisYearMonth}
                onChange={(e) => setAnalysisYearMonth(e.target.value)}
                className="rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-100"
              />
              <div className="flex items-center gap-2">
                <Search size={16} className="text-gray-400" />
                <input
                  value={analysisStoreKeyword}
                  onChange={(e) => setAnalysisStoreKeyword(e.target.value)}
                  placeholder="店號或店名"
                  className="w-40 rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-100"
                />
              </div>
              <input
                value={analysisOrderKeyword}
                onChange={(e) => setAnalysisOrderKeyword(e.target.value)}
                placeholder="盤點單號"
                className="w-48 rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-100"
              />
              <button
                onClick={() => loadInventoryResultAnalysis('')}
                disabled={analysisLoading}
                className="flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-50"
              >
                <RefreshCw size={16} className={analysisLoading ? 'animate-spin' : ''} />
                查詢
              </button>
              <button
                onClick={() => {
                  setAnalysisStoreKeyword('');
                  setAnalysisOrderKeyword('');
                  setSelectedAnalysisBatchId('');
                  loadInventoryResultAnalysis('', '', '');
                }}
                className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm text-gray-600 hover:bg-gray-50"
              >
                清除
              </button>
            </div>

            {analysisLoading ? (
              <div className="py-12 text-center text-gray-500">
                <RefreshCw size={20} className="mr-2 inline-block animate-spin" />
                載入盤點結果分析資料中...
              </div>
            ) : analysisBatches.length === 0 ? (
              <div className="rounded-xl border border-dashed border-gray-300 bg-gray-50 px-4 py-12 text-center text-gray-500">
                尚無盤點結果分析資料，請先匯入 .xlsx
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-6 xl:grid-cols-[300px_minmax(0,1fr)]">
                <div className="space-y-3">
                  <h3 className="font-bold text-gray-800">匯入批次</h3>
                  <div className="max-h-[620px] space-y-2 overflow-y-auto pr-1">
                    {analysisBatches.map((batch) => (
                      <button
                        key={batch.id}
                        onClick={() => loadInventoryResultAnalysis(batch.id)}
                        className={`w-full rounded-lg border p-3 text-left transition-colors ${
                          selectedAnalysisBatchId === batch.id
                            ? 'border-indigo-400 bg-indigo-50'
                            : 'border-gray-200 bg-white hover:bg-gray-50'
                        }`}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div>
                            <div className="font-semibold text-gray-900">{batch.store_code} {batch.store_name}</div>
                            <div className="mt-1 text-xs font-semibold text-indigo-700">年月：{batch.year_month}</div>
                            <div className="mt-1 text-xs text-gray-500">單號：{batch.inventory_order_no}</div>
                          </div>
                          <span className="rounded-full bg-white px-2 py-0.5 text-xs font-semibold text-indigo-700">
                            {batch.row_count} 筆
                          </span>
                        </div>
                        <div className="mt-2 grid grid-cols-2 gap-2 text-xs">
                          <span className="rounded bg-red-50 px-2 py-1 text-red-700">短少 {batch.shortage_count}</span>
                          <span className="rounded bg-green-50 px-2 py-1 text-green-700">盤盈 {batch.surplus_count}</span>
                        </div>
                        <div className="mt-2 text-xs text-gray-400">
                          {batch.imported_at ? new Date(batch.imported_at).toLocaleString('zh-TW') : ''}
                        </div>
                      </button>
                    ))}
                  </div>
                </div>

                <div className="space-y-6">
                  {selectedAnalysisBatch && (
                    <>
                      <div className="rounded-xl border border-gray-200 bg-white p-4">
                        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                          <h4 className="font-bold text-gray-800">目前統計：{dashboardSummary.label}</h4>
                          {selectedAnalysisCategoryCode && (
                            <button
                              onClick={() => setSelectedAnalysisCategoryCode('')}
                              className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-semibold text-gray-600 hover:bg-gray-50"
                            >
                              清除分類
                            </button>
                          )}
                        </div>
                        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 2xl:grid-cols-4">
                          <div className="min-w-0 rounded-xl border border-gray-200 bg-gray-50 p-4">
                            <div className="text-xs text-gray-500">統計筆數</div>
                            <div className="mt-1 whitespace-nowrap text-2xl font-bold text-gray-900">{dashboardSummary.row_count}</div>
                          </div>
                          <div className="min-w-0 rounded-xl border border-green-200 bg-green-50 p-4">
                            <div className="text-xs text-green-600">正盤差成本</div>
                            <div className="mt-1 whitespace-nowrap text-2xl font-bold text-green-700">{formatMoney(dashboardSummary.positive_cost_total)}</div>
                          </div>
                          <div className="min-w-0 rounded-xl border border-red-200 bg-red-50 p-4">
                            <div className="text-xs text-red-600">負盤差成本</div>
                            <div className="mt-1 whitespace-nowrap text-2xl font-bold text-red-700">{formatMoney(dashboardSummary.negative_cost_total)}</div>
                          </div>
                          <div className="min-w-0 rounded-xl border border-blue-200 bg-blue-50 p-4">
                            <div className="text-xs text-blue-600">正負加總成本</div>
                            <div className={`mt-1 whitespace-nowrap text-2xl font-bold ${Number(dashboardSummary.net_cost_total) < 0 ? 'text-red-700' : Number(dashboardSummary.net_cost_total) > 0 ? 'text-green-700' : 'text-gray-700'}`}>
                              {formatMoney(dashboardSummary.net_cost_total)}
                            </div>
                          </div>
                        </div>
                      </div>

                      <div className="rounded-xl border border-gray-200 bg-white">
                        <div className="border-b border-gray-200 px-4 py-3">
                          <h4 className="font-bold text-gray-800">分類別盤點分析（點擊分類可切換儀表板、Top 10 與明細）</h4>
                        </div>
                        <div className="grid grid-cols-1 gap-3 p-4 md:grid-cols-2 2xl:grid-cols-3">
                          {analysisCategorySummary.map((category) => {
                            const isActive = selectedAnalysisCategoryCode === category.category_code;
                            return (
                              <button
                                type="button"
                                key={category.category_code}
                                onClick={() => setSelectedAnalysisCategoryCode(isActive ? '' : category.category_code)}
                                className={`rounded-xl border p-4 text-left transition-colors ${
                                  isActive ? 'border-indigo-400 bg-indigo-50 ring-2 ring-indigo-100' : 'border-gray-200 bg-white hover:bg-gray-50'
                                }`}
                              >
                                <div className="mb-3 flex items-start justify-between gap-2">
                                  <div className="font-bold text-gray-900">{category.category_code} {category.category_name}</div>
                                  <span className="whitespace-nowrap rounded-full bg-gray-100 px-2 py-0.5 text-xs font-semibold text-gray-600">{category.row_count} 項</span>
                                </div>
                                <div className="grid grid-cols-2 gap-2 text-xs">
                                  <div className="rounded-lg bg-green-50 p-2">
                                    <div className="text-green-600">正盤差成本</div>
                                    <div className="mt-1 whitespace-nowrap font-bold text-green-700">{formatMoney(category.positive_cost_total)}</div>
                                  </div>
                                  <div className="rounded-lg bg-red-50 p-2">
                                    <div className="text-red-600">負盤差成本</div>
                                    <div className="mt-1 whitespace-nowrap font-bold text-red-700">{formatMoney(category.negative_cost_total)}</div>
                                  </div>
                                  <div className="rounded-lg bg-blue-50 p-2">
                                    <div className="text-blue-600">加總成本</div>
                                    <div className="mt-1 whitespace-nowrap font-bold text-blue-700">{formatMoney(category.net_cost_total)}</div>
                                  </div>
                                  <div className="rounded-lg bg-gray-50 p-2">
                                    <div className="text-gray-500">庫存額總額</div>
                                    <div className="mt-1 whitespace-nowrap font-bold text-gray-800">{formatMoney(category.stock_amount_total)}</div>
                                  </div>
                                </div>
                              </button>
                            );
                          })}
                        </div>
                      </div>

                      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                        <div className="rounded-xl border border-gray-200 p-4">
                          <h4 className="mb-3 flex items-center gap-2 font-bold text-gray-800">
                            <BarChart3 size={18} className="text-red-600" />
                            短少成本 Top 10
                          </h4>
                          <div className="space-y-2">
                            {topShortageItems.length === 0 ? (
                              <div className="text-sm text-gray-400">無短少資料</div>
                            ) : topShortageItems.map((item) => (
                              <div key={item.id} className="flex items-center justify-between gap-3 rounded-lg bg-red-50 px-3 py-2 text-sm">
                                <span className="min-w-0 truncate text-gray-800">{item.product_code} {item.product_name}</span>
                                <span className="whitespace-nowrap font-semibold text-red-700">{formatMoney(item.cost)}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                        <div className="rounded-xl border border-gray-200 p-4">
                          <h4 className="mb-3 flex items-center gap-2 font-bold text-gray-800">
                            <BarChart3 size={18} className="text-green-600" />
                            盤盈成本 Top 10
                          </h4>
                          <div className="space-y-2">
                            {topSurplusItems.length === 0 ? (
                              <div className="text-sm text-gray-400">無盤盈資料</div>
                            ) : topSurplusItems.map((item) => (
                              <div key={item.id} className="flex items-center justify-between gap-3 rounded-lg bg-green-50 px-3 py-2 text-sm">
                                <span className="min-w-0 truncate text-gray-800">{item.product_code} {item.product_name}</span>
                                <span className="whitespace-nowrap font-semibold text-green-700">{formatMoney(item.cost)}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      </div>

                      {analysisNonExcludedSummary && (
                        <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4">
                          <div className="mb-3">
                            <h4 className="font-bold text-emerald-900">排除 01 / 97 / 98 / 99 後商品盤差成本</h4>
                            <p className="mt-1 text-xs text-emerald-700">排除處方藥品、庶務類消耗品、虛擬產品、贈品與展示品。</p>
                          </div>
                          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 2xl:grid-cols-4">
                            <div className="rounded-lg bg-white p-3">
                              <div className="text-xs text-gray-500">統計筆數</div>
                              <div className="mt-1 text-xl font-bold text-gray-900">{analysisNonExcludedSummary.row_count}</div>
                            </div>
                            <div className="rounded-lg bg-white p-3">
                              <div className="text-xs text-green-600">正盤差成本</div>
                              <div className="mt-1 text-xl font-bold text-green-700">{formatMoney(analysisNonExcludedSummary.positive_cost_total)}</div>
                            </div>
                            <div className="rounded-lg bg-white p-3">
                              <div className="text-xs text-red-600">負盤差成本</div>
                              <div className="mt-1 text-xl font-bold text-red-700">{formatMoney(analysisNonExcludedSummary.negative_cost_total)}</div>
                            </div>
                            <div className="rounded-lg bg-white p-3">
                              <div className="text-xs text-emerald-700">正負加總成本</div>
                              <div className={`mt-1 text-xl font-bold ${Number(analysisNonExcludedSummary.net_cost_total) < 0 ? 'text-red-700' : Number(analysisNonExcludedSummary.net_cost_total) > 0 ? 'text-green-700' : 'text-gray-700'}`}>
                                {formatMoney(analysisNonExcludedSummary.net_cost_total)}
                              </div>
                            </div>
                          </div>
                        </div>
                      )}

                      <div className="rounded-xl border border-gray-200">
                        <div className="border-b border-gray-200 px-4 py-3">
                          <h4 className="font-bold text-gray-800">
                            明細資料（{selectedAnalysisCategory ? `${selectedAnalysisCategory.category_code} ${selectedAnalysisCategory.category_name}` : '全部分類'}，共 {filteredAnalysisItems.length} 筆）
                          </h4>
                        </div>
                        <div className="max-h-[680px] overflow-auto">
                          <table className="w-full text-xs">
                            <thead className="sticky top-0 bg-gray-50 text-gray-500">
                              <tr>
                                <th className="px-3 py-2 text-left">品號</th>
                                <th className="px-3 py-2 text-left">分類</th>
                                <th className="px-3 py-2 text-left">品名</th>
                                <th className="px-3 py-2 text-left">儲位</th>
                                <th className="px-3 py-2 text-right">盤差量</th>
                                <th className="px-3 py-2 text-right">成本</th>
                                <th className="px-3 py-2 text-right">盤差額(會員)</th>
                                <th className="px-3 py-2 text-right">庫存量</th>
                                <th className="px-3 py-2 text-right">庫存額</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-100">
                              {filteredAnalysisItems.map((item) => (
                                <tr key={item.id} className="hover:bg-gray-50">
                                  <td className="px-3 py-2 font-mono">{item.product_code}</td>
                                  <td className="px-3 py-2 whitespace-nowrap">{getItemCategoryCode(item)} {getItemCategoryName(item)}</td>
                                  <td className="px-3 py-2">{item.product_name}</td>
                                  <td className="px-3 py-2">{[item.storage_location_1, item.storage_location_2].filter(Boolean).join(' / ') || '-'}</td>
                                  <td className={`px-3 py-2 text-right font-semibold ${Number(item.difference_qty) < 0 ? 'text-red-600' : Number(item.difference_qty) > 0 ? 'text-green-600' : 'text-gray-400'}`}>
                                    {formatMoney(item.difference_qty)}
                                  </td>
                                  <td className={`px-3 py-2 text-right font-semibold ${Number(item.cost) < 0 ? 'text-red-600' : Number(item.cost) > 0 ? 'text-green-600' : 'text-gray-400'}`}>
                                    {formatMoney(item.cost)}
                                  </td>
                                  <td className={`px-3 py-2 text-right font-semibold ${Number(item.difference_amount_member) < 0 ? 'text-red-600' : Number(item.difference_amount_member) > 0 ? 'text-green-600' : 'text-gray-400'}`}>
                                    {formatMoney(item.difference_amount_member)}
                                  </td>
                                  <td className="px-3 py-2 text-right">{formatMoney(item.stock_qty)}</td>
                                  <td className="px-3 py-2 text-right">{formatMoney(item.stock_amount)}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    </>
                  )}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
