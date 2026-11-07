<script setup lang="ts">
import { ref, computed, onMounted, watch, onBeforeUnmount } from "vue";
import { api, ApiError } from "../api";
import { useSession, useWorkspace, type WorkTab } from "../stores";
import Modal from "../components/Modal.vue";
import SignatureInput from "../components/SignatureInput.vue";
import InspectionPhotoCapture from "../components/InspectionPhotoCapture.vue";
import { carryOverScores, type CarryNotice } from "../../../lib/workspace/inspection-carryover";
import { hasManualStaffEdits, rosterToStaff, type DutyStaff } from "../../../lib/workspace/inspection-staff";
import {
  DRAFT_TTL_DAYS,
  OFFLINE_RETRY_MESSAGE,
  draftKey,
  expiresAt,
  hasDraftContent,
  serverMovedOn,
  type OfflineDraft,
} from "../../../lib/workspace/inspection-offline-policy";
import { getDraft, offlineAvailable, purgeExpiredDrafts, putDraft, removeDraft } from "../inspection-offline";
import GpsGuideDialog from "../components/GpsGuideDialog.vue";
import {
  GPS_HIGH_ACCURACY_FALLBACK_MS,
  classifyGeolocationError,
  classifyGpsDbError,
  detectGpsDevice,
  formatTaipeiDate,
  getGpsDbErrorMessage,
  getGpsFailureMessage,
  isGpsDbError,
  isGpsTimestampWithinWindow,
  validateGpsFix,
  type GpsFailureKind,
} from "../../../lib/inspection/gps-policy";
import { getInspectionGpsCapturedAt } from "../../../lib/inspection/date";
import { scoreInspection } from "../../../lib/workspace/inspection-scoring";
const props = defineProps<{ tab: WorkTab }>(),
  work = useWorkspace(),
  session = useSession();
const userId = computed(() => session.data?.user.id || "");
const recordRemoved = computed(() =>
  work.deletedInspectionIds.includes(props.tab.recordId || ""),
);
const ready = ref(false);
const loading = ref(true),
  error = ref(""),
  message = ref(""),
  failed = ref(false),
  submitConfirm = ref(false),
  templates = ref<any[]>([]),
  grades = ref<any[]>([]),
  stores = ref<any[]>([]),
  templateHash = ref(""),
  version = ref(0),
  locked = ref(false);
// M4 Q9：範本變更後重新載入，列出對不上的項目給督導確認。
const carryNotices = ref<CarryNotice[]>([]),
  noticesAck = ref(false);
// M4 Q13：換門市時當班人員自動換成新門市名單；已有手動修改先確認。
const staffConfirm = ref<null | { store: string; previous: string; roster: DutyStaff[] }>(null);
let autoRoster: DutyStaff[] = [],
  suppressStore = false;
// M4 Q14–Q16：離線暫存。
const restorePrompt = ref<OfflineDraft | null>(null),
  restoreDeleteConfirm = ref(false),
  offlineNotice = ref(""),
  draftSavedAt = ref(0);
let autosaveReady = false,
  draftTimer = 0;
// 定位狀態（僅新增模式使用）：新增巡店必須先定位成功，表單才會解鎖。
const gpsStatus = ref<"idle" | "loading" | "success" | "error">("idle"),
  gpsError = ref(""),
  gpsKind = ref<GpsFailureKind | null>(null),
  gpsWarning = ref(false),
  gpsGuideOpen = ref(false);
let gpsAttempt = 0,
  gpsTimer = 0;
// 錯誤視窗出現時，收起「確認提交」視窗，避免兩個視窗疊在一起。
watch(failed, (v) => {
  if (v) submitConfirm.value = false;
});
const isNew = computed(() => !props.tab.recordId);
const today = () => formatTaipeiDate(new Date());
const form = ref<any>({
  store: props.tab.store,
  type: props.tab.payload?.type || "supervisor",
  date: today(),
  temperature: "",
  notes: "",
  gps: null,
  signature: "",
  supervisorSignature: "",
  scores: [],
  staff: [],
});
let baseline = "",
  pending: { serialized: string; writeId: string } | null = null;
const sections = computed(() => {
  const map = new Map<string, { name: string; items: any[] }>();
  for (const t of templates.value) {
    const key = t.section || "other";
    if (!map.has(key)) map.set(key, { name: t.section_name || key, items: [] });
    map.get(key)!.items.push(t);
  }
  return [...map.entries()];
});
const scoreResult = computed(() => {
  try {
    return {
      value: scoreInspection(templates.value, form.value.scores, grades.value),
      error: "",
    };
  } catch (e) {
    return { value: null, error: (e as Error).message };
  }
});
// 定位結果與日期由系統帶入，不算使用者未儲存的變更。
const snapshot = () => JSON.stringify({ ...form.value, gps: null, date: null });
watch(
  form,
  () => {
    if (!loading.value) {
      props.tab.dirty = snapshot() !== baseline;
      message.value = "";
    }
  },
  { deep: true, flush: "sync" },
);
const gpsLocked = computed(
  () => isNew.value && (gpsStatus.value !== "success" || !form.value.gps),
);
const disabled = computed(
  () =>
    loading.value ||
    locked.value ||
    props.tab.busy ||
    !!restorePrompt.value ||
    gpsLocked.value,
);
function score(id: string) {
  return form.value.scores.find((s: any) => s.template_id === id);
}
async function load() {
  loading.value = true;
  error.value = "";
  try {
    const params = new URLSearchParams({ type: form.value.type });
    if (props.tab.recordId) params.set("id", props.tab.recordId);
    else if (form.value.store) params.set("store", form.value.store);
    const r = await api("inspection-form?" + params);
    templates.value = r.templates;
    grades.value = r.grades;
    stores.value = r.stores;
    templateHash.value = r.templateHash;
    if (r.record) {
      const row = r.record;
      version.value = row.workspace_version;
      form.value = {
        ...form.value,
        store: row.store_id,
        date: row.inspection_date,
        temperature: row.indoor_temperature ?? "",
        notes: row.supervisor_notes || "",
        signature: row.signature_photo_url || "",
        supervisorSignature: row.supervisor_signature_url || "",
        gps: row.gps_timestamp
          ? {
              latitude: Number(row.gps_latitude),
              longitude: Number(row.gps_longitude),
              accuracy: Number(row.gps_accuracy),
              capturedAt: row.gps_timestamp,
            }
          : null,
        staff: r.staff.map((s: any) => ({
          ...s,
          employee_code: s.employee_code || "",
          position: s.position || "",
        })),
      };
    } else {
      autoRoster = rosterToStaff(r.roster);
      form.value.staff = rosterToStaff(r.roster);
    }
    form.value.scores = r.templates.map((t: any) => {
      const old = r.results.find((s: any) => s.template_id === t.id);
      const checked = old?.selected_items || [];
      let quantities = old?.workspace_quantities || {};
      if (old && !Object.keys(quantities).length) {
        const counted = (t.checklist_items || []).filter(
          (o: any) => checked.includes(o.label) && o.requires_quantity,
        );
        if (counted.length === 1) {
          const fixed = (t.checklist_items || [])
            .filter(
              (o: any) => checked.includes(o.label) && !o.requires_quantity,
            )
            .reduce((n: number, o: any) => n + Number(o.deduction), 0);
          const inferred =
            (Number(old.deduction_amount) - fixed) /
            Number(counted[0].deduction);
          if (Number.isInteger(inferred) && inferred >= 1)
            quantities = { [counted[0].label]: inferred };
          else error.value = "舊紀錄缺少缺失數量，請逐項核對再儲存。";
        } else if (counted.length > 1)
          error.value = "舊紀錄缺少各項數量，請逐項核對再儲存。";
      }
      if (old) {
        for (const option of t.checklist_items || []) {
          if (
            option.requires_quantity &&
            checked.includes(option.label) &&
            quantities[option.label] == null
          ) {
            quantities[option.label] = 0;
          }
        }
      }
      return {
        template_id: t.id,
        checked_items: checked,
        quantities,
        notes: old?.notes || "",
        photos: old?.photo_urls || [],
      };
    });
    props.tab.title = props.tab.recordId
      ? "編輯巡店"
      : "新增" + (form.value.type === "manager" ? "經理" : "督導") + "巡店";
    ready.value = true;
    baseline = snapshot();
    props.tab.dirty = false;
    if (!offered) {
      offered = true;
      void offerRestore();
    }
  } catch (e) {
    error.value = (e as Error).message;
    // 已送出（完成或結案）的巡店不能再編輯：本機暫存自動清除（Q16）。
    if (
      e instanceof ApiError &&
      e.status === 409 &&
      /已完成或已結案/.test(e.message) &&
      props.tab.recordId &&
      userId.value
    )
      void removeDraft(userId.value, form.value.type, props.tab.recordId);
  } finally {
    loading.value = false;
  }
}
let offered = false;

// ---- M4 Q14–Q16：離線暫存 ----
function draftPayload(): OfflineDraft {
  return {
    key: draftKey(userId.value, form.value.type, props.tab.recordId),
    userId: userId.value,
    type: form.value.type,
    recordId: props.tab.recordId || null,
    savedAt: Date.now(),
    serverVersion: version.value,
    templateHash: templateHash.value,
    templates: templates.value.map((t: any) => ({
      id: t.id,
      item_name: t.item_name,
      max_score: t.max_score,
      is_active: t.is_active,
      checklist_items: t.checklist_items,
    })),
    // 定位與日期由系統重新帶入，不暫存。
    form: { ...form.value, gps: null, date: null },
  };
}
async function flushDraft() {
  window.clearTimeout(draftTimer);
  if (!autosaveReady || !userId.value || locked.value || !ready.value) return;
  if (!props.tab.dirty) return;
  if (!props.tab.recordId && !hasDraftContent(form.value)) return;
  const draft = draftPayload();
  if (await putDraft(draft)) draftSavedAt.value = draft.savedAt;
}
function scheduleDraft() {
  window.clearTimeout(draftTimer);
  draftTimer = window.setTimeout(() => void flushDraft(), 700);
}
async function clearDrafts(previousRecordId?: string | null) {
  window.clearTimeout(draftTimer);
  autosaveReady = false;
  if (!userId.value) return;
  const t = form.value.type;
  await removeDraft(userId.value, t, null);
  if (previousRecordId) await removeDraft(userId.value, t, previousRecordId);
  if (props.tab.recordId) await removeDraft(userId.value, t, props.tab.recordId);
  draftSavedAt.value = 0;
}
async function offerRestore() {
  if (!userId.value) return;
  if (!(await offlineAvailable())) {
    offlineNotice.value = "此瀏覽器無法使用本機暫存，請完成後盡快儲存。";
    return;
  }
  await purgeExpiredDrafts();
  const draft = await getDraft(userId.value, form.value.type, props.tab.recordId);
  if (draft) restorePrompt.value = draft;
  else autosaveReady = true;
}
const restoreInfo = computed(() => {
  const d = restorePrompt.value;
  if (!d) return null;
  return {
    savedAt: new Date(d.savedAt).toLocaleString("zh-TW", { timeZone: "Asia/Taipei", hour12: false }),
    expires: new Date(expiresAt(d.savedAt)).toLocaleDateString("zh-TW", { timeZone: "Asia/Taipei" }),
    serverMoved: serverMovedOn(d, version.value),
  };
});
function applyRestore() {
  const d = restorePrompt.value;
  if (!d) return;
  const saved = d.form;
  const merged = carryOverScores(d.templates, saved.scores || [], templates.value);
  suppressStore = true;
  form.value = {
    ...form.value,
    ...saved,
    type: form.value.type,
    scores: merged.scores,
    gps: form.value.gps,
    date: form.value.date,
  };
  suppressStore = false;
  autoRoster = [];
  carryNotices.value = merged.notices;
  noticesAck.value = false;
  restorePrompt.value = null;
  restoreDeleteConfirm.value = false;
  autosaveReady = true;
  message.value = "已還原本機暫存的內容（含照片與簽名）。";
  void flushDraft();
}
async function deleteRestore() {
  if (userId.value)
    await removeDraft(userId.value, form.value.type, props.tab.recordId);
  restorePrompt.value = null;
  restoreDeleteConfirm.value = false;
  autosaveReady = true;
  message.value = "已刪除本機暫存。";
}
const onHide = () => {
  if (document.visibilityState === "hidden") void flushDraft();
};

// ---- M4 Q9：範本變更時重新載入並保留還對得上的內容 ----
async function reloadTemplates() {
  const params = new URLSearchParams({ type: form.value.type });
  if (props.tab.recordId) params.set("id", props.tab.recordId);
  else if (form.value.store) params.set("store", form.value.store);
  const r = await api("inspection-form?" + params);
  const merged = carryOverScores(templates.value, form.value.scores, r.templates);
  templates.value = r.templates;
  grades.value = r.grades;
  templateHash.value = r.templateHash;
  form.value.scores = merged.scores;
  carryNotices.value = merged.notices;
  noticesAck.value = false;
  message.value =
    "巡店範本剛被更新，已重新載入並保留還對得上的勾選、數量、備註與照片；請確認下方清單後再送出。";
}
const TEMPLATE_CHANGED = /範本已更新|巡店設定已變更|巡店設定正在更新/;

// ---- M4 Q13：換門市時當班人員自動帶入 ----
async function onStoreChanged(next: string, previous: string) {
  try {
    const r = await api(
      "inspection-form?" +
        new URLSearchParams({
          type: form.value.type,
          store: next,
          ...(props.tab.recordId ? { id: props.tab.recordId } : {}),
        }),
    );
    const roster = rosterToStaff(r.roster);
    if (hasManualStaffEdits(form.value.staff, autoRoster)) {
      staffConfirm.value = { store: next, previous, roster };
      return;
    }
    autoRoster = roster;
    form.value.staff = rosterToStaff(r.roster);
  } catch (e) {
    error.value = (e as Error).message;
  }
}
function confirmStaffReplace() {
  const c = staffConfirm.value;
  if (!c) return;
  autoRoster = c.roster;
  form.value.staff = rosterToStaff(c.roster);
  staffConfirm.value = null;
  message.value = "當班人員已換成新門市的上月在職名單。";
}
function cancelStaffReplace() {
  const c = staffConfirm.value;
  if (!c) return;
  suppressStore = true;
  form.value.store = c.previous;
  suppressStore = false;
  staffConfirm.value = null;
}
watch(
  () => form.value.store,
  (next, previous) => {
    if (loading.value || suppressStore || !next || next === previous) return;
    void onStoreChanged(next, previous);
  },
  { flush: "sync" },
);
watch(form, scheduleDraft, { deep: true });
async function loadRoster() {
  if (!form.value.store) return;
  error.value = "";
  try {
    const r = await api(
      "inspection-form?" +
        new URLSearchParams({
          type: form.value.type,
          store: form.value.store,
          ...(props.tab.recordId ? { id: props.tab.recordId } : {}),
        }),
    );
    for (const s of r.roster) {
      if (
        !form.value.staff.some(
          (x: any) =>
            x.employee_code === s.employee_code &&
            x.employee_name === s.employee_name,
        )
      )
        form.value.staff.push({
          ...s,
          employee_code: s.employee_code || "",
          employee_name: s.employee_name || "",
          position: s.position || "",
          is_duty_supervisor: false,
          is_manually_added: false,
        });
    }
    message.value = "已加入上月在職人員；請移除本次不在班的人員。";
  } catch (e) {
    error.value = (e as Error).message;
  }
}
const gpsMobile = (() => {
  const d = detectGpsDevice(navigator.userAgent, {
    maxTouchPoints: navigator.maxTouchPoints,
  });
  return d === "ios" || d === "android";
})();
function locate() {
  const attempt = ++gpsAttempt;
  window.clearTimeout(gpsTimer);
  const current = () => gpsAttempt === attempt;
  const fail = (kind: GpsFailureKind, accuracy?: number | null) => {
    if (!current()) return;
    form.value.gps = null;
    gpsWarning.value = false;
    gpsKind.value = kind;
    gpsError.value = getGpsFailureMessage(kind, accuracy);
    gpsStatus.value = "error";
    gpsGuideOpen.value = true;
  };
  const accept = (p: GeolocationPosition) => {
    if (!current()) return;
    const fix = {
      latitude: p.coords.latitude,
      longitude: p.coords.longitude,
      accuracy: p.coords.accuracy,
      capturedAt: getInspectionGpsCapturedAt(p.timestamp),
    };
    const check = validateGpsFix(fix);
    if (!check.ok) return fail(check.kind, fix.accuracy);
    form.value.gps = fix;
    form.value.date = formatTaipeiDate(fix.capturedAt);
    gpsWarning.value = check.warning;
    gpsKind.value = null;
    gpsError.value = "";
    gpsStatus.value = "success";
    gpsGuideOpen.value = false;
    if (error.value.startsWith("定位已過期")) error.value = "";
  };
  if (!navigator.geolocation) return fail("unsupported");
  gpsStatus.value = "loading";
  form.value.gps = null;
  gpsWarning.value = false;
  gpsError.value = "";
  gpsKind.value = null;
  let fallback = false;
  // 高精度先試約 8 秒，逾時或失敗改用一般定位（WiFi／基地台）；兩者都失敗才算失敗。
  const tryNormal = () => {
    if (fallback || !current()) return;
    fallback = true;
    window.clearTimeout(gpsTimer);
    navigator.geolocation.getCurrentPosition(
      accept,
      (e) => fail(classifyGeolocationError(e.code)),
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 300000 },
    );
  };
  gpsTimer = window.setTimeout(tryNormal, GPS_HIGH_ACCURACY_FALLBACK_MS);
  navigator.geolocation.getCurrentPosition(
    (p) => {
      if (fallback) return;
      window.clearTimeout(gpsTimer);
      accept(p);
    },
    () => tryNormal(),
    { enableHighAccuracy: true, timeout: 7000, maximumAge: 0 },
  );
}
function retryFromGuide() {
  gpsGuideOpen.value = false;
  locate();
}
function addPhoto(id: string, url: string) {
  const list = score(id).photos;
  if (list.length >= 5) return;
  list.push(url);
  // 拍照後立即寫入本機暫存（Q14），連拍不遺失。
  void flushDraft();
}
function removePhoto(id: string, index: number) {
  score(id).photos.splice(index, 1);
  void flushDraft();
}
function setQuantity(id: string, label: string, raw: string) {
  // 與舊版一致：最小 1、整數、空白或錯誤輸入自動回 1。
  const n = Math.floor(Number(raw));
  score(id).quantities[label] = Number.isFinite(n) && n >= 1 ? n : 1;
}
async function save(status = "draft") {
  if (recordRemoved.value) {
    error.value = "此巡店已刪除，不能儲存；本頁填寫內容仍保留。";
    return false;
  }
  error.value = "";
  if (disabled.value) return false;
  if (!form.value.store || form.value.temperature === "") {
    error.value = "請選擇門市並輸入室內溫度";
    failed.value = true;
    return false;
  }
  if (scoreResult.value.error) {
    error.value = scoreResult.value.error;
    failed.value = true;
    return false;
  }
  if (carryNotices.value.length && !noticesAck.value && status === "completed") {
    error.value = "範本有變更，請先確認下方「對不上的項目」清單再送出。";
    failed.value = true;
    return false;
  }
  if (status === "completed" && (!form.value.signature || !form.value.supervisorSignature)) {
    // M4 Q12：正式送出必須雙簽名（草稿可不簽）。
    error.value = "請完成「店長／當班主管確認簽名」與「督導簽名」兩個簽名後再送出。";
    failed.value = true;
    return false;
  }
  if (isNew.value && !isGpsTimestampWithinWindow(form.value.gps?.capturedAt)) {
    // 定位時間窗已過期（超過 2 小時）：不送出，重新定位。
    submitConfirm.value = false;
    message.value = "";
    error.value = "定位已過期，正在重新定位，完成後請再送出。";
    locate();
    return false;
  }
  props.tab.busy = true;
  try {
    const body = {
      ...form.value,
      temperature: Number(form.value.temperature),
      id: props.tab.recordId || null,
      version: version.value,
      templateHash: templateHash.value,
      status,
    };
    const serialized = JSON.stringify(body);
    if (serialized.length > 24_000_000) {
      error.value = "照片總容量過大，請刪除部分照片後再儲存";
      failed.value = true;
      return false;
    }
    if (pending?.serialized !== serialized)
      pending = { serialized, writeId: crypto.randomUUID() };
    const r = await api("inspection-form", {
      method: "POST",
      body: JSON.stringify({ ...body, writeId: pending.writeId }),
    });
    const wasRecord = props.tab.recordId;
    props.tab.recordId = r.record.id;
    version.value = r.record.workspace_version;
    baseline = snapshot();
    props.tab.dirty = false;
    pending = null;
    submitConfirm.value = false;
    // 伺服器儲存成功後清除本機暫存（草稿與已送出都清；之後的修改會重新暫存）。
    await clearDrafts(wasRecord);
    autosaveReady = status !== "completed";
    carryNotices.value = [];
    message.value = status === "completed" ? "巡店已完成提交" : "草稿已儲存";
    locked.value = status === "completed";
    props.tab.title = locked.value ? "已提交巡店" : "編輯巡店";
    return true;
  } catch (e) {
    error.value = (e as Error).message;
    if (e instanceof ApiError && e.status === 0) {
      // M4：網路中斷採手動重送，不自動補送（正式送出會產生待改善與獎金計算）。
      submitConfirm.value = false;
      error.value = "";
      message.value = OFFLINE_RETRY_MESSAGE;
      await flushDraft();
      return false;
    }
    if (e instanceof ApiError && e.status === 409 && TEMPLATE_CHANGED.test(e.message)) {
      // M4 Q9：擋下送出，保留填寫內容並自動對應新範本。
      submitConfirm.value = false;
      error.value = "";
      try {
        await reloadTemplates();
        await flushDraft();
      } catch (e2) {
        error.value = (e2 as Error).message;
        failed.value = true;
      }
      return false;
    }
    if (isNew.value && (isGpsDbError(e) || /定位/.test(error.value))) {
      // 伺服器擋下定位資料：表單重新鎖住並引導重新定位。
      const msg = isGpsDbError(e) ? getGpsDbErrorMessage(e) : error.value;
      error.value = msg;
      submitConfirm.value = false;
      form.value.gps = null;
      gpsWarning.value = false;
      gpsKind.value = classifyGpsDbError(msg);
      gpsError.value = msg;
      gpsStatus.value = "error";
      gpsGuideOpen.value = true;
      return false;
    }
    failed.value = true;
    return false;
  } finally {
    props.tab.busy = false;
  }
}
props.tab.save = () => save("draft");
onBeforeUnmount(() => {
  gpsAttempt++;
  window.clearTimeout(gpsTimer);
  void flushDraft();
  document.removeEventListener("visibilitychange", onHide);
  delete props.tab.save;
});
onMounted(() => {
  document.addEventListener("visibilitychange", onHide);
  // 新增模式進頁自動定位；編輯模式不定位，沿用第一次的定位與日期。
  if (!props.tab.recordId) locate();
  void load();
});
</script>
<template>
  <header class="page-heading">
    <div>
      <p class="eyebrow">
        巡店 / {{ form.type === "manager" ? "經理" : "督導" }}
      </p>
      <h1>{{ tab.recordId ? "編輯巡店" : "新增巡店" }}</h1>
      <p class="muted">選擇缺失項目及數量，系統依範本計分。</p>
    </div>
    <button
      v-if="locked"
      @click="work.open('inspection-detail', form.store, tab.recordId)"
    >
      查看已提交紀錄
    </button>
  </header>
  <p v-if="recordRemoved" class="notice error" role="alert">
    此巡店已在其他頁籤刪除，不能儲存；本頁草稿仍保留供核對。
  </p>
  <p v-if="loading" role="status">載入巡店表單…</p>
  <p v-if="error" class="notice error" role="alert">{{ error }}</p>
  <button v-if="!loading && !ready" @click="load">重新載入表單</button>
  <p v-if="message" class="notice" role="status">{{ message }}</p>
  <p v-if="offlineNotice" class="notice error" role="status">{{ offlineNotice }}</p>
  <section
    v-if="carryNotices.length"
    class="notice error"
    role="alert"
    data-testid="carryover-notices"
  >
    <strong>範本有變更，以下項目請督導確認（分數不會被悄悄改動）：</strong>
    <ul class="carryover-list">
      <li v-for="(n, i) in carryNotices" :key="i">
        {{ n.item_name }}：{{ n.message }}
      </li>
    </ul>
    <label class="restore-note"
      ><span
        ><input
          type="checkbox"
          v-model="noticesAck"
          data-testid="carryover-ack"
        />
        我已確認以上變更</span
      ></label
    >
  </section>
  <form
    v-if="!loading && ready"
    @submit.prevent="submitConfirm = true"
    class="inspection-editor"
  >
    <fieldset :disabled="disabled">
      <legend>基本資料</legend>
      <div class="module-form-grid">
        <label
          >門市<select v-model="form.store" aria-label="巡店門市" required>
            <option value="">選擇門市</option>
            <option v-for="s in stores" :key="s.id" :value="s.id">
              {{ s.store_code }} {{ s.store_name }}
            </option>
          </select></label
        ><label
          >巡店日期<input
            type="date"
            v-model="form.date"
            disabled
            required /></label
        ><label
          >室內溫度（°C）<input
            type="number"
            step="0.1"
            min="-99.9"
            max="99.9"
            v-model="form.temperature"
            required
        /></label>
      </div>
    </fieldset>
    <div
      class="gps-panel"
      data-testid="gps-panel"
      :data-gps-status="isNew ? gpsStatus : 'readonly'"
    >
      <strong>GPS 定位<small v-if="isNew">(必填)</small></strong>
      <template v-if="isNew">
        <span
          v-if="gpsStatus === 'loading' || gpsStatus === 'idle'"
          data-testid="gps-loading"
          role="status"
          >定位中…</span
        >
        <template v-else-if="gpsStatus === 'success' && form.gps">
          <span class="gps-ok">✓ 已定位</span>
          <a
            :href="`https://www.google.com/maps?q=${form.gps.latitude},${form.gps.longitude}`"
            target="_blank"
            rel="noopener noreferrer"
            >({{ form.gps.latitude.toFixed(6) }},
            {{ form.gps.longitude.toFixed(6) }})</a
          >
          <span data-testid="gps-accuracy" :class="{ 'gps-warn': gpsWarning }"
            >精度: ±{{ Math.round(form.gps.accuracy) }}m{{
              gpsWarning ? " (建議使用手機)" : ""
            }}</span
          >
        </template>
        <span v-else class="gps-fail" data-testid="gps-error" role="alert"
          >✗ {{ gpsError }}</span
        >
        <div class="module-actions">
          <button
            v-if="gpsStatus === 'error'"
            type="button"
            data-testid="gps-retry"
            @click="locate"
          >
            重新定位
          </button>
        </div>
        <p class="muted" data-testid="gps-hint">
          {{
            gpsMobile
              ? "💡 所有人新增巡店都必須先定位成功（誤差需在 1000 公尺內），請開啟「精確位置」。"
              : "💡 所有人新增巡店都必須先定位成功（誤差需在 1000 公尺內）。桌機使用 WiFi 定位亦可，但實際巡店建議用手機開啟此頁面以獲得精確 GPS 座標。"
          }}
        </p>
        <button
          type="button"
          class="gps-link"
          data-testid="gps-guide-link"
          @click="gpsGuideOpen = true"
        >
          定位開不了？看教學
        </button>
      </template>
      <template v-else>
        <span v-if="form.gps" data-testid="gps-readonly"
          >{{ form.gps.latitude.toFixed(5) }},
          {{ form.gps.longitude.toFixed(5) }} · 精度
          {{ Math.round(form.gps.accuracy) }} 公尺</span
        ><span v-else class="muted">此巡店沒有定位紀錄。</span>
        <p class="muted">
          定位與巡店日期為第一次建立時的紀錄，編輯時不會更新。
        </p>
      </template>
    </div>
    <fieldset :disabled="disabled">
      <legend>當班人員</legend>
      <div class="module-actions">
        <button type="button" @click="loadRoster" :disabled="!form.store">
          加入上月在職名冊</button
        ><button
          type="button"
          @click="
            form.staff.push({
              employee_code: '',
              employee_name: '',
              position: '',
              is_duty_supervisor: false,
              is_manually_added: true,
            })
          "
        >
          手動新增人員
        </button>
      </div>
      <div class="module-table">
        <table>
          <thead>
            <tr>
              <th>員編</th>
              <th>姓名</th>
              <th>職位</th>
              <th>當班督導</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(s, i) in form.staff" :key="i">
              <td>
                <input
                  v-model="s.employee_code"
                  :aria-label="`人員 ${Number(i) + 1} 員編`"
                  maxlength="20"
                />
              </td>
              <td>
                <input
                  v-model="s.employee_name"
                  :aria-label="`人員 ${Number(i) + 1} 姓名`"
                  required
                  maxlength="100"
                />
              </td>
              <td>
                <input
                  v-model="s.position"
                  :aria-label="`人員 ${Number(i) + 1} 職位`"
                  maxlength="50"
                />
              </td>
              <td>
                <input
                  type="checkbox"
                  v-model="s.is_duty_supervisor"
                  :aria-label="`人員 ${Number(i) + 1} 當班督導`"
                />
              </td>
              <td>
                <button type="button" @click="form.staff.splice(i, 1)">
                  移除
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <p v-if="!form.staff.length" class="muted">尚未加入本次當班人員。</p>
    </fieldset>
    <div class="inspection-summary">
      <strong>總分 {{ scoreResult.value?.total ?? "—" }} / 220</strong
      ><span>評級 {{ scoreResult.value?.grade ?? "—" }} / 10</span
      ><span>扣分 {{ scoreResult.value?.deduction ?? "—" }}</span>
    </div>
    <p v-if="scoreResult.error" class="notice error">{{ scoreResult.error }}</p>
    <fieldset :disabled="disabled">
      <legend>巡店檢查項目</legend>
      <details
        v-for="[key, section] in sections"
        :key="key"
        open
        class="inspection-section"
      >
        <summary>{{ section.name }} · {{ section.items.length }} 項</summary>
        <section
          v-for="t in section.items"
          :key="t.id"
          class="inspection-score-item"
        >
          <h3>
            {{ t.item_name }} <small>滿分 {{ t.max_score }}</small>
            <small v-if="t.is_active === false" class="tag" data-testid="template-disabled"
              >已停用</small
            >
          </h3>
          <p class="muted">{{ t.item_description }}</p>
          <div
            v-for="o in t.checklist_items || []"
            :key="o.label"
            class="inspection-check"
          >
            <label
              ><input
                type="checkbox"
                :value="o.label"
                v-model="score(t.id).checked_items"
              />{{ o.label }}（扣 {{ o.deduction }} 分{{
                o.requires_quantity ? " / " + (o.unit || "件") : ""
              }}）</label
            ><label
              v-if="
                o.requires_quantity &&
                score(t.id).checked_items.includes(o.label)
              "
              >數量<input
                type="number"
                min="1"
                step="1"
                :aria-label="o.label + '數量'"
                :value="score(t.id).quantities[o.label] || 1"
                @input="
                  setQuantity(
                    t.id,
                    o.label,
                    ($event.target as HTMLInputElement).value,
                  )
                "
            /></label>
          </div>
          <label
            >改善建議 / 備註<textarea
              v-model="score(t.id).notes"
              maxlength="4000"
              rows="2"
              :aria-label="t.item_name + '備註'"
            />
          </label>
          <InspectionPhotoCapture
            :photos="score(t.id).photos"
            :name="t.item_name"
            @add="addPhoto(t.id, $event)"
            @remove="removePhoto(t.id, $event)"
            @error="error = $event"
          />
        </section>
      </details>
    </fieldset>
    <fieldset :disabled="disabled">
      <legend>巡店備註與簽名</legend>
      <label
        >巡店備註<textarea v-model="form.notes" maxlength="8000" rows="4" />
      </label>
      <div class="module-form-grid">
        <SignatureInput
          v-model="form.signature"
          label="店長／當班主管確認簽名"
          :disabled="disabled"
        /><SignatureInput
          v-model="form.supervisorSignature"
          label="督導簽名"
          :disabled="disabled"
        />
      </div>
    </fieldset>
    <div class="module-actions">
      <button type="button" @click="save('draft')" :disabled="disabled">
        儲存草稿</button
      ><button class="primary" :disabled="disabled">提交巡店</button>
    </div>
  </form>
  <GpsGuideDialog
    v-if="gpsGuideOpen"
    :failure-kind="gpsStatus === 'error' ? gpsKind : null"
    :failure-message="gpsStatus === 'error' ? gpsError : ''"
    @close="gpsGuideOpen = false"
    @retry="retryFromGuide"
  />
  <Modal
    v-if="restorePrompt && !restoreDeleteConfirm"
    title="發現未完成的暫存內容"
    ><p data-testid="restore-info">
      這台裝置上有你在 {{ restoreInfo?.savedAt }} 暫存的巡店內容（含照片與簽名），
      保留到 {{ restoreInfo?.expires }}（共 {{ DRAFT_TTL_DAYS }} 天）。要還原嗎？
    </p>
    <p v-if="restoreInfo?.serverMoved" class="notice error" role="alert">
      注意：伺服器上的這張草稿在暫存之後已被其他裝置更新過，還原後再儲存會以你的暫存內容為準。
    </p>
    <div class="dialog-actions">
      <button type="button" data-testid="restore-no" @click="restoreDeleteConfirm = true">
        不還原</button
      ><button type="button" class="primary" data-testid="restore-yes" @click="applyRestore">
        還原暫存
      </button>
    </div></Modal
  ><Modal v-if="restorePrompt && restoreDeleteConfirm" title="確定刪除暫存？"
    ><p>
      刪除後無法復原，暫存的照片、簽名與填寫內容都會消失。確定不要還原嗎？
    </p>
    <div class="dialog-actions">
      <button type="button" data-testid="restore-back" @click="restoreDeleteConfirm = false">
        返回，我要還原</button
      ><button type="button" class="primary" data-testid="restore-delete" @click="deleteRestore">
        確定刪除
      </button>
    </div></Modal
  ><Modal v-if="staffConfirm" title="換成新門市的當班人員？"
    ><p data-testid="staff-confirm-text">
      你已手動修改過當班人員（新增人員、勾選當班督導或改過名單）。換門市會把名單整份換成新門市的上月在職名單，手動填的資料會被清掉。
    </p>
    <div class="dialog-actions">
      <button type="button" data-testid="staff-keep" @click="cancelStaffReplace">
        取消，維持原門市</button
      ><button type="button" class="primary" data-testid="staff-replace" @click="confirmStaffReplace">
        換成新名單
      </button>
    </div></Modal
  ><Modal
    v-if="submitConfirm"
    title="提交巡店"
    :busy="tab.busy"
    @cancel="submitConfirm = false"
    ><p>提交後將完成此巡店，不能繼續編輯。請確認評分、當班人員及附件。</p>
    <div class="dialog-actions">
      <button @click="submitConfirm = false" :disabled="tab.busy">
        返回檢查</button
      ><button class="primary" @click="save('completed')" :disabled="tab.busy">
        確認提交
      </button>
    </div></Modal
  ><Modal v-if="failed" title="巡店尚未儲存" @cancel="failed = false"
    ><p>{{ error }}</p>
    <p>表單內容仍保留，請修正或稍後重試。</p>
    <div class="dialog-actions">
      <button @click="failed = false">返回編輯</button>
    </div></Modal
  >
</template>
