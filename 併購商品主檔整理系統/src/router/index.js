import { createRouter, createWebHistory } from 'vue-router'
import { supabase } from '../lib/supabase'

const routes = [
  { path: '/', redirect: '/dashboard' },
  {
    path: '/login',
    name: 'Login',
    component: () => import('../views/Login.vue'),
    meta: { requiresAuth: false },
  },
  {
    path: '/dashboard',
    name: 'Dashboard',
    component: () => import('../views/Dashboard.vue'),
    meta: { requiresAuth: true },
  },
  {
    path: '/import',
    name: 'ProductImport',
    component: () => import('../views/ProductImport.vue'),
    meta: { requiresAuth: true },
  },
  {
    path: '/scan',
    name: 'PharmacyScan',
    component: () => import('../views/PharmacyScan.vue'),
    meta: { requiresAuth: true },
  },
  {
    path: '/unmatched',
    name: 'UnmatchedProducts',
    component: () => import('../views/UnmatchedProducts.vue'),
    meta: { requiresAuth: true },
  },
]

const router = createRouter({
  history: createWebHistory(),
  routes,
})

router.beforeEach(async (to) => {
  if (to.meta.requiresAuth === false) return true
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return '/login'
  return true
})

export default router
