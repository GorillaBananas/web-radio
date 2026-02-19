// ── Config ──
const REGIONS = ['auckland', 'wellington', 'christchurch'];
const BLOCK_MINUTES = 15;
const BLOCKS_PER_HOUR = 60 / BLOCK_MINUTES;
const TOTAL_BLOCKS = 24 * BLOCKS_PER_HOUR;
const NZDT_OFFSET = 13; // NZDT = UTC+13

const TIME_GROUPS = [
  { label: 'Early Morning', start: 0, end: 6 },
  { label: 'Morning', start: 6, end: 12 },
  { label: 'Afternoon', start: 12, end: 18 },
  { label: 'Evening', start: 18, end: 24 },
];

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
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

// ── DOM Helpers ──
const $ = (id) => document.getElementById(id);
const audio = $('audio');
const playerBar = $('playerBar');
const progressFill = $('progressFill');
const btnPlay = $('btnPlay');

// ── Date/Time Helpers ──

function getNZNow() {
  const now = new Date();
  return new Date(now.getTime() + (NZDT_OFFSET * 60 + now.getTimezoneOffset()) * 60000);
}

function getNZDate(daysAgo) {
  const nzNow = getNZNow();
  nzNow.setDate(nzNow.getDate() - daysAgo);
  nzNow.setHours(0, 0, 0, 0);
  return nzNow;
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

function isFutureBlock(dayOffset, block) {
  if (dayOffset > 0) return false;
  const nzNow = getNZNow();
  const nowBlock = nzNow.getHours() * BLOCKS_PER_HOUR +
                   Math.floor(nzNow.getMinutes() / BLOCK_MINUTES);
  return block > nowBlock;
}

function regionLabel(r) {
  return r.charAt(0).toUpperCase() + r.slice(1);
}

function formatSecs(seconds) {
  if (!isFinite(seconds) || seconds < 0) return '0:00';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

// ── URL Builder ──

function buildUrl(region, date, block) {
  const base = 'https://weekondemand.newstalkzb.co.nz/WeekOnDemand/ZB';
  return `${base}/${region}/${formatDateDot(date)}-${blockToUrlTime(block)}-D.mp3`;
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

// ── Render: Regions ──

function renderRegions() {
  const wrap = $('regionPills');
  wrap.innerHTML = REGIONS.map((r) => {
    const cls = r === state.region ? 'region-pill active' : 'region-pill';
    return `<div class="${cls}" data-region="${r}">${regionLabel(r)}</div>`;
  }).join('');
}

$('regionPills').addEventListener('click', (e) => {
  const pill = e.target.closest('.region-pill');
  if (!pill) return;
  state.region = pill.dataset.region;
  localStorage.setItem('zb_region', state.region);
  renderRegions();
  renderTimeGrid();
  if (state.playing || state.loading) playCurrentBlock();
});

// ── Render: Days ──

function renderDays() {
  const wrap = $('dayScroll');
  let html = '';
  for (let i = 0; i < 7; i++) {
    const date = getNZDate(i);
    const name = i === 0 ? 'Today' : i === 1 ? 'Yest.' : DAY_NAMES[date.getDay()];
    const active = i === state.dayOffset;
    const today = i === 0 && !active;
    html += `<div class="day-card${active ? ' active' : ''}${today ? ' today' : ''}" data-offset="${i}">
      <div class="day-name">${name}</div>
      <div class="day-date">${date.getDate()}</div>
      <div class="day-month">${MONTH_NAMES[date.getMonth()]}</div>
    </div>`;
  }
  wrap.innerHTML = html;
}

$('dayScroll').addEventListener('click', (e) => {
  const card = e.target.closest('.day-card');
  if (!card) return;
  state.dayOffset = parseInt(card.dataset.offset, 10);
  renderDays();
  renderTimeGrid();
});

// ── Render: Time Grid ──

function renderTimeGrid() {
  const container = $('timeGrid');
  let html = '';

  for (const group of TIME_GROUPS) {
    const startBlock = group.start * BLOCKS_PER_HOUR;
    const endBlock = group.end * BLOCKS_PER_HOUR;

    html += '<div class="time-group">';
    html += `<div class="time-group-label">${group.label}</div>`;
    html += '<div class="time-grid">';

    for (let b = startBlock; b < endBlock; b++) {
      const future = isFutureBlock(state.dayOffset, b);
      const isActive = b === state.timeBlock;
      const isPlaying = isActive && (state.playing || state.loading);
      let cls = 'time-slot';
      if (isPlaying) cls += ' playing';
      else if (isActive) cls += ' active';
      if (future) cls += ' future';
      html += `<div class="${cls}" data-block="${b}">${blockToDisplay(b)}</div>`;
    }

    html += '</div></div>';
  }

  container.innerHTML = html;
}

$('timeGrid').addEventListener('click', (e) => {
  const slot = e.target.closest('.time-slot');
  if (!slot || slot.classList.contains('future')) return;
  state.timeBlock = parseInt(slot.dataset.block, 10);
  playCurrentBlock();
});

// ── Player Logic ──

function playCurrentBlock() {
  if (state.timeBlock === null) return;

  const date = getNZDate(state.dayOffset);
  const url = buildUrl(state.region, date, state.timeBlock);

  state.loading = true;
  state.playing = false;
  updatePlayerUI();
  renderTimeGrid();

  audio.src = url;
  audio.load();
  audio.play().catch(() => {
    state.loading = false;
    showToast('Playback failed');
    updatePlayerUI();
    renderTimeGrid();
  });
}

function togglePlay() {
  if (state.timeBlock === null) return;
  if (audio.paused) {
    if (!audio.src) {
      playCurrentBlock();
    } else {
      audio.play();
    }
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
    } else {
      return;
    }
  } else if (next >= TOTAL_BLOCKS) {
    if (state.dayOffset > 0) {
      state.dayOffset--;
      next = 0;
      renderDays();
    } else {
      return;
    }
  }

  if (isFutureBlock(state.dayOffset, next)) return;
  state.timeBlock = next;
  renderTimeGrid();
  playCurrentBlock();
}

// ── Player UI Update ──

function updatePlayerUI() {
  const show = state.timeBlock !== null;
  playerBar.classList.toggle('visible', show);
  document.documentElement.style.setProperty(
    '--player-height', show ? '110px' : '0px'
  );
  if (!show) return;

  playerBar.classList.toggle('loading', state.loading);

  const date = getNZDate(state.dayOffset);
  const dayLabel = state.dayOffset === 0
    ? 'Today'
    : state.dayOffset === 1
      ? 'Yesterday'
      : `${DAY_NAMES[date.getDay()]} ${date.getDate()} ${MONTH_NAMES[date.getMonth()]}`;

  $('playerTitle').textContent =
    `${regionLabel(state.region)} \u2014 ${blockToDisplay(state.timeBlock)}`;
  $('playerSubtitle').textContent = `${dayLabel} \u2022 15 min block`;

  const playIcon = btnPlay.querySelector('.play-icon');
  if (state.playing) {
    playIcon.innerHTML = '<path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/>';
  } else {
    playIcon.innerHTML = '<path d="M8 5v14l11-7z"/>';
  }
}

// ── Audio Events ──

audio.addEventListener('playing', () => {
  state.loading = false;
  state.playing = true;
  updatePlayerUI();
  renderTimeGrid();
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
  showToast('Audio not available for this time slot');
  updatePlayerUI();
  renderTimeGrid();
});

audio.addEventListener('timeupdate', () => {
  if (!audio.duration) return;
  progressFill.style.width = (audio.currentTime / audio.duration) * 100 + '%';
  $('timeCurrent').textContent = formatSecs(audio.currentTime);
  $('timeTotal').textContent = formatSecs(audio.duration);
});

// ── Progress Seeking ──

$('progressWrap').addEventListener('click', (e) => {
  if (!audio.duration) return;
  const rect = e.currentTarget.getBoundingClientRect();
  const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
  audio.currentTime = pct * audio.duration;
});

// ── Button Events ──

btnPlay.addEventListener('click', togglePlay);
$('btnPrev').addEventListener('click', () => skipBlock(-1));
$('btnNext').addEventListener('click', () => skipBlock(1));

// ── MediaSession (lock screen controls) ──

if ('mediaSession' in navigator) {
  navigator.mediaSession.setActionHandler('play', () => audio.play());
  navigator.mediaSession.setActionHandler('pause', () => audio.pause());
  navigator.mediaSession.setActionHandler('previoustrack', () => skipBlock(-1));
  navigator.mediaSession.setActionHandler('nexttrack', () => skipBlock(1));

  audio.addEventListener('playing', () => {
    navigator.mediaSession.metadata = new MediaMetadata({
      title: `${blockToDisplay(state.timeBlock)} \u2014 ${regionLabel(state.region)}`,
      artist: 'Newstalk ZB',
      album: 'Week on Demand',
    });
  });
}

// ── Keyboard Shortcuts ──

document.addEventListener('keydown', (e) => {
  if (e.code === 'Space') { e.preventDefault(); togglePlay(); }
  if (e.code === 'ArrowLeft') skipBlock(-1);
  if (e.code === 'ArrowRight') skipBlock(1);
});

// ── Init ──

renderRegions();
renderDays();
renderTimeGrid();
updatePlayerUI();

// ── Service Worker ──

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
