<script setup lang="ts">
import { ref, computed, watch, onMounted, onBeforeUnmount } from "vue";
import { api } from "../api";
import type { WorkTab } from "../stores";
import Modal from "../components/Modal.vue";
import { MODULE_NAMES, FEATURE_NAMES } from "../../../types/rbac";
import { isScopePermission, preferredScopePermission, permissionLabel } from "../role-scope";
const props = defineProps<{ tab: WorkTab }>();
const roles = ref<any[]>([]),
  caps = ref<Record<string, boolean>>({}),
  loading = ref(false),
  error = ref(""),
  message = ref(""),
  search = ref(""),
  includeDev = ref(false),
  status = ref(""),
  hidden = ref(0);
const modal = ref(""),
  target = ref<any>(null),
  section = ref("basic"),
  form = ref<any>({}),
  baseline = ref(""),
  dialogError = ref(""),
  detailLoading = ref(false),
  permissions = ref<any[]>([]),
  savedIds = ref<string[]>([]),
  users = ref<any[]>([]),
  codes = ref(""),
  userSearch = ref(""),
  userStatus = ref(""),
  permissionSearch = ref(""),
  permissionView = ref("all"),
  technical = ref(false),
  confirm = ref(""),
  pending = ref<any>(null),
  expanded = ref(false);
const url = () => `roles/${target.value.id}`;
const active = (u: any) =>
  u.is_active &&
  (!u.expires_at || new Date(u.expires_at).getTime() > Date.now());
const ids = computed(() =>
  permissions.value.filter((p) => p.granted).map((p) => p.id),
);
const changes = computed(() =>
  permissions.value.filter((p) => p.granted !== savedIds.value.includes(p.id)),
);
const dirty = computed(
  () =>
    !!modal.value &&
    (JSON.stringify(form.value) !== baseline.value ||
      changes.value.length > 0 ||
      !!codes.value.trim()),
);
watch(dirty, (v) => (props.tab.dirty = v), { flush: "sync" });
const visible = computed(() =>
  roles.value.filter(
    (r) =>
      (!status.value ||
        (status.value === "active" ? r.is_active : !r.is_active)) &&
      [r.name, r.code, r.description].some((v) =>
        String(v || "")
          .toLowerCase()
          .includes(search.value.toLowerCase()),
      ),
  ),
);
const normalizeModule = (name: string) =>
  (
    ({
      任務管理: "task",
      門市管理: "store",
      人事管理: "employee",
      活動管理: "activity",
      盤點管理: "inventory",
      每月狀態: "monthly",
      每月人員狀態: "monthly",
      monthly_status: "monthly",
      系統: "user",
      督導巡店: "inspection",
      業績管理: "performance",
      組織管理: "organization",
    }) as Record<string, string>
  )[name] || name;
const scope = isScopePermission;
const highImpact = (p: any) =>
  ["delete", "force_close", "revert", "unconfirm"].includes(p.action) ||
  p.code === "monthly.allowance.edit_support_bonus";
const sensitive = (p: any) => highImpact(p) || p.action === "view_all";
const permissionSections = [
  { key: "entry", label: "進入功能" },
  { key: "scope", label: "資料查看範圍（擇一）" },
  { key: "additional", label: "附加查看" },
  { key: "daily", label: "日常操作" },
  { key: "advanced", label: "進階操作" },
];
const permissionSection = (p: any) =>
  highImpact(p)
    ? "advanced"
    : scope(p)
      ? "scope"
      : p.action === "access"
        ? "entry"
        : p.action === "view_inactive"
          ? "additional"
          : "daily";
const featurePermissions = (module: string, feature: string) =>
  permissions.value.filter(
    (p) => normalizeModule(p.module) === module && p.feature === feature,
  );
const preferredScope = preferredScopePermission;
const basicLabel = (ps: any[]) => {
  const p = preferredScope(ps);
  return p ? label(p) : "進入功能";
};
const conflicts = computed(() => {
  const features = new Map<string, any[]>();
  for (const p of permissions.value.filter((p) => p.granted && scope(p))) {
    const key = normalizeModule(p.module) + "." + p.feature;
    features.set(key, [...(features.get(key) || []), p]);
  }
  return [...features.values()].filter((ps) => ps.length > 1);
});
const label = permissionLabel;
const groups = computed(() => {
  const result: Record<string, Record<string, any[]>> = {};
  for (const p of permissions.value) {
    if (
      (permissionView.value === "granted" && !p.granted) ||
      (permissionView.value === "changed" && !changes.value.includes(p)) ||
      (permissionView.value === "advanced" && !sensitive(p))
    )
      continue;
    if (
      ![
        p.code,
        p.description,
        MODULE_NAMES[p.module],
        FEATURE_NAMES[p.feature],
      ].some((v) =>
        String(v || "")
          .toLowerCase()
          .includes(permissionSearch.value.toLowerCase()),
      )
    )
      continue;
    ((result[normalizeModule(p.module)] ??= {})[p.feature] ??= []).push(p);
  }
  return result;
});
const visibleUsers = computed(() =>
  users.value.filter(
    (u) =>
      (!userStatus.value ||
        (userStatus.value === "current" ? active(u) : !active(u))) &&
      [u.name, u.email, u.employee_code].some((v) =>
        String(v || "")
          .toLowerCase()
          .includes(userSearch.value.toLowerCase()),
      ),
  ),
);
async function load() {
  loading.value = true;
  error.value = "";
  try {
    const d = await api<any>(`roles?includeDevRoles=${includeDev.value}`);
    roles.value = d.roles;
    caps.value = d.capabilities;
    hidden.value = d.meta.hidden_dev_role_count;
  } catch (e: any) {
    error.value = e.message;
  } finally {
    loading.value = false;
  }
}
function open(r?: any) {
  message.value = "";
  target.value = r || null;
  form.value = r
    ? { name: r.name, description: r.description || "", is_active: r.is_active }
    : { name: "", code: "", description: "" };
  baseline.value = JSON.stringify(form.value);
  modal.value = r ? "edit" : "create";
  section.value = "basic";
  permissions.value = [];
  savedIds.value = [];
  users.value = [];
  codes.value = "";
  dialogError.value = "";
  permissionSearch.value = "";
  permissionView.value = "all";
  confirm.value = "";
}
async function selectSection(s: string) {
  if (props.tab.busy || detailLoading.value) return;
  section.value = s;
  dialogError.value = "";
  detailLoading.value = true;
  try {
    if (s === "permissions" && !permissions.value.length) {
      const d = await api<any>(url() + "/permissions");
      permissions.value = d.permissions;
      savedIds.value = ids.value.slice();
    }
    if (s === "users") users.value = (await api<any>(url() + "/users")).users;
  } catch (e: any) {
    dialogError.value = e.message;
  } finally {
    detailLoading.value = false;
  }
}
async function reloadSection() {
  if (
    changes.value.length &&
    !window.confirm("重新載入會放棄尚未儲存的權限變更，是否繼續？")
  )
    return;
  permissions.value = [];
  savedIds.value = [];
  await selectSection(section.value);
}
function close() {
  if (props.tab.busy || detailLoading.value) return;
  if (dirty.value) {
    confirm.value = "discard";
    return;
  }
  modal.value = "";
}
function changePermission(event: Event, p: any) {
  // Restore native pre-click state before applying controlled Vue state,
  // including radios deselected by the browser while awaiting confirmation.
  const fieldset=(event.target as HTMLElement).closest('fieldset');
  fieldset?.querySelectorAll<HTMLInputElement>('input[data-permission-id]').forEach(input=>{
    input.checked=!!permissions.value.find(q=>q.id===input.dataset.permissionId)?.granted;
  });
  toggle(p);
}
function toggle(p: any) {
  if (!caps.value.assignPermissions || props.tab.busy) return;
  if (scope(p) && p.granted) {
    grant(p, true);
    return;
  }
  if (!p.granted && sensitive(p)) {
    pending.value = p;
    confirm.value = "sensitive";
    return;
  }
  grant(p, !p.granted);
}
function grant(p: any, on: boolean) {
  for (const q of permissions.value) {
    if (
      normalizeModule(q.module) !== normalizeModule(p.module) ||
      q.feature !== p.feature
    )
      continue;
    if (q.id === p.id) q.granted = on;
    else if (on && scope(p) && scope(q)) q.granted = false;
    else if (on && p.action !== "access" && q.action === "access")
      q.granted = true;
  }
}
function preset(module: string, feature: string, mode: string) {
  if (!caps.value.assignPermissions || props.tab.busy) return;
  const ps = permissions.value.filter(
    (p) => normalizeModule(p.module) === module && p.feature === feature,
  );
  const preferred = preferredScope(ps);
  for (const p of ps)
    p.granted =
      mode !== "none" &&
      (p.action === "access" ||
        p === preferred ||
        (mode === "daily" &&
          !scope(p) &&
          !highImpact(p) &&
          p.action !== "view_inactive"));
}
async function perform(path: string, method: string, body?: any) {
  if (props.tab.busy) return false;
  props.tab.busy = true;
  dialogError.value = "";
  try {
    const d = await api<any>(path, {
      method,
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    message.value = [d.message || "儲存完成", d.details]
      .filter(Boolean)
      .join("；");
    return true;
  } catch (e: any) {
    dialogError.value = e.message;
    return false;
  } finally {
    props.tab.busy = false;
  }
}
async function saveBasic() {
  if (!form.value.name.trim()) {
    dialogError.value = "請填寫角色名稱";
    return false;
  }
  const creating = modal.value === "create";
  if (
    await perform(
      creating ? "roles" : url(),
      creating ? "POST" : "PATCH",
      form.value,
    )
  ) {
    baseline.value = JSON.stringify(form.value);
    if (creating) modal.value = "";
    else Object.assign(target.value, form.value);
    await load();
    return true;
  }
  return false;
}
async function savePermissions() {
  if (
    await perform(url() + "/permissions", "POST", {
      permissionIds: ids.value,
      expectedPermissionIds: savedIds.value,
    })
  ) {
    savedIds.value = ids.value.slice();
    confirm.value = "";
    await load();
    return true;
  }
  confirm.value = "";
  return false;
}
async function assign() {
  const employee_codes = [
    ...new Set(
      codes.value
        .toUpperCase()
        .split(/[\s,，;；]+/)
        .filter(Boolean),
    ),
  ];
  if (!employee_codes.length) {
    dialogError.value = "請輸入員工編號";
    return;
  }
  if (await perform(url() + "/users", "POST", { employee_codes })) {
    codes.value = "";
    await selectSection("users");
    await load();
  }
}
async function remove() {
  const path =
    confirm.value === "delete" ? url() : url() + "/users/" + pending.value.id;
  if (await perform(path, "DELETE")) {
    if (confirm.value === "delete") modal.value = "";
    else await selectSection("users");
    confirm.value = "";
    await load();
  } else confirm.value = "";
}
async function saveAll() {
  if (JSON.stringify(form.value) !== baseline.value && !(await saveBasic()))
    return false;
  if (changes.value.length) {
    section.value = "permissions";
    confirm.value = "permissions";
    return false;
  }
  if (codes.value.trim()) {
    section.value = "users";
    dialogError.value = "請先確認並完成使用者指派";
    return false;
  }
  return true;
}
props.tab.save = saveAll;
onBeforeUnmount(() => delete props.tab.save);
onMounted(load);
</script>
<template>
  <section class="roles-page">
    <header class="role-header">
      <div>
        <small>系統管理 / 授權設定</small>
        <h1>角色權限管理</h1>
        <p>依角色設定操作權限；門市資料範圍另依門市指派決定。</p>
      </div>
      <div class="actions">
        <button :disabled="loading || tab.busy" @click="load">重新整理</button
        ><button v-if="caps.create" class="primary" @click="open()">
          新增角色
        </button>
      </div>
    </header>
    <p v-if="error" role="alert" class="error">{{ error }}</p>
    <p v-if="message" role="status" class="notice">{{ message }}</p>
    <div class="filters">
      <label
        >搜尋角色<input
          v-model="search"
          type="search"
          placeholder="名稱、代碼或說明" /></label
      ><label
        >狀態<select v-model="status">
          <option value="">全部</option>
          <option value="active">啟用</option>
          <option value="inactive">停用</option>
        </select></label
      ><label class="check"
        ><input
          v-model="includeDev"
          type="checkbox"
          :disabled="loading"
          @change="load"
        />顯示測試角色
        <span v-if="hidden">（隱藏 {{ hidden }} 筆）</span></label
      >
    </div>
    <p>{{ loading ? "載入中…" : `共 ${visible.length} 個角色` }}</p>
    <div class="module-table">
      <table>
        <thead>
          <tr>
            <th>角色</th>
            <th>說明</th>
            <th>權限數</th>
            <th>有效使用者</th>
            <th>狀態</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="r in visible" :key="r.id">
            <td>
              <strong>{{ r.name }}</strong
              ><small>{{ r.code }} {{ r.is_system ? "· 系統預設" : "" }}</small>
            </td>
            <td>{{ r.description || "—" }}</td>
            <td>{{ r.permission_count }}</td>
            <td>
              {{ r.user_count
              }}<small>{{
                r.assigned_users.map((u: any) => u.name || u.email).join("、")
              }}</small>
            </td>
            <td>{{ r.is_active ? "啟用" : "停用" }}</td>
            <td><button @click="open(r)">查看／設定</button></td>
          </tr>
          <tr v-if="!loading && !visible.length">
            <td colspan="6">沒有符合條件的角色</td>
          </tr>
        </tbody>
      </table>
    </div>
  </section>
  <Modal
    v-if="modal"
    :title="modal === 'create' ? '新增角色' : target.name + ' · 角色設定'"
    wide
    :busy="tab.busy || detailLoading"
    @cancel="close"
  >
    <div class="roles-dialog">
      <nav
        v-if="modal === 'edit'"
        class="actions section-tabs"
        aria-label="角色設定分頁"
      >
        <button
          :aria-pressed="section === 'basic'"
          @click="selectSection('basic')"
        >
          基本資料</button
        ><button
          v-if="caps.viewPermissions"
          :aria-pressed="section === 'permissions'"
          @click="selectSection('permissions')"
        >
          權限設定</button
        ><button
          v-if="caps.viewUsers"
          :aria-pressed="section === 'users'"
          @click="selectSection('users')"
        >
          使用者指派
        </button>
      </nav>
      <p v-if="message" class="notice" role="status">{{ message }}</p>
      <p v-if="dialogError" class="error" role="alert">
        {{ dialogError }}
        <button v-if="section !== 'basic'" @click="reloadSection">
          重新載入
        </button>
      </p>
      <p v-if="detailLoading" role="status">載入中…</p>
      <form v-if="section === 'basic'" @submit.prevent="saveBasic">
        <fieldset
          :disabled="
            tab.busy || !(modal === 'create' ? caps.create : caps.edit)
          "
        >
          <label
            >角色名稱<input
              v-model="form.name"
              required
              maxlength="100" /></label
          ><label v-if="modal === 'create'"
            >角色代碼<input
              v-model="form.code"
              required
              pattern="[a-z0-9_]+"
              placeholder="小寫英文、數字、底線" /></label
          ><label
            >說明<textarea
              v-model="form.description"
              rows="3"
              maxlength="2000"
            ></textarea></label
          ><label v-if="modal === 'edit'" class="check"
            ><input
              v-model="form.is_active"
              type="checkbox"
              :disabled="target.is_system"
            />啟用角色
            {{ target.is_system ? "（系統預設角色不可停用）" : "" }}</label
          >
        </fieldset>
        <div class="actions">
          <button
            v-if="modal === 'create' ? caps.create : caps.edit"
            class="primary"
            :disabled="tab.busy"
            type="submit"
          >
            儲存角色</button
          ><button
            v-if="modal === 'edit' && caps.delete && !target.is_system"
            type="button"
            class="danger"
            @click="confirm = 'delete'"
          >
            刪除角色
          </button>
        </div>
      </form>
      <section v-else-if="section === 'permissions' && !detailLoading">
        <div class="filters">
          <label
            >搜尋權限<input
              v-model="permissionSearch"
              type="search"
              placeholder="模組、功能或說明" /></label
          ><label
            >顯示<select v-model="permissionView">
              <option value="all">全部權限</option>
              <option value="granted">已授予</option>
              <option value="changed">本次變更</option>
              <option value="advanced">進階與全店範圍</option>
            </select></label
          ><label class="check"
            ><input v-model="technical" type="checkbox" />顯示權限代碼</label
          ><button @click="expanded = !expanded">
            {{ expanded ? "全部收合" : "全部展開" }}
          </button>
        </div>
        <div class="permission-summary">
          <strong
            >全部 {{ permissions.length }} 項 · 已選 {{ ids.length }} 項 ·
            本次變更 {{ changes.length }} 項</strong
          ><button
            v-if="caps.assignPermissions"
            class="primary"
            :disabled="!changes.length || tab.busy"
            @click="confirm = 'permissions'"
          >
            檢視變更並儲存
          </button>
        </div>
        <p v-if="conflicts.length" class="error" role="alert">
          原設定有
          {{
            conflicts.length
          }}
          個功能同時授予多個查看範圍。可於各功能重新擇一；未操作的項目仍保留原設定。
        </p>
        <p v-if="permissionView !== 'all' || permissionSearch" class="muted">
          目前僅顯示符合篩選的權限。<button
            @click="
              permissionView = 'all';
              permissionSearch = '';
            "
          >
            顯示全部權限
          </button>
        </p>
        <details
          v-for="(features, module) in groups"
          :key="module"
          :open="expanded || !!permissionSearch || permissionView !== 'all'"
        >
          <summary>{{ MODULE_NAMES[module] || module }}</summary>
          <section
            v-for="(ps, feature) in features"
            :key="feature"
            class="feature"
          >
            <div class="feature-heading">
              <strong
                >{{ FEATURE_NAMES[feature] || feature }}
                <small
                  >已選
                  {{
                    featurePermissions(String(module), String(feature)).filter(
                      (p) => p.granted,
                    ).length
                  }}
                  /
                  {{ featurePermissions(String(module), String(feature)).length
                  }}<span
                    v-if="
                      featurePermissions(String(module), String(feature)).some(
                        sensitive,
                      )
                    "
                  >
                    · 含
                    {{
                      featurePermissions(
                        String(module),
                        String(feature),
                      ).filter(sensitive).length
                    }}
                    項敏感權限</span
                  ></small
                ></strong
              >
              <div v-if="caps.assignPermissions" class="actions">
                <button
                  @click="preset(String(module), String(feature), 'view')"
                >
                  {{
                    basicLabel(
                      featurePermissions(String(module), String(feature)),
                    )
                  }}</button
                ><button
                  @click="preset(String(module), String(feature), 'daily')"
                >
                  日常處理</button
                ><button
                  @click="preset(String(module), String(feature), 'none')"
                >
                  清除
                </button>
              </div>
            </div>
            <template v-for="part in permissionSections" :key="part.key">
              <fieldset
                v-if="ps.some((p) => permissionSection(p) === part.key)"
                class="permission-section"
                :class="{ 'advanced-section': part.key === 'advanced' }"
                :disabled="!caps.assignPermissions || tab.busy"
              >
                <legend>{{ part.label }}</legend>
                <p
                  v-if="
                    part.key === 'scope' &&
                    featurePermissions(String(module), String(feature)).filter(
                      (p) => p.granted && scope(p),
                    ).length > 1
                  "
                  class="error"
                >
                  已授予多個範圍，請重新擇一。
                </p>
                <div class="permission-grid">
                  <label
                    v-for="p in ps.filter(
                      (p) => permissionSection(p) === part.key,
                    )"
                    :key="p.id"
                    class="permission"
                  >
                    <input
                      :type="scope(p) ? 'radio' : 'checkbox'"
                      :name="
                        scope(p)
                          ? `${props.tab.id}-${target.id}-${module}-${feature}`
                          : undefined
                      "
                      :checked="p.granted"
                      :data-permission-id="p.id" @click="changePermission($event,p)"
                    />
                    <span
                      >{{ label(p)
                      }}<em v-if="p.action === 'view_all'">範圍較廣</em
                      ><em v-else-if="highImpact(p)">進階權限</em
                      ><small>{{ p.description }}</small
                      ><code v-if="technical">{{ p.code }}</code></span
                    >
                  </label>
                </div>
              </fieldset>
            </template>
          </section>
        </details>
        <p v-if="!Object.keys(groups).length">沒有符合條件的權限</p>
      </section>
      <section v-else-if="section === 'users' && !detailLoading">
        <form v-if="caps.assignUsers" @submit.prevent="assign">
          <label
            >批次指派員工編號<textarea
              v-model="codes"
              rows="2"
              placeholder="以換行、空白或逗號分隔；員工需已綁定使用者帳號"
            ></textarea></label
          ><button class="primary" :disabled="tab.busy || !codes.trim()">
            指派使用者
          </button>
        </form>
        <div class="filters">
          <label
            >搜尋使用者<input
              v-model="userSearch"
              type="search"
              placeholder="姓名、員編、帳號" /></label
          ><label
            >指派狀態<select v-model="userStatus">
              <option value="">全部</option>
              <option value="current">有效</option>
              <option value="inactive">停用／到期</option>
            </select></label
          >
        </div>
        <div class="module-table">
          <table>
            <thead>
              <tr>
                <th>員編／姓名</th>
                <th>帳號</th>
                <th>部門／職稱</th>
                <th>狀態／期限</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="u in visibleUsers" :key="u.id">
                <td>
                  {{ u.employee_code || "—" }}<small>{{ u.name }}</small>
                </td>
                <td>{{ u.email }}</td>
                <td>{{ u.department }} {{ u.job_title }}</td>
                <td>
                  {{ active(u) ? "有效" : u.is_active ? "已到期" : "已停用"
                  }}<small>{{
                    u.expires_at
                      ? new Date(u.expires_at).toLocaleDateString("zh-TW")
                      : "無到期日"
                  }}</small>
                </td>
                <td>
                  <button
                    v-if="caps.revokeUsers"
                    class="danger"
                    @click="
                      pending = u;
                      confirm = 'revoke';
                    "
                  >
                    移除指派
                  </button>
                </td>
              </tr>
              <tr v-if="!visibleUsers.length">
                <td colspan="5">沒有符合條件的使用者</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>
      <footer class="actions">
        <button :disabled="tab.busy || detailLoading" @click="close">
          關閉
        </button>
      </footer>
    </div>
  </Modal>
  <Modal
    v-if="confirm"
    :title="
      (
        {
          discard: '放棄未儲存變更',
          sensitive: '確認授予權限',
          permissions: '確認權限變更',
          delete: '刪除角色',
          revoke: '移除使用者指派',
        } as any
      )[confirm]
    "
    :busy="tab.busy"
    @cancel="confirm = ''"
  >
    <template v-if="confirm === 'permissions'"
      ><p>
        角色：{{ target.name }} · 目前有效使用者
        {{ target.user_count }} 人。設定會影響使用此角色的人員。
      </p>
      <ul class="change-list">
        <li v-for="p in changes" :key="p.id">
          {{ p.granted ? "新增" : "移除" }} ·
          {{ MODULE_NAMES[p.module] || p.module }}／{{
            FEATURE_NAMES[p.feature] || p.feature
          }}／{{ label(p) }}
        </li>
      </ul>
      <div class="actions">
        <button @click="confirm = ''">返回調整</button
        ><button class="primary" :disabled="tab.busy" @click="savePermissions">
          確認儲存權限
        </button>
      </div></template
    >
    <template v-else-if="confirm === 'sensitive'"
      ><p>
        {{
          pending.description || label(pending)
        }}。授予後將擴大此角色的操作或資料查看範圍。
      </p>
      <div class="actions">
        <button @click="confirm = ''">取消</button
        ><button
          class="primary"
          @click="
            grant(pending, true);
            confirm = '';
          "
        >
          確認授予
        </button>
      </div></template
    >
    <template v-else-if="confirm === 'discard'"
      ><p>尚未儲存的角色資料、權限與待指派員編將被放棄。</p>
      <div class="actions">
        <button @click="confirm = ''">繼續編輯</button
        ><button
          class="danger"
          @click="
            modal = '';
            confirm = '';
            form = {};
            baseline = '{}';
            permissions = [];
            savedIds = [];
            codes = '';
          "
        >
          放棄變更
        </button>
      </div></template
    >
    <template v-else
      ><p>
        {{
          confirm === "delete"
            ? `將刪除「${target.name}」，並移除其角色指派與權限。有效使用者 ${target.user_count} 人。`
            : `將移除 ${pending.name || pending.email} 的「${target.name}」角色。`
        }}
      </p>
      <div class="actions">
        <button :disabled="tab.busy" @click="confirm = ''">取消</button
        ><button class="danger" :disabled="tab.busy" @click="remove">
          確認{{ confirm === "delete" ? "刪除" : "移除" }}
        </button>
      </div></template
    >
  </Modal>
</template>
<style scoped>
.role-header,
.actions,
.feature-heading,
.permission-summary {
  display: flex;
  align-items: center;
  gap: 10px;
  justify-content: space-between;
}
.actions {
  justify-content: flex-start;
  flex-wrap: wrap;
}
.role-header {
  margin-bottom: 28px;
}
.role-header p,
small {
  color: var(--muted);
}
small {
  display: block;
  margin-top: 5px;
}
h1 {
  margin: 10px 0;
}
.filters {
  display: flex;
  align-items: end;
  gap: 16px;
  flex-wrap: wrap;
  margin: 20px 0;
}
label {
  display: flex;
  flex-direction: column;
  gap: 7px;
}
input,
select,
textarea {
  padding: 10px;
  border: 1px solid var(--line);
  border-radius: 4px;
  background: var(--surface);
  color: var(--ink);
}
.check {
  flex-direction: row;
  align-items: center;
  min-height: 40px;
}
input[type="checkbox"],
input[type="radio"] {
  width: 17px;
  height: 17px;
  flex-shrink: 0;
  accent-color: var(--primary);
}
table {
  width: 100%;
  border-collapse: collapse;
}
th,
td {
  text-align: left;
  padding: 14px;
  border-bottom: 1px solid var(--line);
  vertical-align: top;
}
th {
  background: var(--soft);
}
.error {
  color: #a32a23;
  background: var(--soft);
  padding: 12px;
}
.notice {
  padding: 12px;
  border-left: 3px solid var(--primary);
  white-space: pre-line;
}
.danger {
  color: #a32a23;
}
.roles-dialog {
  max-height: 75vh;
  overflow: auto;
  padding: 2px;
}
.section-tabs {
  padding-bottom: 12px;
  border-bottom: 1px solid var(--line);
  position: sticky;
  top: 0;
  background: var(--surface);
  z-index: 1;
}
button[aria-pressed="true"] {
  background: var(--primary);
  color: white;
}
fieldset {
  border: 0;
  padding: 18px 0;
  display: grid;
  gap: 16px;
}
footer {
  margin-top: 24px;
  justify-content: flex-end !important;
}
.permission-summary {
  margin: 16px 0;
  gap: 15px;
  flex-wrap: wrap;
}
details {
  border-top: 1px solid var(--line);
}
summary {
  cursor: pointer;
  padding: 16px 4px;
  font-weight: 600;
}
.feature {
  padding: 12px 10px 20px;
  border-top: 1px solid var(--line);
}
.permission-section {
  display: block;
  margin: 14px 0 0;
  padding: 12px 0;
  border: 0;
  border-top: 1px solid var(--line);
}
.permission-section legend {
  font-size: 12px;
  color: var(--muted);
  padding-right: 10px;
}
.advanced-section legend {
  color: #a32a23;
}
.permission-grid {
  display: grid;
  grid-template-columns: 1fr;
  gap: 16px;
  margin-top: 18px;
}
.permission {
  flex-direction: row;
  align-items: flex-start;
  overflow-wrap: anywhere;
}
.permission small {
  font-size: 12px;
}
.permission em {
  display: inline-block;
  font-style: normal;
  font-size: 11px;
  margin-left: 6px;
  color: var(--muted);
}
code {
  font-size: 11px;
}
.change-list {
  max-height: 45vh;
  overflow: auto;
  line-height: 1.8;
}
form textarea {
  width: 100%;
  box-sizing: border-box;
}
section > form {
  margin-bottom: 20px;
}
@media (max-width: 760px) {
  .role-header,
  .feature-heading {
    align-items: flex-start;
    flex-direction: column;
  }
  .permission-grid {
    grid-template-columns: 1fr;
  }
  .filters > label {
    flex: 1;
    min-width: 180px;
  }
  .role-header h1 {
    font-size: 24px;
  }
}
</style>
