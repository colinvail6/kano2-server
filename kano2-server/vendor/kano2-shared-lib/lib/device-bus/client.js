"use strict";

const { randomUUID } = require('crypto');

const DEFAULT_TIMEOUT = 30000,
      // The Pixel Kit MCU can sit on a request until more bytes arrive (see SerialChannel#nudge). Pass opts.nudgeAfter (ms)
      // on a call to push it if the answer is slow. Off by default: nudging every unanswered display frame was seen to
      // upset the MCU's framing (periodic "Couldn't decode JSON").
      NUDGE_AFTER_MS = 0,
      MAX_NUDGES = 3;

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
                clearTimeout(entry.nudgeTimer);
                // The Pixel Kit MCU replies with "error"; kano's own server code uses "err". Accept both.
                let err = response.err != null ? response.err : (response.error != null ? response.error : null);
                entry.callback(err, response.value);
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
            entry = { callback: callback, timer: null, nudgeTimer: null, nudges: 0 },
            timeout = opts.timeout || DEFAULT_TIMEOUT,
            nudgeAfter = opts.nudgeAfter !== undefined ? opts.nudgeAfter : NUDGE_AFTER_MS,
            nudge = () => {
                if (!this.calls[id] || entry.nudges >= MAX_NUDGES || typeof this.channel.nudge !== 'function') {
                    return;
                }
                entry.nudges++;
                this.channel.nudge();
                entry.nudgeTimer = setTimeout(nudge, nudgeAfter);
            };

        entry.timer = setTimeout(() => {
            if (this.calls[id]) {
                delete this.calls[id];
                clearTimeout(entry.nudgeTimer);
                callback('Request timed out', null);
            }
        }, timeout);

        if (nudgeAfter > 0) {
            entry.nudgeTimer = setTimeout(nudge, nudgeAfter);
        }

        this.calls[id] = entry;

        this.channel.send('rpc-request', request, (err) => {
            if (err && this.calls[id]) {
                delete this.calls[id];
                clearTimeout(entry.timer);
                clearTimeout(entry.nudgeTimer);
                callback(err);
            }
        });

        return this;
    }
}

module.exports = RPCClient;
