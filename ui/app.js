'use strict';
/* MarathonStream core: timer, persistence, activity log, settings UI.
   Twitch connectivity lives in twitch.js and calls MS.onTwitchEvent(). */
(function () {
  const LSKEY = 'marathonstream_v1';
  const WEEK_MS = 7 * 24 * 3600 * 1000;
  const $ = (id) => document.getElementById(id);

  // ---------- state ----------
  function defaults() {
    return {
      settings: {
        clientId: '',
        followSeconds: 60,
        subSeconds: 300,
        bitsPer100Seconds: 60,
        allowAfterZero: false,
        timerFontPx: 0,   // 0 = auto (scales with window)
        labelFontPx: 0,   // 0 = auto
        bgColor: '#0e0e10',
        popupFrom: 'above',  // 'above' | 'below' | 'random'
        keywords: [],     // [{word, seconds, cooldownSec}]
        redemptions: []   // [{title, seconds}]
      },
      timer: { remaining: 0, running: false, started: false },
      actionsPaused: false,
      activity: [],          // [{ts, type, label, user, added, note}]
      followCooldowns: {},   // userId -> last counted timestamp (ms)
      keywordCooldowns: {},  // "userId|keyword" -> timestamp (ms)
      auth: { token: null, userId: null, login: null }
    };
  }

  function load() {
    try {
      const raw = localStorage.getItem(LSKEY);
      if (!raw) return defaults();
      const s = JSON.parse(raw);
      const d = defaults();
      const settings = Object.assign(d.settings, s.settings);
      // migrate pre-per-keyword-cooldown saves: old global keywordCooldownSec
      const legacyCd = (s.settings && typeof s.settings.keywordCooldownSec === 'number') ? s.settings.keywordCooldownSec : 60;
      delete settings.keywordCooldownSec;
      for (const k of settings.keywords) {
        if (typeof k.cooldownSec !== 'number') k.cooldownSec = legacyCd;
      }
      return {
        settings,
        timer: Object.assign(d.timer, s.timer),
        actionsPaused: !!s.actionsPaused,
        activity: Array.isArray(s.activity) ? s.activity : [],
        followCooldowns: s.followCooldowns || {},
        keywordCooldowns: s.keywordCooldowns || {},
        auth: Object.assign(d.auth, s.auth)
      };
    } catch {
      return defaults();
    }
  }

  const state = load();

  let saveQueued = false;
  function save() {
    if (saveQueued) return;
    saveQueued = true;
    setTimeout(() => {
      saveQueued = false;
      try { localStorage.setItem(LSKEY, JSON.stringify(state)); } catch { /* storage full */ }
    }, 300);
  }
  function saveNow() {
    try { localStorage.setItem(LSKEY, JSON.stringify(state)); } catch { /* storage full */ }
  }

  // ---------- activity log ----------
  const ICONS = {
    follow: '❤',    // heart
    sub: '⭐',       // star
    bits: '💎', // gem
    keyword: '💬', // speech bubble
    redeem: '🏆',  // trophy
    manual: '➕',    // plus
    system: '⏱'     // stopwatch
  };

  function pushLog(entry) {
    entry.ts = Date.now();
    state.activity.unshift(entry);
    if (state.activity.length > 2000) state.activity.length = 2000;
    save();
    renderActivity();
  }

  function formatDur(totalSec) {
    const neg = totalSec < 0;
    let t = Math.abs(Math.round(totalSec));
    const d = Math.floor(t / 86400); t %= 86400;
    const h = Math.floor(t / 3600); t %= 3600;
    const m = Math.floor(t / 60);
    const s = t % 60;
    const parts = [];
    if (d) parts.push(d + 'd');
    if (h) parts.push(h + 'h');
    if (m) parts.push(m + 'm');
    if (s || !parts.length) parts.push(s + 's');
    return (neg ? '-' : '+') + parts.join(' ');
  }

  function formatWhen(ts) {
    const dte = new Date(ts);
    const today = new Date();
    const sameDay = dte.toDateString() === today.toDateString();
    const time = dte.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    return sameDay ? time : dte.toLocaleDateString() + ' ' + time;
  }

  function renderActivity() {
    const list = $('activity-list');
    const rows = state.activity.slice(0, 300);
    $('activity-empty').style.display = rows.length ? 'none' : 'block';
    list.innerHTML = '';
    for (const e of rows) {
      const li = document.createElement('li');

      const icon = document.createElement('span');
      icon.className = 'icon';
      icon.textContent = ICONS[e.type] || '•';

      const info = document.createElement('div');
      info.className = 'info';
      const line = document.createElement('div');
      if (e.user) {
        const who = document.createElement('span');
        who.className = 'who';
        who.textContent = e.user + ' ';
        line.appendChild(who);
      }
      const what = document.createElement('span');
      what.className = 'what';
      what.textContent = e.label + (e.note ? ' (' + e.note + ')' : '');
      line.appendChild(what);
      const when = document.createElement('div');
      when.className = 'when';
      when.textContent = formatWhen(e.ts);
      info.appendChild(line);
      info.appendChild(when);

      const amount = document.createElement('span');
      amount.className = 'amount' + (e.added ? (e.added < 0 ? ' neg' : '') : ' zero');
      amount.textContent = e.added ? formatDur(e.added) : '+0';

      li.appendChild(icon);
      li.appendChild(info);
      li.appendChild(amount);
      list.appendChild(li);
    }
  }

  // ---------- timer ----------
  let lastTick = Date.now();
  let zeroLogged = state.timer.started && state.timer.remaining <= 0;

  setInterval(() => {
    const now = Date.now();
    if (state.timer.running && state.timer.remaining > 0) {
      state.timer.remaining = Math.max(0, state.timer.remaining - (now - lastTick) / 1000);
      if (state.timer.remaining <= 0 && !zeroLogged) {
        zeroLogged = true;
        pushLog({ type: 'system', label: 'Timer reached zero', user: '', added: 0, note: '' });
      }
      save();
    }
    lastTick = now;
    decayAnim();
    renderTimer();
  }, 250);

  function renderTimer() {
    // animOffset holds time not yet shown: the display "runs up" (or down) to the real value
    const total = Math.max(0, Math.floor(state.timer.remaining - animOffset));
    const d = Math.floor(total / 86400);
    const h = Math.floor((total % 86400) / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    $('t-d').textContent = String(d);
    $('t-h').textContent = String(h).padStart(2, '0');
    $('t-m').textContent = String(m).padStart(2, '0');
    $('t-s').textContent = String(s).padStart(2, '0');

    const ended = state.timer.started && state.timer.remaining <= 0;
    document.body.classList.toggle('ended', ended);

    const timerEl = $('timer');
    timerEl.classList.toggle('count-up', animOffset > 0.05);
    timerEl.classList.toggle('count-down', animOffset < -0.05);

    const chips = [];
    if (ended) chips.push('<span class="chip ended">TIMER ENDED</span>');
    else if (state.timer.started && !state.timer.running) chips.push('<span class="chip paused">TIMER PAUSED</span>');
    if (state.actionsPaused) chips.push('<span class="chip actions">TIME ADDITIONS PAUSED</span>');
    $('chips').innerHTML = chips.join('');

    const tBtn = $('btn-toggle-timer');
    tBtn.innerHTML = state.timer.running ? '&#10074;&#10074;' : '&#9654;';
    tBtn.classList.toggle('active', state.timer.running);
    $('btn-toggle-actions').classList.toggle('warn', state.actionsPaused);
    $('btn-start-pause').textContent = !state.timer.started ? 'Start' : (state.timer.running ? 'Pause' : 'Resume');
  }

  // ---------- time-change animation ----------
  // A "+30s" popup drops onto the timer; on impact the timer bumps and the
  // displayed time runs up (or down) to the real value instead of jumping.
  let animOffset = 0;      // seconds the display still lags behind reality
  let animActive = false;  // decay enabled (popup has hit the timer)
  let animLastDecay = 0;

  // Time-based decay shared by the rAF loop (smooth when visible) and the
  // 250ms tick (fallback: rAF never fires when the window is hidden/occluded,
  // e.g. while OBS captures a minimized window).
  function decayAnim() {
    if (!animActive) return;
    const now = performance.now();
    const dt = Math.min((now - animLastDecay) / 1000, 0.5);
    animLastDecay = now;
    animOffset *= Math.pow(0.02, dt / 1.3); // ~98% of the gap closes in 1.3s
    if (Math.abs(animOffset) < 0.05) {
      animOffset = 0;
      animActive = false;
    }
  }

  function animLoop() {
    if (!animActive) return;
    decayAnim();
    renderTimer();
    requestAnimationFrame(animLoop);
  }

  function startRunUp() {
    if (animActive || animOffset === 0) return;
    animActive = true;
    animLastDecay = performance.now();
    requestAnimationFrame(animLoop);
  }

  // One popup per time component (e.g. +2m 30s -> "+2" over the minutes
  // column and "+30" over the seconds column), anchored to the live layout
  // so window resizes can't misplace them.
  function spawnPops(added, from) {
    const layer = $('pop-layer');
    const sign = added < 0 ? '-' : '+';
    const t = Math.abs(Math.round(added));
    const parts = [
      ['t-d', Math.floor(t / 86400)],
      ['t-h', Math.floor((t % 86400) / 3600)],
      ['t-m', Math.floor((t % 3600) / 60)],
      ['t-s', t % 60]
    ];
    const stageRect = $('stage').getBoundingClientRect();
    for (const [id, val] of parts) {
      if (!val) continue;
      const unitRect = $(id).closest('.unit').getBoundingClientRect();
      const pop = document.createElement('div');
      pop.className = 'time-pop ' + from + (added < 0 ? ' neg' : '');
      pop.textContent = sign + val;
      pop.style.left = (unitRect.left + unitRect.width / 2 - stageRect.left) + 'px';
      pop.style.top = ((from === 'above' ? unitRect.top : unitRect.bottom) - stageRect.top) + 'px';
      layer.appendChild(pop);
      pop.addEventListener('animationend', () => pop.remove());
      setTimeout(() => pop.remove(), 4000); // animationend never fires while the window is hidden
    }
  }

  function animateTimeChange(added) {
    animOffset += added;   // freeze the display at the old value
    renderTimer();

    const pref = state.settings.popupFrom;
    const from = pref === 'random' ? (Math.random() < 0.5 ? 'above' : 'below')
               : pref === 'below' ? 'below' : 'above';
    spawnPops(added, from);

    // the popup keyframes reach the timer ~38% in (~530ms); bump + start counting then
    setTimeout(() => {
      const timerEl = $('timer');
      timerEl.classList.remove('bump');
      void timerEl.offsetWidth; // restart the CSS animation
      timerEl.classList.toggle('bump-below', from === 'below');
      timerEl.classList.add('bump');
      startRunUp();
    }, 530);
  }

  // ---------- adding time ----------
  // manual=true bypasses the "actions paused" and "timer ended" gates (streamer intent)
  function recordAction(type, label, user, seconds, manual) {
    let added = Math.round(seconds);
    let note = '';
    if (!manual) {
      if (state.actionsPaused) { added = 0; note = 'additions paused - no time added'; }
      else if (state.timer.started && state.timer.remaining <= 0 && !state.settings.allowAfterZero) {
        added = 0; note = 'timer ended - no time added';
      }
    }
    if (added !== 0) {
      const before = state.timer.remaining;
      state.timer.remaining = Math.max(0, state.timer.remaining + added);
      if (state.timer.remaining > 0) zeroLogged = false;
      const delta = state.timer.remaining - before;
      if (Math.abs(delta) >= 0.5) animateTimeChange(delta);
    }
    pushLog({ type, label, user, added, note });
    renderTimer();
  }

  // ---------- Twitch event handling ----------
  function tierName(t) { return t === '2000' ? '2' : t === '3000' ? '3' : '1'; }

  function pruneCooldowns() {
    const now = Date.now();
    for (const id of Object.keys(state.followCooldowns)) {
      if (now - state.followCooldowns[id] > WEEK_MS) delete state.followCooldowns[id];
    }
    const maxCd = state.settings.keywords.reduce((mx, k) => Math.max(mx, k.cooldownSec || 0), 0);
    const kwWindow = Math.max(maxCd * 1000, 3600000);
    for (const k of Object.keys(state.keywordCooldowns)) {
      if (now - state.keywordCooldowns[k] > kwWindow) delete state.keywordCooldowns[k];
    }
  }
  setInterval(() => { pruneCooldowns(); save(); }, 10 * 60 * 1000);

  function onTwitchEvent(type, ev) {
    const s = state.settings;
    try {
      switch (type) {
        case 'channel.follow': {
          const last = state.followCooldowns[ev.user_id];
          if (last && Date.now() - last < WEEK_MS) {
            pushLog({ type: 'follow', label: 'followed (7-day cooldown, no time)', user: ev.user_name, added: 0, note: '' });
            return;
          }
          state.followCooldowns[ev.user_id] = Date.now();
          recordAction('follow', 'followed', ev.user_name, s.followSeconds, false);
          break;
        }
        case 'channel.subscribe': {
          const label = ev.is_gift
            ? 'received a gifted sub (Tier ' + tierName(ev.tier) + ')'
            : 'subscribed (Tier ' + tierName(ev.tier) + ')';
          recordAction('sub', label, ev.user_name, s.subSeconds, false);
          break;
        }
        case 'channel.subscription.message': {
          const months = ev.cumulative_months ? ' - ' + ev.cumulative_months + ' months' : '';
          recordAction('sub', 'resubscribed (Tier ' + tierName(ev.tier) + ')' + months, ev.user_name, s.subSeconds, false);
          break;
        }
        case 'channel.cheer': {
          const secs = (ev.bits || 0) * s.bitsPer100Seconds / 100;
          const who = ev.is_anonymous ? 'Anonymous' : (ev.user_name || 'Unknown');
          recordAction('bits', 'cheered ' + ev.bits + ' bits', who, secs, false);
          break;
        }
        case 'channel.chat.message': {
          if (!s.keywords.length) return;
          const text = ((ev.message && ev.message.text) || '').toLowerCase();
          for (const k of s.keywords) {
            if (!k.word) continue;
            const w = k.word.toLowerCase();
            if (!text.includes(w)) continue;
            const key = ev.chatter_user_id + '|' + w;
            const cd = (k.cooldownSec || 0) * 1000;
            if (cd > 0 && state.keywordCooldowns[key] && Date.now() - state.keywordCooldowns[key] < cd) continue;
            state.keywordCooldowns[key] = Date.now();
            recordAction('keyword', 'used keyword "' + k.word + '"', ev.chatter_user_name, k.seconds, false);
          }
          break;
        }
        case 'channel.channel_points_custom_reward_redemption.add': {
          const title = ((ev.reward && ev.reward.title) || '').trim();
          const match = s.redemptions.find(r => r.title.trim().toLowerCase() === title.toLowerCase());
          if (match) recordAction('redeem', 'redeemed "' + title + '"', ev.user_name, match.seconds, false);
          break;
        }
      }
    } catch (err) {
      console.error('Error handling event', type, err);
    }
  }

  // ---------- appearance ----------
  function applyAppearance() {
    const s = state.settings;
    const root = document.documentElement.style;
    if (s.timerFontPx > 0) root.setProperty('--timer-size', s.timerFontPx + 'px');
    else root.removeProperty('--timer-size');
    if (s.labelFontPx > 0) root.setProperty('--label-size', s.labelFontPx + 'px');
    else root.removeProperty('--label-size');
    root.setProperty('--stage-bg', s.bgColor || '#0e0e10');
  }

  // ---------- settings UI ----------
  function readDHMS(prefix) {
    const v = (id) => parseInt($(id).value, 10) || 0;
    return v(prefix + '-d') * 86400 + v(prefix + '-h') * 3600 + v(prefix + '-m') * 60 + v(prefix + '-s');
  }

  function bindNumber(id, key) {
    const el = $(id);
    el.value = state.settings[key];
    el.addEventListener('change', () => {
      state.settings[key] = parseInt(el.value, 10) || 0;
      el.value = state.settings[key];
      save();
    });
  }

  function renderCfgList(containerId, items, fields, onChange) {
    const box = $(containerId);
    box.innerHTML = '';
    items.forEach((item, i) => {
      const row = document.createElement('div');
      row.className = 'cfg-row';

      const text = document.createElement('input');
      text.type = 'text';
      text.value = item[fields.text];
      text.addEventListener('change', () => { item[fields.text] = text.value.trim(); onChange(); });

      const num = document.createElement('input');
      num.type = 'number';
      num.value = item.seconds;
      num.title = 'seconds added (negative subtracts)';
      num.addEventListener('change', () => { item.seconds = parseInt(num.value, 10) || 0; onChange(); });

      let cd = null;
      if (fields.cooldown) {
        cd = document.createElement('input');
        cd.type = 'number';
        cd.min = '0';
        cd.value = item.cooldownSec || 0;
        cd.title = 'per-user cooldown in seconds (0 = off)';
        cd.addEventListener('change', () => { item.cooldownSec = Math.max(0, parseInt(cd.value, 10) || 0); onChange(); });
      }

      const del = document.createElement('button');
      del.textContent = '✕';
      del.title = 'Remove';
      del.addEventListener('click', () => { items.splice(i, 1); onChange(); renderCfgList(containerId, items, fields, onChange); });

      row.appendChild(text); row.appendChild(num);
      if (cd) row.appendChild(cd);
      row.appendChild(del);
      box.appendChild(row);
    });
  }

  const renderKeywords = () => renderCfgList('keyword-list', state.settings.keywords, { text: 'word', cooldown: true }, save);
  const renderRedeems = () => renderCfgList('redeem-list', state.settings.redemptions, { text: 'title' }, save);

  function initUI() {
    // Twitch client ID
    $('clientId').value = state.settings.clientId;
    $('clientId').addEventListener('change', () => {
      state.settings.clientId = $('clientId').value.trim();
      save();
    });

    // per-action amounts
    bindNumber('followSeconds', 'followSeconds');
    bindNumber('subSeconds', 'subSeconds');
    bindNumber('bitsPer100Seconds', 'bitsPer100Seconds');

    // appearance
    ['timerFontPx', 'labelFontPx'].forEach(key => {
      const el = $(key);
      el.value = state.settings[key];
      el.addEventListener('change', () => {
        state.settings[key] = Math.max(0, parseInt(el.value, 10) || 0);
        el.value = state.settings[key];
        save();
        applyAppearance();
      });
    });
    $('bgColor').value = state.settings.bgColor || '#0e0e10';
    $('bgColor').addEventListener('input', () => {
      state.settings.bgColor = $('bgColor').value;
      save();
      applyAppearance();
    });
    $('popupFrom').value = state.settings.popupFrom || 'above';
    $('popupFrom').addEventListener('change', () => {
      state.settings.popupFrom = $('popupFrom').value;
      save();
    });
    $('btn-reset-appearance').addEventListener('click', () => {
      state.settings.timerFontPx = 0;
      state.settings.labelFontPx = 0;
      state.settings.bgColor = '#0e0e10';
      state.settings.popupFrom = 'above';
      $('timerFontPx').value = 0;
      $('labelFontPx').value = 0;
      $('bgColor').value = '#0e0e10';
      $('popupFrom').value = 'above';
      save();
      applyAppearance();
    });

    $('allowAfterZero').checked = state.settings.allowAfterZero;
    $('allowAfterZero').addEventListener('change', () => {
      state.settings.allowAfterZero = $('allowAfterZero').checked;
      save();
    });

    renderKeywords();
    renderRedeems();

    $('btn-add-keyword').addEventListener('click', () => {
      const word = $('kw-word').value.trim();
      const secs = parseInt($('kw-secs').value, 10) || 0;
      const cd = Math.max(0, parseInt($('kw-cd').value, 10) || 0);
      if (!word) return;
      state.settings.keywords.push({ word, seconds: secs, cooldownSec: cd });
      $('kw-word').value = ''; $('kw-secs').value = ''; $('kw-cd').value = '';
      save(); renderKeywords();
    });

    $('btn-add-redeem').addEventListener('click', () => {
      const title = $('rd-title').value.trim();
      const secs = parseInt($('rd-secs').value, 10) || 0;
      if (!title) return;
      state.settings.redemptions.push({ title, seconds: secs });
      $('rd-title').value = ''; $('rd-secs').value = '';
      save(); renderRedeems();
    });

    // timer controls
    $('btn-set-timer').addEventListener('click', () => {
      const secs = readDHMS('start');
      if (state.timer.started && state.timer.running &&
          !confirm('The timer is currently running. Overwrite it with the new time?')) return;
      state.timer.remaining = secs;
      state.timer.started = false;
      state.timer.running = false;
      zeroLogged = false;
      pushLog({ type: 'system', label: 'Timer set to ' + formatDur(secs).slice(1), user: '', added: 0, note: '' });
      renderTimer();
      saveNow();
    });

    function toggleTimer() {
      if (!state.timer.started) {
        if (state.timer.remaining <= 0) { alert('Set a starting time first (Options > Timer).'); return; }
        state.timer.started = true;
        state.timer.running = true;
        lastTick = Date.now();
        pushLog({ type: 'system', label: 'Timer started', user: '', added: 0, note: '' });
      } else {
        state.timer.running = !state.timer.running;
        if (state.timer.running) lastTick = Date.now();
        pushLog({ type: 'system', label: state.timer.running ? 'Timer resumed' : 'Timer paused', user: '', added: 0, note: '' });
      }
      renderTimer();
      saveNow();
    }
    $('btn-start-pause').addEventListener('click', toggleTimer);
    $('btn-toggle-timer').addEventListener('click', toggleTimer);

    function toggleActions() {
      state.actionsPaused = !state.actionsPaused;
      pushLog({ type: 'system', label: state.actionsPaused ? 'Time additions paused' : 'Time additions resumed', user: '', added: 0, note: '' });
      $('btn-pause-actions').textContent = state.actionsPaused ? 'Resume time additions' : 'Pause time additions';
      renderTimer();
      saveNow();
    }
    $('btn-pause-actions').addEventListener('click', toggleActions);
    $('btn-toggle-actions').addEventListener('click', toggleActions);
    $('btn-pause-actions').textContent = state.actionsPaused ? 'Resume time additions' : 'Pause time additions';

    // manual add
    $('btn-add-time').addEventListener('click', () => {
      const v = (id) => parseInt($(id).value, 10) || 0;
      const secs = v('add-d') * 86400 + v('add-h') * 3600 + v('add-m') * 60 + v('add-s');
      if (!secs) return;
      recordAction('manual', 'manually ' + (secs > 0 ? 'added' : 'removed') + ' time', 'Streamer', secs, true);
      ['add-d', 'add-h', 'add-m', 'add-s'].forEach(id => $(id).value = 0);
    });

    // reset
    $('btn-reset').addEventListener('click', () => {
      if (!confirm('RESET EVERYTHING?\n\nThis clears the timer, the whole activity log, and all follow/keyword cooldowns.\nSettings and your Twitch login are kept.')) return;
      state.timer = { remaining: 0, running: false, started: false };
      state.activity = [];
      state.followCooldowns = {};
      state.keywordCooldowns = {};
      state.actionsPaused = false;
      zeroLogged = false;
      $('btn-pause-actions').textContent = 'Pause time additions';
      saveNow();
      renderActivity();
      renderTimer();
    });

    // test simulators
    document.querySelectorAll('.sim').forEach(btn => {
      btn.addEventListener('click', () => {
        const kind = btn.dataset.sim;
        const uid = 'test-' + Math.floor(Math.random() * 1e9);
        if (kind === 'follow') onTwitchEvent('channel.follow', { user_id: uid, user_name: 'TestFollower' });
        else if (kind === 'sub') onTwitchEvent('channel.subscribe', { user_id: uid, user_name: 'TestSubscriber', tier: '1000', is_gift: false });
        else if (kind === 'bits') onTwitchEvent('channel.cheer', { user_id: uid, user_name: 'TestCheerer', bits: 100, is_anonymous: false });
        else if (kind === 'keyword') {
          const kw = state.settings.keywords[0];
          if (!kw) { alert('Add a keyword first.'); return; }
          onTwitchEvent('channel.chat.message', { chatter_user_id: uid, chatter_user_name: 'TestChatter', message: { text: 'hello ' + kw.word + ' world' } });
        } else if (kind === 'redeem') {
          const rd = state.settings.redemptions[0];
          if (!rd) { alert('Add a channel point reward first.'); return; }
          onTwitchEvent('channel.channel_points_custom_reward_redemption.add', { user_id: uid, user_name: 'TestRedeemer', reward: { title: rd.title } });
        }
      });
    });

    // panels
    $('btn-settings').addEventListener('click', () => togglePanel('settings'));
    $('btn-activity').addEventListener('click', () => togglePanel('activity'));
    document.querySelectorAll('.close').forEach(btn => {
      btn.addEventListener('click', () => togglePanel(btn.dataset.close, false));
    });

    // hover-to-reveal controls
    let hideTimer = null;
    function poke() {
      document.body.classList.add('show-ui');
      clearTimeout(hideTimer);
      hideTimer = setTimeout(() => document.body.classList.remove('show-ui'), 3000);
    }
    document.addEventListener('mousemove', poke);
    document.addEventListener('touchstart', poke);
  }

  function togglePanel(name, force) {
    const el = $(name);
    const open = force !== undefined ? force : !el.classList.contains('open');
    el.classList.toggle('open', open);
    document.body.classList.toggle('panel-open',
      $('settings').classList.contains('open') || $('activity').classList.contains('open'));
  }

  function setTwitchStatus(text, cls) {
    const el = $('twitch-status');
    el.textContent = text;
    el.className = 'muted' + (cls ? ' ' + cls : '');
  }

  // public API used by twitch.js
  window.MS = { state, save, saveNow, onTwitchEvent, setTwitchStatus, pushLog };

  initUI();
  applyAppearance();
  renderActivity();
  renderTimer();
})();
