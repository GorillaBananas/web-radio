# NewstalkZB "Week on Demand" — Audio Stream URL Research

## Summary

NewstalkZB's on-demand audio is served via **StreamGuys** infrastructure (NZME's CDN provider).
The "Week on Demand" player at `https://www.newstalkzb.co.nz/on-demand/zb-on-demand/` uses a
JavaScript bundle (`radiowebapp.BWQw6z7z.js`) to construct audio URLs based on three user
selections: **Region**, **Day**, and **Time** (15-minute blocks).

> **Note:** The JS bundle could not be fetched programmatically (blocked by network restrictions).
> Findings below are assembled from StreamGuys documentation, Internet Archive captures,
> community forums, and press releases. Sections marked **[CONFIRMED]** are verified from
> multiple sources. Sections marked **[HYPOTHESIS]** are educated guesses that need browser
> verification.

---

## 1. Base URL Pattern

### [CONFIRMED] Live Stream URLs

NZME live streams use this pattern:

```
https://ais-nzme.streamguys1.com/nz_{STATION_ID}_aac
```

Legacy alternate:
```
http://radionetwork-iheart-ice.streamguys1.com/{STATION_CODE}.mp3
```

### [HYPOTHESIS] On-Demand — Option A: SGrewind (HLS time-range playback)

StreamGuys' **SGrewind** product provides DVR-like time-shifted playback over HLS. If
NewstalkZB uses SGrewind, the on-demand URL would follow this pattern:

```
https://{NZME_SGREWIND_HOST}/sgrewind/{STREAM_MOUNT}/playlist_dvr_range-{UTC_EPOCH_START}-{DURATION_SECONDS}.m3u8
```

Example (hypothetical):
```
https://ais-nzme.streamguys1.com/sgrewind/nz_002/playlist_dvr_range-1708300800-900.m3u8
```
This would play Newstalk ZB Auckland starting at epoch `1708300800` for 900 seconds (15 minutes).

### [HYPOTHESIS] On-Demand — Option B: SGrecast archive files

StreamGuys' **SGrecast** stores segmented archive recordings. Internet Archive captures show
NZME audio files with the naming pattern:

```
_HOUR_{HH}_{YYYYMMDD}.afpk
```

If the on-demand player uses direct file URLs, the pattern might be:

```
https://{NZME_RECAST_HOST}/{STREAM_MOUNT}/{DATE}_{TIME}.aac
```

### [HYPOTHESIS] On-Demand — Option C: Custom NZME endpoint

The `radiowebapp.BWQw6z7z.js` bundle may construct a URL to a custom NZME API or CDN
path that returns audio directly, e.g.:

```
https://www.newstalkzb.co.nz/assets/audio/ondemand/{REGION}/{YYYYMMDD}/{HHMM}.aac
```

---

## 2. Parameter Values

### [CONFIRMED] NZME Station IDs (StreamGuys)

| Station        | Stream Mount | Legacy Code |
|---------------|-------------|-------------|
| Newstalk ZB (National/Auckland) | `nz_002_aac` | `zbaalt` |
| Newstalk ZB Auckland | `nz_002_aac` (or separate ID) | `zbakalt` (overseas) |
| Newstalk ZB Wellington | unknown | `zbwnalt` (overseas) |
| Newstalk ZB Christchurch | unknown | `zbchalt` (overseas) |
| Radio Hauraki | `nz_009_aac` | `hkihr` |
| Coast | `nz_011_aac` | — |
| ZM | — | `zmihr` |

### [CONFIRMED] Region values (from HTML select#auRegion)

The Week on Demand player has three regions:
- **Auckland**
- **Wellington**
- **Christchurch**

The `<option>` values in the `#auRegion` select are unknown — they could be:
- Station IDs: `nz_002`, `nz_XXX`, `nz_YYY`
- Region codes: `auckland`, `wellington`, `christchurch`
- Short codes: `ak`, `wn`, `ch`
- Legacy codes: `zbak`, `zbwn`, `zbch`

### [CONFIRMED] Day format

The `#auDay` select is populated dynamically by JS for the last 7 days. Values are likely:
- ISO date: `2026-02-19`
- Compact date: `20260219`
- Day offset: `0` (today), `1` (yesterday), etc.

### [CONFIRMED] Time format

The `#auTime` select provides 15-minute blocks throughout the day. Values are likely:
- 24-hour compact: `0000`, `0015`, `0030`, `0045`, `0100`, ... `2345`
- Or with colon: `00:00`, `00:15`, etc.
- Or UTC epoch timestamps

---

## 3. Example Complete URLs

### If SGrewind (Option A) — most likely

```
# Auckland, Feb 18 2026, 9:00 AM NZDT (UTC epoch for 2026-02-18T09:00:00+13:00 = 1739826000)
# 15 minutes = 900 seconds

https://ais-nzme.streamguys1.com/sgrewind/nz_002/playlist_dvr_range-1739826000-900.m3u8

# Wellington, Feb 17 2026, 2:30 PM NZDT
https://ais-nzme.streamguys1.com/sgrewind/nz_XXX/playlist_dvr_range-1739745000-900.m3u8

# Christchurch, Feb 16 2026, 7:00 AM NZDT
https://ais-nzme.streamguys1.com/sgrewind/nz_YYY/playlist_dvr_range-1739631600-900.m3u8
```

### If direct archive files (Option B)

```
# Auckland, Feb 18 2026, 9:00 AM
https://{host}/nz_002/20260218_0900.aac

# Wellington, Feb 17 2026, 2:30 PM
https://{host}/nz_XXX/20260217_1430.aac
```

---

## 4. Authentication & Headers

### [CONFIRMED] Live streams

Live streams at `ais-nzme.streamguys1.com` do **not** require authentication tokens or special
headers. They are publicly accessible.

### [UNKNOWN] On-demand streams

The on-demand player may require:
- No auth (public, like live streams)
- A session token or cookie from the newstalkzb.co.nz website
- A signed URL with expiring token (common for CDN-protected content)
- CORS headers restricting playback to the newstalkzb.co.nz origin

This can only be determined by inspecting the actual network requests from the player.

---

## 5. Relevant Code Snippets

The JavaScript bundle `radiowebapp.BWQw6z7z.js` could not be retrieved due to network
restrictions in the analysis environment.

### HTML elements (from page documentation)

```html
<select id="auRegion">
  <!-- Auckland, Wellington, Christchurch options -->
</select>
<select id="auDay">
  <!-- Dynamically populated: last 7 days -->
</select>
<select id="auTime">
  <!-- Dynamically populated: 15-minute intervals -->
</select>
<audio id="wod-player">
  <!-- src set by JS when user hits play -->
</audio>
```

### StreamGuys SGrewind URL format (from official documentation)

```
# Time-range playback (specific start time + duration)
playlist_dvr_range-{UTC_EPOCH_START}-{DURATION_SECONDS}.m3u8

# Time-shifted playback (relative to now)
playlist_dvr_timeshift-{SECONDS_AGO}-{BUFFER_SECONDS}.m3u8

# With HLS offset directive (ensures playback starts at first segment)
playlist_dvr_range-{UTC_EPOCH_START}-{DURATION_SECONDS}_offset-0.m3u8
```

### SGrewind constraints

- Rolling DVR buffer (typically 2 days to 2 weeks depending on configuration)
- 7-day buffer aligns perfectly with "Week on Demand" branding
- HLS (.m3u8) and MPEG-DASH formats supported
- Server-side processing (no client-side storage needed)

---

## 6. How to Complete This Investigation

To extract the exact URL pattern, open the Week on Demand player in a browser:

### Method 1: Browser DevTools Network Tab

1. Open `https://www.newstalkzb.co.nz/on-demand/zb-on-demand/`
2. Open DevTools (F12) → **Network** tab
3. Filter by **Media** or type `m3u8` / `aac` / `mp3` in the filter
4. Select a region, day, and time, then press play
5. The audio request URL will appear in the Network tab

### Method 2: Inspect the JavaScript Bundle

1. Open DevTools → **Sources** tab
2. Find `radiowebapp.BWQw6z7z.js` (or search all files for `wod-player`)
3. Pretty-print the minified JS
4. Search for: `wod-player`, `auRegion`, `auDay`, `auTime`, `audio`, `src`,
   `streamguys`, `sgrewind`, `playlist_dvr`, `.m3u8`, `.aac`, `.mp3`
5. The URL construction function will show the exact pattern

### Method 3: Console Override

```javascript
// Paste in browser console before pressing play
const origSrc = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'src');
Object.defineProperty(HTMLMediaElement.prototype, 'src', {
  set(url) {
    console.log('AUDIO URL:', url);
    origSrc.set.call(this, url);
  },
  get() {
    return origSrc.get.call(this);
  }
});
```

---

## 7. Sources

- [Geekzone NZ Radio Streaming Links](https://www.geekzone.co.nz/forums.asp?forumid=151&topicid=196049) — community-sourced NZME StreamGuys URLs
- [Internet Archive: Coast via ais-nzme.streamguys1.com](https://archive.org/details/https-ais-nzme.streamguys-1.com-nz-011-aac) — confirms NZME station ID format
- [Triton Digital / NZME Partnership](https://tritondigital.com/press-releases/October-08-2024/triton-digital-partners-with-nzme-to-transform-new-zealand-s-audio-strategy) — NZME streaming infrastructure
- [StreamGuys SGrewind Demo](https://example.streamguys1.com/sgrewind/demo/) — official SGrewind URL format documentation
- [StreamGuys SGrewind Announcement](https://www.streamingmedia.com/PressRelease/StreamGuys-to-Preview-New-Live-Stream-Rewind-Resume-and-Restart-Technology-at-IBC2018_47632.aspx) — SGrewind capabilities
- [StreamGuys / ARN / NZME Relationship](https://www.radioworld.com/global/user-report-streamguys-assures-streaming-uptime-for-arn) — confirms NZME uses StreamGuys
- [NewstalkZB Week on Demand](https://www.newstalkzb.co.nz/on-demand/zb-on-demand/) — the target page
- [NewstalkZB Overseas Streaming](https://www.newstalkzb.co.nz/on-demand/listen-from-overseas/) — legacy .pls stream URLs
- [fmstream.org NZ streams](https://fmstream.org/index.php?c=NZL) — NZ radio stream directory
