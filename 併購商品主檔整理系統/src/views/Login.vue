<template>
  <div class="min-h-screen bg-surface flex items-center justify-center p-4">
    <div class="w-full max-w-sm">
      <!-- Logo -->
      <div class="text-center mb-8">
        <div class="w-16 h-16 mx-auto rounded-2xl bg-gradient-to-br from-teal-500 to-emerald-500 flex items-center justify-center shadow-lg mb-4">
          <svg class="w-9 h-9 text-white" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" d="M19.428 15.428a2 2 0 00-1.022-.547l-2.387-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z"/>
          </svg>
        </div>
        <h1 class="text-xl font-bold text-ink">併購商品主檔整理系統</h1>
        <p class="text-sm text-ink-muted mt-1">富康藥局内部作業系統</p>
      </div>

      <!-- Login form -->
      <div class="bg-card rounded-2xl shadow-sm border border-border-subtle p-6 transition-colors duration-300">
        <h2 class="text-base font-semibold text-ink mb-5">登入帳號</h2>

        <form @submit.prevent="handleLogin" class="space-y-4">
          <div>
            <label class="block text-sm font-medium text-ink-muted mb-1.5">電子郵件</label>
            <input
              v-model="email"
              type="email"
              placeholder="輸入電子郵件"
              autocomplete="email"
              required
              class="w-full px-4 py-2.5 rounded-xl bg-surface border border-border-subtle text-ink placeholder:text-ink-faint focus:outline-none focus:ring-2 focus:ring-teal-400/40 focus:border-teal-400 transition-all"
            />
          </div>

          <div>
            <label class="block text-sm font-medium text-ink-muted mb-1.5">密碼</label>
            <input
              v-model="password"
              type="password"
              placeholder="輸入密碼"
              autocomplete="current-password"
              required
              class="w-full px-4 py-2.5 rounded-xl bg-surface border border-border-subtle text-ink placeholder:text-ink-faint focus:outline-none focus:ring-2 focus:ring-teal-400/40 focus:border-teal-400 transition-all"
            />
          </div>

          <!-- Error message -->
          <div v-if="errorMsg" class="flex items-center gap-2 px-3 py-2.5 rounded-xl bg-coral-soft text-coral text-sm">
            <svg class="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/>
            </svg>
            {{ errorMsg }}
          </div>

          <button
            type="submit"
            :disabled="loading"
            class="w-full py-2.5 rounded-xl bg-gradient-to-r from-teal-500 to-emerald-500 text-white font-semibold text-sm hover:from-teal-600 hover:to-emerald-600 active:scale-[0.98] transition-all disabled:opacity-60 disabled:cursor-not-allowed shadow-sm"
          >
            <span v-if="loading" class="flex items-center justify-center gap-2">
              <svg class="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"/>
                <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
              </svg>
              登入中...
            </span>
            <span v-else>登入</span>
          </button>
        </form>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { supabase } from '../lib/supabase'

const router = useRouter()
const email = ref('')
const password = ref('')
const loading = ref(false)
const errorMsg = ref('')

async function handleLogin() {
  loading.value = true
  errorMsg.value = ''
  const { error } = await supabase.auth.signInWithPassword({
    email: email.value,
    password: password.value,
  })
  loading.value = false
  if (error) {
    errorMsg.value = '帳號或密碼錯誤，請重新輸入'
  } else {
    router.push('/dashboard')
  }
}
</script>
