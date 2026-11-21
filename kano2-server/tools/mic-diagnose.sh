#!/bin/bash
# Finds out how (and whether) the board's microphone is visible to Linux.
#   sudo bash tools/mic-diagnose.sh 2>&1 | tee ~/mic.log
# Stop kano2-server first if it is using the microphone. During each "RECORDING" line, clap or talk near the kit.

echo "== system"
uname -r
[ -r /proc/device-tree/model ] && tr -d '\0' < /proc/device-tree/model; echo

echo; echo "== arecord"
if command -v arecord >/dev/null; then command -v arecord; else echo "arecord NOT installed: sudo apt install alsa-utils"; fi

echo; echo "== sound cards (/proc/asound/cards)"
cat /proc/asound/cards 2>/dev/null || echo "none"

echo; echo "== capture devices (arecord -l)"
arecord -l 2>&1

echo; echo "== device-tree audio nodes"
find /proc/device-tree \( -iname 'codec*' -o -iname 'sound*' -o -iname 'audio*' \) 2>/dev/null | while read -r n; do
    printf '%s  status=%s  compatible=%s\n' "${n#/proc/device-tree}" "$(tr -d '\0' < "$n/status" 2>/dev/null)" "$(tr -d '\0' < "$n/compatible" 2>/dev/null)"
done

echo; echo "== device-tree audio routing"
for f in /proc/device-tree/soc*/codec*/allwinner,audio-routing /proc/device-tree/sound*/allwinner,audio-routing; do
    [ -r "$f" ] && { echo "$f"; tr '\0' '\n' < "$f" | paste - - | sed 's/^/  /'; }
done

echo; echo "== sound modules"
lsmod 2>/dev/null | awk '/^snd/ {printf "%s ", $1} END {print ""}'

echo; echo "== kernel messages about audio"
dmesg 2>/dev/null | grep -iE "codec|sun4i|sun8i.*(audio|codec|i2s)|snd|alsa|sound" | tail -25

# every capture device: "card N ... device M"
arecord -l 2>/dev/null | sed -n 's/^card \([0-9]*\):.*device \([0-9]*\):.*/\1 \2/p' | while read -r card dev; do
    echo; echo "== mixer controls, card $card"
    amixer -c "$card" scontrols 2>&1 | head -40
    echo "-- capture-related settings"
    amixer -c "$card" scontents 2>/dev/null | awk '/^Simple mixer control/ {name=$0} /Capabilities:.*(cvolume|cswitch|capture)/ {print name; f=1; next} f && /^  (Front|Mono|Capture|Limits|Playback)/ {print} /^[A-Za-z]/ {f=0}' | head -60

    echo; echo "== record test, card $card device $dev (2 s each: make some noise!)"
    for spec in "plughw:$card,$dev 16000 2" "hw:$card,$dev 48000 2" "hw:$card,$dev 44100 2" "hw:$card,$dev 48000 1" "hw:$card,$dev 16000 1"; do
        set -- $spec; d=$1; r=$2; c=$3
        echo "RECORDING  -D $d -r $r -c $c"
        timeout 6 arecord -q -D "$d" -t raw -f S16_LE -r "$r" -c "$c" -d 2 /tmp/mic-diag.raw 2>/tmp/mic-diag.err
        rc=$?
        bytes=$(stat -c %s /tmp/mic-diag.raw 2>/dev/null || echo 0)
        printf '   exit %s, %s bytes' "$rc" "$bytes"
        if [ "$bytes" -gt 0 ] && command -v python3 >/dev/null; then
            python3 - /tmp/mic-diag.raw "$c" <<'PY'
import array, math, sys
a = array.array('h'); data = open(sys.argv[1], 'rb').read(); a.frombytes(data[:len(data) // 2 * 2])
ch = int(sys.argv[2])
out = []
for c in range(ch):
    s = a[c::ch]
    if not s: continue
    rms = math.sqrt(sum(x * x for x in s) / len(s)) / 32768 * 1000
    out.append("ch%d rms*1000=%.1f peak=%d" % (c, rms, max(abs(x) for x in s)))
print("   |   " + "   ".join(out))
PY
        else
            echo
        fi
        head -c 200 /tmp/mic-diag.err | head -2 | sed 's/^/   arecord: /'
    done
    rm -f /tmp/mic-diag.raw /tmp/mic-diag.err
done
echo; echo "== done"
