"use strict";

const express = require('express');

module.exports = {
    vendor: 'kano',
    product: 'gyro-accelerometer',

    setup: (device, callback) => {
        callback();
    },

    api: {
        root: '/gyro-accelerometer',
        getRouter: (self, devices) => {
            let router = express.Router();

            router.get('/:devId/gyro', (req, res) => {
                let devId = parseInt(req.params.devId),
                    dev = devices.findDevice(self.vendor, self.product, devId);

                res.json({
                    vector: dev.lastGyroVector
                });
            });

            router.get('/:devId/accelerometer', (req, res) => {
                let devId = parseInt(req.params.devId),
                    dev = devices.findDevice(self.vendor, self.product, devId);

                res.json({
                    vector: dev.lastAccelVector
                });
            });

            return router;
        }
    },

    events: {
        'gyro-data': (e) => {
            e.device.lastGyroVector = e.detail;
            e.forwardToSocket();
        },
        'accelerometer-data': (e) => {
            e.device.lastAccelVector = e.detail;
            e.forwardToSocket();
        }
    }
};
