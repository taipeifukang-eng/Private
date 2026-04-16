<template>
  <div class="min-h-screen flex flex-col bg-surface font-sans transition-colors duration-300">
    <!-- Accent stripe -->
    <div class="fixed top-0 left-0 right-0 h-1 bg-gradient-to-r from-teal-500 via-teal-400 to-emerald-400 z-60"></div>

    <!-- 未登入時只顯示 router-view（登入頁） -->
    <template v-if="!user">
      <router-view />
    </template>

    <!-- 已登入：完整版面 -->
    <template v-else>
      <!-- Top Banner -->
      <header class="fixed top-1 left-0 right-0 h-14 bg-header backdrop-blur-xl border-b border-border-subtle z-50 flex items-center justify-between px-3 md:px-5 transition-colors duration-300">
        <!-- Left: Hamburger -->
        <button
          class="p-2 rounded-lg hover:bg-surface-warm active:scale-95 transition-all duration-200"
          @click="toggleSidebar"
        >
          <svg class="w-5 h-5 text-ink" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" d="M4 6h16M4 12h16M4 18h16" />
          </svg>
        </button>

        <!-- Center: Logo -->
        <div class="hidden sm:flex items-center gap-2">
          <div class="w-7 h-7 rounded-lg bg-gradient-to-br from-teal-500 to-emerald-500 flex items-center justify-center">
            <svg class="w-4 h-4 text-white" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" d="M19.428 15.428a2 2 0 00-1.022-.547l-2.387-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z"/>
            </svg>
          </div>
          <span class="text-base font-bold text-ink tracking-tight">併購商品主檔整理系統</span>
        </div>

        <!-- Right: Theme toggle + User + Logout -->
        <div class="flex items-center gap-2 md:gap-3">
          <!-- Theme toggle -->
          <button
            class="p-2 rounded-lg hover:bg-surface-warm active:scale-95 transition-all duration-200"
            @click="toggleTheme"
            :title="isDark ? '切換淺色模式' : '切換深色模式'"
          >
            <svg v-if="isDark" class="w-5 h-5 text-amber-400" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z"/>
            </svg>
            <svg v-else class="w-5 h-5 text-ink-muted" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z"/>
            </svg>
          </button>

          <!-- User pill -->
          <div class="flex items-center gap-2 pl-2.5 pr-1 py-1 rounded-full bg-surface-warm border border-border-subtle transition-colors duration-300">
            <span class="text-sm font-medium text-ink-muted hidden sm:inline">{{ userEmail }}</span>
            <div class="w-7 h-7 rounded-full bg-gradient-to-br from-teal to-emerald-400 flex items-center justify-center text-white text-xs font-bold shadow-sm">
              {{ userInitial }}
            </div>
          </div>

          <!-- Logout -->
          <button
            class="p-2 rounded-lg text-ink-faint hover:text-coral hover:bg-coral-soft transition-all duration-200"
            @click="handleLogout"
            title="登出"
          >
            <svg class="w-5 h-5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1"/>
            </svg>
          </button>
        </div>
      </header>

      <div class="flex flex-1" style="padding-top: calc(1rem + 3.5rem)">
        <!-- Mobile backdrop -->
        <div
          :class="['sidebar-backdrop fixed inset-0 bg-black/40 z-30 transition-opacity duration-300', sidebarOpen ? 'active opacity-100' : 'opacity-0']"
          @click="sidebarOpen = false"
        ></div>

        <!-- Side Menu -->
        <aside
          :class="[
            'fixed bottom-0 bg-sidebar transition-all duration-300 z-40 flex flex-col overflow-hidden',
            'max-md:w-64',
            sidebarOpen ? 'max-md:translate-x-0' : 'max-md:-translate-x-full',
            'md:translate-x-0',
            sidebarOpen ? 'md:w-64' : 'md:w-[4.5rem]',
          ]"
          style="top: calc(1rem + 3.5rem)"
        >
          <nav class="flex-1 px-3 py-5 space-y-1">
            <router-link
              v-for="item in menuItems"
              :key="item.path"
              :to="item.path"
              :class="[
                'group flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all duration-200',
                $route.path === item.path
                  ? 'bg-sidebar-active text-teal-400'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-sidebar-hover',
              ]"
              @click="onNavClick"
            >
              <span v-html="item.icon" class="w-5 h-5 flex-shrink-0"></span>
              <span v-show="sidebarOpen" class="text-sm font-medium whitespace-nowrap">{{ item.label }}</span>
              <span
                v-if="$route.path === item.path && sidebarOpen"
                class="ml-auto w-1.5 h-1.5 rounded-full bg-teal-400"
              ></span>
            </router-link>
          </nav>

          <div v-show="sidebarOpen" class="px-4 py-4 border-t border-white/5">
            <p class="text-[11px] text-slate-500 tracking-wide">© 2026 富康藥局</p>
          </div>
        </aside>

        <!-- Main Content -->
        <main
          :class="[
            'flex-1 transition-all duration-300 p-4 md:p-6',
            sidebarOpen ? 'md:ml-64' : 'md:ml-[4.5rem]',
          ]"
        >
          <router-view v-slot="{ Component }">
            <keep-alive>
              <component :is="Component" />
            </keep-alive>
          </router-view>
        </main>
      </div>
    </template>
  </div>
</template>

<script setup>
import { ref, computed, watch, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { supabase } from './lib/supabase'

const router = useRouter()
const user = ref(null)
const sidebarOpen = ref(window.innerWidth >= 768)
const isDark = ref(false)

const userEmail = computed(() => user.value?.email || '')
const userInitial = computed(() => (user.value?.email?.[0] || 'U').toUpperCase())

function applyTheme(dark) {
  document.documentElement.classList.toggle('dark', dark)
}

onMounted(async () => {
  // 取得目前登入狀態
  const { data: { user: u } } = await supabase.auth.getUser()
  user.value = u

  // 監聽登入狀態變化
  supabase.auth.onAuthStateChange((_event, session) => {
    user.value = session?.user || null
    if (!session?.user) router.push('/login')
  })

  // 主題設定
  const saved = localStorage.getItem('theme')
  if (saved === 'dark' || (!saved && window.matchMedia('(prefers-color-scheme: dark)').matches)) {
    isDark.value = true
  }
  applyTheme(isDark.value)
})

watch(isDark, (val) => applyTheme(val))

const menuItems = [
  {
    path: '/dashboard',
    label: '系統總覽',
    icon: '<svg fill="none" stroke="currentColor" stroke-width="1.75" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-4 0a1 1 0 01-1-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 01-1 1h-2z"/></svg>',
  },
  {
    path: '/import',
    label: '商品主檔匯入',
    icon: '<svg fill="none" stroke="currentColor" stroke-width="1.75" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12"/></svg>',
  },
  {
    path: '/scan',
    label: '併購藥局商品掃描',
    icon: '<svg fill="none" stroke="currentColor" stroke-width="1.75" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M12 4v1m6 11h2m-6 0h-2v4m0-11v3m0 0h.01M12 12h4.01M16 20h4M4 12h4m12 0h.01M5 8H3a2 2 0 00-2 2v10a2 2 0 002 2h3.5M9 4H7a2 2 0 00-2 2v2m14-4h2a2 2 0 012 2v2M9 4v4M5 12v4.5"/></svg>',
  },
  {
    path: '/unmatched',
    label: '未建立商品管理',
    icon: '<svg fill="none" stroke="currentColor" stroke-width="1.75" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M9 5H7a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4"/></svg>',
  },
]

function toggleSidebar() {
  sidebarOpen.value = !sidebarOpen.value
}

function toggleTheme() {
  isDark.value = !isDark.value
  localStorage.setItem('theme', isDark.value ? 'dark' : 'light')
}

function onNavClick() {
  if (window.innerWidth < 768) sidebarOpen.value = false
}

async function handleLogout() {
  await supabase.auth.signOut()
  router.push('/login')
}
</script>
