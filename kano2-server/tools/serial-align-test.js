#!/usr/bin/env node
"use strict";
/*
 * Measures how the Pixel Kit MCU answers after a serial break, for a few padding / spacer combinations, so the right
 * recovery sequence can be chosen from data instead of guesses.
 *
 *   1. Stop kano2-server first (only one program can use the serial port).
 *   2. sudo $(which node) tools/serial-align-test.js            # uses kit_device.serial_path from config.json
 *      (or pass the device: sudo $(which node) tools/serial-align-test.js /dev/ttyS2)
 *
 * Takes about 1.5 minutes and leaves the display blank. Every row is one run: [break] -> [spacer bytes] ->
 * 3 x serial-info, 1s apart -> 6 blank display frames, 100ms apart. Nothing is pushed or retried, so a slow answer
 * shows up as a slow answer. The first clean variant is then run as a 10 second stream. Paste the whole output back.
 */
const Serial = require('kano2-shared-lib/lib/device-bus/channels/serial'),
      Client = require('kano2-shared-lib/lib/device-bus/client'),
      Events = require('kano2-shared-lib/lib/device-bus/event-stream'),
      kit = require('../config.json').default.kit_device,
      device = process.argv[2] || kit.serial_path;

const ch = new Serial(device, { baudRate: kit.baud_rate || 115200, xon: true, xoff: true, padLength: kit.pad_length || 227, breakSettleMs: 2000 }),
      rpc = new Client(ch),
      events = new Events(ch),
      BLANK_FRAME = Buffer.alloc(256).toString('base64'),
      sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
      PAD = { 'space': ' ', 'NUL': '\0' };

let errors = 0;
events.on('error', () => errors++);
events.on('invalid-json', () => {});

/* resolves to the answer latency in ms, or null if the MCU did not answer within 700ms */
function timedCall (method, params) {
    return new Promise((resolve) => {
        let t0 = Date.now();
        rpc.call(method, params, { timeout: 700, nudgeAfter: 0 }, (err) => resolve(err === 'Request timed out' ? null : Date.now() - t0));
    });
}

async function runVariant (v) {
    errors = 0;
    ch.padChar = PAD[v.pad];
    if (v.brk) {
        await new Promise((resolve) => ch.sendBreak(5, (e) => {
            if (e) {
                console.log('   (break failed: ' + e.message.split('\n')[0] + ', continuing)');
            }
            resolve();
        }));
    }
    if (v.spacer) {
        ch.nudge(v.spacer);
    }
    await sleep(150);

    let probes = [];
    for (let i = 0; i < 3; i++) {
        probes.push(await timedCall('serial-info', []));
        await sleep(1000);
    }

    let frames = [];
    for (let i = 0; i < 6; i++) {
        frames.push(timedCall('grid-bmp', [{ map: BLANK_FRAME }]));
        await sleep(100);
    }
    frames = await Promise.all(frames);

    let answered = frames.filter((f) => f !== null).sort((a, b) => a - b),
        median = answered.length ? answered[Math.floor(answered.length / 2)] : null,
        fmt = (x) => x === null ? '  --' : String(x).padStart(4),
        ok = probes.every((p) => p !== null && p < 150) && answered.length === 6 && median < 200 && errors === 0;

    console.log(
        `${(v.brk ? 'break' : 'no break').padEnd(9)} pad=${v.pad.padEnd(5)} spacer=${String(v.spacer).padStart(2)} | ` +
        `serial-info ms:${probes.map(fmt).join('')} | frames ${answered.length}/6 median ${fmt(median)} ms | decode errors ${errors}  ${ok ? 'OK' : ''}`
    );
    return ok ? v : null;
}


/* 10 seconds of display frames at 20 fps, like a running program: are they all answered, and how late? */
async function streamTest (v) {
    errors = 0;
    ch.padChar = PAD[v.pad];
    await new Promise((resolve) => ch.sendBreak(5, () => resolve()));
    if (v.spacer) {
        ch.nudge(v.spacer);
    }
    await sleep(150);

    let calls = [];
    for (let i = 0; i < 200; i++) {
        calls.push(timedCall('grid-bmp', [{ map: BLANK_FRAME }]));
        await sleep(50);
    }
    let lat = (await Promise.all(calls)).filter((x) => x !== null).sort((a, b) => a - b);
    console.log(
        `\nStream (${v.pad} padding, spacer ${v.spacer}): 200 frames at 20 fps -> answered ${lat.length}/200, ` +
        `median ${lat[Math.floor(lat.length / 2)]} ms, 95th ${lat[Math.floor(lat.length * 0.95)]} ms, max ${lat[lat.length - 1]} ms, decode errors ${errors}`
    );
}

(async () => {
    console.log(`Device ${device}. Waiting 6s for the MCU to settle...`);
    await sleep(6000);

    let variants = [{ brk: false, pad: 'NUL', spacer: 0 }, { brk: true, pad: 'space', spacer: 1 }];
    [0, 1, 2, 3, 4, 5, 8, 1, 1, 1].forEach((spacer) => variants.push({ brk: true, pad: 'NUL', spacer: spacer }));

    let good = [];
    for (let v of variants) {
        let r = await runVariant(v);
        if (r) {
            good.push(r);
        }
    }

    if (good.length) {
        await streamTest(good[0]);
    }

    console.log('\nVariants where every answer was prompt and clean:');
    console.log(good.length ? good.map((v) => `  ${v.brk ? 'break' : 'no break'}, pad=${v.pad}, spacer=${v.spacer}`).join('\n') : '  none');
    ch.close(() => process.exit(0));
})();
