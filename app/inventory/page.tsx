'use client';

import { useState } from 'react';
import * as XLSX from 'xlsx';
import { Upload, Download, FileSpreadsheet, AlertCircle } from 'lucide-react';

type ProductData = {
  品號: string;
  品名: string;
  條碼: string;
  庫存: number;
  主要儲位: string;
};

type ExternalInventory = {
  品號: string;
  品名: string;
  條碼: string;
  盤點數量: number;
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

export default function InventoryManagement() {
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

  // 模組三：狀態
  const [internalRecount, setInternalRecount] = useState<any[]>([]);
  const [unInventoried, setUnInventoried] = useState<any[]>([]);
  const [externalFinal, setExternalFinal] = useState<ExternalInventory[]>([]);
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
          
          // 從第二行開始讀取（跳過第一行空白合併儲存格）
          const json = XLSX.utils.sheet_to_json(worksheet, { range: 1 });
          
          const parsed = json.map((row: any) => ({
            品號: formatProductCode(row['品號']),
            品名: String(row['品名'] || ''),
            條碼: String(row['條碼'] || ''),
            庫存: Number(row['庫存'] || 0),
            主要儲位: String(row['主要儲位'] || '')
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

  // ========== 模組一：外盤複盤分析 ==========
  const handleModule1Upload = async (type: 'external' | 'fks0701', file: File) => {
    try {
      const data = await readExcelFile(file);
      
      if (type === 'external') {
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
        const parsed = data.map((row: any) => ({
          品號: formatProductCode(row['品號']),
          品名: String(row['品名'] || ''),
          條碼: String(row['條碼'] || ''),
          盤點數量: Number(row['盤點數量'] || 0),
          盤點儲位: String(row['盤點儲位'] || '')
        }));
        setFks0701Data1(parsed);
        alert(`✅ 已匯入 ${parsed.length} 筆 FKS0701 盤點紀錄`);
      }
    } catch (error) {
      console.error('匯入失敗:', error);
      alert('❌ 匯入失敗，請檢查檔案格式');
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

  // ========== 模組二：內部複盤資料整合 ==========
  const handleModule2Upload = async (type: 'pre' | 'fks0701' | 'external', file: File) => {
    try {
      const data = await readExcelFile(file);

      if (type === 'pre') {
        const parsed = data.map((row: any) => ({
          品號: formatProductCode(row['品號']),
          盤點數量: Number(row['盤點數量'] || 0),
          盤點儲位: String(row['盤點儲位'] || '')
        }));
        setPreInventory(parsed);
        alert(`✅ 已匯入 ${parsed.length} 筆預盤資料`);
      } else if (type === 'fks0701') {
        const parsed = data.map((row: any) => ({
          品號: formatProductCode(row['品號']),
          品名: String(row['品名'] || ''),
          條碼: String(row['條碼'] || ''),
          盤點數量: Number(row['盤點數量'] || 0),
          盤點儲位: String(row['盤點儲位'] || '')
        }));
        setFks0701Data2(parsed);
        alert(`✅ 已匯入 ${parsed.length} 筆 FKS0701 盤點紀錄`);
      } else if (type === 'external') {
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
          alert(`❌ 匯入失敗：外盤公司修改檔中發現重複品號！\n\n重複的品號有：\n${重複品號.join(', ')}\n\n❌ 系統已拒絕匯入此檔案。\n\n請聯繫外盤公司修正檔案後重新上傳，\n每個品號只能出現一次。`);
          return;
        }

        setExternalModified(parsed);
        alert(`✅ 已匯入 ${parsed.length} 筆外盤公司修改檔`);
      }
    } catch (error) {
      console.error('匯入失敗:', error);
      alert('❌ 匯入失敗，請檢查檔案格式');
    }
  };

  // 處理多個預盤檔案上傳
  const handleMultiplePreInventoryUpload = async (files: FileList) => {
    try {
      const allData: PreInventory[] = [];
      let totalFiles = files.length;

      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const data = await readExcelFile(file);
        const parsed = data.map((row: any) => ({
          品號: formatProductCode(row['品號']),
          盤點數量: Number(row['盤點數量'] || 0),
          盤點儲位: String(row['盤點儲位'] || '')
        }));
        allData.push(...parsed);
      }

      setPreInventory(allData);
      alert(`✅ 已匯入 ${totalFiles} 個預盤檔案，共 ${allData.length} 筆資料`);
    } catch (error) {
      console.error('匯入失敗:', error);
      alert('❌ 匯入失敗，請檢查檔案格式');
    }
  };

  const generateModule2Result = () => {
    if (baseData.length === 0) {
      alert('❌ 請先匯入 1F當日商品資料');
      return;
    }

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

    // 3. 外盤修改檔（固定儲位名稱）
    externalModified.forEach(item => {
      inventoryRecords.push({
        品號: item.品號,
        盤點儲位: '外盤公司盤點區',
        該儲位盤點數量: item.盤點數量
      });
    });

    // 按品號分組，計算總量
    const productTotalMap = new Map<string, number>();
    inventoryRecords.forEach(record => {
      const current = productTotalMap.get(record.品號) || 0;
      productTotalMap.set(record.品號, current + record.該儲位盤點數量);
    });

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
        條碼: base?.條碼 || '',
        庫存量,
        各式盤點數量加總,
        盤差量
      };
    });

    // 篩選有盤差的
    const withDiff = fullRecords.filter(r => r.盤差量 !== 0);

    // 按盤點儲位排序
    withDiff.sort((a, b) => a.盤點儲位.localeCompare(b.盤點儲位, 'zh-TW'));

    // 產生「內部盤點複盤資料」
    if (withDiff.length > 0) {
      const filename = `內部盤點複盤資料_${new Date().toLocaleDateString('zh-TW')}.xlsx`;
      exportToExcel(withDiff, filename);
      alert(`✅ 已產生 ${withDiff.length} 筆內部盤點複盤資料`);
    }

    // 找出「系統有庫存但未盤點」
    const inventoriedProducts = new Set<string>();
    inventoryRecords.forEach(r => inventoriedProducts.add(r.品號));

    const unInventoriedList = baseData
      .filter(item => item.庫存 !== 0 && !inventoriedProducts.has(item.品號))
      .map(item => ({
        品號: item.品號,
        品名: item.品名,
        條碼: item.條碼,
        庫存量: item.庫存,
        主要儲位: item.主要儲位,
        盤點數量: 0
      }));

    if (unInventoriedList.length > 0) {
      const filename = `系統有庫存但未盤點檔案_${new Date().toLocaleDateString('zh-TW')}.xlsx`;
      exportToExcel(unInventoriedList, filename);
      alert(`✅ 已產生 ${unInventoriedList.length} 筆未盤點品項`);
    }

    if (withDiff.length === 0 && unInventoriedList.length === 0) {
      alert('✅ 無盤差且無未盤點品項');
    }
  };

  // ========== 模組三：最終結果產出 ==========
  const handleModule3Upload = async (type: 'internal' | 'uninventoried' | 'external', file: File) => {
    try {
      const data = await readExcelFile(file);

      if (type === 'internal') {
        setInternalRecount(data);
        alert(`✅ 已匯入 ${data.length} 筆修改完的內部盤點複盤資料`);
      } else if (type === 'uninventoried') {
        setUnInventoried(data);
        alert(`✅ 已匯入 ${data.length} 筆修改完的未盤點檔案`);
      } else if (type === 'external') {
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
          alert(`❌ 匯入失敗：外盤修改檔中發現重複品號！\n\n重複的品號有：\n${重複品號.join(', ')}\n\n❌ 系統已拒絕匯入此檔案。\n\n請聯繫外盤公司修正檔案後重新上傳，\n每個品號只能出現一次。`);
          return;
        }

        setExternalFinal(parsed);
        alert(`✅ 已匯入 ${parsed.length} 筆外盤修改檔`);
      }
    } catch (error) {
      console.error('匯入失敗:', error);
      alert('❌ 匯入失敗，請檢查檔案格式');
    }
  };

  const generateModule3Result = () => {
    if (internalRecount.length === 0 && unInventoried.length === 0 && externalFinal.length === 0) {
      alert('❌ 請先匯入至少一個檔案');
      return;
    }

    // 整合所有資料，按品號分組
    const finalMap = new Map<string, { 庫存量: number; 實際量: number }>();

    // 1. 處理內部複盤資料（一品號可能多行）
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

    // 2. 處理未盤點檔案（盤點數量為0或修改後的值）
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

    // 3. 處理外盤修改檔
    externalFinal.forEach(row => {
      const 品號 = row.品號;
      if (!finalMap.has(品號)) {
        finalMap.set(品號, { 庫存量: 0, 實際量: 0 });
      }
      const item = finalMap.get(品號)!;
      item.實際量 += row.盤點數量;
    });

    // 產生最終結果
    const result = Array.from(finalMap.entries()).map(([品號, data]) => ({
      品號,
      庫存量: data.庫存量,
      實際量: data.實際量,
      盤差量: data.實際量 - data.庫存量
    }));

    const today = new Date();
    const filename = `${today.getMonth() + 1}月${today.getDate()}日盤點結果檔.xlsx`;
    exportToExcel(result, filename);
    alert(`✅ 已產生 ${result.length} 筆盤點結果檔`);
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-indigo-50 to-purple-50 p-6">
      <div className="max-w-7xl mx-auto">
        {/* 標題 */}
        <div className="mb-8">
          <h1 className="text-4xl font-bold text-gray-800 mb-2">盤點管理系統</h1>
          <p className="text-gray-600">整合外盤、內盤、預盤資料，產生複盤清單與最終盤點結果</p>
        </div>

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
            模組一：外盤複盤分析
          </button>
          <button
            onClick={() => setActiveModule(2)}
            className={`px-6 py-3 rounded-lg font-semibold transition-all ${
              activeModule === 2
                ? 'bg-indigo-600 text-white shadow-lg'
                : 'bg-white text-gray-700 hover:bg-gray-50'
            }`}
          >
            模組二：內部複盤整合
          </button>
          <button
            onClick={() => setActiveModule(3)}
            className={`px-6 py-3 rounded-lg font-semibold transition-all ${
              activeModule === 3
                ? 'bg-indigo-600 text-white shadow-lg'
                : 'bg-white text-gray-700 hover:bg-gray-50'
            }`}
          >
            模組三：最終結果產出
          </button>
        </div>

        {/* 模組一內容 */}
        {activeModule === 1 && (
          <div className="bg-white rounded-xl shadow-lg p-8">
            <div className="mb-6">
              <h2 className="text-2xl font-bold text-gray-800 mb-2">外盤複盤分析</h2>
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
                        handleBaseDataUpload(file);
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
        {activeModule === 2 && (
          <div className="bg-white rounded-xl shadow-lg p-8">
            <div className="mb-6">
              <h2 className="text-2xl font-bold text-gray-800 mb-2">內部複盤資料整合</h2>
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
                    onChange={(e) => {
                      const files = e.target.files;
                      if (files && files.length > 0) {
                        handleMultiplePreInventoryUpload(files);
                        e.target.value = ''; // 清空以便可以重新上傳
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
                  <h3 className="font-semibold text-gray-800">外盤公司修改檔</h3>
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
                    <li>外盤修改檔的儲位固定為「外盤公司盤點區」</li>
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
        {activeModule === 3 && (
          <div className="bg-white rounded-xl shadow-lg p-8">
            <div className="mb-6">
              <h2 className="text-2xl font-bold text-gray-800 mb-2">最終結果產出</h2>
              <p className="text-gray-600">整合修正後的複盤資料，產生上傳 DPOS 的盤點結果檔</p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
              {/* 內部複盤資料 */}
              <div className="border-2 border-dashed border-gray-300 rounded-lg p-6 hover:border-indigo-400 transition-colors">
                <div className="flex items-center gap-2 mb-3">
                  <FileSpreadsheet className="text-indigo-600" size={24} />
                  <h3 className="font-semibold text-gray-800">修改後內部複盤資料</h3>
                </div>
                <p className="text-sm text-gray-600 mb-4">
                  模組二產生的內部複盤資料（修正後）
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

              {/* 外盤修改檔 */}
              <div className="border-2 border-dashed border-gray-300 rounded-lg p-6 hover:border-indigo-400 transition-colors">
                <div className="flex items-center gap-2 mb-3">
                  <FileSpreadsheet className="text-indigo-600" size={24} />
                  <h3 className="font-semibold text-gray-800">外盤修改檔</h3>
                </div>
                <p className="text-sm text-gray-600 mb-4">
                  外盤公司複盤後的最終修改檔
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
                        handleModule3Upload('external', file);
                        e.target.value = ''; // 清空以便可以重新上傳
                      }
                    }}
                  />
                </label>
                {externalFinal.length > 0 && (
                  <div className="mt-3 text-sm text-green-600 font-medium">
                    ✓ 已匯入 {externalFinal.length} 筆
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
                    <li>整合三個資料源的盤點數量</li>
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
      </div>
    </div>
  );
}
