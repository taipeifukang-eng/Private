<script setup lang="ts">
import { ref } from "vue";
import Modal from "../Modal.vue";
import ResourceAttachmentPanel from "./ResourceAttachmentPanel.vue";

// 請款單畫面每張帳單旁的「看掃描檔」：開一個視窗，用既有附件 API（簽名網址每次重新簽發）列出這張帳單的掃描檔與照片，點「開啟」看原檔。只讀，不能在這裡上傳或刪除。
defineProps<{ billId: string; label?: string }>();
const open = ref(false);
</script>
<template>
  <button type="button" class="link" data-testid="bill-scan-open" @click="open = true">看掃描檔</button>
  <Modal v-if="open" :title="'帳單掃描檔' + (label ? '：' + label : '')" wide @cancel="open = false">
    <ResourceAttachmentPanel resource-type="UTILITY_BILL" :resource-id="billId" purpose="BILL_DOCUMENT" title="帳單掃描檔與照片" :can-upload="false" :can-delete="false" />
    <div class="dialog-actions"><button type="button" class="primary" data-testid="bill-scan-close" @click="open = false">關閉</button></div>
  </Modal>
</template>
