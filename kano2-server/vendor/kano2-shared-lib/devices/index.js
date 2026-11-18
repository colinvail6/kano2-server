"use strict";

const fs = require('fs'),
      DEVICES_DIR = __dirname;


function getModules() {
    let moduleDirs = fs.readdirSync(DEVICES_DIR),
        modules = [];

    for (let moduleDir of moduleDirs) {
        if (moduleDir !== 'index.js') {
            let module = require(`${DEVICES_DIR}/${moduleDir}`);
            modules.push(module);
        }
    }

    return modules;
}

module.exports = getModules();
