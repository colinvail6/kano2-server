"use strict";

module.exports = {
    deviceBus: {
        channels: {
            serial: require('./device-bus/channels/serial')
        },
        client: require('./device-bus/client'),
        server: require('./device-bus/server'),
        peer: require('./device-bus/peer'),
        eventStream: require('./device-bus/event-stream')
    },
    logger: require('./logger'),
    storage: require('./storage'),
    devices: require('./devices/devices'),
    deviceModules: require('../devices/')
};
