#!/usr/bin/env node
/* M9 新權限勾選頁產生器。
 * 用法：node scripts/m9-perm-checklist/build.cjs [items.json] [role-inventory.json] [out.html]
 * items.json 與角色盤點 JSON 都放在 repo 外（含正式區資料），本程式只讀取、輸出單一 HTML。
 * 頁面送出時寫入 artifact db：survey/m9-permissions。 */
'use strict';
const fs = require('fs');
const path = require('path');

const DOC_ID = 'm9-permissions';
const SCRATCH = 'C:\\Users\\user\\AppData\\Local\\Temp\\claude\\36e794268116a3de\\898eeb0b-3421-41c5-b9bb-ca6fa1ac61a8\\scratchpad\\m9-review';
const DEFAULT_ITEMS = path.join(SCRATCH, 'perm-items.json');
const DEFAULT_INV = path.join(SCRATCH, 'prod-role-inventory-2026-11-24.json');
const DEFAULT_OUT = path.join(SCRATCH, 'm9-perm-checklist.html');

// 老闆已定「收緊」或「不是授權動作」的損失項，預設不補回（仍可手動勾）。
const NO_AUTO_RESTORE = /老闆已決定|老闆已核可|老闆已定|設計明定|補掛/;

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/** 每個權限的預設勾選角色 = 建議角色。 */
function defaultAnswers(items) {
  const out = {};
  for (const it of items) out[it.code] = { roles: [...(it.recommendRoles || [])], note: '' };
  return out;
}

/** 損失項預設：有對應權限卡時，只有該卡建議角色才預設補回；沒有對應卡時看文字是否為已定收緊。 */
function lossDefault(loss, items) {
  if (NO_AUTO_RESTORE.test(loss.what || '')) return false;
  const it = items.find((x) => x.code === loss.fixCode);
  if (it) return (it.recommendRoles || []).includes(loss.role);
  return true;
}

function defaultLosses(items, losses) {
  const out = {};
  for (const l of losses || []) {
    if (!lossDefault(l, items)) continue;
    (out[l.fixCode] = out[l.fixCode] || { roles: [] }).roles.push(l.role);
  }
  return out;
}

function roleList(inventory, items) {
  const roles = (inventory.roles || []).map((r) => ({
    code: r.code, name: r.name || r.code, members: Number(r.active_members) || 0, known: true,
  }));
  const seen = new Set(roles.map((r) => r.code));
  for (const it of items) {
    for (const c of [...(it.recommendRoles || []), ...(it.prodHolders || [])]) {
      if (!seen.has(c)) { seen.add(c); roles.push({ code: c, name: c, members: 0, known: false }); }
    }
  }
  return roles;
}

const CSS = String.raw`
:root{--bg:#f6f4ef;--card:#fff;--ink:#1d2433;--muted:#5a6475;--line:#d9d4c8;--accent:#1f5fbf;--accent-ink:#fff;--rec:#e3f0e4;--rec-ink:#1d5a2b;--danger:#b42318;--danger-bg:#fdecea;--warn:#8a5a00;--warn-bg:#fff4d6;--soft:#efece4}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){--bg:#14171d;--card:#1d222b;--ink:#e8ebf1;--muted:#a3adbd;--line:#363e4c;--accent:#6ea2f0;--accent-ink:#0d1624;--rec:#1d3a26;--rec-ink:#a5e0b4;--danger:#ff8a80;--danger-bg:#3a1d1b;--warn:#f2c46b;--warn-bg:#3a2f12;--soft:#262c37}}
:root[data-theme="dark"]{--bg:#14171d;--card:#1d222b;--ink:#e8ebf1;--muted:#a3adbd;--line:#363e4c;--accent:#6ea2f0;--accent-ink:#0d1624;--rec:#1d3a26;--rec-ink:#a5e0b4;--danger:#ff8a80;--danger-bg:#3a1d1b;--warn:#f2c46b;--warn-bg:#3a2f12;--soft:#262c37}
*{box-sizing:border-box}
html{-webkit-text-size-adjust:100%}
body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.7 "Noto Sans TC","PingFang TC","Microsoft JhengHei",system-ui,sans-serif;overflow-x:hidden}
.wrap{max-width:1100px;margin:0 auto;padding:0 16px}
header{padding:28px 0 8px}
.eyebrow{font-size:16px;color:var(--muted);font-weight:700}
h1{font-size:30px;line-height:1.3;margin:4px 0 12px}
h2{font-size:22px;margin:0 0 8px}
h3{font-size:18px;margin:0;line-height:1.45;overflow-wrap:anywhere}
p{margin:0 0 10px}
.intro{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:16px 18px;margin:12px 0}
.intro ul{margin:6px 0 0;padding-left:22px}
.intro li{margin:4px 0}
.red{color:var(--danger);font-weight:700}
.roles-strip{display:flex;flex-wrap:wrap;gap:8px;margin:10px 0 0;padding:0;list-style:none}
.roles-strip li{background:var(--soft);border:1px solid var(--line);border-radius:999px;padding:4px 12px;font-size:16px}
.roles-strip b{color:var(--accent)}
section.group{margin:32px 0}
.group>p.sum{color:var(--muted)}
.card{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:16px;margin:14px 0}
.card.sensitive{border:2px solid var(--danger)}
.card-head{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-bottom:6px}
code{font:16px/1.5 ui-monospace,Consolas,monospace;background:var(--soft);padding:1px 6px;border-radius:6px;overflow-wrap:anywhere;word-break:break-all}
.tag{display:inline-block;font-size:16px;font-weight:700;border-radius:6px;padding:0 8px}
.tag.sens{background:var(--danger-bg);color:var(--danger)}
.tag.missing{background:var(--warn-bg);color:var(--warn)}
.tag.rec{background:var(--rec);color:var(--rec-ink)}
.plain{font-size:17px;font-weight:700;margin:2px 0 8px}
.kv{margin:6px 0;color:var(--ink)}
.kv b{color:var(--muted)}
.risk{background:var(--warn-bg);border-radius:8px;padding:8px 12px}
.card.sensitive .risk{background:var(--danger-bg)}
.holders{color:var(--muted)}
fieldset{border:0;margin:10px 0 0;padding:0;min-width:0}
legend{font-weight:700;padding:0;margin-bottom:4px}
.role-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(250px,1fr));gap:6px}
label.opt{display:flex;gap:10px;align-items:flex-start;padding:8px 10px;border:1px solid var(--line);border-radius:8px;cursor:pointer;min-height:44px}
label.opt:has(input:checked){border-color:var(--accent);background:var(--soft)}
label.opt input{width:22px;height:22px;margin:2px 0 0;flex:none;accent-color:var(--accent)}
label.opt span{overflow-wrap:anywhere}
label.opt small{color:var(--muted);font-size:16px}
details{margin-top:8px}
summary{cursor:pointer;color:var(--accent);font-weight:700;min-height:32px}
textarea{width:100%;font:inherit;color:var(--ink);background:var(--bg);border:1px solid var(--line);border-radius:8px;padding:8px 10px;resize:vertical}
.note-l{display:block;margin-top:10px;font-weight:700}
.losses .card{border-left:6px solid var(--warn)}
.bar{position:sticky;bottom:0;background:var(--card);border-top:1px solid var(--line);padding:10px 0;margin-top:32px;z-index:5}
.bar .wrap{display:flex;gap:12px;align-items:center;flex-wrap:wrap}
.status{flex:1 1 240px;color:var(--muted);overflow-wrap:anywhere}
.status.ok{color:var(--rec-ink)}
.status.err{color:var(--danger);font-weight:700}
button.submit,button.copy{font:inherit;font-weight:700;background:var(--accent);color:var(--accent-ink);border:0;border-radius:10px;padding:10px 22px;min-height:44px;cursor:pointer}
button:disabled{opacity:.5;cursor:not-allowed}
#fallback{display:none;margin:16px 0}
#fallback textarea{font:16px/1.5 ui-monospace,Consolas,monospace;min-height:220px}
.notice{background:var(--danger-bg);color:var(--danger);border-radius:10px;padding:10px 14px;font-weight:700}
@media (max-width:600px){h1{font-size:25px}.role-grid{grid-template-columns:1fr}}
`;

const SCRIPT = String.raw`
(function(){
var form=document.getElementById('perm-form');
var statusEl=document.getElementById('status');
var btn=document.getElementById('submit');
function setStatus(t,c){statusEl.textContent=t;statusEl.className='status'+(c?' '+c:'')}
function fmt(i){try{return new Date(i).toLocaleString('zh-TW',{hour12:false})}catch(e){return i}}
function q(sel,root){return Array.prototype.slice.call((root||form).querySelectorAll(sel))}
function collect(){
  var answers={},losses={};
  q('.card[data-code]').forEach(function(card){
    var code=card.getAttribute('data-code');
    var roles=q('input.perm-cb:checked',card).map(function(i){return i.value});
    var note=(card.querySelector('textarea')||{value:''}).value.trim();
    answers[code]={roles:roles,note:note};
  });
  q('input.loss-cb:checked').forEach(function(i){
    var c=i.getAttribute('data-code');(losses[c]=losses[c]||{roles:[]}).roles.push(i.value);
  });
  var g=document.getElementById('note-general');
  return {answers:answers,losses:losses,general:g?g.value.trim():'',submittedAt:new Date().toISOString(),status:'submitted'};
}
function mirror(src){
  var code=src.getAttribute('data-code'),role=src.value;
  var other=src.classList.contains('loss-cb')?'input.perm-cb':'input.loss-cb';
  q(other).forEach(function(i){if(i.getAttribute('data-code')===code&&i.value===role)i.checked=src.checked});
}
form.addEventListener('change',function(e){var t=e.target;if(t&&t.matches&&t.matches('input.perm-cb,input.loss-cb'))mirror(t)});
function apply(v){
  if(!v)return;
  q('.card[data-code]').forEach(function(card){
    var code=card.getAttribute('data-code'),a=v.answers&&v.answers[code];if(!a)return;
    q('input.perm-cb',card).forEach(function(i){i.checked=(a.roles||[]).indexOf(i.value)>=0});
    var ta=card.querySelector('textarea');if(ta)ta.value=a.note||'';
  });
  if(v.losses){q('input.loss-cb').forEach(function(i){var l=v.losses[i.getAttribute('data-code')];i.checked=!!(l&&(l.roles||[]).indexOf(i.value)>=0)})}
  var g=document.getElementById('note-general');if(g&&v.general)g.value=v.general;
}
function showFallback(obj){
  var box=document.getElementById('fallback');box.style.display='block';
  var ta=document.getElementById('fallback-text');ta.value=JSON.stringify(obj,null,2);ta.focus();ta.select();
}
document.getElementById('copy').addEventListener('click',function(){
  var ta=document.getElementById('fallback-text');ta.select();
  try{navigator.clipboard.writeText(ta.value)}catch(e){document.execCommand&&document.execCommand('copy')}
});
var ref=null;
setStatus('正在連線…');
var timer=setTimeout(function(){if(!ref)setStatus('無法連線到儲存服務，仍可勾選，送出時會顯示可複製的結果。','err')},10000);
(async function(){
  var db=null;
  try{db=window.claude&&window.claude.use?await window.claude.use('db'):null}catch(e){db=null}
  clearTimeout(timer);
  if(!db){
    document.getElementById('nodb').style.display='block';
    setStatus('無法送出：目前沒有儲存服務。','err');return;
  }
  ref=db.doc('survey/m9-permissions');
  try{var s=await ref.get();if(s.exists){var v=s.data();apply(v);setStatus('已在 '+fmt(v.submittedAt)+' 送出，可修改後重新送出','ok')}else setStatus('尚未送出（已預先勾好建議）')}
  catch(e){setStatus('讀取先前答案失敗，仍可直接送出。','err')}
})();
form.addEventListener('submit',async function(ev){
  ev.preventDefault();
  var data=collect();
  if(!ref){showFallback(data);setStatus('無法送出：請把下方文字複製給 Claude。','err');return}
  btn.disabled=true;setStatus('送出中…');
  try{await ref.set(data);setStatus('已送出（'+fmt(data.submittedAt)+'）。回到 Claude 說「權限勾選好了」。','ok')}
  catch(e){setStatus('送出失敗：'+(e&&e.message?e.message:'請稍後再試')+'。勾選仍保留，可再按一次。','err');showFallback(data)}
  btn.disabled=false;
});
})();
`;

function roleBox(cls, code, role, checked, held) {
  const mem = role.members > 0 ? `${role.members} 人` : '0 人';
  return `<label class="opt"><input type="checkbox" class="${cls}" data-code="${esc(code)}" value="${esc(role.code)}"${checked ? ' checked' : ''}><span>${esc(role.name)} <small>${esc(role.code)}｜${mem}${held ? '｜已持有' : ''}</small></span></label>`;
}

function renderCard(it, roles, nameOf) {
  const rec = new Set(it.recommendRoles || []);
  const held = new Set(it.prodHolders || []);
  const main = roles.filter((r) => r.members > 0);
  const other = roles.filter((r) => r.members <= 0);
  const box = (r) => roleBox('perm-cb', it.code, r, rec.has(r.code), held.has(r.code));
  const holders = (it.prodHolders || []).length ? it.prodHolders.map(nameOf).join('、') : '（沒有任何角色）';
  const tags = [];
  if (it.sensitive) tags.push('<span class="tag sens">敏感</span>');
  if (!it.existsInProd) tags.push('<span class="tag missing">正式區尚無此碼</span>');
  if ((it.recommendRoles || []).length) tags.push('<span class="tag rec">已預先勾好建議</span>');
  else tags.push('<span class="tag rec">預設不勾</span>');
  return `<article class="card${it.sensitive ? ' sensitive' : ''}" data-code="${esc(it.code)}" id="c-${esc(it.code)}">
<div class="card-head"><h3><code>${esc(it.code)}</code></h3>${tags.join('')}</div>
<p class="plain">${esc(it.plain)}</p>
<p class="kv"><b>建議理由：</b>${esc(it.reason)}</p>
<p class="kv risk"><b>給錯或不給的風險：</b>${esc(it.risk)}</p>
${it.existsInProd ? '' : `<p class="kv"><b>建立方式：</b>${esc(it.createdByRunbookStep)}</p>`}
<p class="kv holders"><b>正式區目前持有角色：</b>${esc(holders)}</p>
<fieldset><legend>要給哪些角色</legend><div class="role-grid">${main.map(box).join('')}</div>
${other.length ? `<details><summary>其他角色（0 人，${other.length} 個）</summary><div class="role-grid">${other.map(box).join('')}</div></details>` : ''}
</fieldset>
<label class="note-l" for="n-${esc(it.code)}">補充（選填）</label><textarea id="n-${esc(it.code)}" rows="2"></textarea>
</article>`;
}

function renderLosses(losses, items, roles, nameOf, memberOf) {
  if (!losses.length) return '';
  const cards = losses.map((l) => {
    const checked = lossDefault(l, items);
    const rec = checked ? '<span class="tag rec">預設補回</span>' : '<span class="tag missing">預設不補（老闆已定或非授權動作）</span>';
    return `<article class="card"><div class="card-head"><h3>${esc(nameOf(l.role))}（${memberOf(l.role)} 人）</h3>${rec}</div>
<p class="kv">${esc(l.what)}</p>
<label class="opt"><input type="checkbox" class="loss-cb" data-code="${esc(l.fixCode)}" value="${esc(l.role)}"${checked ? ' checked' : ''}><span>補回：給「${esc(nameOf(l.role))}」<code>${esc(l.fixCode)}</code></span></label></article>`;
  }).join('\n');
  return `<section class="group losses" id="losses"><h2>新版會失去的能力</h2>
<p class="sum">以下是新版上線後，這些角色會比舊版少掉的事。勾選代表補回（也就是把對應權限給該角色），和下方權限卡的勾選會同步。</p>
${cards}</section>`;
}

function buildHtml({ items, losses = [], roleNotes = [], inventory }) {
  const roles = roleList(inventory, items);
  const byCode = new Map(roles.map((r) => [r.code, r]));
  const nameOf = (c) => (byCode.get(c) ? byCode.get(c).name : c);
  const memberOf = (c) => (byCode.get(c) ? byCode.get(c).members : 0);
  const modules = [];
  const mm = new Map();
  for (const it of items) {
    if (!mm.has(it.module)) { mm.set(it.module, []); modules.push(it.module); }
    mm.get(it.module).push(it);
  }
  const strip = roles.filter((r) => r.known).map((r) => `<li>${esc(r.name)} <b>${r.members}</b> 人</li>`).join('');
  const notes = roleNotes.map((n) => `<details><summary>${esc(nameOf(n.role))}（${esc(n.role)}）</summary><p>${esc(n.note)}</p></details>`).join('');
  const groups = modules.map((m) => `<section class="group"><h2>${esc(m)}</h2><p class="sum">${mm.get(m).length} 個權限</p>\n${mm.get(m).map((it) => renderCard(it, roles, nameOf)).join('\n')}</section>`).join('\n');
  return `<!doctype html>
<html lang="zh-Hant"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>新權限勾選</title>
<style>${CSS}</style></head>
<body>
<header><div class="wrap"><div class="eyebrow">M9 上線前</div><h1>新權限勾選</h1></div></header>
<main><div class="wrap">
<div class="intro"><p>這一頁讓老闆決定：新版用到的權限，要給哪些角色。</p><ul>
<li>新權限<b>只新增，不會自動給任何人</b>；沒勾就沒人有。</li>
<li>每一項的<b>建議已經預先勾好</b>，不改直接送出就是採用建議。</li>
<li><span class="red">紅框、標「敏感」</span>的權限會碰到金額、廠商帳務、刪除或強制結案，請特別看一眼。</li>
<li>下方每個角色都標了<b>正式區目前人數</b>；人數 0 的角色收在「其他角色」裡。請款付款兩項依你的決定預設都不勾。</li>
<li>「頁面回舊版開關」與「AI 語音用量設定」只有系統管理員能用，不是權限碼，不需要在這裡勾。</li>
<li>盤點的「看／匯入／刪除」三項各有一張卡；預設只維持正式區目前持有的角色，不多給。</li></ul>
<ul class="roles-strip">${strip}</ul>
<details><summary>各角色說明</summary>${notes}</details></div>
<div class="notice" id="nodb" style="display:none">目前沒有儲存服務，無法直接送出。按「送出」後會顯示一段可複製的文字，請貼給 Claude。</div>
<form id="perm-form" novalidate>
${renderLosses(losses, items, roles, nameOf, memberOf)}
${groups}
<section class="group"><h2>總補充</h2><label class="note-l" for="note-general">還有什麼想法或要特別注意的（選填）</label><textarea id="note-general" rows="3"></textarea></section>
<section id="fallback"><p class="notice">請複製下面全部文字，貼回給 Claude。</p><textarea id="fallback-text" readonly></textarea><p><button type="button" class="copy" id="copy">複製</button></p></section>
<div class="bar"><div class="wrap"><span class="status" id="status" role="status">尚未送出</span><button type="submit" class="submit" id="submit">送出</button></div></div>
</form></div></main>
<script>${SCRIPT}</script>
</body></html>
`;
}

function main(argv) {
  const [itemsPath = DEFAULT_ITEMS, invPath = DEFAULT_INV, outPath = DEFAULT_OUT] = argv;
  const cfg = JSON.parse(fs.readFileSync(itemsPath, 'utf8'));
  const inv = JSON.parse(fs.readFileSync(invPath, 'utf8'));
  const html = buildHtml({ items: cfg.items, losses: cfg.losses, roleNotes: cfg.roleNotes, inventory: { roles: (inv.roles || []).map((r) => ({ code: r.code, name: r.name, active_members: r.active_members })) } });
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, html);
  console.log(`items ${cfg.items.length} losses ${(cfg.losses || []).length} -> ${outPath}`);
}

module.exports = { buildHtml, defaultAnswers, defaultLosses, lossDefault, DOC_ID };
if (require.main === module) main(process.argv.slice(2));
