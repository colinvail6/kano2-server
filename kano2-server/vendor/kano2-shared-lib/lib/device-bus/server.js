"use strict";

class RPCServer {
    constructor (channel) {
        /* The channel object must implement .listen() and .send() methods. */
        this.channel = channel;
        this.methods = {};

        this.channel.listen('server', (req) => {
            if (!this.methods[req.method]) {
                return this._respond(req.id, "Method '" + req.method + "' not supported by server");
            }

            let params = Array.isArray(req.params) ? req.params.slice() : [];
            params.push((err, rv) => {
                this._respond(req.id, err, rv);
            });
            this.methods[req.method].apply(this.methods[req.method], params);
        });
    }

    on (method, impl) {
        console.log("Registering the '" + method + "' method");
        this.methods[method] = impl;

        return this;
    }

    _respond (reqId, err, rv) {
        let response = { id: reqId, err: err, value: rv };

        this.channel.send('rpc-response', response, (err) => {
            if (err) {
                console.log('Failed to send response ' + err);
            }
        });
    }
}

module.exports = RPCServer;
