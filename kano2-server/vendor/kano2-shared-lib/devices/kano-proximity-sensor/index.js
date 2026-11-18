"use strict";

const express = require('express');

module.exports = {
    vendor: 'kano',
    product: 'proximity-sensor',

    setup: (device, callback) => {
        callback();
    },

    api: {
        root: '/proximity-sensor',
        getRouter: (self, devices) => {
            let router = express.Router();

            router.get('/:devId/proximity', (req, res) => {
                let devId = parseInt(req.params.devId),
                    dev = devices.findDevice(self.vendor, self.product, devId);

                res.json({
                    proximity: dev.lastValue.proximity
                });
            });

            return router;
        }
    },

    events: {
        'proximity-data': (e) => {
            e.device.lastValue = e.detail;
            e.forwardToSocket();
        }
    }
};
