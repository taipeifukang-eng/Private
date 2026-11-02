<script setup lang="ts">
import { ref, computed, watch, onMounted, onBeforeUnmount } from "vue";
import { api } from "../api";
import type { WorkTab } from "../stores";
import Modal from "../components/Modal.vue";
const props = defineProps<{ tab: WorkTab }>();
const users = ref<any[]>([]),
  caps = ref<Record<string, boolean>>({}),
  currentUser = ref(""),
  search = ref(""),
  role = ref(""),
  page = ref(1),
  loading = ref(false),
  error = ref(""),
  message = ref(""),
  modal = ref(""),
  target = ref<any>(null),
  form = ref<any>({}),
  dialogError = ref(""),
  discard = ref(false),
  detail = ref<any>(null),
  detailLoading = ref(false),
  permissionSearch = ref(""),
  detailTab = ref("roles"),
  showPassword = ref(false),
  resetDone = ref(false),
  copyMessage = ref("");
const roleNames: Record<string, string> = {
  admin: "管理員",
  manager: "主管",
  member: "成員",
};
const baseline = ref("{}");
const draft = computed(
  () =>
    ["create", "edit", "role", "reset"].includes(modal.value) &&
    JSON.stringify(form.value) !== baseline.value &&
    !resetDone.value,
);
watch(draft, (v) => (props.tab.dirty = v), { flush: "sync" });
const filtered = computed(() =>
  users.value
    .filter(
      (u) =>
        (!role.value || u.role === role.value) &&
        [u.email, u.full_name, u.employee_code].some((v) =>
          String(v || "")
            .toLowerCase()
            .includes(search.value.trim().toLowerCase()),
        ),
    )
    .sort((a, b) =>
      !a.employee_code
        ? !b.employee_code
          ? 0
          : 1
        : !b.employee_code
          ? -1
          : String(a.employee_code).localeCompare(
              String(b.employee_code),
              "zh-TW",
              { numeric: true },
            ),
    ),
);
const pages = computed(() =>
    Math.max(1, Math.ceil(filtered.value.length / 50)),
  ),
  visible = computed(() =>
    filtered.value.slice(
      (Math.min(page.value, pages.value) - 1) * 50,
      Math.min(page.value, pages.value) * 50,
    ),
  );
watch([search, role], () => (page.value = 1));
const permissions = computed(() =>
  (detail.value?.effective_permissions || []).filter((p: any) =>
    [
      p.code,
      p.description,
      ...(p.source_roles || []).map((r: any) => r.name),
    ].some((v) =>
      String(v || "")
        .toLowerCase()
        .includes(permissionSearch.value.trim().toLowerCase()),
    ),
  ),
);
const modalTitle = computed(
  () =>
    ({
      create: "新增使用者",
      edit: "編輯使用者",
      role: "變更相容角色",
      reset: "重置密碼",
      delete: "刪除使用者",
      detail: "角色與權限",
    })[modal.value] || "",
);
const time = (v: any) =>
  v ? new Date(v).toLocaleString("zh-TW", { timeZone: "Asia/Taipei" }) : "—";
async function load() {
  loading.value = true;
  error.value = "";
  try {
    const r = await api("users");
    users.value = r.users;
    caps.value = r.capabilities;
    currentUser.value = r.currentUser;
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    loading.value = false;
  }
}
function open(action: string, user: any = null) {
  target.value = user;
  modal.value = action;
  dialogError.value = "";
  copyMessage.value = "";
  resetDone.value = false;
  showPassword.value = false;
  form.value =
    action === "edit"
      ? Object.fromEntries(
          ["full_name", "employee_code", "department", "job_title"].map((k) => [
            k,
            user[k] || "",
          ]),
        )
      : action === "role"
        ? { role: user.role }
        : action === "create"
          ? { email: "", full_name: "", password: "", confirmPassword: "" }
          : { password: "" };
  baseline.value = JSON.stringify(form.value);
  props.tab.dirty = false;
}
function close() {
  if (props.tab.busy) return;
  if (draft.value) {
    discard.value = true;
    return;
  }
  finishClose();
}
function finishClose() {
  modal.value = "";
  form.value = {};
  discard.value = false;
  props.tab.dirty = false;
  dialogError.value = "";
}
function randomPassword() {
  const bytes = crypto.getRandomValues(new Uint8Array(18));
  form.value.password =
    Array.from(bytes, (b) => b.toString(16).padStart(2, "0"))
      .join("")
      .slice(0, 16) + "aA!";
  showPassword.value = true;
  resetDone.value = false;
}
async function copy(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    copyMessage.value = "已複製";
  } catch {
    copyMessage.value = "無法自動複製，請選取內容後手動複製。";
  }
}
async function save() {
  if (props.tab.busy) return false;
  if (!["create", "edit", "role", "reset", "delete"].includes(modal.value))
    return true;
  dialogError.value = "";
  if (
    modal.value === "create" &&
    form.value.password !== form.value.confirmPassword
  ) {
    dialogError.value = "兩次密碼不一致";
    return false;
  }
  props.tab.busy = true;
  try {
    let r: any;
    const action = modal.value;
    if (action === "delete")
      r = await api(`users?id=${encodeURIComponent(target.value.id)}`, {
        method: "DELETE",
      });
    else {
      const { confirmPassword, ...values } = form.value;
      r = await api("users", {
        method: action === "edit" || action === "role" ? "PATCH" : "POST",
        body: JSON.stringify({ action, id: target.value?.id, ...values }),
      });
    }
    message.value = r.message || "操作完成";
    baseline.value = JSON.stringify(form.value);
    props.tab.dirty = false;
    if (action === "reset") {
      resetDone.value = true;
      copyMessage.value = "密碼已重置，關閉視窗前請妥善保存。";
    } else {
      finishClose();
      await load();
    }
    return true;
  } catch (e) {
    dialogError.value = (e as Error).message;
    return false;
  } finally {
    props.tab.busy = false;
  }
}
let detailRequest = 0;
async function loadDetail() {
  const request = ++detailRequest;
  const userId = target.value.id;
  detailLoading.value = true;
  dialogError.value = "";
  try {
    const r = await api(`users?id=${encodeURIComponent(userId)}`);
    if (
      request === detailRequest &&
      modal.value === "detail" &&
      target.value.id === userId
    )
      detail.value = r.detail;
  } catch (e) {
    if (request === detailRequest) dialogError.value = (e as Error).message;
  } finally {
    if (request === detailRequest) detailLoading.value = false;
  }
}
function showDetail(user: any) {
  open("detail", user);
  detail.value = null;
  permissionSearch.value = "";
  detailTab.value = "roles";
  loadDetail();
}
props.tab.save = save;
onBeforeUnmount(() => delete props.tab.save);
onMounted(load);
const validationLabels: Record<string, string> = {
  can_view_users: "查看使用者",
  can_view_roles: "查看角色",
  can_access_general_affairs_service: "進入總務服務中心",
  can_view_inventory_balances: "查看庫存結餘",
  can_view_inventory_transactions: "查看庫存異動",
  can_post_inventory_transactions: "管理庫存異動",
  can_view_parts: "查看零件",
};
</script>
<template>
  <header class="page-heading">
    <div>
      <p class="eyebrow">系統管理 / 使用者</p>
      <h1>使用者管理</h1>
      <p class="muted">管理登入帳號、基本資料及權限範圍</p>
    </div>
    <div class="module-actions">
      <button :disabled="loading || tab.busy" @click="load">重新整理</button
      ><button v-if="caps.create" class="primary" @click="open('create')">
        新增使用者
      </button>
    </div>
  </header>
  <p v-if="error" class="notice error" role="alert">{{ error }}</p>
  <p v-if="message" class="notice" role="status">{{ message }}</p>
  <div class="user-counts" aria-label="使用者統計">
    <button :aria-pressed="role === ''" @click="role = ''">
      總使用者 <strong>{{ users.length }}</strong></button
    ><button
      v-for="(name, key) in roleNames"
      :aria-pressed="role === key"
      @click="role = String(key)"
    >
      {{ name }}
      <strong>{{ users.filter((u) => u.role === key).length }}</strong>
    </button>
  </div>
  <div class="module-filters">
    <label>搜尋姓名／帳號／員編<input type="search" v-model="search" /></label
    ><label
      >相容角色<select v-model="role">
        <option value="">全部角色</option>
        <option v-for="(name, key) in roleNames" :value="key">
          {{ name }}
        </option>
      </select></label
    ><span>{{ filtered.length }} 位使用者</span>
  </div>
  <p v-if="loading" role="status">載入使用者…</p>
  <div v-else class="module-table">
    <table>
      <thead>
        <tr>
          <th>員工編號／姓名</th>
          <th>登入帳號</th>
          <th>部門／職位</th>
          <th>相容角色</th>
          <th>RBAC 角色／有效權限</th>
          <th>門市範圍</th>
          <th>帳號狀態／建立時間</th>
          <th>操作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="u in visible" :key="u.id">
          <td>
            {{ u.employee_code || "—" }}<br /><strong>{{
              u.full_name || "未設定"
            }}</strong
            ><small v-if="u.id === currentUser">目前登入</small>
          </td>
          <td>{{ u.email }}</td>
          <td>{{ u.department || "—" }}<br />{{ u.job_title || "—" }}</td>
          <td>
            {{ roleNames[u.role] || u.role
            }}<small v-if="u.is_admin_compatibility">管理員相容權限</small>
          </td>
          <td>
            <div
              v-for="r in u.rbac_roles.filter((r: any) => r.is_current)"
              :key="r.id"
            >
              {{ r.name }}
            </div>
            <small>{{ u.effective_permission_count }} 項有效權限</small>
          </td>
          <td>{{ u.store_scope_count }} 間</td>
          <td>
            {{
              u.has_auth === false
                ? "無登入帳號"
                : u.is_disabled
                  ? "停用登入"
                  : "可登入"
            }}<br /><small>{{ time(u.created_at) }}</small>
          </td>
          <td>
            <div class="row-actions">
              <button @click="showDetail(u)">角色與權限</button
              ><button v-if="caps.edit" @click="open('edit', u)">編輯</button
              ><button
                v-if="caps.change_role"
                :disabled="u.id === currentUser"
                @click="open('role', u)"
              >
                變更角色</button
              ><button v-if="caps.reset" @click="open('reset', u)">
                重置密碼</button
              ><button
                v-if="caps.delete"
                class="danger"
                :disabled="u.id === currentUser"
                @click="open('delete', u)"
              >
                刪除
              </button>
            </div>
          </td>
        </tr>
        <tr v-if="!visible.length">
          <td colspan="8">沒有符合條件的使用者。</td>
        </tr>
      </tbody>
    </table>
  </div>
  <div class="module-actions">
    <button :disabled="page <= 1" @click="page--">上一頁</button
    ><span>{{ Math.min(page, pages) }} / {{ pages }} 頁</span
    ><button :disabled="page >= pages" @click="page++">下一頁</button>
  </div>
  <Modal
    v-if="modal"
    :title="modalTitle"
    :wide="modal === 'detail'"
    :busy="tab.busy"
    @cancel="close"
  >
    <p v-if="target">
      {{ target.employee_code }} {{ target.full_name }} · {{ target.email }}
    </p>
    <p v-if="dialogError" class="notice error" role="alert">
      {{ dialogError
      }}<button v-if="modal === 'detail'" @click="loadDetail">重試</button>
    </p>
    <template v-if="modal === 'detail'"
      ><p v-if="detailLoading" role="status">載入角色與權限…</p>
      <template v-else-if="detail">
        <p v-if="detail.legacy_compatibility.is_admin_like" class="notice">
          此使用者另具管理員相容權限；下方列出由 RBAC
          角色實際授予的權限，兩種來源分開辨識。
        </p>
        <nav class="module-actions" aria-label="使用者權限明細">
          <button
            v-for="(name, key) in {
              roles: '指派角色',
              permissions: '有效權限',
              stores: '門市範圍',
              validation: '權限檢核',
            }"
            :aria-pressed="detailTab === key"
            :class="{ primary: detailTab === key }"
            @click="detailTab = String(key)"
          >
            {{ name }}
          </button>
        </nav>
        <div v-if="detailTab === 'roles'" class="module-table">
          <table>
            <thead>
              <tr>
                <th>角色</th>
                <th>狀態</th>
                <th>指派時間</th>
                <th>到期時間</th>
                <th>權限數</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="r in detail.roles">
                <td>
                  {{ r.name }}<br /><small
                    >{{ r.code }} {{ r.is_system ? "· 系統角色" : "" }}</small
                  >
                </td>
                <td>
                  {{
                    r.is_current ? "生效中" : r.is_expired ? "已到期" : "未啟用"
                  }}
                </td>
                <td>{{ time(r.assigned_at) }}</td>
                <td>{{ time(r.expires_at) }}</td>
                <td>{{ r.permission_count }}</td>
              </tr>
              <tr v-if="!detail.roles.length">
                <td colspan="5">尚無指派角色。</td>
              </tr>
            </tbody>
          </table>
        </div>
        <template v-if="detailTab === 'permissions'"
          ><div class="module-filters">
            <label
              >搜尋權限<input v-model="permissionSearch" type="search" /></label
            ><button
              @click="copy(permissions.map((p: any) => p.code).join('\n'))"
              :disabled="!permissions.length"
            >
              複製目前權限</button
            ><span>{{ permissions.length }} 項</span>
          </div>
          <div class="module-table">
            <table>
              <thead>
                <tr>
                  <th>權限代碼</th>
                  <th>說明</th>
                  <th>來源角色</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="p in permissions" :key="p.code">
                  <td>{{ p.code }}</td>
                  <td>{{ p.description || "—" }}</td>
                  <td>
                    {{ p.source_roles.map((r: any) => r.name).join("、") }}
                  </td>
                </tr>
                <tr v-if="!permissions.length">
                  <td colspan="3">沒有符合的有效權限。</td>
                </tr>
              </tbody>
            </table>
          </div></template
        >
        <div v-if="detailTab === 'stores'" class="module-table">
          <table>
            <thead>
              <tr>
                <th>門市</th>
                <th>管理身分</th>
                <th>主責</th>
                <th>門市狀態</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="s in detail.store_scopes" :key="s.id">
                <td>{{ s.store_code }} {{ s.short_name || s.store_name }}</td>
                <td>{{ s.role_type }}</td>
                <td>{{ s.is_primary ? "是" : "否" }}</td>
                <td>{{ s.store_is_active ? "營運中" : "停用" }}</td>
              </tr>
              <tr v-if="!detail.store_scopes.length">
                <td colspan="4">沒有指派門市範圍。</td>
              </tr>
            </tbody>
          </table>
        </div>
        <dl v-if="detailTab === 'validation'" class="validation">
          <template v-for="(name, key) in validationLabels"
            ><dt>{{ name }}</dt>
            <dd>
              {{ detail.validation_summary[key] ? "允許" : "未授權" }}
            </dd></template
          >
          <dt>門市範圍</dt>
          <dd>{{ detail.validation_summary.store_manager_scope_label }}</dd>
        </dl>
      </template>
      <p v-if="copyMessage" role="status">{{ copyMessage }}</p>
      <div class="dialog-actions">
        <button @click="close">關閉</button>
      </div></template
    >
    <form v-else @submit.prevent="save">
      <fieldset :disabled="tab.busy">
        <template v-if="modal === 'create'"
          ><label
            >姓名<input
              v-model="form.full_name"
              required
              maxlength="200" /></label
          ><label
            >電子郵件<input
              type="email"
              v-model="form.email"
              required
              autocomplete="off"
              maxlength="254" /></label
          ><label
            >密碼<input
              type="password"
              v-model="form.password"
              required
              minlength="6"
              maxlength="128"
              autocomplete="new-password" /></label
          ><label
            >確認密碼<input
              type="password"
              v-model="form.confirmPassword"
              required
              minlength="6"
              autocomplete="new-password"
          /></label>
          <p class="muted">
            新增後預設為成員；此操作不寄送通知郵件。
          </p></template
        >
        <template v-if="modal === 'edit'"
          ><label
            v-for="(label, key) in {
              full_name: '姓名',
              employee_code: '員工編號',
              department: '部門',
              job_title: '職位',
            }"
            >{{ label
            }}<input
              v-model="form[key]"
              :required="['full_name', 'employee_code'].includes(String(key))"
              maxlength="200" /></label
        ></template>
        <template v-if="modal === 'role'"
          ><label
            >相容角色<select v-model="form.role">
              <option v-for="(name, key) in roleNames" :value="key">
                {{ name }}
              </option>
            </select></label
          >
          <p class="notice">
            此設定變更相容角色，並非 RBAC
            角色指派。管理員相容角色會影響管理介面的存取。
          </p></template
        >
        <template v-if="modal === 'reset'"
          ><label
            >新密碼<input
              :type="showPassword ? 'text' : 'password'"
              v-model="form.password"
              minlength="6"
              maxlength="128"
              required
              autocomplete="new-password"
              @input="resetDone = false"
          /></label>
          <div class="module-actions">
            <button type="button" @click="randomPassword">產生隨機密碼</button
            ><button type="button" @click="showPassword = !showPassword">
              {{ showPassword ? "隱藏密碼" : "顯示密碼" }}</button
            ><button
              type="button"
              :disabled="!form.password"
              @click="copy(form.password)"
            >
              複製密碼
            </button>
          </div>
          <p v-if="copyMessage" role="status">{{ copyMessage }}</p></template
        >
        <template v-if="modal === 'delete'"
          ><p class="notice error">確定刪除此使用者？此操作無法復原。</p>
          <p>
            若已有歷史紀錄引用，系統會保留基本資料並停用登入、撤除角色及管理範圍；完成後會顯示實際處理結果。
          </p></template
        >
      </fieldset>
      <div class="dialog-actions">
        <button type="button" :disabled="tab.busy" @click="close">
          {{ resetDone ? "關閉" : "取消" }}</button
        ><button
          v-if="!resetDone"
          :class="modal === 'delete' ? 'danger' : 'primary'"
          :disabled="tab.busy"
        >
          {{
            tab.busy
              ? "處理中…"
              : modal === "delete"
                ? "確認刪除"
                : modal === "reset"
                  ? "確認重置"
                  : modal === "role"
                    ? "確認變更"
                    : "儲存"
          }}
        </button>
      </div>
    </form>
  </Modal>
  <Modal v-if="discard" title="放棄未儲存內容？" @cancel="discard = false"
    ><p>關閉後將清除這次編輯內容。</p>
    <div class="dialog-actions">
      <button @click="discard = false">繼續編輯</button
      ><button class="danger" @click="finishClose">放棄變更</button>
    </div></Modal
  >
</template>
<style scoped>
.user-counts {
  display: flex;
  gap: 12px;
  flex-wrap: wrap;
  margin: 24px 0;
}
.user-counts button {
  display: flex;
  gap: 28px;
  align-items: baseline;
  background: var(--surface);
  padding: 16px 22px;
}
.user-counts button[aria-pressed="true"] {
  border-color: var(--primary);
}
.user-counts strong {
  font-size: 24px;
}
.row-actions {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  min-width: 220px;
}
td small {
  display: block;
  color: var(--muted);
  margin-top: 5px;
}
td {
  vertical-align: top;
}
fieldset {
  border: 0;
  padding: 0;
  display: grid;
  gap: 16px;
}
fieldset label {
  display: grid;
  gap: 8px;
}
fieldset input,
fieldset select {
  width: 100%;
  box-sizing: border-box;
}
.validation {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
}
.validation dd {
  margin: 0;
}
.module-actions,
.module-filters {
  flex-wrap: wrap;
}
</style>
