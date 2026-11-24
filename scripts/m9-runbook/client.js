/* 正式區上線操作頁：前端腳本（由 build.cjs 內嵌進 HTML，不使用外部腳本）。 */
(function () {
  'use strict';
  var DATA = JSON.parse(document.getElementById('rb-data').textContent);
  var DOC_PATH = 'runbook/progress-2026-12-07';
  var LS_KEY = 'm9-runbook-progress-2026-12-07';
  var steps = DATA.steps;
  var byId = {};
  steps.forEach(function (s) { byId[s.id] = s; });
  var state = {}; // stepId -> {done, verified, note, at}

  /* ---------- 小工具 ---------- */
  function h(tag, attrs) {
    var el = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        var v = attrs[k];
        if (v === null || v === undefined || v === false) return;
        if (k === 'class') el.className = v;
        else if (k === 'text') el.textContent = v;
        else el.setAttribute(k, v === true ? '' : v);
      });
    }
    for (var i = 2; i < arguments.length; i++) {
      var c = arguments[i];
      if (c === null || c === undefined || c === false) continue;
      el.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    }
    return el;
  }
  function $(id) { return document.getElementById(id); }
  function lsGet() { try { return JSON.parse(localStorage.getItem(LS_KEY) || 'null'); } catch (e) { return null; } }
  function lsSet() { try { localStorage.setItem(LS_KEY, JSON.stringify(state)); } catch (e) { /* 無法使用本機儲存時略過 */ } }
  function withTimeout(p, ms) {
    return new Promise(function (resolve, reject) {
      var t = setTimeout(function () { reject(new Error('timeout')); }, ms);
      Promise.resolve(p).then(function (v) { clearTimeout(t); resolve(v); }, function (e) { clearTimeout(t); reject(e); });
    });
  }
  function fmtTime(iso) {
    try { return new Date(iso).toLocaleString('zh-TW', { hour12: false }); } catch (e) { return iso; }
  }
  function isComplete(id) { var s = state[id]; return !!(s && s.done && s.verified); }

  /* ---------- 複製 ---------- */
  function copyText(text, btn) {
    function ok() {
      var old = btn.textContent;
      btn.textContent = '已複製';
      btn.classList.add('copied');
      setTimeout(function () { btn.textContent = old; btn.classList.remove('copied'); }, 1800);
    }
    function fallback() {
      var ta = h('textarea', { 'aria-hidden': 'true', style: 'position:fixed;left:-9999px;top:0' });
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      var done = false;
      try { done = document.execCommand('copy'); } catch (e) { done = false; }
      document.body.removeChild(ta);
      if (done) ok(); else { btn.textContent = '複製失敗，請手動選取'; }
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(ok, fallback);
    } else fallback();
  }

  /* ---------- SQL 區塊 ---------- */
  function sqlBlock(b, opts) {
    opts = opts || {};
    var pre = h('pre', { tabindex: '0' }, h('code', { text: b.sql }));
    var btn = h('button', { type: 'button', class: 'copy' }, '複製這段 SQL');
    btn.addEventListener('click', function () { copyText(b.sql, btn); });
    return h('figure', { class: 'sql' + (opts.cls ? ' ' + opts.cls : '') },
      h('figcaption', null,
        h('span', { class: 'cap-main' }, h('strong', { text: b.label }), b.file ? h('span', { class: 'file', text: b.file }) : null),
        btn),
      b.note ? h('p', { class: 'cap-note', text: b.note }) : null,
      pre);
  }
  function section(title, cls) {
    return h('section', { class: 'sec ' + (cls || '') }, h('h4', { text: title }));
  }
  function stopBox(s) {
    return h('div', { class: 'stop', role: 'alert' },
      h('strong', { class: 'stop-h', text: '停下來' }),
      h('div', null, h('b', { text: s.title }), h('p', { text: s.body })));
  }
  function cautionBox(text) { return h('div', { class: 'caution' }, h('b', { text: '注意　' }), text); }

  /* ---------- 卡片本體（展開才建立） ---------- */
  function buildBody(s) {
    var body = h('div', { class: 'body-inner' });
    (s.stops || []).filter(function (x) { return x.where !== 'verify'; }).forEach(function (x) { body.appendChild(stopBox(x)); });
    (s.cautions || []).forEach(function (c) { body.appendChild(cautionBox(c)); });

    var bk = s.blocks.backup || [];
    if (s.backupText || bk.length) {
      var sec = section('先做：備份', 'sec-backup');
      if (s.backupText) sec.appendChild(h('p', { text: s.backupText }));
      bk.forEach(function (b) { sec.appendChild(sqlBlock(b)); });
      body.appendChild(sec);
    }
    var pv = s.blocks.preview || [];
    if (pv.length) {
      var sec2 = section('先看：套用前預覽（只有 SELECT，不改資料）', 'sec-preview');
      pv.forEach(function (b) { sec2.appendChild(sqlBlock(b)); });
      if (s.previewJudge) sec2.appendChild(h('p', { class: 'judge', text: s.previewJudge }));
      body.appendChild(sec2);
    }
    var main = s.blocks.main || [];
    if (main.length) {
      var sec3 = section(s.kind === 'readonly' ? '貼上執行（唯讀查詢）' : '主要 SQL（在正式區 SQL Editor 貼上執行）', 'sec-main');
      if (main.length > 1) sec3.appendChild(h('p', { class: 'hint', text: '這一步有 ' + main.length + ' 份檔案，請一份一份貼上、執行、看結果，再貼下一份。' }));
      main.forEach(function (b) { sec3.appendChild(sqlBlock(b)); });
      body.appendChild(sec3);
    }
    var cm = s.blocks.commit || [];
    if (cm.length) {
      var sec4 = section('這份檔案開頭是 BEGIN;，要另外 COMMIT', 'sec-commit');
      sec4.appendChild(h('p', { text: s.commitText }));
      cm.forEach(function (b) { sec4.appendChild(sqlBlock(b)); });
      body.appendChild(sec4);
    }
    var vf = s.blocks.verify || [];
    if (vf.length || s.expect || s.manualText) {
      var sec5 = section(s.kind === 'manual' ? '怎麼做' : '執行後檢查', 'sec-verify');
      if (s.manualText) sec5.appendChild(h('p', { class: 'manual', text: s.manualText }));
      vf.forEach(function (b) { sec5.appendChild(sqlBlock(b)); });
      if (s.expect) sec5.appendChild(h('div', { class: 'expect' }, h('b', { text: '看到什麼才算對　' }), s.expect));
      (s.stops || []).filter(function (x) { return x.where === 'verify'; }).forEach(function (x) { sec5.appendChild(stopBox(x)); });
      body.appendChild(sec5);
    }
    var rb = s.blocks.rollback || [];
    if (rb.length || s.rollbackText) {
      var d = h('details', { class: 'rollback' }, h('summary', { text: '撤回（出事才用，先問 Claude；預設收合）' }));
      if (s.rollbackText) d.appendChild(h('p', { text: s.rollbackText }));
      rb.forEach(function (b) { d.appendChild(sqlBlock(b, { cls: 'sql-rollback' })); });
      body.appendChild(d);
    }
    return body;
  }

  function kindClass(k) { return { readonly: 'k-ro', add: 'k-add', modify: 'k-mod', addmodify: 'k-mod', manual: 'k-man' }[k] || 'k-man'; }

  function buildCard(s) {
    var card = h('article', { class: 'step', id: 'step-' + s.id, 'data-id': s.id });
    var tags = h('span', { class: 'tags' },
      h('span', { class: 'tag ' + kindClass(s.kind), text: s.kindLabel }),
      s.optional ? h('span', { class: 'tag t-opt', text: '選用' }) : null,
      (s.stops && s.stops.length) ? h('span', { class: 'tag t-stop', text: '有停止點' }) : null,
      s.readmeNo ? h('span', { class: 'tag t-ref', text: 'README 第 ' + s.readmeNo + ' 步' }) : null,
      h('span', { class: 'tag t-min', text: '約 ' + s.minutes + ' 分' }));
    var head = h('button', { type: 'button', class: 'head', 'aria-expanded': 'false', 'aria-controls': 'body-' + s.id },
      h('span', { class: 'seq', text: String(s.no) }),
      h('span', { class: 'hd' }, h('span', { class: 'ttl', text: s.title }), tags),
      h('span', { class: 'status-chip', 'data-chip': s.id, text: '未做' }),
      h('span', { class: 'chev', 'aria-hidden': 'true', text: '展開' }));
    var bodyBox = h('div', { class: 'body', id: 'body-' + s.id, hidden: true });
    head.addEventListener('click', function () { toggle(card, s); });

    var cbDone = h('input', { type: 'checkbox', id: 'cd-' + s.id });
    var cbVer = h('input', { type: 'checkbox', id: 'cv-' + s.id });
    var note = h('textarea', { id: 'nt-' + s.id, rows: '2', placeholder: '備註（例如：執行時間、看到的數字、遇到的狀況）', 'aria-label': '第 ' + s.no + ' 步備註' });
    var foot = h('div', { class: 'foot' },
      h('label', { class: 'chk' }, cbDone, h('span', { text: '已完成' })),
      h('label', { class: 'chk' }, cbVer, h('span', { text: '檢查通過' })),
      note);
    cbDone.addEventListener('change', function () { setField(s.id, 'done', cbDone.checked); });
    cbVer.addEventListener('change', function () { setField(s.id, 'verified', cbVer.checked); });
    note.addEventListener('change', function () { setField(s.id, 'note', note.value); });

    card.appendChild(head);
    card.appendChild(h('p', { class: 'what', text: s.what }));
    card.appendChild(bodyBox);
    card.appendChild(foot);
    return card;
  }

  function toggle(card, s, force) {
    var head = card.querySelector('.head');
    var box = card.querySelector('.body');
    var open = force === undefined ? head.getAttribute('aria-expanded') !== 'true' : force;
    if (open && !box.firstChild) box.appendChild(buildBody(s));
    head.setAttribute('aria-expanded', open ? 'true' : 'false');
    head.querySelector('.chev').textContent = open ? '收合' : '展開';
    if (open) box.removeAttribute('hidden'); else box.setAttribute('hidden', '');
  }

  /* ---------- 狀態寫入 ---------- */
  function setField(id, field, value) {
    var cur = state[id] || { done: false, verified: false, note: '', at: '' };
    if (cur[field] === value) return; // 沒改變就不寫
    var next = { done: !!cur.done, verified: !!cur.verified, note: cur.note || '', at: new Date().toISOString() };
    next[field] = value;
    state[id] = next;
    lsSet();
    refreshStep(id);
    refreshProgress();
    queueSave(id);
  }
  function refreshStep(id) {
    var s = state[id] || { done: false, verified: false, note: '' };
    var cd = $('cd-' + id), cv = $('cv-' + id), nt = $('nt-' + id);
    if (cd && cd.checked !== !!s.done) cd.checked = !!s.done;
    if (cv && cv.checked !== !!s.verified) cv.checked = !!s.verified;
    if (nt && nt.value !== (s.note || '') && document.activeElement !== nt) nt.value = s.note || '';
    var chip = document.querySelector('[data-chip="' + id + '"]');
    var card = $('step-' + id);
    var label = '未做', cls = '';
    if (s.done && s.verified) { label = '已完成、已檢查'; cls = 'is-ok'; }
    else if (s.done) { label = '已做，待檢查'; cls = 'is-half'; }
    if (chip) { chip.textContent = label; chip.className = 'status-chip ' + cls; }
    if (card) { card.classList.toggle('is-ok', cls === 'is-ok'); card.classList.toggle('is-half', cls === 'is-half'); }
  }
  function refreshProgress() {
    var req = steps.filter(function (s) { return !s.optional; });
    var okReq = req.filter(function (s) { return isComplete(s.id); }).length;
    var doneAll = steps.filter(function (s) { return isComplete(s.id); }).length;
    $('prog-text').textContent = '必做 ' + okReq + ' / ' + req.length + ' 步完成（全部 ' + steps.length + ' 步中已完成 ' + doneAll + '）';
    $('prog-bar').style.width = (req.length ? Math.round(okReq * 100 / req.length) : 0) + '%';
    $('prog-bar').parentNode.setAttribute('aria-valuenow', String(okReq));
    $('prog-bar').parentNode.setAttribute('aria-valuemax', String(req.length));
    DATA.stages.forEach(function (st) {
      var el = document.querySelector('[data-stage-count="' + st.id + '"]');
      if (!el) return;
      var ids = st.stepIds.filter(function (i) { return !byId[i].optional; });
      var n = ids.filter(isComplete).length;
      el.textContent = ids.length ? n + '/' + ids.length : '選用';
      el.classList.toggle('all', ids.length > 0 && n === ids.length);
    });
  }

  /* ---------- 雲端同步（db capability；沒有就只存本機） ---------- */
  var cloud = { ref: null, exists: false, inflight: false, dirty: {}, timer: null, retry: null, failed: false, unsub: null };
  function setSync(kind, extra) {
    var el = $('sync');
    var txt = {
      connecting: '正在連線雲端儲存…',
      synced: '進度已存到雲端（換手機或重開也在）',
      saving: '儲存中…',
      local: '雲端儲存不可用：進度只記在這台裝置',
      slow: '雲端暫時連不上：已先記在這台裝置，連上後自動補存',
      fail: '雲端儲存失敗：已先記在這台裝置'
    }[kind] || '';
    if (extra) txt += extra;
    el.textContent = txt;
    var det = $('sync-detail');
    if (det) {
      det.hidden = !(kind === 'local' || kind === 'slow' || kind === 'fail');
      det.textContent = kind === 'local' ? '目前無法使用雲端儲存，進度只記在這台裝置的瀏覽器：換手機、換瀏覽器或清除瀏覽資料，勾選就會不見。請不要靠它換裝置接力，重要進度另外截圖或記在備註。' : '雲端那邊暫時沒存成功。勾選與備註已先記在這台裝置，網路恢復後會自動補存；也可以按上方的「重試儲存到雲端」。';
    }
    el.className = 'sync sync-' + kind;
    var rb = $('sync-retry');
    rb.hidden = kind !== 'fail' && kind !== 'slow';
  }
  function mergeRemote(data) {
    var rs = (data && data.steps) || {};
    var changed = [], needPush = false;
    Object.keys(rs).forEach(function (id) {
      if (!byId[id]) return;
      var r = rs[id], l = state[id];
      if (!l || (r.at || '') > (l.at || '')) { state[id] = { done: !!r.done, verified: !!r.verified, note: r.note || '', at: r.at || '' }; changed.push(id); }
    });
    Object.keys(state).forEach(function (id) {
      var r = rs[id], l = state[id];
      if (!r || (l.at || '') > (r.at || '')) { cloud.dirty[id] = true; needPush = true; }
    });
    if (changed.length) { lsSet(); changed.forEach(refreshStep); refreshProgress(); }
    return needPush;
  }
  function queueSave(id) {
    if (!cloud.ref) return;
    cloud.dirty[id] = true;
    clearTimeout(cloud.timer);
    cloud.timer = setTimeout(flush, 500); // 連續操作合併成一次寫入
  }
  async function flush() {
    if (!cloud.ref || cloud.inflight) return;
    var ids = Object.keys(cloud.dirty);
    if (!ids.length) return;
    cloud.inflight = true; // 同一份文件一次只寫一筆：要等這筆真的結束（成功或失敗）才放行下一筆
    cloud.dirty = {};
    setSync('saving');
    var p;
    try {
      if (cloud.exists) {
        var patch = {};
        ids.forEach(function (id) { patch[id] = state[id]; });
        p = cloud.ref.update({ steps: patch });
      } else {
        p = cloud.ref.set({ steps: JSON.parse(JSON.stringify(state)) });
      }
    } catch (e0) { p = Promise.reject(e0); }
    p = Promise.resolve(p);
    try {
      await withTimeout(p, 10000);
      cloud.exists = true;
      cloud.failed = false;
      setSync('synced');
    } catch (e) {
      var timedOut = !!(e && e.message === 'timeout');
      ids.forEach(function (id) { cloud.dirty[id] = true; });
      cloud.failed = true;
      setSync(timedOut ? 'slow' : 'fail');
      // 逾時時原本那筆可能還在路上：等它結束再放行，避免兩筆同時寫同一份文件
      if (timedOut) { try { await p; cloud.exists = true; cloud.failed = false; setSync('synced'); } catch (e2) { /* 維持 slow／fail */ } }
    }
    cloud.inflight = false;
    if (!cloud.failed && Object.keys(cloud.dirty).length) flush();
    else if (cloud.failed) scheduleRetry();
  }
  function scheduleRetry() {
    clearTimeout(cloud.retry);
    cloud.retry = setTimeout(function () { cloud.failed = false; flush(); }, 20000); // 連不上時每 20 秒自動再試一次
  }
  async function initCloud() {
    setSync('connecting');
    var db = null;
    try {
      db = (window.claude && typeof window.claude.use === 'function') ? await withTimeout(window.claude.use('db'), 10000) : null;
    } catch (e) { db = null; }
    if (!db) { setSync('local'); return; }
    try { cloud.ref = db.doc(DOC_PATH); } catch (e) { cloud.ref = null; setSync('local'); return; }
    var first = true;
    var slowTimer = setTimeout(function () { setSync('slow'); }, 10000);
    try {
      cloud.unsub = cloud.ref.onSnapshot(function (snap) {
        clearTimeout(slowTimer);
        var needPush = false;
        if (snap.exists) { cloud.exists = true; needPush = mergeRemote(snap.data()); }
        else if (Object.keys(state).length) { Object.keys(state).forEach(function (id) { cloud.dirty[id] = true; }); needPush = true; }
        if (first) { first = false; if (!needPush) setSync('synced'); }
        if (needPush && !cloud.inflight) flush();
      }, function () {
        clearTimeout(slowTimer);
        cloud.failed = true;
        setSync('fail');
      });
    } catch (e) { clearTimeout(slowTimer); setSync('local'); }
  }

  /* ---------- 版面 ---------- */
  function buildLayout() {
    var nav = $('stage-nav');
    DATA.stages.forEach(function (st) {
      var a = h('a', { href: '#stage-' + st.id, class: 'stage-link' },
        h('span', { class: 'sl-t', text: st.short }),
        h('span', { class: 'sl-c', 'data-stage-count': st.id, text: '' }));
      nav.appendChild(a);
    });
    var host = $('steps');
    DATA.stages.forEach(function (st) {
      var sec = h('section', { class: 'stage', id: 'stage-' + st.id },
        h('h2', { text: st.title }),
        st.intro ? h('p', { class: 'stage-intro', text: st.intro }) : null);
      st.stepIds.forEach(function (id) { sec.appendChild(buildCard(byId[id])); });
      host.appendChild(sec);
    });
    var stopList = $('stop-list');
    DATA.stopList.forEach(function (x) {
      stopList.appendChild(h('li', null, h('a', { href: '#step-' + x.stepId, text: '第 ' + x.no + ' 步　' + x.stepTitle }), '：' + x.title));
    });
  }
  function openStep(id) {
    var card = $('step-' + id);
    if (!card) return;
    toggle(card, byId[id], true);
    card.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
  function nextIncomplete() {
    for (var i = 0; i < steps.length; i++) {
      if (!steps[i].optional && !isComplete(steps[i].id)) return steps[i].id;
    }
    return null;
  }

  function tick() {
    var d = new Date();
    function p(n) { return (n < 10 ? '0' : '') + n; }
    $('clock').textContent = d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
  }

  buildLayout();
  var saved = lsGet();
  if (saved && typeof saved === 'object') {
    Object.keys(saved).forEach(function (id) { if (byId[id]) state[id] = saved[id]; });
  }
  steps.forEach(function (s) { refreshStep(s.id); });
  refreshProgress();
  tick(); setInterval(tick, 30000);
  $('next-btn').addEventListener('click', function () {
    var id = nextIncomplete();
    if (id) openStep(id); else $('next-btn').textContent = '全部做完了';
  });
  $('sync-retry').addEventListener('click', function () {
    steps.forEach(function (s) { if (state[s.id] && cloud.ref) cloud.dirty[s.id] = true; });
    cloud.failed = false;
    flush();
  });
  $('expand-first').addEventListener('click', function () { var id = nextIncomplete(); if (id) openStep(id); });
  if (location.hash && /^#step-/.test(location.hash)) {
    var hid = location.hash.replace('#step-', '');
    if (byId[hid]) setTimeout(function () { openStep(hid); }, 0);
  }
  initCloud();
})();
