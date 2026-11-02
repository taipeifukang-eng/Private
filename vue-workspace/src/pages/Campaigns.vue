<script setup lang="ts">
import { ref, reactive, onMounted, watch } from "vue";
import { api, type Campaign } from "../api";
import { useWorkspace, useSession, type WorkTab } from "../stores";
import Modal from '../components/Modal.vue';
import CampaignEdit from './CampaignEdit.vue';
import CampaignConfiguration from '../components/CampaignConfiguration.vue';
import {campaignApi} from '../campaign-api';
const props=defineProps<{tab:WorkTab}>();
const editor=ref<WorkTab|null>(null),closeConfirm=ref(false),config=ref<'settings'|'events'|null>(null),deleting=ref<Campaign|null>(null),deleteBusy=ref(false);
function configure(mode:'settings'|'events'){edit();config.value=mode;}
async function remove(){if(!deleting.value)return;deleteBusy.value=true;error.value='';try{await api('campaigns?id='+deleting.value.id+'&version='+deleting.value.workspace_version,{method:'DELETE'});deleting.value=null;await load();}catch(e){error.value=(e as Error).message;}finally{deleteBusy.value=false;}}
function edit(id=''){config.value=null;editor.value=reactive({...props.tab,id:crypto.randomUUID(),recordId:id,kind:'campaign-edit' as const,dirty:false,busy:false,save:undefined,discard:undefined});}
function close(){if(editor.value?.busy)return;if(editor.value?.dirty)closeConfirm.value=true;else editor.value=null;}
watch(()=>[editor.value?.dirty,editor.value?.busy],()=>{props.tab.dirty=!!editor.value?.dirty;props.tab.busy=!!editor.value?.busy;props.tab.submitOnly=!!editor.value;},{flush:'sync'});
async function saved(){editor.value=null;await load();}
const work = useWorkspace(),
  session = useSession();
const rows = ref<Campaign[]>([]),
  q = ref(""),
  page = ref(1),
  total = ref(0),
  error = ref(""),
  loading = ref(false),
  stale = ref(false);
async function load(reset = false) {
  if (reset) page.value = 1;
  loading.value = true;
  error.value = "";
  try {
    const result = await api(
      `campaigns?${new URLSearchParams({ q: q.value, page: String(page.value) })}`,
    );
    rows.value = result.records;
    total.value = result.total;
    stale.value = false;
  } catch (e) {
    error.value = (e as Error).message;
    rows.value = [];
  } finally {
    loading.value = false;
  }
}
watch(
  () => work.campaignRevision,
  () => {
    stale.value = true;
  },
);
onMounted(() => load());
</script>
<template>
  <header class="page-heading">
    <div>
      <p class="eyebrow">營運排程 / 公司檔期</p>
      <h1>活動管理</h1>
      <p class="muted">管理活動檔期、門市排程與各部門規劃。</p>
    </div>
    <div class="campaign-actions"><button @click="configure('settings')">門市設定</button><button @click="configure('events')">特殊日期</button><button
      v-if="session.data?.capabilities.editCampaigns"
      class="primary"
      @click="edit()"
    >
      新增活動
    </button></div>
  </header>
  <div v-if="stale" class="notice">
    活動資料已更新。<button @click="load()">重新載入列表</button>
  </div>
  <form class="filter-bar" @submit.prevent="load(true)">
    <label class="grow"
      >活動名稱<input
        v-model="q"
        type="search"
        placeholder="輸入活動名稱"
        maxlength="100" /></label
    ><button :disabled="loading">查詢</button
    ><button type="button" @click="load()" :disabled="loading">重新整理</button>
  </form>
  <div v-if="error" class="notice error" role="alert">
    {{ error }} <button @click="load()">重試</button>
  </div>
  <div v-else-if="loading" class="empty" role="status">正在讀取活動…</div>
  <template v-else
    ><div class="list-meta">
      <strong>活動檔期</strong><span>{{ total }} 筆</span>
    </div>
    <div class="table-scroll">
      <table>
        <thead>
          <tr>
            <th>活動名稱</th>
            <th>期間</th>
            <th>類型</th>
            <th>狀態</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in rows" :key="row.id">
            <td>
              <strong>{{ row.name }}</strong>
            </td>
            <td>{{ row.start_date }} — {{ row.end_date }}</td>
            <td>{{ row.campaign_type === "inventory" ? "盤點" : "促銷" }}</td>
            <td>{{ row.is_active ? "啟用" : "停用" }}</td>
            <td>
              <button @click="edit(row.id)">
                {{ session.data?.capabilities.editCampaigns ? "編輯" : "查看" }}
              </button>
              <button @click="work.open('campaign-schedule', '', row.id)">
                活動規劃／排程
              </button><button v-if="session.data?.capabilities.editCampaigns" class="danger" @click="deleting=row">刪除活動</button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
    <div v-if="!rows.length" class="empty">
      <h2>沒有符合條件的活動</h2>
      <p>調整查詢條件，或新增一個活動檔期。</p>
    </div>
    <footer class="pagination">
      <span>第 {{ page }} / {{ Math.max(1, Math.ceil(total / 20)) }} 頁</span
      ><button
        :disabled="page <= 1"
        @click="
          page--;
          load();
        "
      >
        上一頁</button
      ><button
        :disabled="page * 20 >= total"
        @click="
          page++;
          load();
        "
      >
        下一頁
      </button>
    </footer></template
  >
<Modal v-if="editor" :title="config==='settings'?'門市活動設定':config==='events'?'特殊日期':editor.recordId?'編輯活動':'新增活動'" :busy="editor.busy" @cancel="close"><CampaignConfiguration v-if="config" :tab="editor" :mode="config" :can-edit="!!session.data?.capabilities.editCampaigns"/><CampaignEdit v-else :tab="editor" embedded @saved="saved"/><div class="dialog-actions"><button :disabled="editor.busy" @click="close">關閉</button></div></Modal>
<Modal v-if="deleting" title="刪除活動檔期？" :busy="deleteBusy" @cancel="deleting=null"><p>將刪除「{{deleting.name}}」及相關排程與規劃資料，此操作無法復原。</p><p v-if="error" role="alert" class="notice error">{{error}}</p><div class="dialog-actions"><button :disabled="deleteBusy" @click="deleting=null">取消</button><button :disabled="deleteBusy" class="danger" @click="remove">確認刪除活動</button></div></Modal>
<Modal v-if="closeConfirm" title="放棄活動修改？" @cancel="closeConfirm=false"><p>尚未儲存的活動內容將被放棄。</p><div class="dialog-actions"><button @click="closeConfirm=false">繼續編輯</button><button class="danger" @click="closeConfirm=false;editor=null">放棄修改</button></div></Modal>
</template>

<style scoped>.campaign-actions{display:flex;flex-wrap:wrap;gap:8px}td button{margin:3px}</style>
