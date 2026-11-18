# kano2-shared-lib (Node 22 port)

Port of Kano's `kano2-shared-lib` v1.0.0 (git dcf85a3, from the March 2017 golden image).
The original needs Node 6 + serialport 4 + native modules; this runs on Node >= 18.15 (tested on 22).

## Install
    cd kano2-server
    npm install ../kano2-shared-lib-node22      # or copy into node_modules/kano2-shared-lib

## What changed
| File | Change |
|---|---|
| `lib/device-bus/channels/serial.js` | serialport 4 -> 12 (`new SerialPort({path,...})`, `ReadlineParser`, `isOpen` property). Same framing: JSON + `\r\n`, space-padded to `padLength`, XON/XOFF. **Added** `sendBreak(ms, cb)`, `reopenOnDisconnect`, and `'disconnect'` events - the repo's kano2-server needs them and the 2017 library didn't have them. Only real serialport options are passed through now. |
| `lib/device-bus/client.js` | `node-uuid` -> `crypto.randomUUID`; timers are cleared on response; calling without a callback no longer crashes later. |
| `lib/device-bus/event-stream.js` | removed `this.listeners = {}` (it shadowed `EventEmitter#listeners`); an `error` event from the MCU with no listener is logged instead of throwing. |
| `lib/device-bus/server.js`, `peer.js` | params copied before use; `peer.start/stop` were calling non-existent methods -> no-ops. |
| `lib/logger.js` | **new** - `getLogger(name, level)` (the repo's `bin/start` and `watchdog-monitor.js` import it; it was not in the image's version). |
| `lib/devices/devices.js` | **stub** replacing the 912-line `lib/devices.js` (USB hot-plug of Kano peripheral kits via native `usb-detection`). Reports no peripherals; the lightboard is virtual so it still works. |
| `lib/storage.js`, `devices/*` | unchanged (`node-storage`, `ospath` work on Node 22). |
| not ported | `lib/virtual/*` (debug-only fake serial port), `tests/`, `usb-detection`, `tcp-ping`, `socket.io`, `node-fetch`. |

## Verified
Fake MCU on a pty speaking the wire protocol: RPC round-trip, MCU events, error responses, 
timeouts, callback-less calls, padding to multiples of 227 bytes, break sequencing (mocked - a pty has no modem lines).
NOT tested on a real Pixel Kit.
