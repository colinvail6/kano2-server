#!/usr/bin/env python3
"""Fake Pixel Kit MCU on a pseudo-terminal, for running kano2-server without hardware (PC / QEMU).

Usage:   python3 fakemcu.py [seconds]        # default 40; prints the slave device, e.g. /dev/pts/3
Then:    point config.json -> default.kit_device.serial_path at that device
         (or: sudo ln -sf /dev/pts/3 /dev/ttyS2)  and run:  node bin/start --device=lightboard
Answers every rpc-request with success (device-info returns a fake serial, serial-info returns padding info) and records
how many times each method was called in $MCU_SEEN (default /tmp/fakemcu-seen.json).
Note: a pty has no modem lines, so the server's serial break fails with 'Inappropriate ioctl'; that is expected here.

FAKEMCU_BLOCKS=1 reproduces what the real board was seen doing after a serial break:
  - it drops the first FAKEMCU_DROP (default 5) bytes it receives, and
  - it only parses its input when a whole 227-byte block has arrived, so every request is answered only once the
    first bytes of the NEXT message show up (or something else pushes the block through). The first message,
    having lost its head, is reported as 'Couldn't decode JSON'.
"""
import os, pty, json, select, sys, time

BLOCKS = os.environ.get('FAKEMCU_BLOCKS') == '1'
BLOCK = 227
DROP = int(os.environ.get('FAKEMCU_DROP', '5'))   # bytes the MCU drops after a break (the real board's alignment is found by the server)
dur = float(sys.argv[1]) if len(sys.argv) > 1 else 40
m, s = pty.openpty()
print(os.ttyname(s), flush=True)
seen = {}
SEEN_FILE = os.environ.get('MCU_SEEN', '/tmp/fakemcu-seen.json')

def send(o): os.write(m, (json.dumps(o) + '\r\n').encode())

def handle(line):
    line = line.strip(b' \x00')
    if not line:
        return
    try:
        msg = json.loads(line)
    except Exception:
        send({'type': 'event', 'name': 'error', 'detail': {'msg': "Couldn't decode JSON", 'ovf': '00000000'}})
        send({'type': 'event', 'name': 'invalid-json', 'invalid': line.decode(errors='replace')})
        return
    if msg.get('type') != 'rpc-request':
        return
    seen[msg['method']] = seen.get(msg['method'], 0) + 1
    open(SEEN_FILE, 'w').write(json.dumps(seen))
    value = True
    if msg['method'] == 'device-info': value = {'serial': 'FAKE0001', 'version': '1.0.0'}
    if msg['method'] == 'serial-info': value = {'padBefore': 0, 'padAfter': 0, 'padTotal': 0}
    send({'type': 'rpc-response', 'id': msg['id'], 'err': None, 'value': value})

pend = b''; dropped = 0; counted = 0
def feed(data):
    """Real-board model: drop the first DROP bytes, parse complete lines only when a BLOCK-byte block completes."""
    global pend, dropped, counted
    if not BLOCKS:
        pend += data
        while b'\r\n' in pend:
            line, pend = pend.split(b'\r\n', 1)
            handle(line)
        return
    if dropped < DROP:
        n = min(DROP - dropped, len(data)); dropped += n; data = data[n:]
    while data:
        take = min(BLOCK - (counted % BLOCK), len(data))
        pend += data[:take]; counted += take; data = data[take:]
        if counted % BLOCK == 0:
            parts = pend.split(b'\r\n')
            pend = parts[-1]                       # partial line carries over to the next block
            for line in parts[:-1]:
                handle(line)

t0 = time.time()
while time.time() - t0 < dur:
    r, _, _ = select.select([m], [], [], 0.2)
    if m not in r: continue
    try: feed(os.read(m, 8192))
    except OSError: break
