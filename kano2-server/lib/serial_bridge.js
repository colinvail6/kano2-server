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
     * After a break the Pixel Kit MCU drops the first few bytes it receives (5 on the board this was tested on), and from
     * then on only answers a request once more bytes arrive after it - which is why pixelkit.py / pixelkit.hpp send
     * their first command twice, 1s apart. Instead: write a few spaces first (they are what gets dropped), then probe
     * with the harmless 'serial-info'. The client nudges the MCU if the probe is not answered quickly.
     */
    _resync (callback) {
        const MAX_ATTEMPTS = 5,
              PROBE_TIMEOUT_MS = 800;
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

        if (typeof this.channel.nudge === 'function') {
            this.channel.nudge(16);
        }
        setTimeout(probe, 50);
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
