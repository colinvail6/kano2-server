"use strict";

let Storage = require('node-storage'),
    path = require('path'),
    ospath = require('ospath'),
    instances = {};


function init(config) {
    let appName = config['app-name'],
        storagePath = path.join(ospath.data(), appName, "/storage.json");

    if (Object.keys(instances).indexOf(storagePath) >= 0) {
        return instances[storagePath];
    }

    console.log('Loading data from ' + storagePath);

    instances[storagePath] = new Storage(storagePath);
    return instances[storagePath];
}

module.exports = {init};
