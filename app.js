/* 每日讀經 — 每天按順序四章，讀完 1189 章為一輪 */
'use strict';

const TOTAL = 1189;
const PER_DAY = 4;
const STORE_KEY = 'bible-daily-v1';

let BOOKS = [];        // [{name, short, chapters}]
let OFFSETS = [];      // 各卷第一章的全域索引
const bookCache = {};  // bookIdx -> chapters data

/* ---------- 狀態 ---------- */
function todayStr(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function defaultState() {
  return {
    pos: 0,            // 下一個還沒讀的章（本輪 0..1188）
    cycle: 1,
    streak: 0,
    lastDone: null,    // 最近一次完成整天的日期
    today: null,       // { date, chapters: [全域索引×4], done: [bool×4], cur: 0 }
    fontSize: 20,
    reminderTime: '07:00',
    notifyOn: false,
    gistToken: null,   // 雲端自動同步金鑰（僅 gist 權限）
    gistId: null,
    lastSync: null,
  };
}
let state = loadState();
function loadState() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) return Object.assign(defaultState(), JSON.parse(raw));
  } catch (e) { /* 壞資料就重來 */ }
  return defaultState();
}
function save() { localStorage.setItem(STORE_KEY, JSON.stringify(state)); }

/* ---------- 章節定位 ---------- */
function locate(globalIdx) {
  const g = ((globalIdx % TOTAL) + TOTAL) % TOTAL;
  let b = 0;
  while (b + 1 < BOOKS.length && OFFSETS[b + 1] <= g) b++;
  return { book: b, chapter: g - OFFSETS[b] + 1 }; // chapter 從 1 起
}
function chapterName(globalIdx) {
  const { book, chapter } = locate(globalIdx);
  return `${BOOKS[book].name} 第 ${chapter} 章`;
}

/* 開新的一天（或加碼一組）：指定接下來四章 */
function assignToday() {
  const chapters = [];
  for (let i = 0; i < PER_DAY; i++) chapters.push((state.pos + i) % TOTAL);
  state.today = { date: todayStr(), chapters, done: [false, false, false, false], cur: 0 };
  save();
}
function ensureToday() {
  if (!state.today || state.today.date !== todayStr()) {
    // 新的一天：如果昨天那組沒讀完，同一組繼續（順序不跳章）
    if (state.today && !state.today.done.every(Boolean)) {
      state.today.date = todayStr();
      save();
    } else {
      assignToday();
    }
  }
}
function completedToday() { return state.lastDone === todayStr(); }

/* 這一組四章全讀完 → 推進進度 */
function completeSet() {
  state.pos += PER_DAY;
  if (state.pos >= TOTAL) { state.pos -= TOTAL; state.cycle += 1; }
  if (!completedToday()) {
    const y = new Date(); y.setDate(y.getDate() - 1);
    state.streak = (state.lastDone === todayStr(y)) ? state.streak + 1 : 1;
    state.lastDone = todayStr();
  }
  state.today = null;
  save();
  cloudPush();
}

/* ---------- 資料載入 ---------- */
async function loadBooks() {
  const res = await fetch('data/books.json');
  BOOKS = await res.json();
  let acc = 0;
  OFFSETS = BOOKS.map(b => { const o = acc; acc += b.chapters; return o; });
}
async function loadBook(bookIdx) {
  if (!bookCache[bookIdx]) {
    const res = await fetch(`data/book-${bookIdx + 1}.json`);
    bookCache[bookIdx] = await res.json();
  }
  return bookCache[bookIdx];
}

/* ---------- 首頁 ---------- */
const $ = id => document.getElementById(id);

function renderHome() {
  ensureToday();
  const now = new Date();
  $('home-date').textContent = now.toLocaleDateString('zh-TW', {
    year: 'numeric', month: 'long', day: 'numeric', weekday: 'long',
  });
  $('stat-streak').textContent = state.streak;
  $('stat-cycle').textContent = state.cycle;
  const pct = Math.floor(state.pos / TOTAL * 100);
  $('stat-percent').textContent = pct + '%';
  $('progress-bar').style.width = (state.pos / TOTAL * 100) + '%';
  $('progress-text').textContent = `本輪已讀 ${state.pos} / ${TOTAL} 章`;

  const doneAll = completedToday();
  const t = state.today;
  $('today-title').textContent = doneAll ? '今天再加碼？' : '今日進度（4 章）';

  const list = $('today-chapters');
  list.innerHTML = '';
  t.chapters.forEach((g, i) => {
    const btn = document.createElement('button');
    btn.className = 'chapter-item' + (t.done[i] ? ' done' : '');
    btn.innerHTML = `<span class="check">${t.done[i] ? '✅' : '📖'}</span>${chapterName(g)}`;
    btn.onclick = () => { t.cur = i; save(); openReader(); };
    list.appendChild(btn);
  });

  const started = t.done.some(Boolean);
  $('btn-start').textContent = doneAll ? '開始加碼讀經 →' : (started ? '繼續今日讀經 →' : '開始今日讀經 →');
  $('btn-start').hidden = false;
  $('done-banner').hidden = !doneAll;
  $('btn-bonus').hidden = true;
  if (doneAll) {
    $('btn-start').hidden = true;
    $('btn-bonus').hidden = false;
  }
}

/* ---------- 閱讀頁 ---------- */
function openReader() {
  const t = state.today;
  // 跳到第一個沒讀完的章（若點選特定章則用 cur）
  if (t.done[t.cur]) {
    const next = t.done.findIndex(d => !d);
    if (next >= 0) t.cur = next;
  }
  $('view-home').hidden = true;
  $('view-reader').hidden = false;
  window.scrollTo(0, 0);
  renderChapter();
}
function closeReader() {
  $('view-reader').hidden = true;
  $('view-home').hidden = false;
  renderHome();
}

async function renderChapter() {
  const t = state.today;
  const g = t.chapters[t.cur];
  const { book, chapter } = locate(g);

  $('reader-progress').textContent = `今日第 ${t.cur + 1} / ${PER_DAY} 章`;
  const dots = $('reader-dots');
  dots.innerHTML = '';
  t.chapters.forEach((_, i) => {
    const s = document.createElement('span');
    if (t.done[i]) s.className = 'done';
    if (i === t.cur) s.className += ' now';
    dots.appendChild(s);
  });

  $('reader-title').textContent = `${BOOKS[book].name} 第 ${chapter} 章`;
  const textEl = $('reader-text');
  textEl.style.fontSize = state.fontSize + 'px';
  textEl.innerHTML = '<div class="loading">載入中…</div>';
  window.scrollTo(0, 0);

  try {
    const data = await loadBook(book);
    const verses = data[chapter - 1];
    textEl.innerHTML = verses.map((v, i) =>
      `<p class="verse"><span class="verse-num">${i + 1}</span>${escapeHtml(v)}</p>`
    ).join('');
  } catch (e) {
    textEl.innerHTML = '<div class="loading">載入失敗，請檢查網路後重試 🙏</div>';
  }

  $('btn-prev').style.visibility = t.cur === 0 ? 'hidden' : 'visible';
  $('btn-next').textContent = t.cur === PER_DAY - 1 ? '✅ 完成今日讀經' : '讀完這章，下一章 →';
}
function escapeHtml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function nextChapter() {
  const t = state.today;
  t.done[t.cur] = true;
  if (t.cur < PER_DAY - 1) {
    t.cur += 1;
    save();
    renderChapter();
  } else {
    save();
    completeSet();
    closeReader();
  }
}
function prevChapter() {
  const t = state.today;
  if (t.cur > 0) { t.cur -= 1; save(); renderChapter(); }
}

/* ---------- 設定 ---------- */
function openSettings() {
  $('inp-time').value = state.reminderTime;
  const selBook = $('sel-book');
  if (!selBook.options.length) {
    BOOKS.forEach((b, i) => {
      const o = document.createElement('option');
      o.value = i; o.textContent = b.name;
      selBook.appendChild(o);
    });
    selBook.onchange = fillChapterSelect;
  }
  const { book, chapter } = locate(state.pos);
  selBook.value = book;
  fillChapterSelect();
  $('sel-chapter').value = chapter;
  updateNotifyStatus();
  renderCloudSection();
  $('cloud-msg').textContent = '';
  $('dlg-settings').showModal();
}
function fillChapterSelect() {
  const b = +$('sel-book').value;
  const sel = $('sel-chapter');
  sel.innerHTML = '';
  for (let c = 1; c <= BOOKS[b].chapters; c++) {
    const o = document.createElement('option');
    o.value = c; o.textContent = `第 ${c} 章`;
    sel.appendChild(o);
  }
}
function setPosition() {
  const b = +$('sel-book').value, c = +$('sel-chapter').value;
  state.pos = OFFSETS[b] + (c - 1);
  state.today = null;
  save();
  cloudPush();
  assignToday();
  $('dlg-settings').close();
  renderHome();
}

/* ---------- 雲端自動同步（存在使用者自己的 GitHub Gist） ---------- */
const GIST_FILE = 'bible-progress.json';
function totalRead(s) { return (s.cycle - 1) * TOTAL + s.pos; }
async function gistApi(method, path, body) {
  const res = await fetch('https://api.github.com' + path, {
    method,
    headers: {
      'Authorization': 'Bearer ' + state.gistToken,
      'Accept': 'application/vnd.github+json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 401) throw new Error('token');
  if (!res.ok) throw new Error('http' + res.status);
  return res.json();
}
function cloudPayload() {
  return JSON.stringify({
    pos: state.pos, cycle: state.cycle, streak: state.streak,
    lastDone: state.lastDone, updated: new Date().toISOString(),
  });
}
async function cloudFindOrCreate() {
  if (state.gistId) return state.gistId;
  for (let page = 1; page <= 3; page++) {
    const gists = await gistApi('GET', `/gists?per_page=100&page=${page}`);
    const hit = gists.find(g => g.files && g.files[GIST_FILE]);
    if (hit) { state.gistId = hit.id; save(); return hit.id; }
    if (gists.length < 100) break;
  }
  const created = await gistApi('POST', '/gists', {
    description: '每日讀經進度（App 自動同步用，請勿刪除）',
    public: false,
    files: { [GIST_FILE]: { content: cloudPayload() } },
  });
  state.gistId = created.id; save();
  return created.id;
}
async function cloudPush() {
  if (!state.gistToken) return;
  try {
    const id = await cloudFindOrCreate();
    await gistApi('PATCH', '/gists/' + id, { files: { [GIST_FILE]: { content: cloudPayload() } } });
    state.lastSync = new Date().toISOString(); save();
  } catch (e) { /* 離線或暫時失敗：下次進度變動再推 */ }
}
/* 回傳 true 表示套用了更新的雲端進度 */
async function cloudPull() {
  if (!state.gistToken) return false;
  try {
    const id = await cloudFindOrCreate();
    const gist = await gistApi('GET', '/gists/' + id);
    const remote = JSON.parse(gist.files[GIST_FILE].content);
    const r = {
      pos: Math.min(Math.max(+remote.pos || 0, 0), TOTAL - 1),
      cycle: +remote.cycle || 1,
      streak: +remote.streak || 0,
      lastDone: remote.lastDone || null,
    };
    state.lastSync = new Date().toISOString();
    if (totalRead(r) > totalRead(state)) {
      Object.assign(state, r);
      state.today = null;
      save();
      return true;
    }
    if (totalRead(r) < totalRead(state)) cloudPush();
    save();
  } catch (e) { /* 離線時安靜跳過 */ }
  return false;
}
async function cloudPullAndRefresh() {
  const changed = await cloudPull();
  if (changed && $('view-reader').hidden) { ensureToday(); renderHome(); }
}
function renderCloudSection() {
  const on = !!state.gistToken;
  $('cloud-off').hidden = on;
  $('cloud-on').hidden = !on;
  if (on) {
    $('cloud-status').textContent = state.lastSync
      ? `✅ 自動同步運作中（上次同步：${new Date(state.lastSync).toLocaleString('zh-TW')}）`
      : '✅ 自動同步已啟用';
  }
}
async function enableCloud() {
  const t = $('inp-token').value.trim();
  if (t.length < 20) { $('cloud-msg').textContent = '❌ 這看起來不是完整的金鑰，請重新複製。'; return; }
  state.gistToken = t; state.gistId = null; save();
  $('cloud-msg').textContent = '⏳ 連線測試中…';
  try {
    await cloudFindOrCreate();
    const changed = await cloudPull();
    $('inp-token').value = '';
    $('cloud-msg').textContent = '✅ 完成！之後所有裝置會自動同步。';
    renderCloudSection();
    if (changed) { ensureToday(); renderHome(); }
    else cloudPush();
  } catch (e) {
    state.gistToken = null; state.gistId = null; save();
    renderCloudSection();
    $('cloud-msg').textContent = e.message === 'token'
      ? '❌ 金鑰無效：請確認完整複製了 ghp_ 開頭的整串，且建立時勾了 gist 權限。'
      : '❌ 連線失敗，請檢查網路後再試一次。';
  }
}
function disableCloud() {
  state.gistToken = null; state.gistId = null; save();
  $('cloud-msg').textContent = '已關閉自動同步（雲端和本機的進度都還在）。';
  renderCloudSection();
}

/* 裝置同步：把進度編成連結，另一台裝置打開即套用 */
function syncLink() {
  return `${location.origin}${location.pathname}?s=${state.pos}.${state.cycle}.${state.streak}.${state.lastDone || ''}`;
}
async function shareSync() {
  const link = syncLink();
  const out = $('sync-out');
  const code = `${state.pos}.${state.cycle}.${state.streak}.${state.lastDone || ''}`;
  try {
    await navigator.clipboard.writeText(link);
    out.textContent = `✅ 已複製！到另一台裝置（或主畫面 App）的設定裡貼上套用。同步碼：${code}`;
  } catch (e) {
    out.textContent = `同步碼：${code}（手動複製後到另一邊貼上）`;
  }
  if (navigator.share) {
    try { await navigator.share({ title: '每日讀經進度', url: link }); }
    catch (e) { /* 使用者取消分享沒關係，同步碼已顯示 */ }
  }
}
function applySyncCode(code) {
  // 接受完整連結或純同步碼（pos.cycle.streak.lastDone）
  const m = String(code).match(/(?:^|[?&]s=)(\d+\.\d+\.\d+(?:\.[\d-]*)?)/);
  if (!m) return 'invalid';
  const [pos, cycle, streak, lastDone] = m[1].split('.');
  if (isNaN(+pos) || +pos < 0 || +pos >= TOTAL) return 'invalid';
  const msg = `要同步讀經進度到這裡嗎？\n\n接下來要讀：${chapterName(+pos)}\n（第 ${+cycle || 1} 輪，連續 ${+streak || 0} 天）`;
  if (!confirm(msg)) return 'cancelled';
  state.pos = +pos;
  state.cycle = +cycle || 1;
  state.streak = +streak || 0;
  state.lastDone = lastDone || null;
  state.today = null;
  save();
  cloudPush();
  return 'ok';
}
function applySyncFromUrl() {
  const p = new URLSearchParams(location.search).get('s');
  if (!p) return;
  history.replaceState(null, '', location.pathname);
  applySyncCode(p);
}
function applySyncFromInput() {
  const result = applySyncCode($('inp-sync').value.trim());
  if (result === 'invalid') {
    $('sync-in-msg').textContent = '❌ 看不懂這個同步碼，請確認有完整貼上。';
    return;
  }
  if (result === 'ok') {
    $('inp-sync').value = '';
    $('sync-in-msg').textContent = '';
    $('dlg-settings').close();
    ensureToday();
    renderHome();
  }
}

/* 行事曆提醒 (.ics)：每天固定時間通知，各平台通用 */
function downloadIcs() {
  state.reminderTime = $('inp-time').value || '07:00';
  save();
  const [h, m] = state.reminderTime.split(':');
  const now = new Date();
  const stamp = todayStr(now).replace(/-/g, '');
  const url = location.origin + location.pathname;
  const ics = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//DailyBible//ZH-TW//',
    'BEGIN:VEVENT',
    `UID:daily-bible-${stamp}@local`,
    `DTSTART;TZID=Asia/Taipei:${stamp}T${h}${m}00`,
    'RRULE:FREQ=DAILY',
    'SUMMARY:📖 每日讀經時間到了',
    `DESCRIPTION:今天的四章在等你：${url}`,
    `URL:${url}`,
    'BEGIN:VALARM',
    'ACTION:DISPLAY',
    'DESCRIPTION:📖 每日讀經時間到了',
    'TRIGGER:PT0M',
    'END:VALARM',
    'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n');
  const blob = new Blob([ics], { type: 'text/calendar;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'daily-bible-reminder.ics';
  a.click();
  URL.revokeObjectURL(a.href);
}

/* 瀏覽器通知（App 開著時的輔助提醒） */
async function enableNotify() {
  if (!('Notification' in window)) {
    $('notify-status').textContent = '這個瀏覽器不支援通知。';
    return;
  }
  const perm = await Notification.requestPermission();
  state.notifyOn = perm === 'granted';
  state.reminderTime = $('inp-time').value || state.reminderTime;
  save();
  updateNotifyStatus();
}
function updateNotifyStatus() {
  $('notify-status').textContent = state.notifyOn
    ? `✅ 已啟用：App 開著時，每天 ${state.reminderTime} 會通知你。`
    : '';
}
function startNotifyLoop() {
  let firedFor = null;
  setInterval(() => {
    if (!state.notifyOn || completedToday()) return;
    const now = new Date();
    const hm = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
    const key = todayStr() + hm;
    if (hm === state.reminderTime && firedFor !== key) {
      firedFor = key;
      const body = `今天的四章：${chapterName(state.today?.chapters?.[0] ?? state.pos)} 開始`;
      if (navigator.serviceWorker?.ready) {
        navigator.serviceWorker.ready.then(reg =>
          reg.showNotification('📖 每日讀經時間到了', { body, icon: 'icons/icon-192.png' })
        ).catch(() => new Notification('📖 每日讀經時間到了', { body }));
      } else {
        new Notification('📖 每日讀經時間到了', { body });
      }
    }
  }, 20000);
}

/* ---------- 啟動 ---------- */
async function main() {
  await loadBooks();
  applySyncFromUrl();
  ensureToday();
  renderHome();

  $('btn-start').onclick = openReader;
  $('btn-bonus').onclick = () => { assignToday(); openReader(); };
  $('btn-back').onclick = closeReader;
  $('btn-next').onclick = nextChapter;
  $('btn-prev').onclick = prevChapter;
  $('btn-settings').onclick = openSettings;
  $('link-settings').onclick = e => { e.preventDefault(); openSettings(); };
  $('btn-close-settings').onclick = () => $('dlg-settings').close();
  $('btn-ics').onclick = downloadIcs;
  $('btn-sync').onclick = shareSync;
  $('btn-apply-sync').onclick = applySyncFromInput;
  $('btn-cloud-on').onclick = enableCloud;
  $('btn-cloud-off').onclick = disableCloud;
  // 要求瀏覽器盡量保留資料，降低進度被系統清掉的機率
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
  $('btn-notify').onclick = enableNotify;
  $('btn-set-pos').onclick = setPosition;
  $('btn-font-plus').onclick = () => { state.fontSize = Math.min(30, state.fontSize + 2); save(); $('reader-text').style.fontSize = state.fontSize + 'px'; };
  $('btn-font-minus').onclick = () => { state.fontSize = Math.max(14, state.fontSize - 2); save(); $('reader-text').style.fontSize = state.fontSize + 'px'; };

  startNotifyLoop();

  // 開啟時拉一次雲端進度
  cloudPullAndRefresh();

  // 換日或切回 App 時：更新畫面並拉雲端進度
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) {
      if ($('view-reader').hidden) renderHome();
      cloudPullAndRefresh();
    }
  });

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
}
main();
