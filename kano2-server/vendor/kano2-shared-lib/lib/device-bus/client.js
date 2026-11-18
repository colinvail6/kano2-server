"use strict";

const { randomUUID } = require('crypto');

const DEFAULT_TIMEOUT = 30000;

class RPCClient {
    constructor (channel) {
        /* The channel object must implement .listen() and .send() methods. */
        this.channel = channel;
        this.calls = {};

        this.channel.listen('client', (response) => {
            let entry = this.calls[response.id];
            if (entry) {
                delete this.calls[response.id];
                clearTimeout(entry.timer);
                entry.callback(response.err, response.value);
            } else {
                console.log("No callback found, " + response.id + " ignored.");
            }
        });
    }

    /* call(method, [params], [opts], [callback]) - all but method are optional. */
    call (method, params, opts, callback) {
        let args = [params, opts, callback].filter(a => a !== undefined);
        params = Array.isArray(args[0]) ? args.shift() : [];
        opts = (args[0] && typeof args[0] === 'object') ? args.shift() : {};
        callback = typeof args[args.length - 1] === 'function' ? args.pop() : function () {};

        let id = randomUUID(),
            request = { id: id, method: method, params: params.slice() },
            entry = { callback: callback, timer: null },
            timeout = opts.timeout || DEFAULT_TIMEOUT;

        entry.timer = setTimeout(() => {
            if (this.calls[id]) {
                delete this.calls[id];
                callback('Request timed out', null);
            }
        }, timeout);

        this.calls[id] = entry;

        this.channel.send('rpc-request', request, (err) => {
            if (err && this.calls[id]) {
                delete this.calls[id];
                clearTimeout(entry.timer);
                callback(err);
            }
        });

        return this;
    }
}

module.exports = RPCClient;
