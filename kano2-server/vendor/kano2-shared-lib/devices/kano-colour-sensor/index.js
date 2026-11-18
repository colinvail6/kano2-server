"use strict";

const express = require('express');

module.exports = {
    vendor: 'kano',
    product: 'colour-sensor',

    setup: (device, callback) => {
        callback();
    },

    api: {
        root: '/colour-sensor',
        getRouter: (self, devices) => {
            let router = express.Router();

            router.get('/:devId/colour', (req, res) => {
                let devId = parseInt(req.params.devId);

                res.json({
                    colour: devices.findDevice(self.vendor, self.product, devId).lastValue
                });
            });

            return router;
        }
    },

    events: {
        'colour-data': (e) => {
            e.device.lastValue = e.detail;
            e.forwardToSocket();
        }
    }
};
