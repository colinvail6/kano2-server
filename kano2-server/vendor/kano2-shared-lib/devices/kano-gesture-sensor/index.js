"use strict";

const express = require('express');

module.exports = {
    vendor: 'kano',
    product: 'gesture-sensor',

    setup: (device, callback) => {
        callback();
    },

    api: {
        root: '/gesture-sensor',
        getRouter: (self, devices) => {
            let router = express.Router();

            router.get('/:devId/gesture', (req, res) => {
                let devId = parseInt(req.params.devId),
                    dev = devices.findDevice(self.vendor, self.product, devId);

                res.json({
                    gesture: dev.lastValue.type
                });
            });

            return router;
        }
    },

    events: {
        'gesture': (e) => {
            e.device.lastValue = e.detail;
            e.forwardToSocket();
        }
    }
};
