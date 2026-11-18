"use strict";

const express = require('express'),
      baseMethods = require('../kit-base-methods');

module.exports = {
    vendor: 'kano',
    product: 'camera',

    setup: (device, callback) => {
        callback();
    },

    methods: Object.assign(baseMethods, {
    }),

    api: null,
    events: {}
};
