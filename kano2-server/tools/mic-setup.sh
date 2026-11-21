#!/bin/bash
# Turns on the capture path of the board's Allwinner audio codec (H3-style: "H3 Audio Codec"), records two seconds
# and prints the level. Make some noise (clap, talk) during the "RECORDING" line.
#   sudo bash tools/mic-setup.sh [card]        # card defaults to the first capture card
#   sudo bash tools/mic-setup.sh --save        # same, then make the mixer settings stick across reboots (alsactl store)
# Control names come from the kernel's sun8i-codec-analog / sun4i-codec drivers. A control that does not exist on
# this board is skipped.

SAVE=0; [ "$1" = "--save" ] && { SAVE=1; shift; }
CARD=${1:-$(arecord -l 2>/dev/null | sed -n 's/^card \([0-9]*\):.*/\1/p' | head -1)}
[ -z "$CARD" ] && { echo "No capture card found (arecord -l). Install alsa-utils or enable the codec in the device tree."; exit 1; }
echo "Card $CARD: $(cat /proc/asound/card$CARD/id 2>/dev/null)"

exists() { amixer -c "$CARD" cget name="$1" >/dev/null 2>&1; }

# set a numeric control to PCT percent of its maximum
set_pct() {
    local name="$1" pct="$2" max
    exists "$name" || { echo "  - $name: not present"; return; }
    max=$(amixer -c "$CARD" cget name="$name" | sed -n 's/.*max=\([0-9]*\).*/\1/p' | head -1)
    [ -z "$max" ] && { echo "  - $name: cannot read range"; return; }
    local val=$(( (max * pct + 50) / 100 ))
    amixer -c "$CARD" cset name="$name" "$val,$val" >/dev/null 2>&1 || amixer -c "$CARD" cset name="$name" "$val" >/dev/null 2>&1
    echo "  - $name = $val (of $max)"
}

# set an on/off control
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
set_pct "Mic1 Boost Volume" 70
set_pct "ADC Gain Capture Volume" 70
set_pct "ADC Capture Volume" 80

measure() {
    local dev="$1" rate="$2" ch="$3"
    echo "RECORDING  -D $dev -r $rate -c $ch   (make noise now)"
    timeout 6 arecord -q -D "$dev" -t raw -f S16_LE -r "$rate" -c "$ch" -d 2 /tmp/mic-setup.raw 2>/tmp/mic-setup.err &
    local pid=$!
    sleep 1; show_dapm
    wait $pid; local rc=$?
    local bytes; bytes=$(stat -c %s /tmp/mic-setup.raw 2>/dev/null || echo 0)
    printf '   exit %s, %s bytes' "$rc" "$bytes"
    if [ "$bytes" -gt 0 ] && command -v python3 >/dev/null; then
        python3 - /tmp/mic-setup.raw "$ch" <<'PY'
import array, math, sys
a = array.array('h'); data = open(sys.argv[1], 'rb').read(); a.frombytes(data[:len(data) // 2 * 2])
ch = int(sys.argv[2]); out = []
for c in range(ch):
    s = a[c::ch]
    if s:
        out.append("ch%d volume=%.1f (kano scale) peak=%d" % (c, math.sqrt(sum(x * x for x in s) / len(s)) / 32768 * 1000, max(abs(x) for x in s)))
print("   |   " + "   ".join(out))
PY
    else echo; fi
    head -c 200 /tmp/mic-setup.err | head -2 | sed 's/^/   arecord: /'
    rm -f /tmp/mic-setup.raw /tmp/mic-setup.err
}

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

echo
measure "plughw:$CARD,0" 16000 2
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
