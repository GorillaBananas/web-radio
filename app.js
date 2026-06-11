// ── Config ──
var REGIONS = ['auckland', 'wellington', 'christchurch'];
var BLOCK_MIN = 15;
var BPH = 60 / BLOCK_MIN;            // blocks per hour
var TOTAL = 24 * BPH;                // 96 blocks/day
var AVAIL_LAG_MIN = 2;               // a block appears on the server ~2 min after it finishes airing
var MORNING_BLOCK = 28;              // 7:00 am
var DRIVE_BLOCK = 67;                // 4:45 pm
var MAX_RETRIES = 2;
var EDGE_RETRY_MS = 20000;           // at the live edge, retry the same block every 20s...
var EDGE_RETRY_MAX = 9;              // ...for up to ~3 minutes
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
var _retryCount = 0;   // transient-error retries for the current block
var _edgeRetries = 0;  // not-yet-published retries at the live edge
var _resumeAt = 0;     // position to restore after a stream reload
var _waitingNext = false;
var _autoTimer = null;
var _lastWall = 0;     // wall-clock time of the last playback progress

// ── DOM shortcuts ──
function $(id) { return document.getElementById(id); }
var audio   = $('audio');
var btnPlay = $('btnPlay');
var appEl   = document.querySelector('.app');

// ── NZ time helpers ──

// NZ wall-clock time via the platform timezone database (handles DST exactly)
var NZ_FMT = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Pacific/Auckland',
  year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit',
  hour12: false
});

function nzNow() {
  var p = {};
  NZ_FMT.formatToParts(new Date()).forEach(function(x) { p[x.type] = x.value; });
  return new Date(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute, +p.second);
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

// Latest block of today that has finished airing and had time to appear
// on the server. Negative just after midnight (nothing from today yet).
function availLimit() {
  var n = nzNow();
  var mins = n.getHours() * 60 + n.getMinutes();
  return Math.floor((mins - AVAIL_LAG_MIN) / BLOCK_MIN) - 1;
}

// Default selection:
//  - after ~5:02pm (4:45pm block available): 4:45pm drive block
//  - after ~7:17am (7:00am block available): 7:00am breakfast block
//  - earlier in the morning: latest available block
//  - just after midnight (nothing from today): yesterday's 11:45pm block
function applyDefault() {
  var avail = availLimit();
  S.day = 0;
  if (avail >= DRIVE_BLOCK) S.block = DRIVE_BLOCK;
  else if (avail >= MORNING_BLOCK) S.block = MORNING_BLOCK;
  else if (avail >= 0) S.block = avail;
  else { S.day = 1; S.block = TOTAL - 1; }
}

function cap(r) { return r[0].toUpperCase() + r.slice(1); }

function fmtSec(s) {
  if (!isFinite(s) || s < 0) return '0:00';
  return Math.floor(s/60) + ':' + String(Math.floor(s%60)).padStart(2,'0');
}

function buildUrl() {
  var d = nzDate(S.day);
  return 'https://weekondemand.newstalkzb.co.nz/WeekOnDemand/ZB/' +
    S.region + '/' + dotDate(d) + '-' + toUrl(S.block) + '-S.mp3';
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
  _retryCount = 0;
  S.region = b.dataset.r;
  localStorage.setItem('zb_region', S.region);
  renderRegion();
  updateNow();
  if (S.playing || S.loading) play();
});

// Day dropdown
function dayLabel(i) {
  var d = nzDate(i);
  return i === 0 ? 'Today' : i === 1 ? 'Yesterday' :
    DAYS_SHORT[d.getDay()] + ' ' + d.getDate() + ' ' + MONTHS[d.getMonth()];
}

function renderDays() {
  var sel = $('daySel');
  var html = '';
  for (var i = 0; i < 7; i++) {
    html += '<option value="' + i + '"' + (i === S.day ? ' selected' : '') + '>' + dayLabel(i) + '</option>';
  }
  sel.innerHTML = html;
}

$('daySel').addEventListener('change', function(e) {
  S.day = parseInt(e.target.value, 10);
  renderTime();
  updateNow();
});

// ── Custom time picker (bottom sheet) ──
var sheetEl = $('timeSheet');
var backdropEl = $('sheetBackdrop');

function buildSheet() {
  var lim = S.day === 0 ? availLimit() : TOTAL - 1;
  $('sheetTitle').textContent = dayLabel(S.day) + ' — ' + cap(S.region);
  var html = '';
  for (var h = 0; h < 24; h++) {
    if (h * BPH > lim) break;
    var hr = h === 0 ? '12 am' : h < 12 ? h + ' am' : h === 12 ? '12 pm' : (h - 12) + ' pm';
    html += '<div class="sheet-row"><div class="sheet-hr">' + hr + '</div>';
    for (var i = 0; i < BPH; i++) {
      var b = h * BPH + i;
      html += '<button class="cell' + (b === S.block ? ' on' : '') + '"' +
        (b > lim ? ' disabled' : '') + ' data-b="' + b + '">:' +
        String(blkM(b)).padStart(2, '0') + '</button>';
    }
    html += '</div>';
  }
  if (!html) html = '<div class="sheet-empty">No blocks available yet today</div>';
  $('sheetGrid').innerHTML = html;
}

function openSheet() {
  buildSheet();
  sheetEl.classList.add('open');
  backdropEl.classList.add('open');
  var on = $('sheetGrid').querySelector('.cell.on');
  if (on) on.scrollIntoView({ block: 'center' });
}

function closeSheet() {
  sheetEl.classList.remove('open');
  backdropEl.classList.remove('open');
}

$('timeDisplay').addEventListener('click', openSheet);
$('sheetClose').addEventListener('click', closeSheet);
backdropEl.addEventListener('click', closeSheet);

$('sheetGrid').addEventListener('click', function(e) {
  var b = e.target.closest('.cell');
  if (!b || b.disabled) return;
  _retryCount = 0;
  _waitingNext = false;
  S.block = parseInt(b.dataset.b, 10);
  closeSheet();
  updateTimeDisplay();
  play();
});

function renderTime() {
  updateTimeDisplay();
  if (sheetEl.classList.contains('open')) buildSheet();
}

// ── Time display sync ──
function updateTimeDisplay() {
  var el = $('timeDisplay');
  if (S.block === null) {
    el.textContent = '--:--';
  } else {
    var t = to12(S.block).split(' ');
    el.innerHTML = t[0] + '<span class="ampm">' + t[1] + '</span>';
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

// Returns true if it actually moved to another block
function skip(d) {
  if (S.block === null) return false;
  var next = S.block + d;
  if (next < 0) {
    if (S.day < 6) { S.day++; next = TOTAL - 1; renderDays(); renderTime(); }
    else return false;
  } else if (next >= TOTAL) {
    if (S.day > 0) { S.day--; next = 0; renderDays(); renderTime(); }
    else { toast('You’re all caught up'); return false; }
  }
  var lim = S.day === 0 ? availLimit() : TOTAL - 1;
  if (next > lim) {
    if (d > 0) toast('You’re all caught up');
    return false;
  }
  _waitingNext = false;
  S.block = next;
  updateTimeDisplay();
  play();
  return true;
}

function userSkip(d) { _retryCount = 0; _waitingNext = false; skip(d); }

// ── UI Updates ──

function updateNow() {
  if (S.block === null) {
    $('nowTitle').textContent = '';
    return;
  }
  $('nowTitle').textContent = cap(S.region) + ' \u2014 ' + dayLabel(S.day);
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

// At the live edge = playing today's newest published block
function liveEdge() {
  return S.day === 0 && S.block !== null && S.block >= availLimit();
}

audio.addEventListener('playing', function() {
  _retryCount = 0;
  _edgeRetries = 0;
  S.loading = false; S.playing = true; updateUI();
  _lastWall = Date.now();
  if (_resumeAt > 0) {
    var t = _resumeAt;
    _resumeAt = 0;
    try { audio.currentTime = t; } catch (e) {}
  }
  updatePositionState();
});
audio.addEventListener('pause', function() {
  S.playing = false; updateUI();
});
audio.addEventListener('ended', function() {
  S.playing = false; updateUI();
  // Auto-advance; if the next block isn't published yet, wait for it
  if (!skip(1)) armAutoAdvance();
});
audio.addEventListener('error', function() {
  if (!audio.src) return;
  S.loading = false; S.playing = false;
  updateUI();
  if (_retryCount === 0) {
    // First failure may be a transient network blip \u2014 retry the same block
    _retryCount++;
    toast('Retrying\u2026');
    setTimeout(play, 1000);
  } else if (liveEdge() && _edgeRetries < EDGE_RETRY_MAX) {
    // The newest block sometimes takes longer than usual to publish \u2014
    // keep retrying the same URL instead of skipping into nothing
    _edgeRetries++;
    toast('Waiting for broadcast\u2026');
    setTimeout(play, EDGE_RETRY_MS);
  } else if (!liveEdge() && _retryCount <= MAX_RETRIES) {
    _retryCount++;
    toast('Trying next block\u2026');
    setTimeout(function() { skip(1); }, 500);
  } else {
    _retryCount = 0;
    _edgeRetries = 0;
    toast('Audio not available');
  }
});
audio.addEventListener('timeupdate', function() {
  if (!audio.duration) return;
  _lastWall = Date.now();
  $('progFill').style.width = (audio.currentTime / audio.duration * 100) + '%';
  $('timeCur').textContent = fmtSec(audio.currentTime);
  $('timeTot').textContent = fmtSec(audio.duration);
});

// ── Stall watchdog ──
// Catches the "looks like it's playing but nothing can be heard" state:
// if the playback clock stops advancing for 10s while nominally playing,
// reload the stream and resume from the same position.
setInterval(function() {
  if (!S.playing || audio.paused || !_lastWall) return;
  if (Date.now() - _lastWall > 10000) {
    _resumeAt = audio.currentTime;
    _lastWall = Date.now();
    toast('Reconnecting…');
    play();
  }
}, 5000);

// ── Auto-advance at the live edge ──
// After today's newest block ends, the next one is only published ~2 min
// after it finishes airing. Wait for that moment and resume automatically.
function armAutoAdvance() {
  if (S.day !== 0 || S.block === null || S.block + 1 >= TOTAL) return;
  _waitingNext = true;
  toast('Next block isn’t ready yet — will resume when it is');
  clearTimeout(_autoTimer);
  var n = nzNow();
  var nowMin = n.getHours() * 60 + n.getMinutes() + n.getSeconds() / 60;
  var publishMin = (S.block + 2) * BLOCK_MIN + AVAIL_LAG_MIN;
  var waitMs = Math.max(5, (publishMin - nowMin) * 60 + 10) * 1000;
  _autoTimer = setTimeout(tryAutoNext, waitMs);
}

function tryAutoNext() {
  if (!_waitingNext || S.playing || S.loading) return;
  if (!skip(1)) {
    clearTimeout(_autoTimer);
    _autoTimer = setTimeout(tryAutoNext, 30000);
  }
}

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
$('btnPrev').addEventListener('click', function() { userSkip(-1); });
$('btnNext').addEventListener('click', function() { userSkip(1); });
$('btnBack15').addEventListener('click', function() { seekBy(-15); });
$('btnFwd30').addEventListener('click', function() { seekBy(30); });
$('btnFwd2m').addEventListener('click', function() { seekBy(120); });
$('btnFwd7m').addEventListener('click', function() { seekBy(420); });

// ── Lock-screen artwork: ZB roundel drawn once on a canvas ──
var _artUrl = null;
(function() {
  try {
    var c = document.createElement('canvas');
    c.width = c.height = 512;
    var x = c.getContext('2d');
    x.fillStyle = '#0a0a0a';
    x.fillRect(0, 0, 512, 512);
    // broadcast arcs either side of the roundel
    x.strokeStyle = 'rgba(230,57,70,.35)';
    x.lineWidth = 12;
    x.lineCap = 'round';
    [185, 215].forEach(function(r) {
      x.beginPath(); x.arc(256, 246, r, -0.5, 0.5); x.stroke();
      x.beginPath(); x.arc(256, 246, r, Math.PI - 0.5, Math.PI + 0.5); x.stroke();
    });
    // red roundel
    x.fillStyle = '#e63946';
    x.beginPath(); x.arc(256, 246, 150, 0, 2 * Math.PI); x.fill();
    x.textAlign = 'center';
    x.textBaseline = 'middle';
    x.fillStyle = '#fff';
    x.font = '600 26px -apple-system, system-ui, sans-serif';
    x.fillText('N E W S T A L K', 256, 178);
    x.font = '800 140px -apple-system, system-ui, sans-serif';
    x.fillText('ZB', 256, 268);
    x.fillStyle = '#e63946';
    x.font = '600 34px -apple-system, system-ui, sans-serif';
    x.fillText('O N   D E M A N D', 256, 466);
    c.toBlob(function(b) {
      if (b) _artUrl = URL.createObjectURL(b);
    }, 'image/png');
  } catch (e) {}
})();

// ── MediaSession (lock screen / CarPlay controls) ──
if ('mediaSession' in navigator) {
  navigator.mediaSession.setActionHandler('play', function() { audio.play(); });
  navigator.mediaSession.setActionHandler('pause', function() { audio.pause(); });
  navigator.mediaSession.setActionHandler('previoustrack', function() { skip(-1); });
  navigator.mediaSession.setActionHandler('nexttrack', function() { skip(1); });
  // Always seek our amounts regardless of system-suggested offset
  navigator.mediaSession.setActionHandler('seekforward', function() { seekBy(30); });
  navigator.mediaSession.setActionHandler('seekbackward', function() { seekBy(-15); });
  // Lock-screen scrubber
  try {
    navigator.mediaSession.setActionHandler('seekto', function(d) {
      if (d.fastSeek && 'fastSeek' in audio) { audio.fastSeek(d.seekTime); return; }
      audio.currentTime = d.seekTime;
      updatePositionState();
    });
  } catch (e) {}
  audio.addEventListener('playing', function() {
    navigator.mediaSession.metadata = new MediaMetadata({
      title: to12(S.block) + ' \u2014 ' + dayLabel(S.day),
      artist: 'Newstalk ZB ' + cap(S.region),
      album: 'Week on Demand',
      artwork: _artUrl
        ? [{ src: _artUrl, sizes: '512x512', type: 'image/png' }]
        : [{ src: 'icon.svg', sizes: '512x512', type: 'image/svg+xml' }]
    });
  });
}

// ── Keyboard ──
document.addEventListener('keydown', function(e) {
  // Don't hijack keys while a control (e.g. the day select) has focus
  if (e.target.closest && e.target.closest('select, button, input')) return;
  if (e.code === 'Space') { e.preventDefault(); toggle(); }
  if (e.code === 'ArrowLeft') userSkip(-1);
  if (e.code === 'ArrowRight') userSkip(1);
});

// ── Keep "Today" fresh ──
// If the PWA sits open (common on iOS), the day labels and today's block list
// go stale. Re-render whenever the app comes back to the foreground.
var _clockKey = '';
function refreshClock() {
  var key = dotDate(nzDate(0)) + ':' + availLimit();
  if (key === _clockKey) return;
  _clockKey = key;
  renderDays();
  renderTime();
  updateNow();
}

document.addEventListener('visibilitychange', function() {
  if (!document.hidden) {
    refreshClock();
    tryAutoNext();
  }
});
window.addEventListener('pageshow', refreshClock);

// ── Init ──

applyDefault();
renderRegion();
renderDays();
renderTime();
updateUI();

if ('serviceWorker' in navigator) {
  // updateViaCache:'none' — always fetch sw.js from network, never HTTP cache
  navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).catch(function(){});

  // When a new SW activates and takes control, reload to get fresh assets
  var refreshing = false;
  navigator.serviceWorker.addEventListener('controllerchange', function() {
    if (!refreshing) {
      refreshing = true;
      window.location.reload();
    }
  });
}
