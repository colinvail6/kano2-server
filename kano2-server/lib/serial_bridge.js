"use strict";

// An all-black 16x8 RGB565 frame, used to test display-sized messages
const BLANK_FRAME = Buffer.alloc(16 * 8 * 2).toString('base64');
let RPCClient = require('kano2-shared-lib/lib/device-bus/client'),
    RPCEventStream = require('kano2-shared-lib/lib/device-bus/event-stream'),
    SerialChannel = require('kano2-shared-lib/lib/device-bus/channels/serial'),
    serialBridge;

class SerialBridge {
    constructor (config) {
        let channel = new SerialChannel(config.kit_device.serial_path, {
            baudRate: config.kit_device.baud_rate,
            // the KS pixel kit has buffer overflows unless we use software flow control.
            xon: true,
            xoff: true,
            padLength: config.kit_device.pad_length
        });
        this.channel = channel;
        this.client = new RPCClient(channel);
        this.eventStream = new RPCEventStream(channel);
    }

    call () {
        this.client.call.apply(this.client, arguments);
        return this;
    }

    resetSerial (callback) {
        // send a break for 5ms
        this.channel.sendBreak(5, (err) => {
            if (err) {
                return callback(err);
            }
            this._resync(callback);
        });
    }

    /*
     * After a break the Pixel Kit MCU's input framing is out of step with our messages. Symptoms: the first message
     * is garbled ("Couldn't decode JSON"), and from then on every request is only answered once the NEXT message
     * starts arriving - up to 30s later if nothing else is sent. (pixelkit.py / pixelkit.hpp hide this by sending
     * their first command twice and then flooding frames.)
     *
     * Measured on the board: writing a single padding byte after the break puts the MCU back in step, but a longer
     * spacer can leave 2-block messages (display frames) one message late. The exact amount is the MCU's business,
     * so find it by measurement: add one padding byte at a time until a short request (serial-info) AND a display-sized
     * one (a blank grid-bmp frame) are both answered promptly with nothing sent after them.
     */
    _resync (callback) {
        const MAX_SPACER_BYTES = 40,
              PROMPT_MS = 150,          // measured on the board: serial-info ~37ms, display frames ~70ms when in step
              TEST_TIMEOUT_MS = 200;
        let spacer = 0,
            shortOk = false;

        // Answered (with a value or an error) within PROMPT_MS, without anything pushing it along.
        let prompt = (method, params, done) => {
            let t0 = Date.now();
            this.client.call(method, params, { timeout: TEST_TIMEOUT_MS, nudgeAfter: 0 }, (err) => {
                done(err !== 'Request timed out' && Date.now() - t0 < PROMPT_MS);
            });
        };

        let next = () => {
            if (spacer >= MAX_SPACER_BYTES) {
                if (shortOk) {
                    console.log(`MCU framing: display-sized requests still look late after ${spacer} spacer bytes, carrying on`);
                    return callback(null);
                }
                console.log(`MCU did not answer ${spacer} serial resync probes`);
                return callback('Request timed out');
            }
            spacer++;
            this.channel.nudge(1);
            setTimeout(() => {
                prompt('serial-info', [], (ok) => {
                    shortOk = shortOk || ok;
                    if (!ok) {
                        return next();
                    }
                    prompt('grid-bmp', [{ map: BLANK_FRAME }], (frameOk) => {
                        if (frameOk) {
                            return callback(null);
                        }
                        next();
                    });
                });
            }, 30);
        };

        next();
    }

    on () {
        this.eventStream.on.apply(this.eventStream, arguments);
        return this;
    }

    removeListener () {
        this.eventStream.removeListener.apply(this.eventStream, arguments);
        return this;
    }

    removeAllListeners () {
        this.eventStream.removeAllListeners.apply(this.eventStream, arguments);
        return this;
    }
}

module.exports = function getOrCreateInstance(config) {
    if (!serialBridge) {
        serialBridge = new SerialBridge(config);
        serialBridge.on('error', (detail) => {
            console.log('Serial bridge error', (detail && detail.stack) || JSON.stringify(detail));
        });
    }
    return serialBridge;
};
