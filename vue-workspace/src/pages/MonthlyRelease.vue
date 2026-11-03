<script setup lang="ts">
import { reactive } from "vue";
import type { WorkTab } from "../stores";
import { MONTHLY_RELEASES } from "../../../lib/workspace/monthly-release";

// W04：每月版更說明頁。內容來自 lib/workspace/monthly-release.ts 的期別陣列（最新在前）；
// 文字照搬舊版 /monthly-release，最新一期預設展開，其餘可點擊展開／收合。登入即可看，沒有任何資料請求。
defineProps<{ tab: WorkTab }>();

const releases = MONTHLY_RELEASES;
const open = reactive(new Set<string>(releases.length ? [releases[0].slug] : []));

function onToggle(slug: string, event: Event) {
  if ((event.target as HTMLDetailsElement).open) open.add(slug);
  else open.delete(slug);
}
function jump(slug: string) {
  open.add(slug);
  requestAnimationFrame(() => document.getElementById(`release-${slug}`)?.scrollIntoView({ block: "start" }));
}
</script>

<template>
  <header class="page-heading">
    <div>
      <p class="eyebrow">MONTHLY RELEASE</p>
      <h1>每月版更內容</h1>
    </div>
  </header>

  <section class="release-list-card" data-release-index>
    <div class="release-list-head">
      <div>
        <h2>月份清單</h2>
        <p class="muted">之後只要新增月份資料，即可持續累積每月公告內容。</p>
      </div>
      <span class="release-pill" data-release-count>共 {{ releases.length }} 期</span>
    </div>
    <div class="release-list">
      <button v-for="(release, index) in releases" :key="release.slug" type="button" class="release-link" :data-release-link="release.slug" @click="jump(release.slug)">
        <span>
          <strong>{{ release.monthLabel }}</strong>
          <small>{{ release.title }}</small>
        </span>
        <span v-if="index === 0" class="release-pill solid">最新</span>
      </button>
    </div>
  </section>

  <details
    v-for="(release, index) in releases"
    :id="`release-${release.slug}`"
    :key="release.slug"
    class="release"
    :data-release="release.slug"
    :open="open.has(release.slug)"
    @toggle="onToggle(release.slug, $event)"
  >
    <summary class="release-summary">
      <div class="release-banner">
        <div class="release-banner-top">
          <span class="release-tag" data-release-eyebrow>{{ release.eyebrow }}</span>
          <span class="release-tag" data-release-state>{{ index === 0 ? "最新公告" : "點擊展開" }}</span>
        </div>
        <div class="release-banner-main">
          <div>
            <h2 data-release-title>{{ release.title }}</h2>
            <p data-release-summary>{{ release.summary }}</p>
          </div>
          <span class="release-month"><span data-release-month>{{ release.monthLabel }}</span><span class="chevron" aria-hidden="true">⌄</span></span>
        </div>
      </div>
    </summary>

    <div class="release-body">
      <section v-for="section in release.sections" :key="section.title" class="release-section" :class="{ highlight: section.style === 'highlight' }" data-release-section>
        <h3 data-section-title>{{ section.title }}</h3>
        <p v-for="paragraph in section.paragraphs" :key="paragraph" data-section-paragraph>{{ paragraph }}</p>
        <ol v-if="section.items" :class="section.style === 'cards' ? 'cards' : 'plain'" :data-section-style="section.style === 'cards' ? 'cards' : 'list'">
          <li v-for="item in section.items" :key="item" data-section-item>{{ item }}</li>
        </ol>
      </section>
    </div>
  </details>
</template>

<style scoped>
.release-list-card,.release{max-width:900px;margin:0 0 20px;border:1px solid var(--line);border-radius:16px;background:var(--surface)}
.release-list-card{padding:18px}
.release-list-head{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:14px}
.release-list-head h2{font-size:18px;margin:0}
.release-list-head p{margin:4px 0 0}
.release-pill{flex:none;border-radius:999px;background:var(--soft);color:var(--primary);padding:3px 12px;font-size:12px;font-weight:600}
.release-pill.solid{background:var(--primary);color:var(--surface)}
.release-list{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}
.release-link{display:flex;align-items:center;justify-content:space-between;gap:12px;text-align:left;border-radius:12px;padding:14px;background:var(--canvas)}
.release-link strong{display:block;font-size:14px}
.release-link small{display:block;margin-top:4px;color:var(--muted);line-height:1.6}
.release{overflow:hidden}
.release-summary{cursor:pointer;list-style:none}
.release-summary::-webkit-details-marker{display:none}
.release-banner{padding:24px 28px;background:var(--primary);color:var(--surface)}
.release-banner-top{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;margin-bottom:14px}
.release-tag{border-radius:999px;background:rgb(255 255 255 / 18%);padding:3px 12px;font-size:13px}
.release-banner-main{display:flex;align-items:flex-end;justify-content:space-between;gap:16px}
.release-banner h2{font-size:22px;line-height:1.4;margin:0}
.release-banner p{margin:12px 0 0;line-height:1.9;max-width:680px;opacity:.92}
.release-month{display:flex;align-items:center;gap:10px;flex:none;font-size:13px}
.chevron{display:inline-block;transition:transform .15s}
.release[open] .chevron{transform:rotate(180deg)}
.release-body{display:grid;gap:28px;padding:28px}
.release-section h3{font-size:18px;margin:0 0 14px}
.release-section.highlight{border:1px solid var(--line);border-radius:14px;background:var(--soft);padding:18px}
.release-section p{margin:10px 0 0;line-height:1.9}
.release-section p:first-of-type{margin-top:0}
.release-section ol{margin:0;line-height:1.9;overflow-wrap:anywhere}
.release-section ol.plain{display:grid;gap:12px;padding-left:24px}
.release-section ol.cards{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px;padding:0;list-style:none}
.release-section ol.cards li{border:1px solid var(--line);border-radius:12px;background:var(--canvas);padding:14px}
@media(max-width:700px){.release-list,.release-section ol.cards{grid-template-columns:1fr}.release-banner{padding:20px 16px}.release-banner-main{flex-direction:column;align-items:flex-start}.release-body{padding:20px 16px}.release-list-card{padding:14px}}
</style>
