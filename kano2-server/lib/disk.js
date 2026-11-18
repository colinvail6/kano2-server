"use strict";

const fs = require('fs'),
      ROOT = '/';

// diskusage (native addon) replaced by fs.statfs, built in since Node 18.15
function getUsage(callback) {
    fs.statfs(ROOT, (err, stats) => {
        if (err) {
            return callback(err);
        }

        callback(null, {
            available: stats.bavail * stats.bsize,
            total: stats.blocks * stats.bsize
        });
    });
}

module.exports = { getUsage };
