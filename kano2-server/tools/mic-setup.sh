#!/bin/bash
# Turns on the capture path of the board's Allwinner audio codec (H3-style: "H3 Audio Codec"), then measures a quiet
# second-and-a-bit and a noisy one, and tells you whether the gain is right.
#   sudo bash tools/mic-setup.sh [--boost N] [--gain N] [--save] [card]
#     --boost N   "Mic1 Boost Volume" 0-7: 0 = off, 1 = +24 dB, then +3 dB per step   (default 2 = +27 dB)
#     --gain N    "ADC Gain Capture Volume" 0-7: -4.5 dB + 1.5 dB per step            (default 3 = 0 dB)
#     --save      afterwards, make the mixer settings stick across reboots (alsactl store)
# Control names come from the kernel's sun8i-codec-analog / sun4i-codec drivers; a control this board lacks is skipped.
# During "STAY QUIET" be silent, during "MAKE NOISE" clap or talk at normal distance.

SAVE=0; BOOST=2; GAIN=3; CARD=""
while [ $# -gt 0 ]; do
    case "$1" in
        --save) SAVE=1;;
        --boost) BOOST=$2; shift;;
        --gain) GAIN=$2; shift;;
        [0-9]*) CARD=$1;;
    esac
    shift
done
[ -z "$CARD" ] && CARD=$(arecord -l 2>/dev/null | sed -n 's/^card \([0-9]*\):.*/\1/p' | head -1)
[ -z "$CARD" ] && { echo "No capture card found (arecord -l). Install alsa-utils or enable the codec in the device tree."; exit 1; }
echo "Card $CARD: $(cat /proc/asound/card$CARD/id 2>/dev/null)"

exists() { amixer -c "$CARD" cget name="$1" >/dev/null 2>&1; }
range_max() { amixer -c "$CARD" cget name="$1" | sed -n 's/.*max=\([0-9]*\).*/\1/p' | head -1; }

# set a numeric control to an absolute value (clamped to its range)
set_abs() {
    local name="$1" val="$2" max
    exists "$name" || { echo "  - $name: not present"; return; }
    max=$(range_max "$name"); [ -n "$max" ] && [ "$val" -gt "$max" ] && val=$max
    amixer -c "$CARD" cset name="$name" "$val,$val" >/dev/null 2>&1 || amixer -c "$CARD" cset name="$name" "$val" >/dev/null 2>&1
    echo "  - $name = $val (of ${max:-?})"
}

set_pct() {
    local name="$1" pct="$2" max
    exists "$name" || { echo "  - $name: not present"; return; }
    max=$(range_max "$name"); [ -z "$max" ] && return
    set_abs "$name" $(( (max * pct + 50) / 100 ))
}

set_switch() {
    local name="$1" state="$2"
    exists "$name" || { echo "  - $name: not present"; return; }
    amixer -c "$CARD" cset name="$name" "$state,$state" >/dev/null 2>&1 || amixer -c "$CARD" cset name="$name" "$state" >/dev/null 2>&1
    echo "  - $name = $state"
}

echo "Enabling the microphone capture path:"
set_switch "Mic1 Capture Switch" on
set_switch "Mic2 Capture Switch" off        # only one mic; keeps its (unconnected) pin out of the mix
set_switch "Line In Capture Switch" off
set_switch "Mixer Capture Switch" off
set_switch "Mixer Reversed Capture Switch" off
set_abs "Mic1 Boost Volume" "$BOOST"
set_abs "ADC Gain Capture Volume" "$GAIN"
set_pct "ADC Capture Volume" 80

# DAPM state of the widgets the microphone needs, read while recording (needs debugfs)
show_dapm() {
    mountpoint -q /sys/kernel/debug 2>/dev/null || mount -t debugfs none /sys/kernel/debug 2>/dev/null
    local found=0
    for w in MBIAS MIC1 "Mic1 Amplifier" "Left ADC Mixer" "Left ADC"; do
        for f in /sys/kernel/debug/asoc/*/*/dapm/"$w"; do
            [ -r "$f" ] && { printf '   dapm %-16s %s\n' "$w" "$(head -1 "$f")"; found=1; break; }
        done
    done
    [ $found = 0 ] && echo "   (no dapm info: debugfs not available)"
}

record() { # file label dapm?
    echo "$2"
    timeout 7 arecord -q -D "plughw:$CARD,0" -t raw -f S16_LE -r 16000 -c 2 -d 3 "$1" 2>/tmp/mic-setup.err &
    local pid=$!
    [ "$3" = dapm ] && { sleep 1; show_dapm; }
    wait $pid
    head -c 200 /tmp/mic-setup.err | head -2 | sed 's/^/   arecord: /'
}

echo
record /tmp/mic-quiet.raw "STAY QUIET for 3 seconds..."
sleep 1
record /tmp/mic-noisy.raw "MAKE NOISE (clap / talk) for 3 seconds, starting now..." dapm

BOOST=$BOOST BOOST=$BOOST python3 - /tmp/mic-quiet.raw /tmp/mic-noisy.raw <<'PY'
import array, math, os, sys
SKIP = 8000      # samples per channel (0.5 s at 16 kHz): the codec ADC clicks when capture starts

def analyse(path):
    if not os.path.exists(path) or os.path.getsize(path) < 4 * 16000:
        return None
    a = array.array('h'); a.frombytes(open(path, 'rb').read()[:os.path.getsize(path) // 4 * 4])
    best = None
    for ch in (0, 1):
        s = a[ch::2]
        head, body = s[:SKIP], s[SKIP:]
        mean = sum(body) / len(body)
        rms = math.sqrt(sum((x - mean) ** 2 for x in body) / len(body)) / 32768 * 1000
        r = (rms, mean / 32768 * 100, max(abs(x) for x in body), max(abs(x) for x in head))
        best = r if best is None or r[0] > best[0] else best
    return best

q, n = analyse(sys.argv[1]), analyse(sys.argv[2])
print()
if not q or not n:
    print("Recording failed - see the arecord message above."); sys.exit()
print("                   volume (Kano scale)   DC offset   peak after 0.5 s   peak in first 0.5 s")
print("  quiet            %8.1f              %6.1f%%    %9d          %9d" % (q[0], q[1], q[2], q[3]))
print("  noise            %8.1f              %6.1f%%    %9d          %9d" % (n[0], n[1], n[2], n[3]))
print()
print("The sound visualizer draws a full-height bar at volume 50; speech should land around 15-40.")
b = int(os.environ.get("BOOST", "2"))
if q[3] >= 32700 and q[2] < 32700:
    print("-> The full-scale peak in the quiet recording is only in the first 0.5 s: that is the codec's start-up click. The server ignores it.")
if q[0] > 8:
    print("-> The quiet level is %.1f even after the click. Real room noise, or too much gain: if it stays high in a silent room, rerun with --boost %d." % (q[0], max(0, b - 1)))
if n[0] > 60:
    print("-> Too loud: normal talking reads %.1f. Rerun with --boost %d (each step is 3 dB)." % (n[0], max(0, b - 1)))
elif n[0] < 8:
    print("-> Quiet: the noise barely registered. Try --boost %d (each step is 3 dB), or check the DAPM lines above." % min(7, b + 1))
else:
    print("-> Level looks usable. (A loud clap reaching full scale is normal; talking should not.)")
if abs(q[1]) > 3:
    print("-> Large DC offset (%.1f%% of full scale): harmless, the server takes it out of the volume." % q[1])
PY
rm -f /tmp/mic-quiet.raw /tmp/mic-noisy.raw /tmp/mic-setup.err

echo
echo "Device-tree audio routing (what the board connects to what):"
for f in /proc/device-tree/soc*/codec*/allwinner,audio-routing /proc/device-tree/sound*/allwinner,audio-routing; do
    [ -r "$f" ] && { echo "  $f"; tr '\0' '\n' < "$f" | paste - - | sed 's/^/    /'; }
done

if [ $SAVE = 1 ]; then
    alsactl store "$CARD" && echo "Mixer settings stored (/var/lib/alsa/asound.state), restored at boot by alsa-restore."
else
    echo; echo "Run again with --save once it works, to keep the settings across reboots."
fi
