<template>
  <div>
    <div class="mb-6">
      <h1 class="text-2xl font-bold text-ink tracking-tight">商品主檔匯入</h1>
      <p class="text-sm text-ink-muted mt-0.5">匯入 DPOS 商品主檔 Excel，支援多條碼對應</p>
    </div>

    <!-- 匯入說明 -->
    <div class="bg-card rounded-2xl border border-border-subtle p-5 mb-5 transition-colors duration-300">
      <h2 class="text-sm font-semibold text-ink mb-3">匯入格式說明</h2>
      <div class="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div v-for="col in columns" :key="col.name" class="bg-surface-warm rounded-xl p-3">
          <p class="text-xs font-semibold text-teal mb-0.5">{{ col.name }}</p>
          <p class="text-xs text-ink-muted">{{ col.desc }}</p>
        </div>
      </div>
      <div class="mt-3 flex items-start gap-2 text-xs text-ink-muted">
        <svg class="w-4 h-4 text-amber-500 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/>
        </svg>
        <span>同一品號可有多筆條碼紀錄，系統會自動合併並建立多條碼對應關係。匯入採「新增/更新」策略，不會刪除現有資料。</span>
      </div>
    </div>

    <!-- 檔案上傳區 -->
    <div class="bg-card rounded-2xl border border-border-subtle p-5 mb-5 transition-colors duration-300">
      <h2 class="text-sm font-semibold text-ink mb-4">選擇 Excel 檔案</h2>
      <div
        class="border-2 border-dashed border-border-subtle rounded-xl p-8 text-center hover:border-teal-400 transition-colors cursor-pointer"
        :class="{ 'border-teal-400 bg-teal-soft': isDragging }"
        @dragover.prevent="isDragging = true"
        @dragleave="isDragging = false"
        @drop.prevent="handleDrop"
        @click="fileInput.click()"
      >
        <svg class="w-10 h-10 mx-auto mb-3 text-ink-faint" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"/>
        </svg>
        <p class="text-sm font-medium text-ink">拖曳檔案或點擊選擇</p>
        <p class="text-xs text-ink-faint mt-1">支援 .xlsx、.xls 格式</p>
        <input ref="fileInput" type="file" accept=".xlsx,.xls" class="hidden" @change="handleFileSelect" />
      </div>

      <!-- 已選擇的檔案 -->
      <div v-if="selectedFile" class="mt-3 flex items-center gap-3 px-4 py-3 bg-surface-warm rounded-xl">
        <svg class="w-5 h-5 text-teal flex-shrink-0" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/>
        </svg>
        <div class="flex-1 min-w-0">
          <p class="text-sm font-medium text-ink truncate">{{ selectedFile.name }}</p>
          <p class="text-xs text-ink-muted">{{ (selectedFile.size / 1024).toFixed(1) }} KB</p>
        </div>
        <button @click.stop="clearFile" class="text-ink-faint hover:text-coral transition-colors">
          <svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12"/>
          </svg>
        </button>
      </div>
    </div>

    <!-- 欄位對應設定 -->
    <div v-if="headers.length > 0" class="bg-card rounded-2xl border border-border-subtle p-5 mb-5 transition-colors duration-300">
      <h2 class="text-sm font-semibold text-ink mb-4">欄位對應設定</h2>
      <div class="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div v-for="field in fieldMappings" :key="field.key">
          <label class="block text-xs font-medium text-ink-muted mb-1.5">{{ field.label }} <span class="text-coral">*</span></label>
          <select
            v-model="field.col"
            class="w-full px-3 py-2 rounded-lg bg-surface border border-border-subtle text-ink text-sm focus:outline-none focus:ring-2 focus:ring-teal-400/40 focus:border-teal-400"
          >
            <option value="">-- 選擇欄位 --</option>
            <option v-for="h in headers" :key="h" :value="h">{{ h }}</option>
          </select>
        </div>
      </div>
      <button
        @click="parsePreview"
        class="mt-4 px-4 py-2 rounded-xl bg-surface-warm border border-border-subtle text-sm font-medium text-ink hover:bg-accent-soft hover:border-teal-400 transition-all"
      >
        預覽資料
      </button>
    </div>

    <!-- 資料預覽 -->
    <div v-if="previewData.length > 0" class="bg-card rounded-2xl border border-border-subtle mb-5 transition-colors duration-300 overflow-hidden">
      <div class="px-5 py-4 border-b border-border-subtle flex items-center justify-between">
        <div>
          <h2 class="text-sm font-semibold text-ink">資料預覽</h2>
          <p class="text-xs text-ink-muted mt-0.5">共 {{ rawRows.length }} 筆原始紀錄 → 合併後 {{ previewData.length }} 個品號 / {{ totalBarcodes }} 條條碼</p>
        </div>
        <div class="flex items-center gap-3">
          <span class="text-xs text-ink-faint">顯示前 20 筆</span>
          <button
            @click="startImport"
            :disabled="importing"
            class="px-4 py-2 rounded-xl bg-gradient-to-r from-teal-500 to-emerald-500 text-white text-sm font-semibold hover:from-teal-600 hover:to-emerald-600 active:scale-95 transition-all disabled:opacity-60 shadow-sm"
          >
            <span v-if="importing" class="flex items-center gap-2">
              <svg class="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24">
                <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"/>
                <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
              </svg>
              匯入中...
            </span>
            <span v-else>確認匯入</span>
          </button>
        </div>
      </div>
      <div class="overflow-x-auto">
        <table class="w-full text-sm">
          <thead>
            <tr class="bg-surface-warm">
              <th class="text-left px-4 py-3 text-xs font-semibold text-ink-muted">品號</th>
              <th class="text-left px-4 py-3 text-xs font-semibold text-ink-muted">品名</th>
              <th class="text-left px-4 py-3 text-xs font-semibold text-ink-muted">單位</th>
              <th class="text-left px-4 py-3 text-xs font-semibold text-ink-muted">條碼</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-border-subtle">
            <tr v-for="row in previewData.slice(0, 20)" :key="row.product_code" class="hover:bg-surface-warm transition-colors">
              <td class="px-4 py-2.5 font-mono text-xs text-ink-muted">{{ row.product_code }}</td>
              <td class="px-4 py-2.5 text-ink max-w-60 truncate">{{ row.product_name }}</td>
              <td class="px-4 py-2.5 text-ink-muted">{{ row.unit }}</td>
              <td class="px-4 py-2.5">
                <div class="flex flex-wrap gap-1">
                  <span
                    v-for="bc in row.barcodes"
                    :key="bc"
                    class="inline-block px-2 py-0.5 rounded-md bg-teal-soft text-teal text-xs font-mono"
                  >{{ bc }}</span>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <!-- 匯入進度 -->
    <div v-if="importing || importResult" class="bg-card rounded-2xl border border-border-subtle p-5 transition-colors duration-300">
      <h2 class="text-sm font-semibold text-ink mb-4">匯入進度</h2>
      <!-- 進度條 -->
      <div v-if="importing" class="mb-4">
        <div class="flex justify-between text-xs text-ink-muted mb-1.5">
          <span>{{ importStatus }}</span>
          <span>{{ importProgress }}%</span>
        </div>
        <div class="h-2 bg-surface-warm rounded-full overflow-hidden">
          <div
            class="h-full bg-gradient-to-r from-teal-500 to-emerald-500 rounded-full transition-all duration-300"
            :style="{ width: importProgress + '%' }"
          ></div>
        </div>
      </div>
      <!-- 結果 -->
      <div v-if="importResult" :class="['flex items-start gap-3 px-4 py-3 rounded-xl', importResult.success ? 'bg-teal-soft' : 'bg-coral-soft']">
        <svg v-if="importResult.success" class="w-5 h-5 text-teal flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"/>
        </svg>
        <svg v-else class="w-5 h-5 text-coral flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/>
        </svg>
        <div>
          <p :class="['text-sm font-semibold', importResult.success ? 'text-teal-700 dark:text-teal' : 'text-coral']">
            {{ importResult.success ? '匯入成功' : '匯入失敗' }}
          </p>
          <p class="text-xs text-ink-muted mt-0.5">{{ importResult.message }}</p>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref } from 'vue'
import ExcelJS from 'exceljs'
import { supabase } from '../lib/supabase'

const fileInput = ref(null)
const selectedFile = ref(null)
const isDragging = ref(false)
const headers = ref([])
const rawRows = ref([])
const previewData = ref([])
const totalBarcodes = ref(0)
const importing = ref(false)
const importProgress = ref(0)
const importStatus = ref('')
const importResult = ref(null)

const columns = [
  { name: '品號', desc: '商品編號（主鍵）' },
  { name: '品名', desc: '商品名稱' },
  { name: '單位', desc: '計量單位' },
  { name: '條碼', desc: '掃描條碼（可多筆）' },
]

const fieldMappings = ref([
  { key: 'product_code', label: '品號', col: '' },
  { key: 'product_name', label: '品名', col: '' },
  { key: 'unit', label: '單位', col: '' },
  { key: 'barcode', label: '條碼', col: '' },
])

function handleDrop(e) {
  isDragging.value = false
  const file = e.dataTransfer.files[0]
  if (file) processFile(file)
}

function handleFileSelect(e) {
  const file = e.target.files[0]
  if (file) processFile(file)
}

function clearFile() {
  selectedFile.value = null
  headers.value = []
  rawRows.value = []
  previewData.value = []
  importResult.value = null
  if (fileInput.value) fileInput.value.value = ''
}

function processFile(file) {
  if (!file.name.match(/\.(xlsx|xls)$/i)) {
    alert('請選擇 .xlsx 或 .xls 格式的檔案')
    return
  }
  selectedFile.value = file
  importResult.value = null

  const reader = new FileReader()
  reader.onload = async (e) => {
    const buffer = e.target.result
    const workbook = new ExcelJS.Workbook()
    await workbook.xlsx.load(buffer)
    const sheet = workbook.worksheets[0]
    if (!sheet) { alert('找不到工作表，請確認檔案格式'); return }

    // 取得標題列（第1列）
    const firstRow = sheet.getRow(1)
    const hdrs = []
    firstRow.eachCell({ includeEmpty: false }, (cell) => {
      hdrs.push(String(cell.value || '').trim())
    })
    headers.value = hdrs.filter(h => h)

    // 取得資料列
    const dataRows = []
    sheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
      if (rowNumber === 1) return
      const arr = []
      for (let i = 1; i <= hdrs.length; i++) {
        const cell = row.getCell(i)
        arr.push(cell.value !== null && cell.value !== undefined ? String(cell.value).trim() : '')
      }
      if (arr.some(v => v !== '')) dataRows.push(arr)
    })
    rawRows.value = dataRows

    // 自動對應欄位名稱
    fieldMappings.value.forEach(fm => {
      const keywords = {
        product_code: ['品號', '商品編號', '編號', 'code'],
        product_name: ['品名', '商品名稱', '名稱', 'name'],
        unit: ['單位', 'unit'],
        barcode: ['條碼', '條形碼', 'barcode'],
      }
      const kws = keywords[fm.key] || []
      const matched = headers.value.find(h => kws.some(kw => h.toLowerCase().includes(kw.toLowerCase())))
      if (matched) fm.col = matched
    })
  }
  reader.readAsArrayBuffer(file)
}

function parsePreview() {
  const mapping = Object.fromEntries(fieldMappings.value.map(fm => [fm.key, fm.col]))
  const missing = fieldMappings.value.filter(fm => !fm.col)
  if (missing.length > 0) {
    alert(`請選擇以下欄位的對應：${missing.map(m => m.label).join('、')}`)
    return
  }

  const productMap = {}

  rawRows.value.forEach(row => {
    const getVal = (colName) => {
      const idx = headers.value.indexOf(colName)
      return idx >= 0 ? String(row[idx] || '').trim() : ''
    }

    const code = getVal(mapping.product_code)
    const name = getVal(mapping.product_name)
    const unit = getVal(mapping.unit)
    const barcode = getVal(mapping.barcode)

    if (!code) return

    if (!productMap[code]) {
      productMap[code] = { product_code: code, product_name: name, unit, barcodes: new Set() }
    }
    if (barcode) productMap[code].barcodes.add(barcode)
    // 品號本身也可作為條碼
    productMap[code].barcodes.add(code)
  })

  const result = Object.values(productMap).map(p => ({
    ...p,
    barcodes: Array.from(p.barcodes),
  }))

  totalBarcodes.value = result.reduce((acc, p) => acc + p.barcodes.length, 0)
  previewData.value = result
}

async function startImport() {
  if (previewData.value.length === 0) return
  importing.value = true
  importResult.value = null
  importProgress.value = 0
  importStatus.value = '準備匯入...'

  try {
    const BATCH = 200
    const products = previewData.value.map(p => ({
      product_code: p.product_code,
      product_name: p.product_name,
      unit: p.unit,
    }))

    // ── Step 1: products_master ──────────────────────────────────
    // 策略：ignoreDuplicates = true
    //   → 品號不存在 → INSERT（新增）
    //   → 品號已存在 → 完全跳過，不覆蓋（保護菁英業務網既有資料）
    // 品號/品名/單位 由兩套系統共用，應以資料庫現有值為準
    importStatus.value = '比對商品主檔...'
    let insertedProducts = 0
    let skippedProducts = 0

    // 先查出哪些品號已存在，供後續統計
    const allCodes = products.map(p => p.product_code)
    const existingCodesSet = new Set()
    for (let i = 0; i < allCodes.length; i += 500) {
      const { data } = await supabase
        .from('products_master')
        .select('product_code')
        .in('product_code', allCodes.slice(i, i + 500))
      ;(data || []).forEach(r => existingCodesSet.add(r.product_code))
    }

    insertedProducts = products.filter(p => !existingCodesSet.has(p.product_code)).length
    skippedProducts = products.length - insertedProducts

    importStatus.value = '寫入新增商品...'
    for (let i = 0; i < products.length; i += BATCH) {
      const batch = products.slice(i, i + BATCH)
      const { error } = await supabase
        .from('products_master')
        .upsert(batch, { onConflict: 'product_code', ignoreDuplicates: true })
      if (error) throw error
      importProgress.value = Math.round(((i + batch.length) / products.length) * 50)
    }

    // ── Step 2: product_barcodes ─────────────────────────────────
    // 策略：一般 upsert（條碼唯一，更新對應品號）
    //   → 此表為本系統專屬，菁英業務網不讀取此表
    importStatus.value = '寫入條碼對應...'
    const allBarcodes = []
    previewData.value.forEach(p => {
      p.barcodes.forEach(bc => {
        allBarcodes.push({ product_code: p.product_code, barcode: bc })
      })
    })

    for (let i = 0; i < allBarcodes.length; i += BATCH) {
      const batch = allBarcodes.slice(i, i + BATCH)
      const { error } = await supabase
        .from('product_barcodes')
        .upsert(batch, { onConflict: 'barcode' })
      if (error) throw error
      importProgress.value = 50 + Math.round(((i + batch.length) / allBarcodes.length) * 50)
    }

    importProgress.value = 100
    importStatus.value = '完成'
    importResult.value = {
      success: true,
      message: `條碼對應寫入 ${allBarcodes.length} 筆 ／ 商品主檔：新增 ${insertedProducts} 個，已存在跳過 ${skippedProducts} 個（不覆蓋）`,
    }
  } catch (err) {
    importResult.value = {
      success: false,
      message: `匯入失敗：${err.message}`,
    }
  } finally {
    importing.value = false
  }
}
</script>
