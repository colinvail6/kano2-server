#!/usr/bin/env python3
"""Fake Pixel Kit MCU on a pseudo-terminal, for running kano2-server without hardware (PC / QEMU).

Usage:   python3 fakemcu.py [seconds]        # default 40; prints the slave device, e.g. /dev/pts/3
Then:    point config.json -> default.kit_device.serial_path at that device
         (or: sudo ln -sf /dev/pts/3 /dev/ttyS2)  and run:  node bin/start --device=lightboard
Answers every rpc-request with success (device-info returns a fake serial) and records
how many times each method was called in $MCU_SEEN (default /tmp/fakemcu-seen.json).
Note: a pty has no modem lines, so the server's serial break fails with 'Inappropriate ioctl'; that is expected here.
"""
import os, pty, json, select, sys, time
dur = float(sys.argv[1]) if len(sys.argv) > 1 else 40
m, s = pty.openpty()
print(os.ttyname(s), flush=True)
buf = b''; seen = {}
def send(o): os.write(m, (json.dumps(o) + '\r\n').encode())
t0 = time.time()
while time.time() - t0 < dur:
    r, _, _ = select.select([m], [], [], 0.2)
    if m not in r: continue
    try: buf += os.read(m, 8192)
    except OSError: break
    while b'\r\n' in buf:
        line, buf = buf.split(b'\r\n', 1)
        line = line.strip(b' \x00')
        if not line: continue
        try: msg = json.loads(line)
        except Exception: continue
        if msg.get('type') != 'rpc-request': continue
        seen[msg['method']] = seen.get(msg['method'], 0) + 1
        value = {'serial': 'FAKE0001', 'version': '1.0.0'} if msg['method'] == 'device-info' else True
        open(os.environ.get('MCU_SEEN', '/tmp/fakemcu-seen.json'), 'w').write(json.dumps(seen))
        send({'type': 'rpc-response', 'id': msg['id'], 'err': None, 'value': value})

