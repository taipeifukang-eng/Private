import { createApp } from "vue";
import { createPinia } from "pinia";
import { createRouter, createWebHashHistory } from "vue-router";
import App from "./App.vue";
import "./style.css";
import { useSession } from "./stores";
import { WORKSPACE_PUBLIC_PAGES } from "./workspace-pages";
const pinia = createPinia();
const empty = { template: "<span />" };
const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    { path: "/", component: empty, meta: { title: "工作總覽" } },
    {
      path: "/work/:id",
      component: empty,
      meta: { title: "營運工作", requiresAuth: true },
    },
    // M5 W20 Q8：舊網址轉址進來的「開啟頁面」深連結（僅限白名單 kind，登入後才開頁籤），由 App.vue 處理。
    { path: "/open/:kind/:id?", component: empty, meta: { title: "開啟頁面", open: true } },
    // 公開頁（D14）：不需登入，由 App.vue 依 meta.public 直接渲染。
    ...WORKSPACE_PUBLIC_PAGES.map((p) => ({
      path: p.path,
      name: p.name,
      component: empty,
      meta: { title: p.title, public: true },
    })),
    { path: "/:pathMatch(.*)*", redirect: "/" },
  ],
});
router.beforeEach((to) =>
  to.meta.requiresAuth && !useSession(pinia).data ? "/" : true,
);
createApp(App).use(pinia).use(router).mount("#app");
