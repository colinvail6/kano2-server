"use strict";

/*
 * STUB for kano2-shared-lib/lib/devices/devices (the original is 912 lines of USB hot-plug
 * detection for Kano's peripheral kits - colour sensor, gesture sensor, camera, power-up kit...
 * - built on the native `usb-detection` module).
 *
 * The Pixel Kit's lightboard is a *virtual* device inside kano2-server, so for lightboard work
 * we only need the manager object to exist and report "no peripherals attached".
 * The original is preserved in the golden image if you want to port it later.
 */

const EventEmitter = require('events');

class Devices extends EventEmitter {
    constructor (options) {
        super();
        this.options = options || {};
        this.devices = [];
    }

    start () { return this; }
    stop () { return this; }
    stopUSBWatch () { return this; }

    setSocket (socket) {
        this.socket = socket;
        return this;
    }

    getDeviceById (id) {
        return this.devices.find((dev) => dev.id === id);
    }

    getDevices () {
        return this.devices.slice();
    }
}

module.exports = Devices;
