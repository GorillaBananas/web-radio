# NewstalkZB "Week on Demand" — Audio Stream URL Pattern

## 1. URL Pattern

```
https://weekondemand.newstalkzb.co.nz/WeekOnDemand/ZB/{region}/{YYYY.MM.DD}-{HH.MM.SS}-D.mp3
```

### Components

| Component | Format | Description |
|-----------|--------|-------------|
| Base URL | `https://weekondemand.newstalkzb.co.nz/WeekOnDemand/ZB` | Dedicated on-demand subdomain |
| Region | `auckland` / `wellington` / `christchurch` | Lowercase city name |
| Date | `YYYY.MM.DD` | Dot-separated date (e.g. `2026.02.20`) |
| Time | `HH.MM.SS` | Dot-separated 24-hour time (e.g. `07.15.00`) |
| Suffix | `-D` | Likely "Download" flag |
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
https://weekondemand.newstalkzb.co.nz/WeekOnDemand/ZB/auckland/2026.02.20-07.15.00-D.mp3

# Auckland, Feb 20 2026, 9:00 AM
https://weekondemand.newstalkzb.co.nz/WeekOnDemand/ZB/auckland/2026.02.20-09.00.00-D.mp3

# Wellington, Feb 19 2026, 2:30 PM
https://weekondemand.newstalkzb.co.nz/WeekOnDemand/ZB/wellington/2026.02.19-14.30.00-D.mp3

# Christchurch, Feb 18 2026, 6:00 PM
https://weekondemand.newstalkzb.co.nz/WeekOnDemand/ZB/christchurch/2026.02.18-18.00.00-D.mp3

# Auckland, Feb 14 2026, midnight
https://weekondemand.newstalkzb.co.nz/WeekOnDemand/ZB/auckland/2026.02.14-00.00.00-D.mp3
```

---

## 3. Authentication & Headers

Based on the URL being a direct download link (no token or signature in the URL):

- **No authentication tokens** visible in the URL
- **No query parameters** required
- The files appear to be publicly accessible static MP3s on a dedicated subdomain
- CORS restrictions may still apply for browser-based playback from other origins,
  but direct HTTP requests (e.g. from a mobile app or media player) should work

---

## 4. Availability Window

The "Week on Demand" branding indicates content is available for the **last 7 days**.
Files older than 7 days are likely removed or return 404.

---

## 5. URL Construction Logic

To build a URL programmatically:

```javascript
function buildWodUrl(region, date, hours, minutes) {
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

  return `https://weekondemand.newstalkzb.co.nz/WeekOnDemand/ZB/${region}/${dateStr}-${timeStr}-D.mp3`;
}

// Usage
buildWodUrl('auckland', new Date(2026, 1, 20), 7, 15);
// => https://weekondemand.newstalkzb.co.nz/WeekOnDemand/ZB/auckland/2026.02.20-07.15.00-D.mp3
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
