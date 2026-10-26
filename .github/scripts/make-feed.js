#!/usr/bin/env node
// Build a podcast feed of NewstalkZB Week on Demand blocks, so the shows can be
// followed in any podcast app — including Apple Podcasts on a cellular Apple
// Watch, which streams standalone with no iPhone nearby. watchOS has no browser,
// so the PWA itself can never run there; this is the way in.
//
// Dependency-free on purpose: the repo has no package.json or build step.
//
// The date/URL logic mirrors app.js (see ZB-ONDEMAND-URLS.md §5 for the
// parameterised reference implementation).

'use strict';

const REGION = 'auckland';
const DAYS = 3;                     // how many NZ days back to include
const SEGMENTS = [
  { name: 'Breakfast', from: 27, to: 35 },   // 6:45 am – 9:00 am
  { name: 'Drive',     from: 67, to: 75 },   // 4:45 pm – 7:00 pm
];

// ZB_BASE exists so the generator can be pointed at a stub server in tests;
// in normal use it is unset and the real host is used.
const BASE = process.env.ZB_BASE || 'https://weekondemand.newstalkzb.co.nz/WeekOnDemand/ZB';
const SITE = 'https://gorillabananas.github.io/web-radio';
const SUFFIXES = ['D', 'S'];        // upstream flips this; see ZB-ONDEMAND-URLS.md §4.1
const BLOCK_MIN = 15;
const BPH = 60 / BLOCK_MIN;
const AVAIL_LAG_MIN = 2;            // a block appears ~2 min after it finishes airing
const DAYS_SHORT = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

// ── NZ time (same approach as app.js: the platform tz database, so DST is exact)
const NZ_FMT = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Pacific/Auckland',
  year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit',
  hour12: false,
});

function nzParts(ts) {
  const p = {};
  NZ_FMT.formatToParts(new Date(ts)).forEach(x => { p[x.type] = x.value; });
  return p;
}

// NZ wall clock as a Date whose *local* fields hold the NZ values (as app.js does)
function nzNow() {
  const p = nzParts(Date.now());
  return new Date(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute, +p.second);
}

function nzDate(ago) {
  const d = nzNow();
  d.setDate(d.getDate() - ago);
  d.setHours(0, 0, 0, 0);
  return d;
}

function dotDate(d) {
  return d.getFullYear() + '.' +
    String(d.getMonth() + 1).padStart(2, '0') + '.' +
    String(d.getDate()).padStart(2, '0');
}

const blkH = b => Math.floor(b / BPH);
const blkM = b => (b % BPH) * BLOCK_MIN;

function to12(b) {
  const h = blkH(b), m = blkM(b);
  const ap = h < 12 ? 'am' : 'pm';
  const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
  return h12 + ':' + String(m).padStart(2, '0') + ' ' + ap;
}

function toUrl(b) {
  return String(blkH(b)).padStart(2, '0') + '.' +
         String(blkM(b)).padStart(2, '0') + '.00';
}

function availLimit() {
  const n = nzNow();
  return Math.floor((n.getHours() * 60 + n.getMinutes() - AVAIL_LAG_MIN) / BLOCK_MIN) - 1;
}

// NZ offset in minutes at a given real instant
function nzOffsetAt(ts) {
  const p = nzParts(ts);
  const asUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute, +p.second);
  return Math.round((asUtc - ts) / 60000);
}

// A block's NZ wall-clock time -> the real UTC instant it aired, for <pubDate>.
// Guess, then correct, so a DST changeover cannot shift it by an hour.
function nzWallToInstant(y, mo, d, hh, mm) {
  const guess = Date.UTC(y, mo - 1, d, hh, mm, 0);
  let utc = guess - nzOffsetAt(guess) * 60000;
  const off2 = nzOffsetAt(utc);
  const corrected = guess - off2 * 60000;
  if (corrected !== utc) utc = corrected;
  return new Date(utc);
}

function blockUrl(dateStr, block, suffix) {
  return `${BASE}/${REGION}/${dateStr}-${toUrl(block)}-${suffix}.mp3`;
}

function xmlEscape(s) {
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

async function headOk(url) {
  try {
    const res = await fetch(url, { method: 'GET', headers: { Range: 'bytes=0-1023' } });
    return { ok: res.status === 200 || res.status === 206, status: res.status, res };
  } catch (e) {
    return { ok: false, status: 0, error: e.message };
  }
}

// Work out which suffix the server is serving today. A static feed cannot retry
// the way app.js does, so this has to be settled at generation time.
async function detectSuffix() {
  const probeDate = dotDate(nzDate(1));          // yesterday: certain to exist
  for (const sfx of SUFFIXES) {
    const url = blockUrl(probeDate, 28, sfx);    // 7:00 am
    const r = await headOk(url);
    console.log(`  probe -${sfx}: ${r.status}`);
    if (r.ok) return sfx;
  }
  return null;
}

// Content-Length for each enclosure. RSS requires the attribute and Apple's
// validator checks it; a HEAD per episode is cheap at this volume.
async function sizeOf(url) {
  try {
    const res = await fetch(url, { method: 'HEAD' });
    const n = parseInt(res.headers.get('content-length') || '0', 10);
    return Number.isFinite(n) && n > 0 ? n : 0;
  } catch (e) {
    return 0;
  }
}

async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      out[idx] = await fn(items[idx], idx);
    }
  }));
  return out;
}

async function main() {
  console.log('NZ now:', nzNow().toString());

  const suffix = await detectSuffix();
  if (!suffix) {
    console.error('::error::No suffix served a known-good block — refusing to publish a feed of dead links.');
    process.exit(1);
  }
  console.log(`Using suffix -${suffix}`);

  const limitToday = availLimit();
  const episodes = [];

  for (let ago = 0; ago < DAYS; ago++) {
    const d = nzDate(ago);
    const dateStr = dotDate(d);
    const dayLabel = `${DAYS_SHORT[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]}`;

    for (const seg of SEGMENTS) {
      for (let b = seg.from; b <= seg.to; b++) {
        if (ago === 0 && b > limitToday) continue;   // not published yet
        episodes.push({
          title: `${seg.name} ${to12(b)} · ${dayLabel}`,
          url: blockUrl(dateStr, b, suffix),
          // suffix-independent so a flip does not make every app re-download
          guid: `zb-${REGION}-${dateStr}-${toUrl(b)}`,
          pub: nzWallToInstant(d.getFullYear(), d.getMonth() + 1, d.getDate(), blkH(b), blkM(b)),
        });
      }
    }
  }

  if (!episodes.length) {
    console.error('::error::No episodes in range — refusing to publish an empty feed.');
    process.exit(1);
  }

  episodes.sort((a, b) => b.pub - a.pub);          // newest first

  console.log(`Sizing ${episodes.length} enclosures…`);
  const sizes = await mapLimit(episodes, 8, e => sizeOf(e.url));
  episodes.forEach((e, i) => { e.length = sizes[i]; });
  const missing = sizes.filter(s => !s).length;
  if (missing) console.log(`  (${missing} without a Content-Length; emitted as 0)`);

  const regionName = REGION.charAt(0).toUpperCase() + REGION.slice(1);

  const items = episodes.map(e => `    <item>
      <title>${xmlEscape(e.title)}</title>
      <description>${xmlEscape(e.title + ' — Newstalk ZB ' + regionName)}</description>
      <enclosure url="${xmlEscape(e.url)}" type="audio/mpeg" length="${e.length}"/>
      <guid isPermaLink="false">${xmlEscape(e.guid)}</guid>
      <pubDate>${e.pub.toUTCString()}</pubDate>
      <itunes:duration>900</itunes:duration>
      <itunes:explicit>false</itunes:explicit>
    </item>`).join('\n');

  const feed = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"
     xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd"
     xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>Newstalk ZB ${xmlEscape(regionName)} — Breakfast &amp; Drive</title>
    <link>${SITE}/</link>
    <atom:link href="${SITE}/feed.xml" rel="self" type="application/rss+xml"/>
    <description>Newstalk ZB ${xmlEscape(regionName)} Week on Demand: the breakfast show from 6:45 am and drive from 4:45 pm, in 15-minute blocks, for the last ${DAYS} days. Unofficial personal feed; audio served by NewstalkZB.</description>
    <language>en-nz</language>
    <lastBuildDate>${new Date().toUTCString()}</lastBuildDate>
    <itunes:author>Newstalk ZB</itunes:author>
    <itunes:summary>Newstalk ZB ${xmlEscape(regionName)} breakfast and drive, in 15-minute blocks, for the last ${DAYS} days.</itunes:summary>
    <itunes:explicit>false</itunes:explicit>
    <itunes:category text="News"><itunes:category text="News Commentary"/></itunes:category>
    <itunes:image href="${SITE}/artwork.png"/>
    <itunes:owner><itunes:name>Newstalk ZB</itunes:name></itunes:owner>
${items}
  </channel>
</rss>
`;

  const out = process.argv[2] || 'feed.xml';
  require('fs').writeFileSync(out, feed);
  console.log(`Wrote ${out}: ${episodes.length} episodes, newest ${episodes[0].title}`);
}

main().catch(e => { console.error('::error::' + e.message); process.exit(1); });
