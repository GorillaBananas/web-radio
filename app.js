// ── Config ──
const REGIONS = ['auckland', 'wellington', 'christchurch'];
const BLOCK_MINUTES = 15;
const BLOCKS_PER_HOUR = 60 / BLOCK_MINUTES;
const TOTAL_BLOCKS = 24 * BLOCKS_PER_HOUR;
const NZDT_OFFSET = 13; // NZDT = UTC+13

const DAY_NAMES_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
                     'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// ── State ──
const state = {
  region: localStorage.getItem('zb_region') || 'auckland',
  dayOffset: 0,
  timeBlock: null,
  playing: false,
  loading: false,
};

// ── DOM ──
const $ = (id) => document.getElementById(id);
const audio = $('audio');
const btnPlay = $('btnPlay');

// ── Date/Time Helpers ──

function getNZNow() {
  const now = new Date();
  return new Date(now.getTime() + (NZDT_OFFSET * 60 + now.getTimezoneOffset()) * 60000);
}

function getNZDate(daysAgo) {
  const d = getNZNow();
  d.setDate(d.getDate() - daysAgo);
  d.setHours(0, 0, 0, 0);
  return d;
}

function formatDateDot(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}.${m}.${d}`;
}

function blockToHM(block) {
  return {
    h: Math.floor(block / BLOCKS_PER_HOUR),
    m: (block % BLOCKS_PER_HOUR) * BLOCK_MINUTES,
  };
}

function blockToDisplay(block) {
  const { h, m } = blockToHM(block);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function blockToUrlTime(block) {
  const { h, m } = blockToHM(block);
  return `${String(h).padStart(2, '0')}.${String(m).padStart(2, '0')}.00`;
}

function blockTo12h(block) {
  const { h, m } = blockToHM(block);
  const ampm = h < 12 ? 'am' : 'pm';
  const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
  return `${h12}:${String(m).padStart(2, '0')} ${ampm}`;
}

function maxBlockToday() {
  const nz = getNZNow();
  return nz.getHours() * BLOCKS_PER_HOUR + Math.floor(nz.getMinutes() / BLOCK_MINUTES);
}

function regionLabel(r) {
  return r.charAt(0).toUpperCase() + r.slice(1);
}

function formatSecs(s) {
  if (!isFinite(s) || s < 0) return '0:00';
  return Math.floor(s / 60) + ':' + String(Math.floor(s % 60)).padStart(2, '0');
}

function buildUrl(region, date, block) {
  return `https://weekondemand.newstalkzb.co.nz/WeekOnDemand/ZB/${region}/${formatDateDot(date)}-${blockToUrlTime(block)}-D.mp3`;
}

// ── Toast ──
let toastTimer;
function showToast(msg) {
  const el = $('toast');
  el.textContent = msg;
  el.classList.add('visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('visible'), 2500);
}

// ══════════════════════════════════
// Render: Regions (segmented control)
// ══════════════════════════════════

function renderRegions() {
  $('regionControl').innerHTML = REGIONS.map((r) =>
    `<button class="seg-btn${r === state.region ? ' active' : ''}" data-region="${r}">${regionLabel(r)}</button>`
  ).join('');
}

$('regionControl').addEventListener('click', (e) => {
  const btn = e.target.closest('.seg-btn');
  if (!btn) return;
  state.region = btn.dataset.region;
  localStorage.setItem('zb_region', state.region);
  renderRegions();
  updatePlayerText();
  if (state.playing || state.loading) playCurrentBlock();
});

// ══════════════════════════════════
// Render: Days (segmented control)
// ══════════════════════════════════

function renderDays() {
  let html = '';
  for (let i = 0; i < 7; i++) {
    const d = getNZDate(i);
    const label = i === 0 ? 'Today' : i === 1 ? 'Yest' : DAY_NAMES_SHORT[d.getDay()];
    html += `<button class="seg-btn${i === state.dayOffset ? ' active' : ''}" data-offset="${i}">
      ${label}<span class="day-num">${d.getDate()}</span>
    </button>`;
  }
  $('dayControl').innerHTML = html;
}

$('dayControl').addEventListener('click', (e) => {
  const btn = e.target.closest('.seg-btn');
  if (!btn) return;
  state.dayOffset = parseInt(btn.dataset.offset, 10);
  renderDays();
  renderTimeOptions();
  updatePlayerText();
});

// ══════════════════════════════════
// Render: Time (native <select>)
// ══════════════════════════════════

function renderTimeOptions() {
  const sel = $('timeSelect');
  const limit = state.dayOffset === 0 ? maxBlockToday() : TOTAL_BLOCKS - 1;

  let html = '<option value="" disabled>Select time</option>';
  for (let b = 0; b < TOTAL_BLOCKS; b++) {
    if (b > limit) break;
    const selected = b === state.timeBlock ? ' selected' : '';
    html += `<option value="${b}"${selected}>${blockTo12h(b)}</option>`;
  }
  sel.innerHTML = html;

  // Keep current selection visible if valid
  if (state.timeBlock !== null && state.timeBlock <= limit) {
    sel.value = state.timeBlock;
  } else if (state.timeBlock !== null) {
    sel.value = '';
  }
}

$('timeSelect').addEventListener('change', (e) => {
  state.timeBlock = parseInt(e.target.value, 10);
  playCurrentBlock();
});

// ══════════════════════════════════
// Player
// ══════════════════════════════════

function playCurrentBlock() {
  if (state.timeBlock === null) return;

  const date = getNZDate(state.dayOffset);
  const url = buildUrl(state.region, date, state.timeBlock);

  state.loading = true;
  state.playing = false;
  updatePlayerUI();

  audio.src = url;
  audio.load();
  audio.play().catch(() => {
    state.loading = false;
    showToast('Playback failed');
    updatePlayerUI();
  });
}

function togglePlay() {
  if (state.timeBlock === null) {
    showToast('Select a time first');
    return;
  }
  if (audio.paused) {
    if (!audio.src) playCurrentBlock();
    else audio.play();
  } else {
    audio.pause();
  }
}

function skipBlock(delta) {
  if (state.timeBlock === null) return;
  let next = state.timeBlock + delta;

  if (next < 0) {
    if (state.dayOffset < 6) {
      state.dayOffset++;
      next = TOTAL_BLOCKS - 1;
      renderDays();
      renderTimeOptions();
    } else return;
  } else if (next >= TOTAL_BLOCKS) {
    if (state.dayOffset > 0) {
      state.dayOffset--;
      next = 0;
      renderDays();
      renderTimeOptions();
    } else return;
  }

  const limit = state.dayOffset === 0 ? maxBlockToday() : TOTAL_BLOCKS - 1;
  if (next > limit) return;

  state.timeBlock = next;
  $('timeSelect').value = next;
  playCurrentBlock();
}

// ── UI Updates ──

function updatePlayerText() {
  if (state.timeBlock === null) return;
  const date = getNZDate(state.dayOffset);
  const dayLabel = state.dayOffset === 0 ? 'Today'
    : state.dayOffset === 1 ? 'Yesterday'
    : `${DAY_NAMES_SHORT[date.getDay()]} ${date.getDate()} ${MONTH_NAMES[date.getMonth()]}`;

  $('playerTitle').textContent = `${regionLabel(state.region)} \u2014 ${blockTo12h(state.timeBlock)}`;
  $('playerSubtitle').textContent = dayLabel;
}

function updatePlayerUI() {
  btnPlay.classList.toggle('loading', state.loading);

  const icon = btnPlay.querySelector('.play-icon');
  if (state.playing) {
    icon.innerHTML = '<path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/>';
  } else {
    icon.innerHTML = '<path d="M8 5v14l11-7z"/>';
  }

  if (state.timeBlock !== null) updatePlayerText();
}

// ── Audio Events ──

audio.addEventListener('playing', () => {
  state.loading = false;
  state.playing = true;
  updatePlayerUI();
});

audio.addEventListener('pause', () => {
  state.playing = false;
  updatePlayerUI();
});

audio.addEventListener('ended', () => {
  state.playing = false;
  updatePlayerUI();
  skipBlock(1);
});

audio.addEventListener('error', () => {
  state.loading = false;
  state.playing = false;
  showToast('Audio not available');
  updatePlayerUI();
});

audio.addEventListener('timeupdate', () => {
  if (!audio.duration) return;
  $('progressFill').style.width = (audio.currentTime / audio.duration) * 100 + '%';
  $('timeCurrent').textContent = formatSecs(audio.currentTime);
  $('timeTotal').textContent = formatSecs(audio.duration);
});

// ── Progress Seeking ──

$('progressWrap').addEventListener('click', (e) => {
  if (!audio.duration) return;
  const rect = e.currentTarget.getBoundingClientRect();
  audio.currentTime = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width)) * audio.duration;
});

// ── Button Events ──

btnPlay.addEventListener('click', togglePlay);
$('btnPrev').addEventListener('click', () => skipBlock(-1));
$('btnNext').addEventListener('click', () => skipBlock(1));

// ── MediaSession (lock screen) ──

if ('mediaSession' in navigator) {
  navigator.mediaSession.setActionHandler('play', () => audio.play());
  navigator.mediaSession.setActionHandler('pause', () => audio.pause());
  navigator.mediaSession.setActionHandler('previoustrack', () => skipBlock(-1));
  navigator.mediaSession.setActionHandler('nexttrack', () => skipBlock(1));

  audio.addEventListener('playing', () => {
    navigator.mediaSession.metadata = new MediaMetadata({
      title: `${blockTo12h(state.timeBlock)} \u2014 ${regionLabel(state.region)}`,
      artist: 'Newstalk ZB',
      album: 'Week on Demand',
    });
  });
}

// ── Keyboard ──

document.addEventListener('keydown', (e) => {
  if (e.code === 'Space') { e.preventDefault(); togglePlay(); }
  if (e.code === 'ArrowLeft') skipBlock(-1);
  if (e.code === 'ArrowRight') skipBlock(1);
});

// ── Init ──

renderRegions();
renderDays();
renderTimeOptions();
updatePlayerUI();

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
