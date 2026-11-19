'use strict';
/**
 * 產生「差異確認頁」單檔 HTML（只放待確認與已排定要修的條目）。
 *   node scripts/allowlist-review/build.cjs <輸出.html> [--doc <docId>] [--allowlist <path>] [--plain <path>] [--date YYYY-MM-DD]
 */
const fs = require('node:fs');
const path = require('node:path');
const L = require('./lib.cjs');

const OTHER_TOPIC = '_other';

function buildData(list, plain, docId) {
  const topicTitles = new Map(plain.topics.map((t) => [t.key, t.title]));
  const item = (e) => {
    const p = plain.items[e.id] || {};
    return {
      id: e.id, page: e.page, description: e.description, reason: e.reason, fixIn: e.fixIn || null,
      topic: p.topic && topicTitles.has(p.topic) ? p.topic : OTHER_TOPIC,
      title: p.title || e.description.slice(0, 40), legacy: p.legacy || '', now: p.now || '', impact: p.impact || '', why: p.why || '',
      hasPlain: !!plain.items[e.id],
    };
  };
  const items = list.filter(L.isPending).map(item);
  const topics = plain.topics.filter((t) => items.some((i) => i.topic === t.key)).map((t) => ({ key: t.key, title: t.title }));
  if (items.some((i) => i.topic === OTHER_TOPIC)) topics.push({ key: OTHER_TOPIC, title: '其他（尚未寫白話說明）' });
  return { docId, topics, items, fixed: list.filter(L.isFix).map(item) };
}

/** 內嵌 JSON：< 轉義，避免 </script> 提早結束；另處理 U+2028/2029。 */
function embedJson(obj) {
  return JSON.stringify(obj).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
}

const TEMPLATE = String.raw`<!doctype html>
<html lang="zh-Hant">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>差異確認頁</title>
<style>
:root {
  --bg: #f5f7f6; --surface: #ffffff; --ink: #17211e; --muted: #5b6a65; --line: #d9e1de;
  --accent: #0d6b57; --accent-ink: #ffffff; --accent-soft: #e2f0eb;
  --warn-bg: #fff1d6; --warn-fg: #8a5300; --revert-soft: #fde8e6; --discuss-soft: #fff1d6;
  --ok: #1f7a4d; --err: #b3261e;
  --f-display: "Noto Serif TC", "Songti TC", serif;
  --f-body: "Noto Sans TC", "PingFang TC", "Microsoft JhengHei", system-ui, sans-serif;
  --f-mono: ui-monospace, Consolas, monospace;
}
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) {
  --bg: #111816; --surface: #172220; --ink: #e3ebe8; --muted: #9aaba5; --line: #2b3a36;
  --accent: #5cc7a8; --accent-ink: #0b1714; --accent-soft: #1d3a32; --warn-bg: #3d2f12; --warn-fg: #f3c56b;
  --revert-soft: #3d1f1c; --discuss-soft: #3d2f12; --ok: #6fd3a0; --err: #ff8a80; color-scheme: dark; } }
:root[data-theme="dark"] {
  --bg: #111816; --surface: #172220; --ink: #e3ebe8; --muted: #9aaba5; --line: #2b3a36;
  --accent: #5cc7a8; --accent-ink: #0b1714; --accent-soft: #1d3a32; --warn-bg: #3d2f12; --warn-fg: #f3c56b;
  --revert-soft: #3d1f1c; --discuss-soft: #3d2f12; --ok: #6fd3a0; --err: #ff8a80; color-scheme: dark; }
* { box-sizing: border-box; }
html { -webkit-text-size-adjust: 100%; }
body { margin: 0; background: var(--bg); color: var(--ink); font-family: var(--f-body); font-size: 15.5px; line-height: 1.7; overflow-x: hidden; }
.wrap { max-width: 880px; margin: 0 auto; padding-left: max(16px, env(safe-area-inset-left, 0px)); padding-right: max(16px, env(safe-area-inset-right, 0px)); }
header { background: var(--surface); border-bottom: 1px solid var(--line); }
header .wrap { padding-block: 30px 24px; display: grid; gap: 12px; }
h1 { font-family: var(--f-display); font-weight: 800; font-size: clamp(26px, 4vw, 36px); line-height: 1.25; margin: 0; }
.lede { margin: 0; color: var(--muted); max-width: 66ch; }
main .wrap { padding-block: 24px 190px; display: grid; gap: 32px; grid-template-columns: minmax(0, 1fr); }
h2 { font-family: var(--f-display); font-weight: 800; font-size: 22px; margin: 0 0 6px; padding-top: 10px; border-top: 2px solid var(--ink); }
.section-note { margin: 0 0 14px; color: var(--muted); font-size: 14px; }
.card { background: var(--surface); border: 1px solid var(--line); border-radius: 10px; padding: 16px 18px; display: grid; gap: 10px; min-width: 0; }
.card h3 { font-size: 17px; margin: 0; line-height: 1.5; overflow-wrap: anywhere; }
.card.fixed { border-left: 4px solid var(--warn-fg); }
.tag { display: inline-block; font-size: 12px; font-weight: 700; padding: 0 8px; border-radius: 999px; background: var(--warn-bg); color: var(--warn-fg); margin-left: 6px; vertical-align: 1px; }
.group { display: grid; gap: 12px; min-width: 0; }
.group-head { display: flex; flex-wrap: wrap; gap: 8px 14px; align-items: center; justify-content: space-between; border-top: 2px solid var(--ink); padding-top: 10px; }
.group-head h2 { border: 0; padding: 0; margin: 0; font-size: 20px; overflow-wrap: anywhere; }
.group-head .count { color: var(--muted); font-size: 14px; }
.facts { display: grid; gap: 6px; margin: 0; }
.facts div { display: grid; grid-template-columns: 3.2em minmax(0, 1fr); gap: 8px; }
.facts dt { color: var(--muted); font-size: 13.5px; font-weight: 700; }
.facts dd { margin: 0; overflow-wrap: anywhere; }
details.raw { font-size: 13.5px; color: var(--muted); }
details.raw summary { cursor: pointer; }
details.raw p { margin: 6px 0 0; overflow-wrap: anywhere; }
details.raw code { font-family: var(--f-mono); font-size: 12.5px; }
.choices { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; border: 0; margin: 0; padding: 0; min-width: 0; }
@media (max-width: 560px) { .choices { grid-template-columns: minmax(0, 1fr); } }
.opt { display: grid; grid-template-columns: 20px minmax(0, 1fr); gap: 8px; align-items: start; padding: 9px 11px; border: 1px solid var(--line); border-radius: 8px; cursor: pointer; font-size: 14.5px; }
.opt:hover { border-color: var(--accent); }
.opt input { margin: 4px 0 0; width: 16px; height: 16px; accent-color: var(--accent); }
.opt:has(input:checked) { border-color: var(--accent); background: var(--accent-soft); }
.opt.revert:has(input:checked) { border-color: var(--err); background: var(--revert-soft); }
.opt.discuss:has(input:checked) { border-color: var(--warn-fg); background: var(--discuss-soft); }
.opt:has(input:focus-visible) { outline: 2px solid var(--accent); outline-offset: 2px; }
label.note-l { font-size: 13px; color: var(--muted); display: grid; gap: 4px; }
textarea { width: 100%; min-height: 52px; resize: vertical; font: inherit; font-size: 14px; color: var(--ink); background: var(--bg); border: 1px solid var(--line); border-radius: 8px; padding: 8px 10px; }
textarea:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
button { font: inherit; border-radius: 8px; cursor: pointer; }
button.primary { font-weight: 700; background: var(--accent); color: var(--accent-ink); border: 0; padding: 10px 22px; }
button.ghost { background: transparent; color: var(--accent); border: 1px solid var(--accent); padding: 7px 14px; font-size: 14px; }
button.link { background: none; border: 0; color: var(--muted); font-size: 13px; padding: 0; text-decoration: underline; justify-self: start; }
button:disabled { opacity: .5; cursor: not-allowed; }
button:focus-visible { outline: 2px solid var(--ink); outline-offset: 2px; }
.bar { position: fixed; left: 0; right: 0; bottom: 0; background: var(--surface); border-top: 1px solid var(--line); padding-bottom: env(safe-area-inset-bottom, 0px); }
.bar .wrap { display: grid; gap: 8px; padding-block: 10px; }
.progress { display: grid; gap: 4px; }
.progress-text { font-size: 14px; font-weight: 700; }
.track { height: 8px; border-radius: 999px; background: var(--line); overflow: hidden; }
.fill { height: 100%; width: 0; background: var(--accent); transition: width .2s; }
.bar-row { display: flex; flex-wrap: wrap; gap: 8px 12px; align-items: center; justify-content: space-between; }
.status { font-size: 14px; color: var(--muted); flex: 1 1 220px; min-width: 0; overflow-wrap: anywhere; }
.status.ok { color: var(--ok); } .status.err { color: var(--err); }
.btns { display: flex; gap: 8px; }
.stack { display: grid; gap: 12px; }
</style>
</head>
<body>
<header><div class="wrap">
  <h1>差異確認頁</h1>
  <p class="lede" id="lede"></p>
</div></header>
<main><div class="wrap">
  <section>
    <h2>已排定要修（不用回答）</h2>
    <p class="section-note">這幾項已經決定要改回跟舊版一樣，只是讓你知道，不需要選。</p>
    <div id="fixed" class="stack"></div>
  </section>
  <section>
    <h2>請你決定</h2>
    <p class="section-note">每一項三選一：同意（新版這樣就好）、要改回跟舊版一樣、要再討論。不確定可以先不選，之後再回來填。按「暫存」可以先存起來分次填。</p>
    <div id="groups" class="stack" style="gap:32px"></div>
  </section>
  <section>
    <h2>整體備註</h2>
    <label class="note-l">想補充的話（選填）<textarea id="general" rows="3"></textarea></label>
  </section>
</div></main>
<div class="bar"><div class="wrap">
  <div class="progress">
    <div class="progress-text" id="ptext"></div>
    <div class="track"><div class="fill" id="pfill"></div></div>
  </div>
  <div class="bar-row">
    <span class="status" id="status" role="status"></span>
    <div class="btns">
      <button type="button" class="ghost" id="btn-draft">暫存</button>
      <button type="button" class="primary" id="btn-submit">送出</button>
    </div>
  </div>
</div></div>
<script id="review-data" type="application/json">__DATA__</script>
<script>
(function () {
  var data = JSON.parse(document.getElementById('review-data').textContent);
  var $ = function (id) { return document.getElementById(id); };
  function el(tag, attrs, text) {
    var n = document.createElement(tag);
    if (attrs) for (var k in attrs) n.setAttribute(k, attrs[k]);
    if (text != null) n.textContent = text;
    return n;
  }
  var CHOICES = [['approve', '同意差異'], ['revert', '要改回跟舊版一樣'], ['discuss', '要再討論']];
  var answers = {}, groupNotes = {}, dirty = false, savedState = {};
  var radios = {}, notes = {}, counters = {}, groupNoteEls = {};

  $('lede').textContent = '新版和舊版有 ' + (data.items.length + data.fixed.length) + ' 處不一樣，其中 ' + data.fixed.length +
    ' 處已排定要修，還有 ' + data.items.length + ' 處需要你決定。每一項都用白話寫了舊版怎樣、新版怎樣、有什麼影響。看不懂的可以點「展開看細節」。';

  function facts(it) {
    var dl = el('dl', { class: 'facts' });
    [['舊版', it.legacy], ['新版', it.now], ['影響', it.impact], ['原因', it.why]].forEach(function (r) {
      if (!r[1]) return;
      var d = el('div'); d.appendChild(el('dt', null, r[0])); d.appendChild(el('dd', null, r[1])); dl.appendChild(d);
    });
    return dl;
  }
  function raw(it) {
    var d = el('details', { class: 'raw' });
    d.appendChild(el('summary', null, '展開看細節'));
    var p1 = el('p'); p1.appendChild(el('b', null, '原文說明：')); p1.appendChild(document.createTextNode(it.description)); d.appendChild(p1);
    var p2 = el('p'); p2.appendChild(el('b', null, '原因：')); p2.appendChild(document.createTextNode(it.reason)); d.appendChild(p2);
    var p3 = el('p'); p3.appendChild(el('b', null, '頁面：')); p3.appendChild(el('code', null, it.page)); d.appendChild(p3);
    var p4 = el('p'); p4.appendChild(el('b', null, 'id：')); p4.appendChild(el('code', null, it.id)); d.appendChild(p4);
    return d;
  }

  data.fixed.forEach(function (it) {
    var c = el('div', { class: 'card fixed' });
    var h = el('h3', null, it.title); h.appendChild(el('span', { class: 'tag' }, '已排定要修，修在 ' + (it.fixIn || '未指定')));
    c.appendChild(h); c.appendChild(facts(it)); c.appendChild(raw(it));
    $('fixed').appendChild(c);
  });

  var allIds = data.items.map(function (i) { return i.id; });
  function decidedIn(ids) { return ids.filter(function (id) { return answers[id] && answers[id].choice; }).length; }
  function setChoice(id, choice) {
    var a = answers[id] || (answers[id] = { choice: '', note: '' });
    a.choice = choice;
    if (radios[id]) radios[id].forEach(function (r) { r.checked = r.value === choice; });
    dirty = true; refresh();
  }

  data.topics.forEach(function (tp) {
    var its = data.items.filter(function (i) { return i.topic === tp.key; });
    var ids = its.map(function (i) { return i.id; });
    var g = el('section', { class: 'group' });
    var head = el('div', { class: 'group-head' });
    var left = el('div');
    left.appendChild(el('h2', null, tp.title));
    var cnt = el('span', { class: 'count' }); left.appendChild(cnt); counters[tp.key] = { el: cnt, ids: ids };
    head.appendChild(left);
    var allBtn = el('button', { type: 'button', class: 'ghost', title: '還沒選的項目全部設為同意，已選的不動' }, '整組同意');
    allBtn.addEventListener('click', function () { ids.forEach(function (id) { if (!(answers[id] && answers[id].choice)) setChoice(id, 'approve'); }); });
    head.appendChild(allBtn);
    g.appendChild(head);
    its.forEach(function (it) {
      var c = el('div', { class: 'card', id: 'i-' + it.id });
      c.appendChild(el('h3', null, it.title));
      c.appendChild(facts(it)); c.appendChild(raw(it));
      var fs = el('fieldset', { class: 'choices' });
      radios[it.id] = [];
      CHOICES.forEach(function (ch) {
        var lab = el('label', { class: 'opt ' + ch[0] });
        var inp = el('input', { type: 'radio', name: 'c-' + it.id, value: ch[0] });
        inp.addEventListener('change', function () { setChoice(it.id, ch[0]); });
        radios[it.id].push(inp);
        lab.appendChild(inp); lab.appendChild(el('span', null, ch[1])); fs.appendChild(lab);
      });
      c.appendChild(fs);
      var clr = el('button', { type: 'button', class: 'link' }, '清除選擇');
      clr.addEventListener('click', function () { setChoice(it.id, ''); });
      c.appendChild(clr);
      var nl = el('label', { class: 'note-l' }, '備註（選填）');
      var ta = el('textarea', { rows: '2' });
      ta.addEventListener('input', function () { (answers[it.id] || (answers[it.id] = { choice: '', note: '' })).note = ta.value; dirty = true; });
      nl.appendChild(ta); notes[it.id] = ta; c.appendChild(nl);
      g.appendChild(c);
    });
    var gl = el('label', { class: 'note-l' }, '這一組的備註（選填）');
    var gta = el('textarea', { rows: '2' });
    gta.addEventListener('input', function () { groupNotes[tp.key] = gta.value; dirty = true; });
    gl.appendChild(gta); groupNoteEls[tp.key] = gta; g.appendChild(gl);
    $('groups').appendChild(g);
  });
  $('general').addEventListener('input', function () { dirty = true; });

  function refresh() {
    var total = allIds.length, n = decidedIn(allIds);
    $('ptext').textContent = '已決定 ' + n + ' / ' + total;
    $('pfill').style.width = (total ? Math.round(n * 100 / total) : 0) + '%';
    Object.keys(counters).forEach(function (k) {
      var c = counters[k]; c.el.textContent = '共 ' + c.ids.length + ' 項，已決定 ' + decidedIn(c.ids) + ' 項';
    });
  }

  var status = $('status'), bSubmit = $('btn-submit'), bDraft = $('btn-draft');
  function setStatus(text, cls) { status.textContent = text; status.className = 'status' + (cls ? ' ' + cls : ''); }
  function fmt(iso) { try { return new Date(iso).toLocaleString('zh-TW', { hour12: false }); } catch (e) { return String(iso); } }
  var dbRef = null;
  function setBusy(b) { bSubmit.disabled = b || !dbRef; bDraft.disabled = b || !dbRef; }

  function fill(saved) {
    if (!saved) return;
    var a = saved.answers || {};
    data.items.forEach(function (it) {
      var s = a[it.id]; if (!s) return;
      var okChoice = CHOICES.some(function (c) { return c[0] === s.choice; }) ? s.choice : '';
      answers[it.id] = { choice: okChoice, note: typeof s.note === 'string' ? s.note : '' };
      if (radios[it.id]) radios[it.id].forEach(function (r) { r.checked = r.value === answers[it.id].choice; });
      if (typeof s.note === 'string' && s.note) notes[it.id].value = s.note;
    });
    var gn = saved.groupNotes || {};
    Object.keys(groupNoteEls).forEach(function (k) { if (typeof gn[k] === 'string' && gn[k]) { groupNotes[k] = gn[k]; groupNoteEls[k].value = gn[k]; } });
    if (typeof saved.general === 'string' && saved.general) $('general').value = saved.general;
    refresh();
  }

  function collect() {
    var out = {};
    allIds.forEach(function (id) {
      var a = answers[id];
      if (a && (a.choice || (a.note || '').trim())) out[id] = { choice: a.choice || '', note: (a.note || '').trim() };
    });
    var gn = {};
    Object.keys(groupNotes).forEach(function (k) { if ((groupNotes[k] || '').trim()) gn[k] = groupNotes[k].trim(); });
    return { answers: out, groupNotes: gn, general: $('general').value.trim() };
  }

  async function save(kind) {
    if (!dbRef) return;
    if (kind === 'submit') {
      var undecided = allIds.length - decidedIn(allIds);
      if (undecided > 0 && !window.confirm('還有 ' + undecided + ' 項沒有選，送出後這些會視為「未決定」。仍要送出嗎？')) return;
    }
    var body = collect(), at = new Date().toISOString();
    body.entryIds = allIds.slice();
    body.submittedAt = kind === 'submit' ? at : (savedState.submittedAt || null);
    body.savedAt = at;
    body.status = kind === 'submit' ? 'submitted' : 'draft';
    setBusy(true); setStatus(kind === 'submit' ? '送出中…' : '暫存中…');
    try {
      await dbRef.set(body);
      savedState = body; dirty = false;
      setStatus(kind === 'submit' ? '已送出（' + fmt(at) + '）。回到 Claude Code 告訴我「差異確認好了」。' : '已暫存（' + fmt(at) + '），還沒送出。', 'ok');
    } catch (e) {
      setStatus((kind === 'submit' ? '送出' : '暫存') + '失敗：' + (e && e.message ? e.message : '請稍後再試') + '。你的選擇仍保留在頁面上，可以再按一次。', 'err');
    }
    setBusy(false);
  }
  bSubmit.addEventListener('click', function () { save('submit'); });
  bDraft.addEventListener('click', function () { save('draft'); });
  window.addEventListener('beforeunload', function (ev) { if (dirty) { ev.preventDefault(); ev.returnValue = ''; } });

  refresh(); setBusy(true);
  setStatus('正在連線…');
  (async function () {
    var db = null;
    try { db = window.claude && window.claude.use ? await window.claude.use('db') : null; } catch (e) { db = null; }
    if (!db) { setStatus('目前是離線預覽，只能看不能送出。請從 claude.ai 開啟這個頁面才能暫存或送出。', 'err'); return; }
    dbRef = db.doc('allowlist-review/' + data.docId);
    try {
      var snap = await dbRef.get();
      if (snap && snap.exists) {
        var s = snap.data(); savedState = s || {}; fill(s);
        setStatus(s && s.status === 'submitted' ? '已在 ' + fmt(s.submittedAt) + ' 送出，可修改後重新送出' : '已讀回先前暫存的答案（' + fmt(s && s.savedAt) + '）', 'ok');
      } else setStatus('尚未暫存或送出');
    } catch (e) { setStatus('讀取先前的答案失敗，仍可直接填寫。', 'err'); }
    setBusy(false);
  })();
})();
</script>
</body>
</html>
`;

function render(data) {
  return TEMPLATE.replace('__DATA__', () => embedJson(data));
}

function main() {
  const { positional, flags } = L.parseArgs(process.argv.slice(2), ['--doc', '--allowlist', '--plain', '--date']);
  if (!positional[0]) throw new Error('用法：build.cjs <輸出.html> [--doc <docId>] [--allowlist <path>] [--plain <path>]');
  const list = L.readJson(flags.allowlist || L.DEFAULT_ALLOWLIST);
  const plain = L.loadPlain(flags.plain || L.DEFAULT_PLAIN);
  const docId = flags.doc || `review-${flags.date || L.todayLocal()}`;
  const data = buildData(list, plain, docId);
  const out = path.resolve(positional[0]);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, render(data), 'utf8');
  const noPlain = [...data.items, ...data.fixed].filter((i) => !i.hasPlain).length;
  process.stdout.write(JSON.stringify({ out, docId, items: data.items.length, fixed: data.fixed.length, topics: data.topics.length, withoutPlain: noPlain }) + '\n');
}

if (require.main === module) {
  try { main(); } catch (e) { process.stderr.write(`錯誤：${e.message}\n`); process.exit(1); }
}
module.exports = { buildData, render, embedJson };
