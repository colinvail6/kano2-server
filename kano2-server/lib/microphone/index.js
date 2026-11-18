"use strict";
const spawn = require('child_process').spawn,
    KanoAudio = require('../../utils/audio'),
    SAMPLE_RATE = 16000;

let microphone;

class Microphone {
    constructor(config) {
        this.config = config;
        this.audio = null;
        this.volume = 0;
        this.pitch = 0;
        this.volumeChangesCallbacks = [];
    }

    startRecording () {
        if (this.audio) {
            return;
        }
        // 16-bit signed little-endian mono PCM on stdout (replaces the read-audio module)
        let ps = spawn('/usr/bin/arecord', ['-q', '-t', 'raw', '-f', 'S16_LE', '-r', String(SAMPLE_RATE), '-c', '1', '-']),
            frameBytes = this.config.microphone.streamBufferSize * 2,
            pending = Buffer.alloc(0);

        this.audio = { ps };

        // No arecord / no capture device: leave volume at 0 instead of crashing the server
        ps.on('error', () => { if (this.audio && this.audio.ps === ps) { this.audio = null; } });
        ps.on('exit', () => { if (this.audio && this.audio.ps === ps) { this.audio = null; } });
        ps.stderr.on('data', () => {});

        ps.stdout.on('data', (chunk) => {
            pending = Buffer.concat([pending, chunk]);
            while (pending.length >= frameBytes) {
                let frame = pending.subarray(0, frameBytes),
                    samples = new Float32Array(this.config.microphone.streamBufferSize);
                for (let i = 0; i < samples.length; i++) {
                    samples[i] = frame.readInt16LE(i * 2) / 32768; // normalise to -1..1
                }
                pending = pending.subarray(frameBytes);
                this.onFrame(samples);
            }
        });
    }

    onFrame (samples) {
        this.volume = KanoAudio.getRMS(samples) * this.config.microphone.rawVolumeMultiplier;
        this.volumeChangesCallbacks.forEach((obj) => {
            if (this.volume >= obj.threshold) {
                obj.callback(this.volume);
            }
        });
    }

    stopRecording () {
        if (this.audio) {
            this.audio.ps.kill('SIGINT');
            this.audio = null;
        }
        this.volumeChangesCallbacks = [];
    }

    onVolumeThreshold (threshold, callback) {
        this.volumeChangesCallbacks.push({
            threshold: threshold,
            callback: callback
        });
        this.startRecording();
    }

    removeOnVolumeThreshold (callback) {
        // The old code compared the callback to {threshold, callback} entries, so it never matched
        let callbackIndex = this.volumeChangesCallbacks.findIndex(obj => obj.callback === callback);
        if (callbackIndex !== -1) {
            this.volumeChangesCallbacks.splice(callbackIndex, 1);
        }
    }

    getVolume () {
        if (!this.audio) {
            this.startRecording();
        }
        return this.volume;
    }

    getPitch () {
        if (!this.audio) {
            this.startRecording();
        }
        return this.pitch;
    }
}

module.exports = function getOrCreateMicrophone(config) {
    if (!microphone) {
        microphone = new Microphone(config);
    }
    return microphone;
}
