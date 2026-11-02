<script setup lang="ts">
import { ref, onMounted } from "vue";
import { api } from "../api";
import { useWorkspace, type WorkTab } from "../stores";
const props = defineProps<{ tab: WorkTab }>(),
  work = useWorkspace(),
  data = ref<any>(null),
  error = ref(""),
  loading = ref(false),
  section = ref("templates");
async function load() {
  loading.value = true;
  error.value = "";
  try {
    data.value = await api("inspection-settings");
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    loading.value = false;
  }
}
function edit(kind: string, id?: string) {
  const tab = work.open("inspection-setting-edit", "", id);
  tab.payload = { kind };
}
onMounted(load);
</script>
<template>
  <header class="page-heading">
    <div>
      <p class="eyebrow">巡店 / 管理設定</p>
      <h1>巡店範本與計分設定</h1>
      <p class="muted">設定檢查項目、評級門檻及改善回補規則。</p>
    </div>
    <button @click="load" :disabled="loading">重新整理</button>
  </header>
  <p v-if="error" role="alert" class="notice error">{{ error }}</p>
  <p v-if="loading" role="status">載入設定…</p>
  <div class="filter-bar">
    <label
      >設定類別<select aria-label="設定類別" v-model="section">
        <option value="templates">檢查項目</option>
        <option value="grades">評級對照</option>
        <option value="bonus">改善回補</option>
      </select></label
    >
  </div>
  <template v-if="data && !loading"
    ><template v-if="section === 'templates'"
      ><div class="list-meta">
        <span
          >啟用 {{ data.templates.filter((t: any) => t.is_active).length }} 項 ·
          巡店起始總分固定 220 分</span
        ><button class="primary" @click="edit('template')">新增檢查項目</button>
      </div>
      <div class="module-table">
        <table>
          <thead>
            <tr>
              <th>區塊 / 排序</th>
              <th>檢查項目</th>
              <th>滿分</th>
              <th>缺失選項</th>
              <th>狀態</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="t in data.templates" :key="t.id">
              <td>
                {{ t.section_name }} / {{ t.section_order }}–{{ t.item_order }}
              </td>
              <td>
                <strong>{{ t.item_name }}</strong>
                <p>{{ t.item_description }}</p>
              </td>
              <td>{{ t.max_score }}</td>
              <td>{{ t.checklist_items?.length || 0 }}</td>
              <td>{{ t.is_active ? "啟用" : "停用" }}</td>
              <td><button @click="edit('template', t.id)">編輯項目</button></td>
            </tr>
            <tr v-if="!data.templates.length">
              <td colspan="6">尚未建立檢查項目。</td>
            </tr>
          </tbody>
        </table>
      </div></template
    ><template v-else-if="section === 'grades'"
      ><div class="list-meta">
        <p>新的巡店及後續分數變動使用此對照，既有分數不會批次重算。</p>
        <button class="primary" @click="edit('grades')">編輯評級對照</button>
      </div>
      <div class="module-table">
        <table>
          <thead>
            <tr>
              <th>評級</th>
              <th>最低分數</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="g in data.grades" :key="g.grade">
              <td>{{ g.grade }}</td>
              <td>{{ g.min_score }}</td>
            </tr>
          </tbody>
        </table>
      </div></template
    ><template v-else
      ><div class="list-meta">
        <p>依巡店日至回報日的天數，回補原扣分的百分比。</p>
        <button class="primary" @click="edit('bonus')">新增回補規則</button>
      </div>
      <div class="module-table">
        <table>
          <thead>
            <tr>
              <th>天數範圍</th>
              <th>回補比例</th>
              <th>說明</th>
              <th>狀態</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="b in data.bonus" :key="b.id">
              <td>{{ b.day_from }}–{{ b.day_to }} 天</td>
              <td>{{ b.bonus_score }}%</td>
              <td>{{ b.description }}</td>
              <td>{{ b.is_active ? "啟用" : "停用" }}</td>
              <td><button @click="edit('bonus', b.id)">編輯規則</button></td>
            </tr>
          </tbody>
        </table>
      </div></template
    ></template
  >
</template>
