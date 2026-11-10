<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { api } from "../../api";
import Modal from "../Modal.vue";
import AssetSitePicker from "./AssetSitePicker.vue";
import { storeLabel } from "../../lib/ga-assets";
import { assetNoun } from "../../lib/ga-transfers";
import { useDebounced, useLatest } from "../../lib/ga";

// 發起轉移單（總務）：選設備／設施 → 轉入門市 → 原因。只建單，不換店；要等轉出門市店長確認交出、轉入門市店長確認收到才正式換店。
// 從資產詳情進來時帶入 asset（直接填轉入門市與原因）；從轉移單頁進來時先搜尋要轉的設備或設施。
type Picked = { id: string; name: string; code: string | null; store_id: string; store: any; type: "EQUIPMENT" | "FACILITY" };
const props = defineProps<{ asset?: Picked | null; canEquipment: boolean; canFacility: boolean }>();
const emit = defineEmits<{ close: []; created: [info: { id: string; transfer_no: string; open_count: number }] }>();

const type = ref<"EQUIPMENT" | "FACILITY">(props.asset?.type || (props.canEquipment ? "EQUIPMENT" : "FACILITY"));
const picked = ref<Picked | null>(props.asset || null);
const search = ref("");
const debounced = useDebounced(search, 300);
const results = ref<Picked[]>([]);
const searching = ref(false);
const latest = useLatest();
const toStoreId = ref("");
const toStoreName = ref("");
const reason = ref("");
const note = ref("");
const error = ref("");
const busy = ref(false);
const openCount = ref<number | null>(null);

async function find() {
  if (picked.value) return;
  const n = latest.next();
  searching.value = true;
  try {
    const kind = type.value === "FACILITY" ? "facilities" : "equipment";
    const q = new URLSearchParams({ page: "1", pageSize: "8" });
    if (debounced.value.trim()) q.set("search", debounced.value.trim());
    const res = await api<{ data: any[] }>(`general-affairs/${kind}?` + q);
    if (!latest.isLatest(n)) return;
    results.value = res.data
      .filter((r) => r.status !== (type.value === "FACILITY" ? "RETIRED" : "SCRAPPED"))
      .map((r) => ({ id: r.id, name: r.name, code: r.asset_code || r.facility_code || null, store_id: r.store_id, store: r.store, type: type.value }));
  } catch (e) {
    if (latest.isLatest(n)) error.value = (e as Error).message;
  } finally {
    if (latest.isLatest(n)) searching.value = false;
  }
}
watch([debounced, type], find, { immediate: true });

async function pick(r: Picked) {
  picked.value = r;
  error.value = "";
  await loadOpen();
}
async function loadOpen() {
  if (!picked.value) return;
  try {
    const kind = picked.value.type === "FACILITY" ? "facilities" : "equipment";
    openCount.value = (await api<{ data: { open_count: number } }>(`general-affairs/${kind}/${picked.value.id}/open-orders`)).data.open_count;
  } catch {
    openCount.value = null;
  }
}
if (props.asset) loadOpen();

const sameStore = computed(() => !!picked.value && !!toStoreId.value && toStoreId.value === picked.value.store_id);
async function submit() {
  if (!picked.value || busy.value) return;
  if (!toStoreId.value) { error.value = "請選擇轉入門市"; return; }
  if (sameStore.value) { error.value = "轉入門市與目前所屬門市相同"; return; }
  if (!reason.value.trim()) { error.value = "請輸入轉移原因"; return; }
  busy.value = true;
  error.value = "";
  try {
    const res = await api<{ data: { id: string; transfer_no: string; open_count: number } }>("general-affairs/transfers", {
      method: "POST", body: JSON.stringify({ assetType: picked.value.type, assetId: picked.value.id, toStoreId: toStoreId.value, reason: reason.value.trim(), note: note.value.trim() || null }),
    });
    emit("created", res.data);
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <Modal title="發起轉移單" :busy="busy" @cancel="emit('close')">
    <p class="muted">轉移單送出後不會馬上換店：要等「轉出門市店長確認交出」與「轉入門市店長確認收到」，收到那一刻才正式換店；QR 標籤沿用，不用重貼。</p>
    <template v-if="!picked">
      <div class="row">
        <label>類型<select v-model="type" aria-label="轉移類型"><option v-if="canEquipment" value="EQUIPMENT">設備</option><option v-if="canFacility" value="FACILITY">設施</option></select></label>
        <label class="grow">搜尋{{ assetNoun(type) }}<input v-model="search" type="search" placeholder="名稱或編號" aria-label="搜尋要轉移的資產" /></label>
      </div>
      <ul class="results" aria-label="可轉移的資產">
        <li v-for="r in results" :key="r.id">
          <div><strong>{{ r.name }}</strong><small>{{ r.code || "尚無編號" }} · {{ storeLabel(r.store) }}</small></div>
          <button type="button" :aria-label="`選擇 ${r.name}`" @click="pick(r)">選這個</button>
        </li>
        <li v-if="!results.length && !searching" class="muted">沒有符合的{{ assetNoun(type) }}（已報廢或已退役的不能轉移）</li>
      </ul>
    </template>
    <template v-else>
      <p class="picked" data-testid="transfer-picked"><strong>{{ picked.name }}</strong>（{{ picked.code || "尚無編號" }}）<br />目前所屬：{{ storeLabel(picked.store) }}
        <button v-if="!asset" type="button" class="link" @click="picked = null; openCount = null">重新選擇</button></p>
      <AssetSitePicker v-model="toStoreId" label="轉入門市" required @select="(s) => (toStoreName = s ? `${s.store_code} ${s.short_name || s.store_name}` : '')" />
      <p v-if="toStoreId" class="notice" role="status">{{ storeLabel(picked.store) }} → {{ toStoreName }}</p>
      <p v-if="openCount" class="notice" role="status">目前有 {{ openCount }} 張未結案單；依規定，進行中的報修單與工單換店後仍屬原門市。</p>
      <label>轉移原因（必填）<input v-model="reason" maxlength="200" aria-label="轉移原因" /></label>
      <label>備註（選填）<textarea v-model="note" maxlength="500" rows="2" aria-label="轉移備註" /></label>
    </template>
    <p v-if="error" class="field-error" role="alert">{{ error }}</p>
    <div class="dialog-actions">
      <button type="button" :disabled="busy" @click="emit('close')">取消</button>
      <button v-if="picked" type="button" class="primary" :disabled="busy" @click="submit">{{ busy ? "送出中…" : "送出轉移單" }}</button>
    </div>
  </Modal>
</template>

<style scoped>
.row { display: flex; gap: 10px; flex-wrap: wrap; }
.grow { flex: 1; min-width: 180px; }
.results { list-style: none; margin: 10px 0 0; padding: 0; display: grid; gap: 8px; }
.results li { display: flex; justify-content: space-between; align-items: center; gap: 10px; border: 1px solid var(--line); border-radius: 8px; padding: 8px 10px; }
.results small { display: block; color: var(--muted); }
.picked { border: 1px solid var(--line); border-radius: 8px; padding: 10px; margin: 8px 0; overflow-wrap: anywhere; }
.link { border: 0; background: none; color: var(--primary); text-decoration: underline; min-height: 0; padding: 0 6px; }
textarea { width: 100%; }
</style>
