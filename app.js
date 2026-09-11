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
var _availTimer = null;
var _availKey = '';    // date + newest available block, to skip no-op refreshes
var _availDate = '';   // NZ date the app currently thinks "today" is

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

// Time dropdown (hidden select — drives the visible time-display)
function renderTime() {
  var sel = $('timeSel');
  var lim = S.day === 0 ? availLimit() : TOTAL - 1;
  var html = '<option value="" disabled>--:--</option>';
  for (var b = 0; b <= lim; b++) {
    html += '<option value="' + b + '"' +
      (b === S.block ? ' selected' : '') + '>' + to12(b) + '</option>';
  }
  sel.innerHTML = html;
  if (S.block !== null && S.block <= lim) sel.value = S.block;
  updateTimeDisplay();
}

// Today's list only ever grows, so append rather than rewriting innerHTML:
// a full rebuild can dismiss the native picker if it happens while it's open.
function growTimeOptions(lim) {
  var sel = $('timeSel');
  var next = sel.options.length - 1;   // minus the '--:--' placeholder
  if (next > lim + 1) return;          // longer than it should be; leave to renderTime()
  for (var b = next; b <= lim; b++) {
    var o = document.createElement('option');
    o.value = b;
    o.textContent = to12(b);
    sel.appendChild(o);
  }
  if (S.block !== null && S.block <= lim) sel.value = S.block;
}

$('timeSel').addEventListener('change', function(e) {
  _retryCount = 0;
  _waitingNext = false;
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
    // A rejection with no media error is the autoplay policy (an auto-advance
    // fired without a user gesture), not a bad file.
    toast(audio.error ? 'Playback failed' : 'Tap play to continue');
    updateUI();
  });
}

function toggle() {
  if (S.block === null) { toast('Pick a time first'); return; }
  if (audio.paused) {
    _waitingNext = false;   // a manual play takes over from a pending auto-advance
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
  $('timeSel').value = next;
  updateTimeDisplay();
  play();
  return true;
}

function userSkip(d) { _retryCount = 0; _waitingNext = false; skip(d); }

// ── UI Updates ──

// Sub-label under the clock: newest block available right now, tappable to
// catch up to it.
function updateSub() {
  var el = $('nowSub');
  var lim = availLimit();
  if (lim < 0) {                      // just after midnight, nothing from today
    el.textContent = '15-minute blocks';
    el.classList.remove('tap');
    return;
  }
  var atLatest = (S.day === 0 && S.block === lim);
  el.textContent = atLatest ? 'Latest block' : 'Latest: ' + to12(lim);
  el.classList.toggle('tap', !atLatest);
}

function updateNow() {
  updateSub();
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
  $('progFill').style.width = (audio.currentTime / audio.duration * 100) + '%';
  $('timeCur').textContent = fmtSec(audio.currentTime);
  $('timeTot').textContent = fmtSec(audio.duration);
});

// ── Stall watchdog ──
// Catches the "looks like it's playing but nothing can be heard" state.
// Tracks the playback position rather than wall-clock time: iOS suspends the
// page's timers while backgrounded even though audio keeps playing, so a pure
// wall-clock check reloaded healthy playback every time the app came back.
var _wdPos = -1, _wdSince = 0;
setInterval(function() {
  if (!S.playing || audio.paused) { _wdPos = -1; _wdSince = 0; return; }
  var p = audio.currentTime;
  if (_wdPos < 0 || p > _wdPos + 0.25) { _wdPos = p; _wdSince = Date.now(); return; }
  if (Date.now() - _wdSince > 12000) {
    _resumeAt = p;
    _wdPos = -1; _wdSince = 0;
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
  if (!_waitingNext) return;
  // Always leave a timer armed while waiting — an early return here used to
  // break the chain permanently, so auto-advance died until the next relaunch.
  clearTimeout(_autoTimer);
  if (S.playing || S.loading) {
    _autoTimer = setTimeout(tryAutoNext, 30000);
    return;
  }
  if (!skip(1)) _autoTimer = setTimeout(tryAutoNext, 30000);
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
  if (e.target.closest && e.target.closest('select, button, input, [role="button"]')) return;
  if (e.code === 'Space') { e.preventDefault(); toggle(); }
  if (e.code === 'ArrowLeft') userSkip(-1);
  if (e.code === 'ArrowRight') userSkip(1);
});

// ══════════════════════════
// AVAILABILITY REFRESH
// ══════════════════════════
// Which blocks exist is derived from the NZ clock, but nothing recomputed it
// while the app sat open, so a block published mid-session never appeared
// until the PWA was relaunched. Poll for the boundary moving.

// A native <select> picker is open when its element holds focus. Rebuilding
// its options then can dismiss or corrupt the iOS picker, so defer instead.
function pickerOpen() {
  return document.activeElement === $('timeSel') ||
         document.activeElement === $('daySel');
}

function refreshAvail() {
  var today = dotDate(nzDate(0));
  var lim = availLimit();
  var key = today + ':' + lim;
  if (key === _availKey) return;
  if (pickerOpen()) return;   // key not consumed — retried on the next tick
  _availKey = key;

  if (_availDate && _availDate !== today) {
    // Midnight rolled over: day offsets now point one day further back, so
    // bump S.day to keep the listener on the same actual calendar date.
    if (S.day < 6) S.day++;
    _availDate = today;
    renderDays();
    renderTime();
    updateNow();
    return;
  }
  _availDate = today;

  if (S.day === 0) growTimeOptions(lim);
  updateNow();
}

function availTick() {
  refreshAvail();
  if (_waitingNext) tryAutoNext();
}

// Catch up to the newest available block
$('nowSub').addEventListener('keydown', function(e) {
  if (e.code === 'Enter' || e.code === 'Space') { e.preventDefault(); this.click(); }
});

$('nowSub').addEventListener('click', function() {
  var lim = availLimit();
  if (lim < 0 || (S.day === 0 && S.block === lim)) return;
  _retryCount = 0;
  _edgeRetries = 0;
  _waitingNext = false;
  if (S.day !== 0) { S.day = 0; renderDays(); renderTime(); }
  S.block = lim;
  $('timeSel').value = lim;
  updateTimeDisplay();
  updateNow();
  play();
});

document.addEventListener('visibilitychange', function() {
  if (!document.hidden) availTick();
});
window.addEventListener('pageshow', refreshAvail);

// Flush a refresh deferred by pickerOpen() as soon as the picker closes
$('timeSel').addEventListener('blur', refreshAvail);
$('daySel').addEventListener('blur', refreshAvail);

// ── Init ──

applyDefault();
renderRegion();
renderDays();
renderTime();
updateUI();
refreshAvail();
_availTimer = setInterval(availTick, 30000);

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
