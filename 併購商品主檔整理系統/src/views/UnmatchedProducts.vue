<template>
  <div>
    <div class="mb-5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
      <div>
        <h1 class="text-2xl font-bold text-ink tracking-tight">未建立商品管理</h1>
        <p class="text-sm text-ink-muted mt-0.5">掃描後未比對到的商品，可依日期分類查看及匯出</p>
      </div>
      <div class="flex items-center gap-3">
        <label class="flex items-center gap-2 text-sm text-ink-muted">
          <input type="checkbox" v-model="showResolved" class="rounded" />
          顯示已建立
        </label>
        <button
          @click="exportAll"
          class="flex items-center gap-2 px-4 py-2 rounded-xl bg-gradient-to-r from-teal-500 to-emerald-500 text-white text-sm font-semibold hover:from-teal-600 hover:to-emerald-600 active:scale-95 transition-all shadow-sm"
        >
          <svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"/>
          </svg>
          匯出全部 Excel
        </button>
      </div>
    </div>

    <!-- 統計列 -->
    <div class="grid grid-cols-3 gap-4 mb-5">
      <div class="bg-card rounded-2xl border border-border-subtle p-4 text-center transition-colors duration-300">
        <p class="text-2xl font-bold text-ink">{{ totalUnresolved }}</p>
        <p class="text-xs text-ink-muted mt-0.5">待建立商品</p>
      </div>
      <div class="bg-card rounded-2xl border border-border-subtle p-4 text-center transition-colors duration-300">
        <p class="text-2xl font-bold text-teal">{{ totalResolved }}</p>
        <p class="text-xs text-ink-muted mt-0.5">已建立商品</p>
      </div>
      <div class="bg-card rounded-2xl border border-border-subtle p-4 text-center transition-colors duration-300">
        <p class="text-2xl font-bold text-amber-500">{{ dateGroups.length }}</p>
        <p class="text-xs text-ink-muted mt-0.5">掃描日期數</p>
      </div>
    </div>

    <!-- 載入中 -->
    <div v-if="loading" class="bg-card rounded-2xl border border-border-subtle p-12 text-center text-ink-faint text-sm transition-colors duration-300">
      載入中...
    </div>

    <!-- 無資料 -->
    <div v-else-if="dateGroups.length === 0" class="bg-card rounded-2xl border border-border-subtle p-12 text-center transition-colors duration-300">
      <div class="w-14 h-14 mx-auto mb-3 rounded-2xl bg-surface-warm flex items-center justify-center">
        <svg class="w-7 h-7 text-ink-faint" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" d="M9 5H7a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4"/>
        </svg>
      </div>
      <p class="text-sm text-ink-faint">尚無未建立商品紀錄</p>
    </div>

    <!-- 依日期分組顯示 -->
    <div v-else class="space-y-4">
      <div
        v-for="group in dateGroups"
        :key="group.date"
        class="bg-card rounded-2xl border border-border-subtle overflow-hidden transition-colors duration-300"
      >
        <!-- 日期標頭 -->
        <div
          class="px-5 py-4 border-b border-border-subtle flex items-center justify-between cursor-pointer hover:bg-surface-warm transition-colors"
          @click="group.expanded = !group.expanded"
        >
          <div class="flex items-center gap-3">
            <svg
              :class="['w-4 h-4 text-ink-faint transition-transform', group.expanded ? 'rotate-90' : '']"
              fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"
            >
              <path stroke-linecap="round" stroke-linejoin="round" d="M9 5l7 7-7 7"/>
            </svg>
            <span class="font-semibold text-sm text-ink">{{ group.date }}</span>
            <span class="text-xs px-2 py-0.5 rounded-full bg-surface-warm text-ink-muted">{{ group.items.length }} 筆</span>
            <span v-if="group.unresolvedCount > 0" class="text-xs px-2 py-0.5 rounded-full bg-coral-soft text-coral">
              {{ group.unresolvedCount }} 筆待建立
            </span>
          </div>
          <div class="flex items-center gap-2">
            <button
              @click.stop="exportGroup(group)"
              class="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-surface-warm border border-border-subtle text-xs font-medium text-ink hover:bg-accent-soft hover:border-teal-400 transition-all"
            >
              <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"/>
              </svg>
              匯出 Excel
            </button>
          </div>
        </div>

        <!-- 展開的表格 -->
        <div v-if="group.expanded" class="overflow-x-auto">
          <table class="w-full text-sm">
            <thead>
              <tr class="bg-surface-warm">
                <th class="text-left px-4 py-2.5 text-xs font-semibold text-ink-muted">掃描條碼</th>
                <th class="text-left px-4 py-2.5 text-xs font-semibold text-ink-muted">商品名稱(OCR)</th>
                <th class="text-left px-4 py-2.5 text-xs font-semibold text-ink-muted">商品條碼(OCR)</th>
                <th class="text-left px-4 py-2.5 text-xs font-semibold text-ink-muted">供應商</th>
                <th class="text-left px-4 py-2.5 text-xs font-semibold text-ink-muted">照片</th>
                <th class="text-left px-4 py-2.5 text-xs font-semibold text-ink-muted">狀態</th>
                <th class="text-left px-4 py-2.5 text-xs font-semibold text-ink-muted">操作</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-border-subtle">
              <tr
                v-for="item in group.items"
                :key="item.id"
                class="hover:bg-surface-warm transition-colors"
                :class="{ 'opacity-50': item.is_resolved }"
              >
                <td class="px-4 py-3 font-mono text-xs text-ink-muted max-w-32 truncate">{{ item.barcode || '—' }}</td>
                <td class="px-4 py-3 text-ink max-w-48 truncate">{{ item.ocr_product_name || '—' }}</td>
                <td class="px-4 py-3 font-mono text-xs text-ink-muted">{{ item.ocr_barcode || '—' }}</td>
                <td class="px-4 py-3 text-ink-muted text-xs max-w-36 truncate">{{ item.ocr_supplier || '—' }}</td>
                <td class="px-4 py-3">
                  <button
                    v-if="item.photos && item.photos.length > 0"
                    @click="viewPhotos(item)"
                    class="flex items-center gap-1 text-xs text-teal hover:underline"
                  >
                    <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                      <path stroke-linecap="round" stroke-linejoin="round" d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z"/>
                      <circle cx="12" cy="13" r="3"/>
                    </svg>
                    {{ item.photos.length }} 張
                  </button>
                  <span v-else class="text-xs text-ink-faint">—</span>
                </td>
                <td class="px-4 py-3">
                  <span :class="['text-xs px-2 py-0.5 rounded-full font-medium', item.is_resolved ? 'bg-teal-soft text-teal' : 'bg-coral-soft text-coral']">
                    {{ item.is_resolved ? '已建立' : '未建立' }}
                  </span>
                </td>
                <td class="px-4 py-3">
                  <div class="flex items-center gap-2">
                    <button
                      @click="editItem(item)"
                      class="text-xs text-ink-muted hover:text-teal transition-colors"
                      title="編輯"
                    >
                      <svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"/>
                      </svg>
                    </button>
                    <button
                      @click="toggleResolved(item)"
                      :class="['text-xs transition-colors', item.is_resolved ? 'text-amber-500 hover:text-ink-muted' : 'text-ink-muted hover:text-teal']"
                      :title="item.is_resolved ? '標記為未建立' : '標記為已建立'"
                    >
                      <svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"/>
                      </svg>
                    </button>
                    <button
                      @click="deleteItem(item)"
                      class="text-xs text-ink-muted hover:text-coral transition-colors"
                      title="刪除"
                    >
                      <svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/>
                      </svg>
                    </button>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>

    <!-- ===== 照片檢視 Modal ===== -->
    <Teleport to="body">
      <Transition name="modal">
        <div
          v-if="photoModal.show"
          class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm"
          @mousedown.self="photoModal.show = false"
        >
          <div class="w-full max-w-2xl bg-card rounded-2xl border border-border-subtle shadow-2xl overflow-hidden">
            <div class="px-5 py-4 border-b border-border-subtle flex items-center justify-between">
              <h3 class="text-sm font-semibold text-ink">商品照片 ({{ photoModal.photos.length }} 張)</h3>
              <button @click="photoModal.show = false" class="text-ink-faint hover:text-ink transition-colors p-1">
                <svg class="w-5 h-5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12"/>
                </svg>
              </button>
            </div>
            <div class="p-4 grid grid-cols-2 md:grid-cols-3 gap-3 max-h-96 overflow-y-auto">
              <img
                v-for="(photo, i) in photoModal.photos"
                :key="i"
                :src="photo"
                class="w-full aspect-square object-cover rounded-xl cursor-pointer hover:opacity-90 transition-opacity"
                @click="photoModal.activeIdx = i"
              />
            </div>
          </div>
        </div>
      </Transition>
    </Teleport>

    <!-- ===== 編輯 Modal ===== -->
    <Teleport to="body">
      <Transition name="modal">
        <div
          v-if="editModal.show"
          class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm"
          @mousedown.self="editModal.show = false"
        >
          <div class="w-full max-w-md bg-card rounded-2xl border border-border-subtle shadow-2xl overflow-hidden">
            <div class="px-5 py-4 border-b border-border-subtle flex items-center justify-between">
              <h3 class="text-sm font-semibold text-ink">編輯商品資訊</h3>
              <button @click="editModal.show = false" class="text-ink-faint hover:text-ink transition-colors p-1">
                <svg class="w-5 h-5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12"/>
                </svg>
              </button>
            </div>
            <div class="p-5 space-y-4">
              <div>
                <label class="block text-xs font-medium text-ink-muted mb-1.5">商品名稱</label>
                <input v-model="editModal.form.ocr_product_name" type="text" class="w-full px-3 py-2.5 rounded-xl bg-surface border border-border-subtle text-ink text-sm focus:outline-none focus:ring-2 focus:ring-teal-400/40 focus:border-teal-400" />
              </div>
              <div>
                <label class="block text-xs font-medium text-ink-muted mb-1.5">商品條碼(OCR)</label>
                <input v-model="editModal.form.ocr_barcode" type="text" class="w-full px-3 py-2.5 rounded-xl bg-surface border border-border-subtle text-ink text-sm font-mono focus:outline-none focus:ring-2 focus:ring-teal-400/40 focus:border-teal-400" />
              </div>
              <div>
                <label class="block text-xs font-medium text-ink-muted mb-1.5">供應商資訊</label>
                <input v-model="editModal.form.ocr_supplier" type="text" class="w-full px-3 py-2.5 rounded-xl bg-surface border border-border-subtle text-ink text-sm focus:outline-none focus:ring-2 focus:ring-teal-400/40 focus:border-teal-400" />
              </div>
              <div>
                <label class="block text-xs font-medium text-ink-muted mb-1.5">備註</label>
                <textarea v-model="editModal.form.notes" rows="2" class="w-full px-3 py-2.5 rounded-xl bg-surface border border-border-subtle text-ink text-sm resize-none focus:outline-none focus:ring-2 focus:ring-teal-400/40 focus:border-teal-400"></textarea>
              </div>
            </div>
            <div class="px-5 py-4 border-t border-border-subtle flex justify-end gap-3">
              <button @click="editModal.show = false" class="px-4 py-2.5 rounded-xl border border-border-subtle text-sm font-medium text-ink-muted hover:bg-surface-warm transition-all">取消</button>
              <button @click="saveEdit" :disabled="editModal.saving" class="px-5 py-2.5 rounded-xl bg-gradient-to-r from-teal-500 to-emerald-500 text-white text-sm font-semibold hover:from-teal-600 hover:to-emerald-600 active:scale-95 transition-all disabled:opacity-60 shadow-sm">
                {{ editModal.saving ? '儲存中...' : '儲存' }}
              </button>
            </div>
          </div>
        </div>
      </Transition>
    </Teleport>
  </div>
</template>

<script setup>
import { ref, computed, reactive, onMounted } from 'vue'
import { supabase } from '../lib/supabase'
import ExcelJS from 'exceljs'

const loading = ref(true)
const allItems = ref([])
const showResolved = ref(false)

const totalUnresolved = computed(() => allItems.value.filter(i => !i.is_resolved).length)
const totalResolved = computed(() => allItems.value.filter(i => i.is_resolved).length)

const filteredItems = computed(() =>
  showResolved.value ? allItems.value : allItems.value.filter(i => !i.is_resolved)
)

const dateGroups = computed(() => {
  const groups = {}
  filteredItems.value.forEach(item => {
    const d = item.scan_date
    if (!groups[d]) groups[d] = { date: d, items: [], expanded: true }
    groups[d].items.push(item)
  })
  return Object.values(groups)
    .sort((a, b) => b.date.localeCompare(a.date))
    .map(g => ({
      ...g,
      unresolvedCount: g.items.filter(i => !i.is_resolved).length,
    }))
})

async function loadData() {
  loading.value = true
  const { data } = await supabase
    .from('acquisition_unmatched')
    .select('*')
    .order('scan_date', { ascending: false })
    .order('created_at', { ascending: false })
  allItems.value = data || []
  loading.value = false
}

async function toggleResolved(item) {
  const { error } = await supabase
    .from('acquisition_unmatched')
    .update({ is_resolved: !item.is_resolved })
    .eq('id', item.id)
  if (!error) item.is_resolved = !item.is_resolved
}

async function deleteItem(item) {
  if (!confirm('確定要刪除這筆紀錄嗎？')) return
  const { error } = await supabase.from('acquisition_unmatched').delete().eq('id', item.id)
  if (!error) allItems.value = allItems.value.filter(i => i.id !== item.id)
}

// ── 照片 Modal ───────────────────────────────────────
const photoModal = reactive({ show: false, photos: [], activeIdx: 0 })

function viewPhotos(item) {
  photoModal.photos = item.photos || []
  photoModal.activeIdx = 0
  photoModal.show = true
}

// ── 編輯 Modal ───────────────────────────────────────
const editModal = reactive({
  show: false,
  saving: false,
  itemId: null,
  form: { ocr_product_name: '', ocr_barcode: '', ocr_supplier: '', notes: '' },
})

function editItem(item) {
  editModal.itemId = item.id
  editModal.form = {
    ocr_product_name: item.ocr_product_name || '',
    ocr_barcode: item.ocr_barcode || '',
    ocr_supplier: item.ocr_supplier || '',
    notes: item.notes || '',
  }
  editModal.show = true
}

async function saveEdit() {
  editModal.saving = true
  const { error } = await supabase
    .from('acquisition_unmatched')
    .update({
      ocr_product_name: editModal.form.ocr_product_name || null,
      ocr_barcode: editModal.form.ocr_barcode || null,
      ocr_supplier: editModal.form.ocr_supplier || null,
      notes: editModal.form.notes || null,
    })
    .eq('id', editModal.itemId)

  editModal.saving = false
  if (!error) {
    const item = allItems.value.find(i => i.id === editModal.itemId)
    if (item) Object.assign(item, editModal.form)
    editModal.show = false
  }
}

// ── Excel 匯出 ────────────────────────────────────────
async function doExport(items, filename) {
  if (!items.length) { alert('沒有資料可以匯出'); return }

  const workbook = new ExcelJS.Workbook()
  const ws = workbook.addWorksheet('未建立商品')

  const columns = [
    { header: '掃描日期', key: 'scan_date', width: 14 },
    { header: '掃描條碼', key: 'barcode', width: 20 },
    { header: '商品名稱(OCR)', key: 'ocr_product_name', width: 32 },
    { header: '商品條碼(OCR)', key: 'ocr_barcode', width: 20 },
    { header: '供應商資訊', key: 'ocr_supplier', width: 24 },
    { header: '備註', key: 'notes', width: 24 },
    { header: '照片數量', key: 'photo_count', width: 10 },
    { header: '狀態', key: 'status', width: 10 },
    { header: '建立時間', key: 'created_at', width: 22 },
  ]
  ws.columns = columns

  // 標題列樣式
  ws.getRow(1).font = { bold: true }
  ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE6FFF8' } }

  items.forEach(item => {
    ws.addRow({
      scan_date: item.scan_date,
      barcode: item.barcode || '',
      ocr_product_name: item.ocr_product_name || '',
      ocr_barcode: item.ocr_barcode || '',
      ocr_supplier: item.ocr_supplier || '',
      notes: item.notes || '',
      photo_count: (item.photos || []).length,
      status: item.is_resolved ? '已建立' : '未建立',
      created_at: item.created_at ? new Date(item.created_at).toLocaleString('zh-TW') : '',
    })
  })

  const buffer = await workbook.xlsx.writeBuffer()
  const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

function exportAll() {
  doExport(filteredItems.value, `未建立商品_全部_${new Date().toLocaleDateString('zh-TW').replace(/\//g, '-')}.xlsx`)
}

function exportGroup(group) {
  doExport(group.items, `未建立商品_${group.date}.xlsx`)
}
onMounted(loadData)
</script>

<style scoped>
.modal-enter-active, .modal-leave-active { transition: all 0.2s ease; }
.modal-enter-from, .modal-leave-to { opacity: 0; }
</style>
