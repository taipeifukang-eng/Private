<script setup lang="ts">
// M5 W20 Q6：活動檢視裡的店長／督導填報（本店人員、人力預估、前置 Check List 勾選與備註）。
// 沿用活動排程頁的門市編輯元件，只開放檢視端需要的區塊；實際能不能寫入由伺服器依舊版規則判斷
// （店長只能寫自己被任命的門市，督導依活動檢視範圍），這裡的 permissions 只決定畫面上顯示哪些按鈕。
import { ref } from "vue";
import Modal from "./Modal.vue";
import CampaignStoreEditor from "./CampaignStoreEditor.vue";
import type { WorkTab } from "../stores";

const props = defineProps<{
  campaign: any;
  store: { id: string; store_code: string; store_name: string };
  sections: string[];
  initial: string;
  permissions: Record<string, boolean>;
  tab: WorkTab;
}>();
const emit = defineEmits<{ close: [changed: boolean] }>();
const confirmDiscard = ref(false);
function requestClose() {
  if (props.tab.busy) return;
  if (props.tab.dirty) confirmDiscard.value = true;
  else done();
}
function done() {
  props.tab.dirty = false;
  emit("close", true);
}
</script>

<template>
  <Modal :title="store.store_code + ' ' + store.store_name + ' · 填報'" wide :busy="tab.busy" @cancel="requestClose">
    <div data-testid="activity-store-fill">
      <CampaignStoreEditor :campaign="campaign" :store="store" :stores="[]" :permissions="permissions" :tab="tab" :initial="initial" :sections="sections" />
      <div class="dialog-actions"><button :disabled="tab.busy" @click="requestClose">關閉填報</button></div>
    </div>
    <Modal v-if="confirmDiscard" title="放棄未儲存的填報？" @cancel="confirmDiscard = false">
      <p>尚未儲存的內容將被放棄。</p>
      <div class="dialog-actions">
        <button @click="confirmDiscard = false">繼續填報</button>
        <button class="danger" @click="confirmDiscard = false; done()">放棄並關閉</button>
      </div>
    </Modal>
  </Modal>
</template>
