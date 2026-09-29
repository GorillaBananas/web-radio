#!/usr/bin/env bash
# Health check for the NewstalkZB Week on Demand endpoints the PWA depends on.
#
# Designed around the two ways this has actually broken:
#   Apr 2026 — suffix changed -D  -> -S
#   Sep 2026 — suffix changed -S  -> -D at the DST changeover, old files left
#              under the old name, so only *recent* blocks broke
#
# So it probes recent AND old blocks, tries BOTH suffixes, and reports which
# one the server is currently serving rather than assuming.
#
# No `set -e`: every probe should run so the log shows the full picture.
set -uo pipefail

BASE='https://weekondemand.newstalkzb.co.nz/WeekOnDemand/ZB'
SUFFIXES='D S'
LAG_MIN=2            # a block appears ~2 min after it finishes airing

now_nz()  { TZ='Pacific/Auckland' date "$@"; }

# Floor a "minutes past midnight" value to a 15-minute block boundary.
block_time() {                      # $1 = minutes past midnight
  local m=$(( $1 / 15 * 15 ))
  printf '%02d.%02d.00' $(( m / 60 )) $(( m % 60 ))
}

# Probe one URL. Echoes the HTTP status; retries once on a connection failure.
probe() {
  local url="$1" code
  for attempt in 1 2; do
    code=$(curl -sS -o /dev/null -w '%{http_code}' -H 'Range: bytes=0-1023' \
             --max-time 30 "$url" 2>/dev/null || echo 000)
    [ "$code" = "000" ] && [ "$attempt" = "1" ] && { sleep 3; continue; }
    break
  done
  echo "$code"
}

# Probe a block under every suffix. Sets WORKING to the suffixes that served it.
WORKING=''
probe_block() {                     # $1 = label, $2 = region, $3 = date, $4 = time
  local label="$1" region="$2" d="$3" t="$4" sfx code
  WORKING=''
  for sfx in $SUFFIXES; do
    code=$(probe "${BASE}/${region}/${d}-${t}-${sfx}.mp3")
    if [ "$code" = "200" ] || [ "$code" = "206" ]; then
      WORKING="${WORKING}${sfx}"
      printf '  %-22s %s %s -%s  %s  OK\n'   "$label" "$d" "$t" "$sfx" "$code"
    else
      printf '  %-22s %s %s -%s  %s\n'       "$label" "$d" "$t" "$sfx" "$code"
      ALL_CODES="${ALL_CODES}${code} "
    fi
  done
}

TODAY=$(now_nz +%Y.%m.%d)
MINS=$(( 10#$(now_nz +%H) * 60 + 10#$(now_nz +%M) ))
ALL_CODES=''

# Newest block that should have been published by now (mirrors availLimit()).
EDGE_MIN=$(( MINS - LAG_MIN - 15 ))
# A block from ~2h ago: unambiguously past the publish lag, so a failure here
# is real rather than a race with the encoder.
RECENT_MIN=$(( MINS - 120 ))
OLD_DATE=$(now_nz -d '5 days ago' +%Y.%m.%d)

echo "NZ now: $(now_nz '+%Y-%m-%d %H:%M %Z')"
echo

echo "Probing:"
EDGE_OK=''; RECENT_OK=''; OLD_OK=''; YEST_OK=''

if [ "$EDGE_MIN" -ge 0 ]; then
  probe_block "live edge"  auckland "$TODAY" "$(block_time $EDGE_MIN)";   EDGE_OK="$WORKING"
else
  echo "  live edge              (skipped: too early in the NZ day)"
  EDGE_OK='skip'
fi

if [ "$RECENT_MIN" -ge 0 ]; then
  probe_block "~2h old"    auckland "$TODAY" "$(block_time $RECENT_MIN)"; RECENT_OK="$WORKING"
else
  echo "  ~2h old                (skipped: too early in the NZ day)"
  RECENT_OK='skip'
fi

probe_block "yesterday 07:00"  auckland    "$(now_nz -d yesterday +%Y.%m.%d)" '07.00.00'; YEST_OK="$WORKING"
probe_block "yesterday 17:00"  wellington  "$(now_nz -d yesterday +%Y.%m.%d)" '17.00.00'
probe_block "yesterday 12:00"  christchurch "$(now_nz -d yesterday +%Y.%m.%d)" '12.00.00'
probe_block "5 days ago 07:00" auckland    "$OLD_DATE" '07.00.00';               OLD_OK="$WORKING"

echo

# ── Diagnose ──────────────────────────────────────────────────────────────
# "Recent" is what the app actually needs; old blocks are the control that
# tells a naming change apart from a publishing stall.
RECENT_LIVE="$RECENT_OK"
[ "$RECENT_LIVE" = 'skip' ] && RECENT_LIVE="$YEST_OK"

STATUS='ok'; HEADLINE=''; DETAIL=''

if [ -n "$RECENT_LIVE" ] && [ -n "$OLD_OK" ] && [ "$RECENT_LIVE" != "$OLD_OK" ]; then
  STATUS='suffix-split'
  HEADLINE="Suffix changed: recent blocks serve -${RECENT_LIVE}, older ones -${OLD_OK}"
  DETAIL="The upstream renamed new files without migrating old ones — exactly the 27 Sep 2026 cutover. app.js tries both suffixes and remembers what works, so the app should cope, but confirm SUFFIXES in app.js still lists '${RECENT_LIVE}' first."
elif [ -z "$RECENT_LIVE" ] && [ -n "$OLD_OK" ]; then
  STATUS='recent-missing'
  HEADLINE='Recent blocks are missing under every known suffix'
  DETAIL="Older blocks still serve (-${OLD_OK}), so this is not a format change. Either the upstream has stopped publishing, or new files moved somewhere new. Load newstalkzb.co.nz/on-demand/zb-on-demand/ in a browser, play a recent show, and read the real URL from the Network tab — or grep the loaded weekOnDemandPlayerEngine.*.js for the template."
elif [ -z "$RECENT_LIVE" ] && [ -z "$OLD_OK" ]; then
  case "$ALL_CODES" in
    *403*) STATUS='blocked'
           HEADLINE='Everything returned 403 — access is being refused'
           DETAIL='Hotlink protection or an IP/geo rule. Check whether the runner is being blocked specifically before assuming the app is broken.' ;;
    *000*) STATUS='unreachable'
           HEADLINE='Could not reach the server at all'
           DETAIL='Probably transient. Re-run once; if it persists the host may be down or renamed.' ;;
        *) STATUS='all-missing'
           HEADLINE='Nothing served under any suffix, old or new'
           DETAIL='This is the signature of a real URL-format or host change. Recover the current scheme from the player bundle as described in ZB-ONDEMAND-URLS.md §4.1.' ;;
  esac
elif [ "$EDGE_OK" != 'skip' ] && [ -z "$EDGE_OK" ] && [ -n "$RECENT_LIVE" ]; then
  STATUS='edge-lag'
  HEADLINE='Newest block not published yet (older blocks fine)'
  DETAIL='Almost certainly just publishing lag at the live edge, not a fault. Worth a glance only if it repeats.'
else
  HEADLINE="Healthy — serving -${RECENT_LIVE}"
fi

echo "STATUS=$STATUS"
echo "$HEADLINE"

{
  echo "# ZB on-demand health"
  echo
  echo "**$HEADLINE**"
  echo
  [ -n "$DETAIL" ] && { echo "$DETAIL"; echo; }
  echo "| probe | serving |"
  echo "|---|---|"
  echo "| live edge (today) | ${EDGE_OK:-none} |"
  echo "| ~2h old (today) | ${RECENT_OK:-none} |"
  echo "| yesterday | ${YEST_OK:-none} |"
  echo "| 5 days ago | ${OLD_OK:-none} |"
} >> "${GITHUB_STEP_SUMMARY:-/dev/stdout}"

# Record for the keep-alive commit step
{
  echo "status=$STATUS"
  echo "headline=$HEADLINE"
} >> "${GITHUB_OUTPUT:-/dev/null}"

# Fail only when a listener would actually be stuck. A suffix split is worth
# surfacing — it is what broke things in September — but app.js adapts to it on
# its own, and it clears once pre-cutover files age out of the 7-day window.
# Failing red for a handled, self-resolving condition just trains us to ignore
# this check.
case "$STATUS" in
  ok)                      exit 0 ;;
  edge-lag|unreachable)    echo "::notice::$HEADLINE";  exit 0 ;;
  suffix-split)            echo "::warning::$HEADLINE"; exit 0 ;;
  *)                       echo "::error::$HEADLINE";   exit 1 ;;
esac
