<template>
  <div>
    <div class="mb-5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
      <div>
        <h1 class="text-2xl font-bold text-ink tracking-tight">併購藥局商品掃描</h1>
        <p class="text-sm text-ink-muted mt-0.5">掃描條碼比對主檔，未比對到可拍照建檔</p>
      </div>
      <div class="flex items-center gap-3">
        <input
          type="date"
          v-model="scanDate"
          class="px-3 py-2 rounded-xl bg-card border border-border-subtle text-ink text-sm focus:outline-none focus:ring-2 focus:ring-teal-400/40 focus:border-teal-400"
        />
        <span class="text-xs text-ink-faint">掃描日期</span>
      </div>
    </div>

    <!-- 條碼輸入 -->
    <div class="bg-card rounded-2xl border border-border-subtle p-5 mb-5 transition-colors duration-300">
      <label class="block text-sm font-semibold text-ink mb-3">掃描條碼</label>
      <div class="flex gap-3">
        <div class="relative flex-1">
          <input
            ref="barcodeInput"
            v-model="barcodeValue"
            type="text"
            placeholder="請掃描或輸入條碼，按 Enter 查詢..."
            class="w-full pl-4 pr-12 py-3 rounded-xl bg-surface border border-border-subtle text-ink text-sm focus:outline-none focus:ring-2 focus:ring-teal-400/40 focus:border-teal-400 transition-all font-mono"
            @keydown.enter="handleScan"
            @keydown.esc="barcodeValue = ''"
            autofocus
          />
          <div v-if="scanning" class="absolute right-3 top-1/2 -translate-y-1/2">
            <svg class="w-5 h-5 text-teal animate-spin" fill="none" viewBox="0 0 24 24">
              <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"/>
              <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
            </svg>
          </div>
        </div>
        <button
          @click="handleScan"
          :disabled="!barcodeValue.trim() || scanning"
          class="px-5 py-3 rounded-xl bg-gradient-to-r from-teal-500 to-emerald-500 text-white text-sm font-semibold hover:from-teal-600 hover:to-emerald-600 active:scale-95 transition-all disabled:opacity-40 shadow-sm"
        >
          查詢
        </button>
      </div>

      <!-- 輕提示：最後一次掃描結果 -->
      <Transition name="slide-fade">
        <div
          v-if="lastScanResult"
          :class="[
            'mt-3 flex items-center gap-3 px-4 py-3 rounded-xl text-sm transition-colors',
            lastScanResult.matched
              ? 'bg-teal-soft border border-teal-400/30'
              : 'bg-coral-soft border border-coral/30',
          ]"
        >
          <svg v-if="lastScanResult.matched" class="w-5 h-5 text-teal flex-shrink-0" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"/>
          </svg>
          <svg v-else class="w-5 h-5 text-coral flex-shrink-0" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/>
          </svg>
          <div>
            <span :class="lastScanResult.matched ? 'text-teal-700 dark:text-teal font-semibold' : 'text-coral font-semibold'">
              {{ lastScanResult.matched ? '比對成功' : '未找到商品' }}
            </span>
            <span class="text-ink-muted ml-2">{{ lastScanResult.message }}</span>
          </div>
        </div>
      </Transition>
    </div>

    <!-- 今日掃描清單 -->
    <div class="bg-card rounded-2xl border border-border-subtle transition-colors duration-300 overflow-hidden">
      <div class="px-5 py-4 border-b border-border-subtle flex items-center justify-between">
        <div class="flex items-center gap-3">
          <h2 class="text-sm font-semibold text-ink">今日掃描清單</h2>
          <span class="text-xs px-2 py-0.5 rounded-full bg-surface-warm text-ink-muted">{{ scanList.length }} 筆</span>
        </div>
        <div class="flex items-center gap-3">
          <span class="text-xs text-ink-faint hidden sm:inline">
            比對成功 {{ matchedCount }} 筆 · 未建立 {{ unmatchedCount }} 筆
          </span>
          <button
            v-if="scanList.length > 0"
            @click="clearTodayConfirm"
            class="text-xs text-ink-faint hover:text-coral transition-colors"
          >
            清除今日紀錄
          </button>
        </div>
      </div>

      <div v-if="loadingList" class="p-8 text-center text-ink-faint text-sm">載入中...</div>
      <div v-else-if="scanList.length === 0" class="p-12 text-center">
        <div class="w-14 h-14 mx-auto mb-3 rounded-2xl bg-surface-warm flex items-center justify-center">
          <svg class="w-7 h-7 text-ink-faint" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" d="M12 4v1m6 11h2m-6 0h-2v4m0-11v3m0 0h.01M12 12h4.01"/>
          </svg>
        </div>
        <p class="text-sm text-ink-faint">尚無掃描紀錄，開始掃描條碼吧</p>
      </div>
      <div v-else class="divide-y divide-border-subtle">
        <div
          v-for="(item, idx) in scanList"
          :key="item.id"
          class="px-5 py-3 flex items-center gap-4 hover:bg-surface-warm transition-colors"
        >
          <span class="text-xs text-ink-faint w-7 text-right">{{ idx + 1 }}</span>
          <span :class="['w-2 h-2 rounded-full flex-shrink-0', item.is_matched ? 'bg-teal' : 'bg-coral']"></span>
          <span class="text-xs font-mono text-ink-muted w-36 truncate">{{ item.barcode }}</span>
          <span class="flex-1 text-sm text-ink truncate">{{ item.product_name || '— 未建立商品 —' }}</span>
          <span class="text-xs text-ink-faint hidden sm:inline">{{ item.product_code || '' }}</span>
          <span :class="['text-xs px-2 py-0.5 rounded-full font-medium flex-shrink-0', item.is_matched ? 'bg-teal-soft text-teal' : 'bg-coral-soft text-coral']">
            {{ item.is_matched ? '已比對' : '未建立' }}
          </span>
          <span class="text-xs text-ink-faint flex-shrink-0 hidden md:inline">{{ formatTime(item.scanned_at) }}</span>
        </div>
      </div>
    </div>

    <!-- ===== 未建立商品 Modal ===== -->
    <Teleport to="body">
      <Transition name="modal">
        <div
          v-if="showModal"
          class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm"
          @mousedown.self="closeModal"
        >
          <div class="w-full max-w-lg bg-card rounded-2xl border border-border-subtle shadow-2xl overflow-hidden max-h-[90vh] flex flex-col">
            <!-- Modal Header -->
            <div class="px-5 py-4 border-b border-border-subtle flex items-center justify-between flex-shrink-0">
              <div class="flex items-center gap-3">
                <div class="w-8 h-8 rounded-lg bg-coral-soft flex items-center justify-center">
                  <svg class="w-4 h-4 text-coral" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/>
                  </svg>
                </div>
                <div>
                  <h3 class="text-sm font-semibold text-ink">未找到商品</h3>
                  <p class="text-xs text-ink-muted">條碼：<span class="font-mono">{{ modalBarcode }}</span></p>
                </div>
              </div>
              <button @click="closeModal" class="text-ink-faint hover:text-ink transition-colors p-1">
                <svg class="w-5 h-5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12"/>
                </svg>
              </button>
            </div>

            <div class="overflow-y-auto flex-1">
              <div class="p-5 space-y-5">
                <!-- 拍照區 -->
                <div>
                  <div class="flex items-center justify-between mb-3">
                    <h4 class="text-sm font-semibold text-ink">商品拍照</h4>
                    <div class="flex gap-2">
                      <button
                        @click="startCamera"
                        :disabled="cameraActive"
                        class="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-surface-warm border border-border-subtle text-xs font-medium text-ink hover:bg-accent-soft hover:border-teal-400 transition-all disabled:opacity-40"
                      >
                        <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                          <path stroke-linecap="round" stroke-linejoin="round" d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z"/><circle cx="12" cy="13" r="3"/>
                        </svg>
                        啟動相機
                      </button>
                      <label class="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-surface-warm border border-border-subtle text-xs font-medium text-ink hover:bg-accent-soft hover:border-teal-400 transition-all cursor-pointer">
                        <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                          <path stroke-linecap="round" stroke-linejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12"/>
                        </svg>
                        上傳圖片
                        <input type="file" accept="image/*" multiple class="hidden" @change="handleImageUpload" />
                      </label>
                    </div>
                  </div>

                  <!-- 相機預覽 -->
                  <div v-if="cameraActive" class="relative rounded-xl overflow-hidden bg-black mb-3">
                    <video ref="videoEl" autoplay playsinline class="w-full max-h-56 object-cover"></video>
                    <canvas ref="canvasEl" class="hidden"></canvas>
                    <div class="absolute bottom-0 left-0 right-0 p-3 flex justify-center gap-3">
                      <button
                        @click="capturePhoto"
                        class="px-5 py-2 rounded-xl bg-white text-gray-900 text-sm font-semibold shadow-lg hover:bg-gray-100 transition-all active:scale-95"
                      >
                        拍照
                      </button>
                      <button
                        @click="stopCamera"
                        class="px-5 py-2 rounded-xl bg-black/60 text-white text-sm font-medium hover:bg-black/80 transition-all"
                      >
                        關閉相機
                      </button>
                    </div>
                  </div>

                  <!-- 照片縮圖 -->
                  <div v-if="capturedPhotos.length > 0" class="flex flex-wrap gap-2">
                    <div
                      v-for="(photo, idx) in capturedPhotos"
                      :key="idx"
                      class="relative w-20 h-20 rounded-xl overflow-hidden border border-border-subtle"
                    >
                      <img :src="photo" class="w-full h-full object-cover" />
                      <button
                        @click="removePhoto(idx)"
                        class="absolute top-1 right-1 w-5 h-5 rounded-full bg-black/60 text-white flex items-center justify-center hover:bg-coral transition-colors"
                      >
                        <svg class="w-3 h-3" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24">
                          <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12"/>
                        </svg>
                      </button>
                    </div>
                  </div>

                  <!-- OCR 按鈕 -->
                  <div v-if="capturedPhotos.length > 0" class="mt-3">
                    <button
                      @click="runOCR"
                      :disabled="ocrRunning"
                      class="flex items-center gap-2 px-4 py-2 rounded-xl bg-gradient-to-r from-teal-500 to-emerald-500 text-white text-xs font-semibold hover:from-teal-600 hover:to-emerald-600 active:scale-95 transition-all disabled:opacity-60 shadow-sm"
                    >
                      <svg v-if="ocrRunning" class="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24">
                        <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"/>
                        <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
                      </svg>
                      <svg v-else class="w-3.5 h-3.5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z"/>
                      </svg>
                      {{ ocrRunning ? 'OCR 識別中...' : '自動 OCR 識別' }}
                    </button>
                    <p v-if="ocrRunning" class="text-xs text-ink-faint mt-1">{{ ocrStatus }}</p>
                  </div>

                  <!-- OCR 原文（供參考） -->
                  <div v-if="ocrText" class="mt-3">
                    <label class="block text-xs font-medium text-ink-muted mb-1">OCR 識別結果（原文）</label>
                    <textarea
                      v-model="ocrText"
                      rows="4"
                      class="w-full px-3 py-2 rounded-xl bg-surface border border-border-subtle text-ink text-xs font-mono resize-none focus:outline-none focus:ring-2 focus:ring-teal-400/40 focus:border-teal-400"
                    ></textarea>
                  </div>
                </div>

                <!-- 商品資訊填寫 -->
                <div class="space-y-4">
                  <h4 class="text-sm font-semibold text-ink">商品資訊</h4>
                  <div>
                    <label class="block text-xs font-medium text-ink-muted mb-1.5">商品名稱</label>
                    <input
                      v-model="newProduct.product_name"
                      type="text"
                      placeholder="輸入商品名稱"
                      class="w-full px-3 py-2.5 rounded-xl bg-surface border border-border-subtle text-ink text-sm focus:outline-none focus:ring-2 focus:ring-teal-400/40 focus:border-teal-400"
                    />
                  </div>
                  <div>
                    <label class="block text-xs font-medium text-ink-muted mb-1.5">商品條碼</label>
                    <input
                      v-model="newProduct.ocr_barcode"
                      type="text"
                      :placeholder="modalBarcode"
                      class="w-full px-3 py-2.5 rounded-xl bg-surface border border-border-subtle text-ink text-sm font-mono focus:outline-none focus:ring-2 focus:ring-teal-400/40 focus:border-teal-400"
                    />
                  </div>
                  <div>
                    <label class="block text-xs font-medium text-ink-muted mb-1.5">供應商資訊</label>
                    <input
                      v-model="newProduct.ocr_supplier"
                      type="text"
                      placeholder="輸入供應商名稱"
                      class="w-full px-3 py-2.5 rounded-xl bg-surface border border-border-subtle text-ink text-sm focus:outline-none focus:ring-2 focus:ring-teal-400/40 focus:border-teal-400"
                    />
                  </div>
                  <div>
                    <label class="block text-xs font-medium text-ink-muted mb-1.5">備註</label>
                    <textarea
                      v-model="newProduct.notes"
                      rows="2"
                      placeholder="其他備註..."
                      class="w-full px-3 py-2.5 rounded-xl bg-surface border border-border-subtle text-ink text-sm resize-none focus:outline-none focus:ring-2 focus:ring-teal-400/40 focus:border-teal-400"
                    ></textarea>
                  </div>
                </div>
              </div>
            </div>

            <!-- Modal Footer -->
            <div class="px-5 py-4 border-t border-border-subtle flex justify-end gap-3 flex-shrink-0">
              <button
                @click="closeModal"
                class="px-4 py-2.5 rounded-xl border border-border-subtle text-sm font-medium text-ink-muted hover:bg-surface-warm transition-all"
              >
                取消
              </button>
              <button
                @click="saveUnmatched"
                :disabled="savingUnmatched"
                class="px-5 py-2.5 rounded-xl bg-gradient-to-r from-teal-500 to-emerald-500 text-white text-sm font-semibold hover:from-teal-600 hover:to-emerald-600 active:scale-95 transition-all disabled:opacity-60 shadow-sm"
              >
                <span v-if="savingUnmatched" class="flex items-center gap-2">
                  <svg class="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24">
                    <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"/>
                    <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
                  </svg>
                  儲存中...
                </span>
                <span v-else>儲存待建立商品</span>
              </button>
            </div>
          </div>
        </div>
      </Transition>
    </Teleport>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { supabase } from '../lib/supabase'

// ── 掃描 ──────────────────────────────────────────────
const barcodeInput = ref(null)
const barcodeValue = ref('')
const scanning = ref(false)
const scanDate = ref(new Date().toISOString().split('T')[0])
const scanList = ref([])
const loadingList = ref(true)
const lastScanResult = ref(null)

const matchedCount = computed(() => scanList.value.filter(s => s.is_matched).length)
const unmatchedCount = computed(() => scanList.value.filter(s => !s.is_matched).length)

async function loadTodayScans() {
  loadingList.value = true
  const { data } = await supabase
    .from('acquisition_scans')
    .select('*')
    .eq('scan_date', scanDate.value)
    .order('scanned_at', { ascending: false })
  scanList.value = data || []
  loadingList.value = false
}

async function handleScan() {
  const barcode = barcodeValue.value.trim()
  if (!barcode || scanning.value) return

  scanning.value = true
  barcodeValue.value = ''
  lastScanResult.value = null

  // 查詢條碼
  const { data: barcodeRow } = await supabase
    .from('product_barcodes')
    .select('product_code, products_master!inner(product_name, unit)')
    .eq('barcode', barcode)
    .maybeSingle()

  let product = null
  if (barcodeRow) {
    product = {
      product_code: barcodeRow.product_code,
      product_name: barcodeRow.products_master.product_name,
      unit: barcodeRow.products_master.unit,
    }
  } else {
    // 嘗試以品號直接查
    const { data: direct } = await supabase
      .from('products_master')
      .select('product_code, product_name, unit')
      .eq('product_code', barcode)
      .maybeSingle()
    if (direct) product = direct
  }

  const { data: { user } } = await supabase.auth.getUser()

  if (product) {
    // 比對成功 → 儲存掃描紀錄
    const { data: saved } = await supabase
      .from('acquisition_scans')
      .insert({
        scan_date: scanDate.value,
        barcode,
        product_code: product.product_code,
        product_name: product.product_name,
        unit: product.unit,
        is_matched: true,
        created_by: user?.id,
      })
      .select()
      .single()

    if (saved) scanList.value.unshift(saved)
    lastScanResult.value = {
      matched: true,
      message: `${product.product_code} · ${product.product_name}`,
    }
  } else {
    // 未找到 → 儲存掃描紀錄（unmatched）並開啟 modal
    const { data: saved } = await supabase
      .from('acquisition_scans')
      .insert({
        scan_date: scanDate.value,
        barcode,
        is_matched: false,
        created_by: user?.id,
      })
      .select()
      .single()

    if (saved) scanList.value.unshift(saved)
    lastScanResult.value = {
      matched: false,
      message: `條碼 ${barcode} 在主檔中查無資料`,
    }

    // 開啟拍照/建檔 modal
    openModal(barcode)
  }

  scanning.value = false
  barcodeInput.value?.focus()
}

function formatTime(ts) {
  if (!ts) return ''
  return new Date(ts).toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

async function clearTodayConfirm() {
  if (!confirm(`確定要清除 ${scanDate.value} 的所有掃描紀錄嗎？`)) return
  await supabase.from('acquisition_scans').delete().eq('scan_date', scanDate.value)
  scanList.value = []
}

// ── Modal（未建立商品） ──────────────────────────────
const showModal = ref(false)
const modalBarcode = ref('')
const capturedPhotos = ref([])
const newProduct = ref({ product_name: '', ocr_barcode: '', ocr_supplier: '', notes: '' })
const savingUnmatched = ref(false)

// 相機
const videoEl = ref(null)
const canvasEl = ref(null)
const cameraActive = ref(false)
let mediaStream = null

// OCR
const ocrRunning = ref(false)
const ocrText = ref('')
const ocrStatus = ref('')

function openModal(barcode) {
  modalBarcode.value = barcode
  newProduct.value = { product_name: '', ocr_barcode: barcode, ocr_supplier: '', notes: '' }
  capturedPhotos.value = []
  ocrText.value = ''
  showModal.value = true
}

function closeModal() {
  stopCamera()
  showModal.value = false
}

async function startCamera() {
  try {
    mediaStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } },
    })
    if (videoEl.value) {
      videoEl.value.srcObject = mediaStream
      cameraActive.value = true
    }
  } catch {
    alert('無法啟動相機，請確認瀏覽器權限，或使用上傳圖片功能')
  }
}

function stopCamera() {
  if (mediaStream) {
    mediaStream.getTracks().forEach(t => t.stop())
    mediaStream = null
  }
  cameraActive.value = false
}

async function capturePhoto() {
  if (!videoEl.value || !canvasEl.value) return
  const video = videoEl.value
  canvasEl.value.width = video.videoWidth
  canvasEl.value.height = video.videoHeight
  canvasEl.value.getContext('2d').drawImage(video, 0, 0)
  const dataUrl = await compressImage(canvasEl.value.toDataURL('image/jpeg', 0.9))
  capturedPhotos.value.push(dataUrl)
}

function handleImageUpload(e) {
  Array.from(e.target.files).forEach(file => {
    const reader = new FileReader()
    reader.onload = async (ev) => {
      const compressed = await compressImage(ev.target.result)
      capturedPhotos.value.push(compressed)
    }
    reader.readAsDataURL(file)
  })
  e.target.value = ''
}

function removePhoto(idx) {
  capturedPhotos.value.splice(idx, 1)
}

function compressImage(dataUrl, maxWidth = 900) {
  return new Promise((resolve) => {
    const img = new Image()
    img.src = dataUrl
    img.onload = () => {
      const ratio = Math.min(maxWidth / img.width, 1)
      const canvas = document.createElement('canvas')
      canvas.width = img.width * ratio
      canvas.height = img.height * ratio
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height)
      resolve(canvas.toDataURL('image/jpeg', 0.75))
    }
  })
}

async function runOCR() {
  if (!capturedPhotos.value.length || ocrRunning.value) return
  ocrRunning.value = true
  ocrText.value = ''
  ocrStatus.value = '載入 OCR 引擎...'

  try {
    const { createWorker } = await import('tesseract.js')
    const worker = await createWorker(['chi_tra', 'eng'], 1)

    let combined = ''
    for (let i = 0; i < capturedPhotos.value.length; i++) {
      ocrStatus.value = `辨識第 ${i + 1} / ${capturedPhotos.value.length} 張照片...`
      const { data: { text } } = await worker.recognize(capturedPhotos.value[i])
      combined += text + (i < capturedPhotos.value.length - 1 ? '\n---\n' : '')
    }

    await worker.terminate()
    ocrText.value = combined

    // 嘗試自動帶入欄位
    autoFillFromOCR(combined)
  } catch (err) {
    ocrText.value = `OCR 識別失敗：${err.message}`
  } finally {
    ocrRunning.value = false
    ocrStatus.value = ''
  }
}

function autoFillFromOCR(text) {
  const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 2)

  // 條碼：尋找 8‑14 位數字的行
  const barcodeMatch = text.match(/\b\d{8,14}\b/)
  if (barcodeMatch && !newProduct.value.ocr_barcode) {
    newProduct.value.ocr_barcode = barcodeMatch[0]
  }

  // 供應商：尋找含「公司」「企業」「股份」「有限」的行
  const supplierLine = lines.find(l => /公司|企業|股份|有限|藥品|藥業/.test(l))
  if (supplierLine && !newProduct.value.ocr_supplier) {
    newProduct.value.ocr_supplier = supplierLine.substring(0, 50)
  }

  // 商品名稱：取第一個長度 > 4 且不含電話、郵遞區號的行
  const nameLine = lines.find(l =>
    l.length >= 4 &&
    !/^\d+$/.test(l) &&
    !/@/.test(l) &&
    !/公司|企業|股份|有限/.test(l)
  )
  if (nameLine && !newProduct.value.product_name) {
    newProduct.value.product_name = nameLine.substring(0, 60)
  }
}

async function saveUnmatched() {
  savingUnmatched.value = true
  const { data: { user } } = await supabase.auth.getUser()

  const { error } = await supabase.from('acquisition_unmatched').insert({
    scan_date: scanDate.value,
    barcode: modalBarcode.value,
    ocr_product_name: newProduct.value.product_name || null,
    ocr_barcode: newProduct.value.ocr_barcode || null,
    ocr_supplier: newProduct.value.ocr_supplier || null,
    photos: capturedPhotos.value,
    notes: newProduct.value.notes || null,
    created_by: user?.id,
  })

  savingUnmatched.value = false

  if (error) {
    alert(`儲存失敗：${error.message}`)
  } else {
    stopCamera()
    showModal.value = false
  }
}

onMounted(() => {
  loadTodayScans()
  barcodeInput.value?.focus()
})

onUnmounted(() => {
  stopCamera()
})
</script>

<style scoped>
.slide-fade-enter-active, .slide-fade-leave-active { transition: all 0.25s ease; }
.slide-fade-enter-from { opacity: 0; transform: translateY(-6px); }
.slide-fade-leave-to { opacity: 0; transform: translateY(-6px); }

.modal-enter-active, .modal-leave-active { transition: all 0.2s ease; }
.modal-enter-from, .modal-leave-to { opacity: 0; }
.modal-enter-from .max-w-lg, .modal-leave-to .max-w-lg { transform: scale(0.96); }
</style>
