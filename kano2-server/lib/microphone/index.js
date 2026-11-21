"use strict";

/*
 * Microphone: volume (RMS x config.microphone.rawVolumeMultiplier) from ALSA, via arecord.
 *
 * The MCU has no microphone support, so the Pixel Kit's mic is on the Linux side (the board's audio codec).
 * Kano's original module used the read-audio package, which ran `arecord -D hw:0,0 -f dat` and misread the
 * stereo 16-bit samples as 32-bit ones; it effectively measured one channel. This version asks for what it wants
 * and reports problems instead of staying silent.
 *
 * config.microphone (all optional except the first two, which were already there):
 *   streamBufferSize     samples per volume reading at the 48 kHz of Kano's original capture (1024 = a reading every
 *                        ~21 ms). Scaled to sampleRate here, so the cadence stays the same.
 *   rawVolumeMultiplier  volume = RMS of samples scaled to -1..1, times this (1000)
 *   device               'auto' (default: first capture card that looks like an audio codec), or an ALSA device
 *                        such as 'plughw:1,0'. The KANO_MIC_DEVICE environment variable overrides it.
 *   sampleRate           16000
 *   latencyMs            50 - arecord buffer; its default is ~500 ms, which delivers audio in 125 ms bursts and left
 *                        some display frames with no reading at all. 0 = use arecord's defaults.
 *   removeDcOffset       true - the codec ADC has a DC offset; it is not sound, so it is taken out of the volume
 *   warmupMs             400 - the codec ADC makes a loud click when capture starts; that much audio is ignored
 *   channels             2 - the loudest channel is used, so it does not matter which one the mic is wired to
 *   arecordPath          '/usr/bin/arecord'
 */

const { spawn, execFile } = require('child_process');

const MAX_RESTARTS = 5,
      RESTART_DELAY_MS = 1000;

let microphone;

/* Parse `arecord -l` and pick a capture device, e.g. 'plughw:1,0'. Returns null if there is none. */
function pickCaptureDevice (listing) {
    let devices = [],
        re = /^card (\d+): (\S+) \[(.*?)\], device (\d+): (.*)$/gm,
        m;

    while ((m = re.exec(listing)) !== null) {
        devices.push({ card: m[1], device: m[4], text: `${m[2]} ${m[3]} ${m[5]}` });
    }

    let best = devices.find((d) => /codec|adc|analog|mic/i.test(d.text) && !/hdmi|spdif/i.test(d.text)) ||
               devices.find((d) => !/hdmi|spdif/i.test(d.text)) ||
               devices[0];

    return best ? `plughw:${best.card},${best.device}` : null;
}

class Microphone {
    constructor(config) {
        let mic = config.microphone || {};

        this.config = config;
        this.multiplier = mic.rawVolumeMultiplier !== undefined ? mic.rawVolumeMultiplier : 1000;
        this.deviceSetting = process.env.KANO_MIC_DEVICE || mic.device || 'auto';
        this.sampleRate = mic.sampleRate || 16000;
        this.frameSamples = Math.max(64, Math.round((mic.streamBufferSize || 1024) * this.sampleRate / 48000));
        this.latencyMs = mic.latencyMs !== undefined ? mic.latencyMs : 50;
        this.lowLatency = this.latencyMs > 0;
        this.removeDc = mic.removeDcOffset !== false;
        this.warmupFrames = Math.ceil((mic.warmupMs !== undefined ? mic.warmupMs : 400) / (this.frameSamples / this.sampleRate * 1000));
        this.peak = 0;
        this.channels = mic.channels || 2;
        this.arecordPath = mic.arecordPath || '/usr/bin/arecord';

        this.audio = null;
        this.volume = 0;
        this.pitch = 0;
        this.volumeChangesCallbacks = [];
        this.wanted = false;
        this.starting = false;
        this.restarts = 0;
        this.device = null;
        this.lastError = null;
    }

    startRecording () {
        this.wanted = true;
        if (this.audio || this.starting) {
            return;
        }
        this.starting = true;

        this._resolveDevice((device) => {
            this.starting = false;
            if (!this.wanted) {
                return;
            }
            this.device = device;
            this._spawn(device);
        });
    }

    _resolveDevice (callback) {
        if (this.deviceSetting !== 'auto') {
            return callback(this.deviceSetting);
        }
        execFile(this.arecordPath, ['-l'], (err, stdout) => {
            let device = err ? null : pickCaptureDevice(String(stdout));
            if (!device) {
                this._fail(err ? `cannot run ${this.arecordPath} -l (${err.code || err.message}); is alsa-utils installed?`
                              : 'no capture device found by arecord -l; trying ALSA "default"');
            }
            callback(device || 'default');
        });
    }

    _spawn (device) {
        let args = ['-q', '-D', device, '-t', 'raw', '-f', 'S16_LE', '-r', String(this.sampleRate), '-c', String(this.channels)],
            lowLatency = this.lowLatency,
            gotAudio = false,
            ps;

        if (lowLatency) {
            args.push(`--buffer-time=${this.latencyMs * 1000}`, `--period-time=${Math.round(this.latencyMs * 200)}`);
        }
        ps = spawn(this.arecordPath, args);
        let frameBytes = this.frameSamples * this.channels * 2,
            pending = Buffer.alloc(0),
            framesSeen = 0,
            stderrText = '';

        this.audio = { ps: ps };

        ps.on('error', (err) => {
            this._fail(`cannot start ${this.arecordPath}: ${err.code || err.message}`);
            this._gone(ps);
        });

        ps.stderr.on('data', (d) => {
            if (stderrText.length < 400) {
                stderrText += String(d);
            }
        });

        ps.stdout.on('data', (chunk) => {
            pending = Buffer.concat([pending, chunk]);
            while (pending.length >= frameBytes) {
                let frame = pending.subarray(0, frameBytes);
                pending = pending.subarray(frameBytes);
                gotAudio = true;
                this.restarts = 0;           // audio is flowing
                this.lastError = null;
                if (framesSeen++ < this.warmupFrames) {
                    continue;                // the ADC clicks when capture starts
                }
                this.onFrame(this._volumeOf(frame));
            }
        });

        ps.on('exit', (code) => {
            if (lowLatency && !gotAudio && this.audio && this.audio.ps === ps && this.wanted) {
                // Some devices refuse the small buffer: fall back to arecord's own defaults and go again at once
                console.log('Microphone: arecord rejected the low-latency buffer settings, using its defaults');
                this.lowLatency = false;
                this.audio = null;
                return this._spawn(device);
            }
            if (this.audio && this.audio.ps === ps) {
                this._fail(`arecord (${args.join(' ')}) exited with ${code}: ${stderrText.trim().split('\n')[0] || 'no message'}`);
            }
            this._gone(ps);
        });
    }

    /* The loudest channel's RMS, samples scaled to -1..1 (DC offset removed), times the multiplier. */
    _volumeOf (frame) {
        let loudest = 0,
            peak = 0;

        for (let c = 0; c < this.channels; c++) {
            let samples = new Float32Array(this.frameSamples),
                mean = 0,
                sum = 0;

            for (let i = 0; i < this.frameSamples; i++) {
                let s = frame.readInt16LE((i * this.channels + c) * 2) / 32768;
                samples[i] = s;
                mean += s;
                peak = Math.max(peak, Math.abs(s));
            }
            mean = this.removeDc ? mean / this.frameSamples : 0;

            for (let i = 0; i < this.frameSamples; i++) {
                let s = samples[i] - mean;
                sum += s * s;
            }
            loudest = Math.max(loudest, Math.sqrt(sum / this.frameSamples));
        }

        this.peak = peak;   // 1.0 = the ADC is clipping
        return loudest * this.multiplier;
    }

    _gone (ps) {
        if (this.audio && this.audio.ps === ps) {
            this.audio = null;
        }
        if (this.wanted && this.restarts < MAX_RESTARTS && !this.restartTimer) {
            this.restarts++;
            this.restartTimer = setTimeout(() => {
                this.restartTimer = null;
                if (this.wanted && !this.audio) {
                    this._spawn(this.device || 'default');
                }
            }, RESTART_DELAY_MS);
            this.restartTimer.unref();
        }
    }

    _fail (message) {
        if (message !== this.lastError) {
            console.log('Microphone:', message);
        }
        this.lastError = message;
    }

    onFrame (volume) {
        this.volume = volume;
        this.volumeChangesCallbacks.forEach((obj) => {
            if (this.volume >= obj.threshold) {
                obj.callback(this.volume);
            }
        });
    }

    stopRecording () {
        this.wanted = false;
        clearTimeout(this.restartTimer);
        this.restartTimer = null;
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
        let callbackIndex = this.volumeChangesCallbacks.findIndex((obj) => obj.callback === callback);
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
};
module.exports.pickCaptureDevice = pickCaptureDevice;
