<template>
  <div>
    <!-- 標題 -->
    <div class="mb-6">
      <h1 class="text-2xl font-bold text-ink tracking-tight">系統總覽</h1>
      <p class="text-sm text-ink-muted mt-0.5">併購藥局商品主檔整理系統</p>
    </div>

    <!-- 統計卡片 -->
    <div class="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
      <div
        v-for="stat in stats"
        :key="stat.label"
        class="bg-card rounded-2xl border border-border-subtle p-5 transition-colors duration-300"
      >
        <div class="flex items-center justify-between mb-3">
          <div :class="['w-10 h-10 rounded-xl flex items-center justify-center', stat.iconBg]">
            <span v-html="stat.icon" class="w-5 h-5"></span>
          </div>
          <span v-if="loading" class="text-ink-faint text-xs">載入中...</span>
        </div>
        <p class="text-2xl font-bold text-ink">{{ loading ? '—' : stat.value.toLocaleString() }}</p>
        <p class="text-xs text-ink-muted mt-0.5">{{ stat.label }}</p>
      </div>
    </div>

    <!-- 快速入口 -->
    <div class="mb-6">
      <h2 class="text-base font-semibold text-ink mb-4">快速入口</h2>
      <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
        <router-link
          v-for="entry in quickEntries"
          :key="entry.path"
          :to="entry.path"
          class="bg-card rounded-2xl border border-border-subtle p-6 hover:border-teal-400/60 hover:shadow-md transition-all duration-200 group"
        >
          <div :class="['w-12 h-12 rounded-xl flex items-center justify-center mb-4', entry.iconBg]">
            <span v-html="entry.icon" class="w-6 h-6"></span>
          </div>
          <h3 class="font-semibold text-ink group-hover:text-teal-600 transition-colors">{{ entry.title }}</h3>
          <p class="text-sm text-ink-muted mt-1">{{ entry.desc }}</p>
        </router-link>
      </div>
    </div>

    <!-- 今日掃描紀錄 -->
    <div class="bg-card rounded-2xl border border-border-subtle transition-colors duration-300">
      <div class="px-5 py-4 border-b border-border-subtle flex items-center justify-between">
        <h2 class="text-sm font-semibold text-ink">今日掃描紀錄</h2>
        <span class="text-xs text-ink-faint">{{ todayDate }}</span>
      </div>
      <div v-if="loading" class="p-8 text-center text-ink-faint text-sm">載入中...</div>
      <div v-else-if="todayScans.length === 0" class="p-8 text-center text-ink-faint text-sm">今日尚無掃描紀錄</div>
      <div v-else class="divide-y divide-border-subtle">
        <div
          v-for="scan in todayScans.slice(0, 10)"
          :key="scan.id"
          class="px-5 py-3 flex items-center gap-4"
        >
          <span :class="['w-2 h-2 rounded-full flex-shrink-0', scan.is_matched ? 'bg-teal' : 'bg-coral']"></span>
          <span class="text-sm font-mono text-ink-muted w-36 truncate">{{ scan.barcode }}</span>
          <span class="text-sm text-ink flex-1 truncate">{{ scan.product_name || '— 未建立商品 —' }}</span>
          <span :class="['text-xs px-2 py-0.5 rounded-full font-medium', scan.is_matched ? 'bg-teal-soft text-teal' : 'bg-coral-soft text-coral']">
            {{ scan.is_matched ? '已比對' : '未建立' }}
          </span>
        </div>
      </div>
      <div v-if="todayScans.length > 10" class="px-5 py-3 border-t border-border-subtle">
        <router-link to="/scan" class="text-xs text-teal hover:underline">查看全部 {{ todayScans.length }} 筆...</router-link>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { supabase } from '../lib/supabase'

const loading = ref(true)
const todayScans = ref([])
const todayDate = new Date().toLocaleDateString('zh-TW')

const stats = ref([
  {
    label: '商品主檔總數',
    value: 0,
    iconBg: 'bg-teal-soft',
    icon: '<svg class="text-teal" fill="none" stroke="currentColor" stroke-width="1.75" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4"/></svg>',
  },
  {
    label: '條碼對應筆數',
    value: 0,
    iconBg: 'bg-amber-50',
    icon: '<svg class="text-amber-500" fill="none" stroke="currentColor" stroke-width="1.75" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M12 4v1m6 11h2m-6 0h-2v4m0-11v3m0 0h.01M12 12h4.01M16 20h4M4 12h4m12 0h.01M5 8H3a2 2 0 00-2 2v10a2 2 0 002 2h3.5M9 4H7a2 2 0 00-2 2v2m14-4h2a2 2 0 012 2v2M9 4v4M5 12v4.5"/></svg>',
  },
  {
    label: '今日掃描次數',
    value: 0,
    iconBg: 'bg-blue-50',
    icon: '<svg class="text-blue-500" fill="none" stroke="currentColor" stroke-width="1.75" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M9 5H7a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"/></svg>',
  },
  {
    label: '待建立商品數',
    value: 0,
    iconBg: 'bg-coral-soft',
    icon: '<svg class="text-coral" fill="none" stroke="currentColor" stroke-width="1.75" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>',
  },
])

const quickEntries = [
  {
    path: '/import',
    title: '商品主檔匯入',
    desc: '匯入 DPOS 商品主檔 Excel，建立品號條碼對應',
    iconBg: 'bg-teal-soft',
    icon: '<svg class="text-teal" fill="none" stroke="currentColor" stroke-width="1.75" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12"/></svg>',
  },
  {
    path: '/scan',
    title: '併購藥局商品掃描',
    desc: '掃描商品條碼比對主檔，未比對到可拍照 OCR 建檔',
    iconBg: 'bg-amber-50',
    icon: '<svg class="text-amber-500" fill="none" stroke="currentColor" stroke-width="1.75" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M12 4v1m6 11h2m-6 0h-2v4m0-11v3m0 0h.01M12 12h4.01M16 20h4M4 12h4m12 0h.01M5 8H3a2 2 0 00-2 2v10a2 2 0 002 2h3.5M9 4H7a2 2 0 00-2 2v2m14-4h2a2 2 0 012 2v2M9 4v4M5 12v4.5"/></svg>',
  },
  {
    path: '/unmatched',
    title: '未建立商品管理',
    desc: '管理掃描後未能比對的商品，可依日期分類匯出',
    iconBg: 'bg-coral-soft',
    icon: '<svg class="text-coral" fill="none" stroke="currentColor" stroke-width="1.75" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M9 5H7a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4"/></svg>',
  },
]

onMounted(async () => {
  const today = new Date().toISOString().split('T')[0]

  const [
    { count: productCount },
    { count: barcodeCount },
    { count: unmatchedCount },
    { data: scans },
  ] = await Promise.all([
    supabase.from('products_master').select('*', { count: 'exact', head: true }),
    supabase.from('product_barcodes').select('*', { count: 'exact', head: true }),
    supabase.from('acquisition_unmatched').select('*', { count: 'exact', head: true }).eq('is_resolved', false),
    supabase.from('acquisition_scans').select('*').eq('scan_date', today).order('scanned_at', { ascending: false }),
  ])

  stats.value[0].value = productCount || 0
  stats.value[1].value = barcodeCount || 0
  stats.value[2].value = scans?.length || 0
  stats.value[3].value = unmatchedCount || 0
  todayScans.value = scans || []
  loading.value = false
})
</script>
