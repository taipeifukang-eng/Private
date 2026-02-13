'use client';

import React from 'react';
import { MapPin } from 'lucide-react';

interface PrintInspectionReportProps {
  inspection: any;
  store: any;
  inspector: any;
  groupedResults: any[];
  improvementItems: any[];
}

export default function PrintInspectionReport({
  inspection,
  store,
  inspector,
  groupedResults,
  improvementItems,
}: PrintInspectionReportProps) {
  const handlePrint = () => {
    window.print();
  };

  return (
    <>
      {/* 列印按鈕（螢幕顯示，列印時隱藏） */}
      <button
        onClick={handlePrint}
        className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors print:hidden"
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          className="h-5 w-5"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z"
          />
        </svg>
        列印報表
      </button>

      {/* 列印專用樣式 */}
      <style jsx global>{`
        @media print {
          /* 隱藏頁面其他元素 */
          body * {
            visibility: hidden;
          }
          
          #print-content,
          #print-content * {
            visibility: visible;
          }
          
          #print-content {
            position: absolute;
            left: 0;
            top: 0;
            width: 100%;
          }

          /* A4 頁面設置 */
          @page {
            size: A4;
            margin: 15mm;
          }

          /* 分頁設置 */
          .page-break {
            page-break-before: always;
          }

          .avoid-break {
            page-break-inside: avoid;
          }

          /* 隱藏不需要列印的元素 */
          .print\\:hidden {
            display: none !important;
          }

          /* 列印時顯示的元素 */
          .print\\:block {
            display: block !important;
          }

          /* 背景顏色設置（某些瀏覽器需要） */
          * {
            -webkit-print-color-adjust: exact;
            print-color-adjust: exact;
          }
        }

        /* 螢幕顯示時隱藏列印內容 */
        @media screen {
          #print-content {
            display: none;
          }
        }
      `}</style>

      {/* 列印內容區域 */}
      <div id="print-content" className="bg-white p-8">
        {/* 頁首 */}
        <div className="border-b-2 border-gray-800 pb-4 mb-6">
          <h1 className="text-2xl font-bold text-center mb-4">門市巡店檢核報告</h1>
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <p className="mb-1"><span className="font-semibold">店鋪名稱：</span>{store.store_name}</p>
              <p className="mb-1"><span className="font-semibold">店鋪代碼：</span>{store.store_code}</p>
              <p className="mb-1"><span className="font-semibold">店鋪地址：</span>{store.address}</p>
            </div>
            <div>
              <p className="mb-1"><span className="font-semibold">檢核日期：</span>{new Date(inspection.inspection_date).toLocaleDateString('zh-TW')}</p>
              <p className="mb-1"><span className="font-semibold">督導人員：</span>{inspector?.full_name || '未知'}</p>
              <p className="mb-1"><span className="font-semibold">報告編號：</span>{inspection.id.slice(0, 8).toUpperCase()}</p>
            </div>
          </div>
          
          {/* GPS 定位資訊 */}
          {inspection.gps_latitude && inspection.gps_longitude && (
            <div className="mt-3 pt-3 border-t border-gray-200">
              <p className="text-xs text-gray-600 flex items-center gap-1">
                <MapPin size={12} />
                GPS 定位：{inspection.gps_latitude.toFixed(6)}, {inspection.gps_longitude.toFixed(6)}
              </p>
            </div>
          )}
        </div>

        {/* 分數總覽 */}
        <div className="mb-6 avoid-break">
          <h2 className="text-lg font-bold mb-3 border-b border-gray-300 pb-2">評分總覽</h2>
          <div className="grid grid-cols-4 gap-4 text-center">
            <div className="border border-gray-300 p-3 rounded">
              <p className="text-xs text-gray-600 mb-1">總得分</p>
              <p className="text-2xl font-bold text-blue-600">{inspection.total_score}</p>
            </div>
            <div className="border border-gray-300 p-3 rounded">
              <p className="text-xs text-gray-600 mb-1">總分</p>
              <p className="text-2xl font-bold text-gray-700">{inspection.max_possible_score}</p>
            </div>
            <div className="border border-gray-300 p-3 rounded">
              <p className="text-xs text-gray-600 mb-1">得分率</p>
              <p className="text-2xl font-bold text-green-600">{inspection.score_percentage.toFixed(1)}%</p>
            </div>
            <div className="border border-gray-300 p-3 rounded">
              <p className="text-xs text-gray-600 mb-1">評級</p>
              <p className="text-2xl font-bold text-purple-600">{inspection.grade}</p>
            </div>
          </div>
        </div>

        {/* 各區塊檢核詳情 */}
        <div className="mb-6">
          <h2 className="text-lg font-bold mb-3 border-b border-gray-300 pb-2">檢核項目詳情</h2>
          {groupedResults.map(([section, data]) => (
            <div key={section} className="mb-4 avoid-break">
              <div className="bg-gray-100 px-3 py-2 font-semibold text-sm mb-2 flex justify-between">
                <span>{data.section_name}</span>
                <span>{data.total_earned} / {data.total_max} 分</span>
              </div>
              <table className="w-full text-xs border-collapse">
                <thead>
                  <tr className="border-b border-gray-300">
                    <th className="text-left py-1 px-2 w-1/3">檢核項目</th>
                    <th className="text-center py-1 px-2 w-1/6">配分</th>
                    <th className="text-center py-1 px-2 w-1/6">得分</th>
                    <th className="text-center py-1 px-2 w-1/6">扣分</th>
                    <th className="text-left py-1 px-2 w-1/4">備註</th>
                  </tr>
                </thead>
                <tbody>
                  {data.items.map((item: any) => (
                    <tr key={item.id} className="border-b border-gray-200">
                      <td className="py-1 px-2">{item.template.item_name}</td>
                      <td className="text-center py-1 px-2">{item.max_score}</td>
                      <td className="text-center py-1 px-2 font-semibold">{item.given_score}</td>
                      <td className="text-center py-1 px-2 text-red-600">
                        {item.deduction_amount > 0 ? `-${item.deduction_amount}` : '-'}
                      </td>
                      <td className="py-1 px-2 text-xs text-gray-600">
                        {item.notes || '-'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
        </div>

        {/* 督導總評 */}
        {inspection.supervisor_notes && (
          <div className="mb-6 avoid-break">
            <h2 className="text-lg font-bold mb-3 border-b border-gray-300 pb-2">督導總評</h2>
            <div className="border border-gray-300 rounded p-3 bg-gray-50">
              <p className="text-sm whitespace-pre-wrap">{inspection.supervisor_notes}</p>
            </div>
          </div>
        )}

        {/* 待改善項目彙整（新頁面） */}
        {improvementItems.length > 0 && (
          <div className="page-break">
            <h2 className="text-lg font-bold mb-4 border-b-2 border-red-500 pb-2 text-red-600">
              待改善項目彙整
            </h2>
            
            {improvementItems.map((item, index) => (
              <div key={item.id} className="mb-6 avoid-break border border-red-200 rounded p-4 bg-red-50">
                <div className="flex items-start gap-3 mb-3">
                  <div className="bg-red-600 text-white rounded-full w-6 h-6 flex items-center justify-center font-bold text-sm flex-shrink-0">
                    {index + 1}
                  </div>
                  <div className="flex-1">
                    <h3 className="font-bold text-sm mb-1">
                      {item.template.section_name} - {item.template.item_name}
                    </h3>
                    <p className="text-xs text-red-700 mb-2">
                      扣分：<span className="font-bold text-lg">-{item.deduction_amount}</span> 分
                    </p>
                    {item.notes && (
                      <div className="bg-white border border-red-200 rounded p-2 mb-3">
                        <p className="text-xs font-semibold mb-1 text-gray-700">缺失說明：</p>
                        <p className="text-sm text-gray-800">{item.notes}</p>
                      </div>
                    )}
                  </div>
                </div>

                {/* 缺失照片 */}
                {item.photo_urls && item.photo_urls.length > 0 && (
                  <div className="mt-3 border-t border-red-200 pt-3">
                    <p className="text-xs font-semibold mb-2 text-gray-700">缺失照片：</p>
                    <div className="grid grid-cols-2 gap-2">
                      {item.photo_urls.map((url: string, photoIndex: number) => (
                        <div key={photoIndex} className="border border-gray-300 rounded overflow-hidden bg-white">
                          <img
                            src={url}
                            alt={`缺失照片 ${photoIndex + 1}`}
                            className="w-full h-32 object-cover"
                            onError={(e) => {
                              (e.target as HTMLImageElement).src = '/placeholder-image.png';
                            }}
                          />
                          <p className="text-xs text-center py-1 bg-gray-100">照片 {photoIndex + 1}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* 改善建議空格 */}
                <div className="mt-3 border-t border-red-200 pt-3">
                  <p className="text-xs font-semibold mb-2 text-gray-700">督導改善建議：</p>
                  <div className="border border-dashed border-gray-400 rounded p-2 min-h-[60px] bg-white">
                    {/* 預留手寫空間 */}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* 簽名區域（最後一頁） */}
        <div className={improvementItems.length > 0 ? '' : 'page-break'}>
          <div className="mt-8 border-t-2 border-gray-800 pt-6">
            <h2 className="text-lg font-bold mb-4">回饋與簽名確認</h2>
            
            {/* 督導建議流程說明 */}
            <div className="mb-6 bg-blue-50 border border-blue-200 rounded p-4">
              <h3 className="font-semibold text-sm mb-2 text-blue-800">督導建議流程：</h3>
              <ol className="text-xs space-y-1 text-gray-700 list-decimal list-inside">
                <li>店長/店主管收到報告後，應於 <span className="font-bold">3 個工作日內</span>確認所有待改善項目</li>
                <li>針對每項缺失擬定具體改善計畫與完成時間</li>
                <li>拍照記錄改善前後對比照片，上傳至系統</li>
                <li>督導將於 <span className="font-bold">7 個工作日後</span>進行複查，確認改善成效</li>
                <li>若未能於期限內改善，將列入月度績效考核</li>
              </ol>
            </div>

            {/* 簽名欄位 */}
            <div className="grid grid-cols-2 gap-6">
              <div className="border border-gray-400 rounded p-4">
                <p className="font-semibold mb-3 text-sm">店長/店主管簽名：</p>
                <div className="border-b border-gray-400 mb-3 h-16">
                  {/* 預留簽名空間 */}
                </div>
                <p className="text-xs text-gray-600">簽名日期：_____________</p>
              </div>
              
              <div className="border border-gray-400 rounded p-4">
                <p className="font-semibold mb-3 text-sm">督導人員簽名：</p>
                <div className="border-b border-gray-400 mb-3 h-16">
                  {inspection.signature_photo_url ? (
                    <img
                      src={inspection.signature_photo_url}
                      alt="督導簽名"
                      className="h-full object-contain"
                    />
                  ) : null}
                </div>
                <p className="text-xs text-gray-600">
                  簽名日期：{new Date(inspection.inspection_date).toLocaleDateString('zh-TW')}
                </p>
              </div>
            </div>

            {/* 備註說明 */}
            <div className="mt-6 border border-gray-300 rounded p-4 bg-gray-50">
              <p className="font-semibold text-xs mb-2">備註說明：</p>
              <div className="min-h-[80px] text-xs text-gray-600">
                {/* 預留手寫空間 */}
              </div>
            </div>
          </div>
        </div>

        {/* 頁尾 */}
        <div className="mt-6 pt-4 border-t border-gray-300 text-xs text-gray-500 text-center">
          <p>本報告由系統自動生成 | 列印時間：{new Date().toLocaleString('zh-TW')}</p>
          <p className="mt-1">如有疑問，請聯繫督導人員或管理部門</p>
        </div>
      </div>
    </>
  );
}
