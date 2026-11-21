#!/usr/bin/env node
"use strict";
/*
 * Live microphone level meter, using the same module the server uses.
 *   node tools/mic-test.js [seconds]        (default 15; stop kano2-server first only if it is using the microphone)
 * Clap or talk; the bar should move. Prints the device that was picked and any arecord error.
 */
const config = require('../config.json').default,
      mic = require('../lib/microphone')(config),
      seconds = Number(process.argv[2]) || 15;

let peak = 0, frames = 0, last = 0;

mic.onVolumeThreshold(0, (volume) => {
    frames++;
    peak = Math.max(peak, volume);
    if (Date.now() - last > 100) {
        last = Date.now();
        let bar = '#'.repeat(Math.min(60, Math.round(volume / 5)));
        process.stdout.write(`\r${volume.toFixed(1).padStart(7)}  ${bar.padEnd(60)}`);
    }
});

setTimeout(() => {
    mic.stopRecording();
    console.log(`\n\ndevice: ${mic.device}   readings: ${frames}   peak volume: ${peak.toFixed(1)}   last error: ${mic.lastError || 'none'}`);
    if (!frames) {
        console.log('No audio arrived. Run: bash tools/mic-diagnose.sh');
    }
    process.exit(0);
}, seconds * 1000);
