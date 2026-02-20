// ── Config ──
var REGIONS = ['auckland', 'wellington', 'christchurch'];
var BLOCK_MIN = 15;
var BPH = 60 / BLOCK_MIN;            // blocks per hour
var TOTAL = 24 * BPH;                // 96 blocks/day
var NZ_OFF = 13;                      // NZDT = UTC+13
var DEFAULT_BLOCK = 28;               // 7:00 am
var MAX_RETRIES = 2;
var DAYS_SHORT = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
var MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

// ── State ──
var S = {
  region: localStorage.getItem('zb_region') || 'auckland',
  day: 0,       // 0=today, 1=yesterday, ...6
  block: null,  // 0-95
  playing: false,
  loading: false
};
var _retryCount = 0;

// ── DOM shortcuts ──
function $(id) { return document.getElementById(id); }
var audio   = $('audio');
var btnPlay = $('btnPlay');
var appEl   = document.querySelector('.app');

// ── NZ time helpers ──

function nzNow() {
  var d = new Date();
  return new Date(d.getTime() + (NZ_OFF * 60 + d.getTimezoneOffset()) * 60000);
}

function nzDate(ago) {
  var d = nzNow();
  d.setDate(d.getDate() - ago);
  d.setHours(0,0,0,0);
  return d;
}

function dotDate(d) {
  return d.getFullYear() + '.' +
    String(d.getMonth()+1).padStart(2,'0') + '.' +
    String(d.getDate()).padStart(2,'0');
}

function blkH(b) { return Math.floor(b / BPH); }
function blkM(b) { return (b % BPH) * BLOCK_MIN; }

function to12(b) {
  var h = blkH(b), m = blkM(b);
  var ap = h < 12 ? 'am' : 'pm';
  var h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
  return h12 + ':' + String(m).padStart(2,'0') + ' ' + ap;
}

function toUrl(b) {
  return String(blkH(b)).padStart(2,'0') + '.' +
         String(blkM(b)).padStart(2,'0') + '.00';
}

function maxBlock() {
  var n = nzNow();
  return n.getHours() * BPH + Math.floor(n.getMinutes() / BLOCK_MIN);
}

function cap(r) { return r[0].toUpperCase() + r.slice(1); }

function fmtSec(s) {
  if (!isFinite(s) || s < 0) return '0:00';
  return Math.floor(s/60) + ':' + String(Math.floor(s%60)).padStart(2,'0');
}

function buildUrl() {
  var d = nzDate(S.day);
  return 'https://weekondemand.newstalkzb.co.nz/WeekOnDemand/ZB/' +
    S.region + '/' + dotDate(d) + '-' + toUrl(S.block) + '-D.mp3';
}

// ── Toast ──
var _tt;
function toast(m) {
  var el = $('toast');
  el.textContent = m;
  el.classList.add('show');
  clearTimeout(_tt);
  _tt = setTimeout(function(){ el.classList.remove('show'); }, 2500);
}

// ══════════════════════════
// RENDER
// ══════════════════════════

// Region segmented control
function renderRegion() {
  $('regionSeg').innerHTML = REGIONS.map(function(r) {
    return '<button class="' + (r === S.region ? 'on' : '') +
           '" data-r="' + r + '">' + cap(r) + '</button>';
  }).join('');
}

$('regionSeg').addEventListener('click', function(e) {
  var b = e.target.closest('button');
  if (!b) return;
  S.region = b.dataset.r;
  localStorage.setItem('zb_region', S.region);
  renderRegion();
  updateNow();
  if (S.playing || S.loading) play();
});

// Day dropdown
function renderDays() {
  var sel = $('daySel');
  var html = '';
  for (var i = 0; i < 7; i++) {
    var d = nzDate(i);
    var lbl = i === 0 ? 'Today' : i === 1 ? 'Yesterday' :
      DAYS_SHORT[d.getDay()] + ' ' + d.getDate() + ' ' + MONTHS[d.getMonth()];
    html += '<option value="' + i + '"' + (i === S.day ? ' selected' : '') + '>' + lbl + '</option>';
  }
  sel.innerHTML = html;
}

$('daySel').addEventListener('change', function(e) {
  S.day = parseInt(e.target.value, 10);
  renderTime();
  updateNow();
});

// Time dropdown (hidden select — drives the visible time-display)
function renderTime() {
  var sel = $('timeSel');
  var lim = S.day === 0 ? maxBlock() : TOTAL - 1;
  var html = '<option value="" disabled>--:--</option>';
  for (var b = 0; b <= lim; b++) {
    html += '<option value="' + b + '"' +
      (b === S.block ? ' selected' : '') + '>' + to12(b) + '</option>';
  }
  sel.innerHTML = html;
  if (S.block !== null && S.block <= lim) sel.value = S.block;
  updateTimeDisplay();
}

$('timeSel').addEventListener('change', function(e) {
  S.block = parseInt(e.target.value, 10);
  updateTimeDisplay();
  play();
});

// ── Time display sync ──
function updateTimeDisplay() {
  var el = $('timeDisplay');
  if (S.block === null) {
    el.textContent = '--:--';
  } else {
    el.textContent = to12(S.block);
  }
}

// ══════════════════════════
// PLAYER
// ══════════════════════════

function play() {
  if (S.block === null) return;
  S.loading = true;
  S.playing = false;
  updateUI();
  audio.src = buildUrl();
  audio.load();
  audio.play().catch(function() {
    S.loading = false;
    toast('Playback failed');
    updateUI();
  });
}

function toggle() {
  if (S.block === null) { toast('Pick a time first'); return; }
  if (audio.paused) {
    if (!audio.src) play(); else audio.play();
  } else {
    audio.pause();
  }
}

function skip(d) {
  if (S.block === null) return;
  var next = S.block + d;
  if (next < 0) {
    if (S.day < 6) { S.day++; next = TOTAL - 1; renderDays(); renderTime(); }
    else return;
  } else if (next >= TOTAL) {
    if (S.day > 0) { S.day--; next = 0; renderDays(); renderTime(); }
    else return;
  }
  var lim = S.day === 0 ? maxBlock() : TOTAL - 1;
  if (next > lim) return;
  S.block = next;
  $('timeSel').value = next;
  updateTimeDisplay();
  play();
}

// ── UI Updates ──

function updateNow() {
  if (S.block === null) {
    $('nowTitle').textContent = '';
    return;
  }
  var d = nzDate(S.day);
  var dayLbl = S.day === 0 ? 'Today' : S.day === 1 ? 'Yesterday' :
    DAYS_SHORT[d.getDay()] + ' ' + d.getDate() + ' ' + MONTHS[d.getMonth()];
  $('nowTitle').textContent = cap(S.region) + ' \u2014 ' + dayLbl;
}

function updateUI() {
  appEl.classList.toggle('is-playing', S.playing);
  btnPlay.classList.toggle('loading', S.loading);
  var icon = btnPlay.querySelector('.play-icon');
  icon.innerHTML = S.playing
    ? '<path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/>'
    : '<path d="M8 5v14l11-7z"/>';
  updateTimeDisplay();
  if (S.block !== null) updateNow();
}

// ── Audio Events ──

audio.addEventListener('playing', function() {
  _retryCount = 0;
  S.loading = false; S.playing = true; updateUI();
  updatePositionState();
});
audio.addEventListener('pause', function() {
  S.playing = false; updateUI();
});
audio.addEventListener('ended', function() {
  S.playing = false; updateUI(); skip(1);
});
audio.addEventListener('error', function() {
  S.loading = false; S.playing = false;
  updateUI();
  if (_retryCount < MAX_RETRIES) {
    _retryCount++;
    toast('Trying next block\u2026');
    setTimeout(function() { skip(1); }, 500);
  } else {
    _retryCount = 0;
    toast('Audio not available');
  }
});
audio.addEventListener('timeupdate', function() {
  if (!audio.duration) return;
  $('progFill').style.width = (audio.currentTime / audio.duration * 100) + '%';
  $('timeCur').textContent = fmtSec(audio.currentTime);
  $('timeTot').textContent = fmtSec(audio.duration);
});

// ── Seek by seconds ──
function seekBy(secs) {
  if (!audio.duration) return;
  audio.currentTime = Math.max(0, Math.min(audio.duration, audio.currentTime + secs));
  updatePositionState();
}

// ── MediaSession position state (improves lock screen accuracy) ──
function updatePositionState() {
  if ('mediaSession' in navigator && navigator.mediaSession.setPositionState && audio.duration) {
    try {
      navigator.mediaSession.setPositionState({
        duration: audio.duration,
        playbackRate: audio.playbackRate || 1,
        position: audio.currentTime
      });
    } catch(e) {}
  }
}

// ── Progress bar: tap + drag scrubbing ──
var progBar = $('progBar');
var scrubbing = false;

function scrubTo(clientX) {
  if (!audio.duration) return;
  var r = progBar.getBoundingClientRect();
  var pct = Math.max(0, Math.min(1, (clientX - r.left) / r.width));
  audio.currentTime = pct * audio.duration;
  $('progFill').style.width = (pct * 100) + '%';
  $('timeCur').textContent = fmtSec(pct * audio.duration);
}

progBar.addEventListener('click', function(e) { scrubTo(e.clientX); updatePositionState(); });

function scrubStart() { scrubbing = true; progBar.classList.add('scrubbing'); }
function scrubEnd() { scrubbing = false; progBar.classList.remove('scrubbing'); updatePositionState(); }

progBar.addEventListener('touchstart', function(e) {
  if (!audio.duration) return;
  scrubStart();
  scrubTo(e.touches[0].clientX);
  e.preventDefault();
}, { passive: false });

document.addEventListener('touchmove', function(e) {
  if (!scrubbing) return;
  scrubTo(e.touches[0].clientX);
  e.preventDefault();
}, { passive: false });

document.addEventListener('touchend', function() { if (scrubbing) scrubEnd(); });

progBar.addEventListener('mousedown', function(e) {
  if (!audio.duration) return;
  scrubStart();
  scrubTo(e.clientX);
});

document.addEventListener('mousemove', function(e) {
  if (!scrubbing) return;
  scrubTo(e.clientX);
});

document.addEventListener('mouseup', function() { if (scrubbing) scrubEnd(); });

// ── Buttons ──
btnPlay.addEventListener('click', toggle);
$('btnPrev').addEventListener('click', function() { skip(-1); });
$('btnNext').addEventListener('click', function() { skip(1); });
$('btnBack15').addEventListener('click', function() { seekBy(-15); });
$('btnFwd30').addEventListener('click', function() { seekBy(30); });
$('btnFwd6m').addEventListener('click', function() { seekBy(360); });
$('btnFwd7m').addEventListener('click', function() { seekBy(420); });

// ── MediaSession (lock screen / CarPlay controls) ──
if ('mediaSession' in navigator) {
  navigator.mediaSession.setActionHandler('play', function() { audio.play(); });
  navigator.mediaSession.setActionHandler('pause', function() { audio.pause(); });
  navigator.mediaSession.setActionHandler('previoustrack', function() { skip(-1); });
  navigator.mediaSession.setActionHandler('nexttrack', function() { skip(1); });
  // Always seek our amounts regardless of system-suggested offset
  navigator.mediaSession.setActionHandler('seekforward', function() { seekBy(30); });
  navigator.mediaSession.setActionHandler('seekbackward', function() { seekBy(-15); });
  audio.addEventListener('playing', function() {
    navigator.mediaSession.metadata = new MediaMetadata({
      title: to12(S.block) + ' \u2014 ' + cap(S.region),
      artist: 'Newstalk ZB',
      album: 'Week on Demand'
    });
  });
}

// ── Keyboard ──
document.addEventListener('keydown', function(e) {
  if (e.code === 'Space') { e.preventDefault(); toggle(); }
  if (e.code === 'ArrowLeft') skip(-1);
  if (e.code === 'ArrowRight') skip(1);
});

// ── Init ──

// Default to 7:00 am — if today hasn't reached 7am NZ time, use yesterday
S.block = DEFAULT_BLOCK;
if (S.day === 0 && maxBlock() < DEFAULT_BLOCK) {
  S.day = 1;
}

renderRegion();
renderDays();
renderTime();
updateUI();

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch(function(){});
}
