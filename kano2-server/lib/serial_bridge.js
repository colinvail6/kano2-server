"use strict";
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
     * After a break the Pixel Kit MCU loses the first few bytes of the first message it receives (5 on the hardware
     * this was tested on), garbles it, and then sits on it until more data arrives - so the first request is answered
     * ~30s late. pixelkit.py and pixelkit.hpp deal with it by sending their first command twice, 1s apart.
     * Same idea here, with a harmless 'serial-info' probe: retry until the MCU answers (with a value OR an error).
     */
    _resync (callback) {
        const MAX_ATTEMPTS = 6,
              PROBE_TIMEOUT_MS = 1000;
        let attempts = 0,
            probe = () => {
                attempts++;
                this.client.call('serial-info', [], { timeout: PROBE_TIMEOUT_MS }, (err) => {
                    if (err !== 'Request timed out') {
                        return callback(null);
                    }
                    if (attempts >= MAX_ATTEMPTS) {
                        console.log(`MCU did not answer ${attempts} serial resync probes`);
                        return callback(err);
                    }
                    probe();
                });
            };

        probe();
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
