# NewstalkZB "Week on Demand" — Audio Stream URL Pattern

## 1. URL Pattern

```
https://weekondemand.newstalkzb.co.nz/WeekOnDemand/ZB/{region}/{YYYY.MM.DD}-{HH.MM.SS}-{D|S}.mp3
```

### Components

| Component | Format | Description |
|-----------|--------|-------------|
| Base URL | `https://weekondemand.newstalkzb.co.nz/WeekOnDemand/ZB` | Dedicated on-demand subdomain |
| Region | `auckland` / `wellington` / `christchurch` | Lowercase city name |
| Date | `YYYY.MM.DD` | Dot-separated date (e.g. `2026.02.20`) |
| Time | `HH.MM.SS` | Dot-separated 24-hour time (e.g. `07.15.00`) |
| Suffix | `-D` or `-S` | **Upstream flips this.** `-D` originally, `-S` from ~April 2026, back to `-D` at the 27 Sep 2026 cutover (see §4.1). Both return 206 Partial Content. Don't hard-code one — the app tries both and remembers what worked. |
| Format | `.mp3` | MP3 audio |

### Time values (15-minute blocks)

Times are on 15-minute boundaries with seconds always `00`:

```
00.00.00, 00.15.00, 00.30.00, 00.45.00,
01.00.00, 01.15.00, 01.30.00, 01.45.00,
...
23.00.00, 23.15.00, 23.30.00, 23.45.00
```

---

## 2. Example Complete URLs

```
# Auckland, Feb 20 2026, 7:15 AM (confirmed working)
https://weekondemand.newstalkzb.co.nz/WeekOnDemand/ZB/auckland/2026.02.20-07.15.00-S.mp3

# Auckland, Feb 20 2026, 9:00 AM
https://weekondemand.newstalkzb.co.nz/WeekOnDemand/ZB/auckland/2026.02.20-09.00.00-S.mp3

# Wellington, Feb 19 2026, 2:30 PM
https://weekondemand.newstalkzb.co.nz/WeekOnDemand/ZB/wellington/2026.02.19-14.30.00-S.mp3

# Christchurch, Feb 18 2026, 6:00 PM
https://weekondemand.newstalkzb.co.nz/WeekOnDemand/ZB/christchurch/2026.02.18-18.00.00-S.mp3

# Auckland, Feb 14 2026, midnight
https://weekondemand.newstalkzb.co.nz/WeekOnDemand/ZB/auckland/2026.02.14-00.00.00-S.mp3
```

---

## 3. Authentication & Headers

- **No authentication tokens** visible in the URL
- **No query parameters** required
- The files are publicly accessible MP3s on a dedicated subdomain

### Hotlink protection

The server returns an HTML error page (which Chrome blocks via ORB) when the
request includes `Sec-Fetch-Dest: audio` — i.e. when an `<audio>` element on
a third-party origin tries to load the file directly. Workarounds:

1. **Service Worker proxy** — intercept the audio element's request in a SW
   and re-`fetch()` the URL programmatically. Programmatic fetches send
   `Sec-Fetch-Dest: empty`, which the server allows. The SW returns the
   opaque response to the audio element, which plays it normally.
2. **Direct browser navigation** — navigating to the URL in a tab works
   because that sends `Sec-Fetch-Dest: document`.

---

## 4. Availability Window

The "Week on Demand" branding indicates content is available for the **last 7 days**.
Files older than 7 days are likely removed or return 404.

A block appears roughly **2 minutes after it finishes airing** — confirmed in practice:
the 8:15–8:30 block becomes fetchable around 8:32. `AVAIL_LAG_MIN` in `app.js` encodes this.

### 4.1 The 27 September 2026 suffix cutover

At the NZ daylight-saving changeover (2am Sun 27 Sep 2026) the upstream flipped the
suffix from `-S` back to `-D`, without migrating existing files. Measured from a GitHub
Actions runner that same week:

| Date | `-D` | `-S` |
|------|------|------|
| 2026.09.25 | 404 | 206 |
| 2026.09.26 | 404 | 206 |
| 2026.09.27 | 206 | 404 |
| 2026.09.28 | 206 | 404 |
| 2026.09.29 | 206 | 404 |

Everything else — host, path, region, date and time format — was unchanged.

Lessons worth keeping:

- **A 404 does not imply the URL format changed.** Here only the suffix moved, and only
  for files written after the cutover. Probe old *and* recent dates before concluding.
- **Check the boundary, not just one date.** A working old file next to a failing new one
  is the signature of a cutover rather than an outage.
- **The player's own bundle is the source of truth.** `weekOnDemandPlayerEngine.*.js`
  contains the template — it built `${base}${region}/${date}-${time}.00-${suffix}.mp3`.
  Loading their page in a headless browser and grepping the loaded scripts recovers the
  current scheme in about a minute.
- Geo-blocking is a tempting but wrong explanation: these files served fine from
  Singapore and from US datacenter IPs throughout.

---

## 5. URL Construction Logic

To build a URL programmatically:

```javascript
function buildWodUrl(region, date, hours, minutes, suffix = 'D') {
  const dateStr = [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0')
  ].join('.');

  const timeStr = [
    String(hours).padStart(2, '0'),
    String(minutes).padStart(2, '0'),
    '00'
  ].join('.');

  // suffix flips upstream — see §4.1; try 'D' then 'S' rather than hard-coding
  return `https://weekondemand.newstalkzb.co.nz/WeekOnDemand/ZB/${region}/${dateStr}-${timeStr}-${suffix}.mp3`;
}

// Usage
buildWodUrl('auckland', new Date(2026, 8, 29), 7, 15);
// => https://weekondemand.newstalkzb.co.nz/WeekOnDemand/ZB/auckland/2026.09.29-07.15.00-D.mp3

// Files written before the 27 Sep 2026 cutover still need 'S'
buildWodUrl('auckland', new Date(2026, 8, 25), 7, 15, 'S');
// => https://weekondemand.newstalkzb.co.nz/WeekOnDemand/ZB/auckland/2026.09.25-07.15.00-S.mp3
```

---

## 6. Reference: Live Stream URLs

For comparison, NZME live streams use a completely separate infrastructure (StreamGuys):

| Stream | URL |
|--------|-----|
| Newstalk ZB (national) | `https://ais-nzme.streamguys1.com/nz_002_aac` |
| Newstalk ZB (MP3) | `http://radionetwork-iheart-ice.streamguys1.com/zbaalt.mp3` |
| ZB Auckland (overseas) | `http://streaming.radiomyway.co.nz/zbakalt.pls` |
| ZB Wellington (overseas) | `http://streaming.radiomyway.co.nz/zbwnalt.pls` |
| ZB Christchurch (overseas) | `http://streaming.radiomyway.co.nz/zbchalt.pls` |
