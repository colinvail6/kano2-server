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
                console.log("Failed to open serial connection");
                console.log(err);
                if (this.reopenOnDisconnect && !this.closedByUser) {
                    setTimeout(() => this._open(), REOPEN_DELAY_MS).unref();
                }
            } else {
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
        if (this._writing || !this.port.isOpen || this.q.length === 0) {
            return;
        }

        let req = this.q.shift(),
            payload = req.content + "\r\n";

        if (this.padLength && payload.length % this.padLength > 0) {
            payload = payload + ' '.repeat(this.padLength - (payload.length % this.padLength));
        }

        if (this.debug) {
            console.log('[serial tx]', req.content.slice(0, 160));
        }

        this._writing = true;
        this.port.write(payload, (err) => {
            this._writing = false;
            req.callback(err || null);
            setImmediate(() => this._dispatch());
        });
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

    /* Hold the line in break condition for `duration` ms (the kit resets its serial parser). */
    sendBreak (duration, callback) {
        callback = callback || function () {};

        if (this.closedByUser) {
            return callback(new Error('Port is not open'));
        }

        this._whenOpen(5000, (openErr) => {
            if (openErr) {
                return callback(openErr);
            }
            this.port.set({ brk: true }, (err) => {
                if (err) {
                    return callback(err);
                }
                setTimeout(() => {
                    this.port.set({ brk: false }, (err2) => callback(err2 || null));
                }, duration);
            });
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
                console.log('[serial rx]', String(data).slice(0, 300));
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
