"use strict";

/*
 * Serial channel for the Kano device bus - Node 22 / serialport v12 port.
 *
 * Wire format (unchanged from the 2017 library):
 *   - one JSON object per message, terminated by "\r\n"
 *   - optional padding with spaces up to a multiple of `padLength` bytes
 *     (the Pixel Kit MCU overflows its buffer without it)
 *   - XON/XOFF software flow control (xon/xoff options)
 *
 * Added vs the image's version (the repo's kano2-server needs these):
 *   - sendBreak(ms, cb)
 *   - the channel is an EventEmitter and emits 'disconnect' / 'error'
 */

const EventEmitter = require('events'),
      { SerialPort, ReadlineParser } = require('serialport');

const REOPEN_DELAY_MS = 1000;

class SerialChannel extends EventEmitter {
    constructor (device, opts) {
        super();
        opts = opts || {};

        this.device = device;
        this.q = [];
        this.roles = {};
        this.listening = false;
        this.closedByUser = false;
        this.padLength = undefined;
        this.reopenOnDisconnect = opts.reopenOnDisconnect !== false; // old library always reopened
        // KANO_SERIAL_DEBUG=1 prints every message sent to / received from the MCU
        this.debug = !!(opts.debug || process.env.KANO_SERIAL_DEBUG);
        // Character used to pad messages up to a multiple of padLength (the 2017 library used spaces; pixelkit.hpp uses NULs)
        this.padChar = opts.padChar !== undefined ? opts.padChar : ' ';
        // After a break the MCU needs time to reset its parser (pixelkit.py / pixelkit.hpp both sleep 2s here)
        this.breakSettleMs = opts.breakSettleMs !== undefined ? opts.breakSettleMs : 2000;
        // KANO_BREAK_SYNC=1: also send the 0x55 'U' sync byte after the break (what pixelkit.hpp does)
        this.breakSync = !!(opts.breakSync || process.env.KANO_BREAK_SYNC);
        this._holdWrites = false;
        this._onIdle = null;
        this._openFailures = 0;

        if (typeof opts.padLength === 'number' && opts.padLength > 0) {
            this.padLength = opts.padLength;
        }

        // Only pass real serialport options through (the old code passed everything).
        let portOpts = { path: device, baudRate: opts.baudRate || 115200, autoOpen: false };
        ['dataBits', 'stopBits', 'parity', 'rtscts', 'xon', 'xoff', 'xany', 'lock'].forEach((k) => {
            if (opts[k] !== undefined) {
                portOpts[k] = opts[k];
            }
        });

        this.port = new SerialPort(portOpts);
        this.parser = this.port.pipe(new ReadlineParser({ delimiter: '\r\n' }));

        this.port.on('error', (err) => {
            console.log(err);
            this.emit('port-error', err);
        });

        this.port.on('close', () => {
            this.emit('disconnect');
            if (this.reopenOnDisconnect && !this.closedByUser) {
                setTimeout(() => this._open(), REOPEN_DELAY_MS).unref();
            }
        });

        this._open();
    }

    _open (callback) {
        if (this.port.isOpen || this.port.opening) {
            return callback && callback(null);
        }

        this.port.open((err) => {
            if (err) {
                this._openFailures++;
                if (this._openFailures === 1 || this._openFailures % 30 === 0) {
                    console.log(`Failed to open serial connection ${this.device} (will keep retrying quietly):`, err.message);
                }
                if (this.reopenOnDisconnect && !this.closedByUser) {
                    let delay = Math.min(REOPEN_DELAY_MS * Math.pow(2, Math.min(this._openFailures - 1, 5)), 30000);
                    setTimeout(() => this._open(), delay).unref();
                }
            } else {
                this._openFailures = 0;
                console.log(`Port to ${this.device} opened successfully`);
                /* Dispatch any request that queued up before the port opened. */
                this._dispatch();
            }
            if (callback) {
                callback(err);
            }
        });
    }

    send (type, message, callback) {
        message['type'] = type;

        let content = JSON.stringify(message);

        this.q.push({ content: content, callback: callback || function () {} });
        this._dispatch();
    }

    _dispatch () {
        if (this._writing || this._holdWrites || !this.port.isOpen || this.q.length === 0) {
            return;
        }

        let req = this.q.shift(),
            payload = req.raw !== undefined ? req.raw : req.content + "\r\n";

        if (req.raw === undefined && this.padLength && payload.length % this.padLength > 0) {
            payload = payload + this.padChar.repeat(this.padLength - (payload.length % this.padLength));
        }

        if (this.debug) {
            this._traceTx(req);
        }

        this._writing = true;
        this.port.write(payload, (err) => {
            this._writing = false;
            req.callback(err || null);
            if (this._onIdle) {
                let waiting = this._onIdle;
                this._onIdle = null;
                return waiting();
            }
            setImmediate(() => this._dispatch());
        });
    }

    /*
     * Push on the MCU: write `count` spaces. Spaces are the padding character, so the MCU ignores them as data, but they
     * complete the 227-byte block it may be sitting on, which makes it answer a request it would otherwise hold until
     * the next message arrives. The first bytes after a break are also dropped by the MCU, and spaces are what get dropped.
     */
    nudge (count, callback) {
        count = count || 16;
        this.q.unshift({ raw: this.padChar.repeat(count), callback: callback || function () {} });
        this._dispatch();
    }

    /* KANO_SERIAL_DEBUG trace. Display frames (grid-bmp) are only logged for the first few, there are 20 a second. */
    _traceTx (req) {
        if (req.raw !== undefined) {
            return console.log(`[serial tx] <${req.raw.length} padding bytes>`);
        }
        let method = (/"method":"([^"]+)"/.exec(req.content) || [])[1];
        if (method === 'grid-bmp') {
            this._frames = (this._frames || 0) + 1;
            if (this._frames > 3) {
                this._quietIds = this._quietIds || new Set();
                this._quietIds.add((/"id":"([^"]+)"/.exec(req.content) || [])[1]);
                if (this._frames === 4) {
                    console.log('[serial] further grid-bmp frames are not logged');
                }
                return;
            }
        }
        console.log('[serial tx]', req.content.slice(0, 160));
    }

    _traceRx (data) {
        let text = String(data);
        if (this._quietIds && this._quietIds.size) {
            let id = (/"rpc-response","id":"([^"]+)"/.exec(text) || [])[1];
            if (id && this._quietIds.delete(id)) {
                return;
            }
        }
        console.log('[serial rx]', text.slice(0, 300));
    }

    /* Run fn once the port is open (or fail after timeoutMs). */
    _whenOpen (timeoutMs, fn) {
        if (this.port.isOpen) {
            return fn(null);
        }
        let timer = setTimeout(() => {
            this.port.removeListener('open', onOpen);
            fn(new Error('Port is not open'));
        }, timeoutMs);
        let onOpen = () => {
            clearTimeout(timer);
            fn(null);
        };
        this.port.once('open', onOpen);
    }

    /*
     * Hold the line in break condition for `duration` ms (the kit resets its serial parser).
     *
     * Writes are paused first and the message in flight is allowed to leave the UART completely:
     * a break asserted mid-message cuts the first bytes off it and leaves the MCU's 227-byte block framing
     * out of step ("Couldn't decode JSON", requests answered ~30s late). Queued messages go out only after
     * the MCU has had `breakSettleMs` to recover.
     */
    sendBreak (duration, callback) {
        callback = callback || function () {};

        if (this.closedByUser) {
            return callback(new Error('Port is not open'));
        }

        this._whenOpen(5000, (openErr) => {
            if (openErr) {
                return callback(openErr);
            }
            if (this._holdWrites) {
                return callback(new Error('Break already in progress'));
            }

            this._holdWrites = true;

            let release = (err) => {
                this._holdWrites = false;
                this._dispatch();
                callback(err || null);
            };

            let settle = () => setTimeout(() => release(null), this.breakSettleMs);

            let doBreak = () => {
                this.port.drain((drainErr) => {
                    if (drainErr) {
                        return release(drainErr);
                    }
                    this.port.set({ brk: true }, (err) => {
                        if (err) {
                            return release(err);
                        }
                        setTimeout(() => {
                            this.port.set({ brk: false }, (err2) => {
                                if (err2) {
                                    return release(err2);
                                }
                                if (this.breakSync) {
                                    return this.port.write('U', (e) => e ? release(e) : this.port.drain(() => settle()));
                                }
                                settle();
                            });
                        }, duration);
                    });
                });
            };

            if (this._writing) {
                this._onIdle = doBreak;
            } else {
                doBreak();
            }
        });
    }

    listen (role, callback) {
        this.roles[role] = callback;
        this._do_listen();
    }

    _do_listen () {
        if (this.listening) {
            return;
        }

        console.log("Listening on " + this.device);
        this.parser.on('data', (data) => {
            let message;

            if (this.debug) {
                this._traceRx(data);
            }

            try {
                message = JSON.parse(data);
            } catch (err) {
                console.log("Invalid JSON format, ignoring message");
                return;
            }

            if (!message) {
                console.log("Ignoring data in unknown format: " + data);
                return;
            }

            switch (message.type) {
                case 'rpc-request':
                    if (this.roles.server) {
                        this.roles.server(message);
                    } else {
                        console.log("Message ignored, no server attached");
                    }
                    break;
                case 'rpc-response':
                    if (this.roles.client) {
                        this.roles.client(message);
                    } else {
                        console.log("Message ignored, no client attached");
                    }
                    break;
                case 'device-info':
                case 'event':
                    if (this.roles.event) {
                        this.roles.event(message);
                    } else {
                        console.log("Message ignored, no event listener attached");
                    }
                    break;
                default:
                    console.log("Unknown message type " + message.type);
            }
        });

        this.listening = true;
    }

    close (callback) {
        this.closedByUser = true;
        if (!this.port.isOpen) {
            return callback && callback(null);
        }
        this.port.close((err) => {
            if (callback) {
                callback(err || null);
            }
        });
    }
}

module.exports = SerialChannel;
