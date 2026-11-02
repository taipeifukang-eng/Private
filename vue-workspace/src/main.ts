import { createApp } from "vue";
import { createPinia } from "pinia";
import { createRouter, createWebHashHistory } from "vue-router";
import App from "./App.vue";
import "./style.css";
import { useSession } from "./stores";
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
    { path: "/:pathMatch(.*)*", redirect: "/" },
  ],
});
router.beforeEach((to) =>
  to.meta.requiresAuth && !useSession(pinia).data ? "/" : true,
);
createApp(App).use(pinia).use(router).mount("#app");
