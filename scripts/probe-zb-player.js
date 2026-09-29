// Temporary diagnostic: discover where NewstalkZB's Week on Demand player now
// fetches audio from. Runs on a GitHub Actions runner because that machine has
// unrestricted internet access. Delete once the new URL pattern is known.

const { chromium } = require('playwright');

const PAGE = 'https://www.newstalkzb.co.nz/on-demand/zb-on-demand/';
const MEDIA_RE = /\.(mp3|m4a|aac|m3u8|mpd)(\?|$)|\/(audio|media|stream)\//i;
const HOST_RE = /weekondemand|omny|megaphone|streamguys|iheart|cloudfront|akamai|fastly|brightcove|simplecast|libsyn/i;

const seen = new Map();          // url -> {method, status, type}
const jsonHits = [];

function note(label, items) {
  console.log('\n===== ' + label + ' (' + items.length + ') =====');
  if (!items.length) console.log('  (none)');
  items.forEach(function (i) { console.log('  ' + i); });
}

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
               '(KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36',
    locale: 'en-NZ',
    timezoneId: 'Pacific/Auckland',
  });
  const page = await ctx.newPage();

  page.on('request', r => {
    if (!seen.has(r.url())) seen.set(r.url(), { method: r.method(), status: '-', type: r.resourceType() });
  });
  page.on('response', async r => {
    const e = seen.get(r.url());
    if (e) e.status = r.status();
    const ct = (r.headers()['content-type'] || '');
    if (ct.includes('json')) {
      try {
        const body = await r.text();
        if (/mp3|m4a|m3u8|audio|weekondemand/i.test(body)) {
          jsonHits.push({ url: r.url(), snippet: body.slice(0, 1500) });
        }
      } catch (e) { /* body not available */ }
    }
  });

  console.log('Loading ' + PAGE);
  try {
    await page.goto(PAGE, { waitUntil: 'domcontentloaded', timeout: 60000 });
  } catch (e) {
    console.log('goto warning: ' + e.message);
  }
  console.log('title: ' + await page.title());
  await page.waitForTimeout(6000);

  // Dismiss a consent/cookie banner if one is in the way
  for (const sel of ['#onetrust-accept-btn-handler', 'button:has-text("Accept")',
                     'button:has-text("I Agree")', 'button:has-text("Got it")',
                     '[aria-label*="accept" i]']) {
    try {
      const b = page.locator(sel).first();
      if (await b.isVisible({ timeout: 1200 })) { await b.click({ timeout: 2500 }); console.log('dismissed banner via ' + sel); break; }
    } catch (e) { /* not present */ }
  }

  // Try to start playback
  for (const sel of ['button[aria-label*="play" i]', '[class*="play" i][role="button"]',
                     'button[class*="play" i]', '.play-button', '[data-testid*="play" i]']) {
    try {
      const b = page.locator(sel).first();
      if (await b.isVisible({ timeout: 1200 })) { await b.click({ timeout: 3000 }); console.log('clicked play via ' + sel); break; }
    } catch (e) { /* not present */ }
  }
  await page.waitForTimeout(5000);

  // Force any media element to load, in case the click missed
  const mediaSrcs = await page.evaluate(async () => {
    const out = [];
    document.querySelectorAll('audio, video').forEach(m => {
      if (m.currentSrc) out.push('currentSrc: ' + m.currentSrc);
      if (m.src) out.push('src: ' + m.src);
      m.querySelectorAll('source').forEach(s => out.push('source: ' + s.src));
      try { m.play().catch(() => {}); } catch (e) {}
    });
    return out;
  });
  await page.waitForTimeout(6000);

  // Grep the page HTML and every loaded script for URL-building clues
  const html = await page.content();
  const htmlHits = (html.match(/https?:\/\/[^"'\s<>\\]{10,220}/g) || [])
    .filter(u => MEDIA_RE.test(u) || HOST_RE.test(u));

  const scripts = [...new Set([...seen.keys()].filter(u => /\.js(\?|$)/i.test(u)))];
  const scriptHits = [];
  for (const s of scripts.slice(0, 40)) {
    try {
      const res = await ctx.request.get(s, { timeout: 20000 });
      if (!res.ok()) continue;
      const body = await res.text();
      const re = /[^"'`\s]{0,90}(weekondemand|WeekOnDemand|\.mp3|on-demand\/audio)[^"'`\s]{0,90}/gi;
      let m;
      while ((m = re.exec(body)) !== null) scriptHits.push(s.split('/').pop() + ' :: ' + m[0]);
      if (scriptHits.length > 120) break;
    } catch (e) { /* skip */ }
  }

  const all = [...seen.entries()];
  note('MEDIA-LOOKING REQUESTS', all.filter(([u]) => MEDIA_RE.test(u))
    .map(([u, v]) => '[' + v.status + '] ' + v.type + ' ' + u));
  note('INTERESTING HOSTS', all.filter(([u]) => HOST_RE.test(u))
    .map(([u, v]) => '[' + v.status + '] ' + v.type + ' ' + u));
  note('MEDIA ELEMENTS IN DOM', mediaSrcs);
  note('URLS IN PAGE HTML', [...new Set(htmlHits)]);
  note('SCRIPT GREP HITS', [...new Set(scriptHits)].slice(0, 80));
  note('XHR/FETCH REQUESTS', all.filter(([, v]) => v.type === 'xhr' || v.type === 'fetch')
    .map(([u, v]) => '[' + v.status + '] ' + u).slice(0, 60));

  console.log('\n===== JSON RESPONSES MENTIONING AUDIO (' + jsonHits.length + ') =====');
  jsonHits.slice(0, 6).forEach(h => console.log('\n--- ' + h.url + '\n' + h.snippet));

  console.log('\ntotal requests observed: ' + all.length);
  await browser.close();
})();
