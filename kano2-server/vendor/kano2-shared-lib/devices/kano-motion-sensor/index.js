"use strict";

const express = require('express');

module.exports = {
    vendor: 'kano',
    product: 'motion-sensor',

    setup: (device, callback) => {
        callback();
    },

    api: {
        root: '/motion-sensor',
        getRouter: (self, devices) => {
            let router = express.Router();

            router.get('/:devId/movement', (req, res) => {
                let devId = parseInt(req.params.devId),
                    dev = devices.findDevice(self.vendor, self.product, devId);

                res.json({
                    movement: dev.lastValue.movement
                });
            });

            return router;
        }
    },

    events: {
        'motion-data': (e) => {
            e.device.lastValue = e.detail;
            e.forwardToSocket((data) => {
                return {movement: data.movement};
            });
        }
    }
};
