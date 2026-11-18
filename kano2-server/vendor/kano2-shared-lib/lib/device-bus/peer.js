"use strict";

const RPCServer = require('./server'),
      RPCClient = require('./client');

class RPCPeer {
    constructor (channel) {
        this.server = new RPCServer(channel);
        this.client = new RPCClient(channel);
    }

    on () {
        this.server.on.apply(this.server, arguments);
        return this;
    }

    call () {
        this.client.call.apply(this.client, arguments);
        return this;
    }

    // RPCServer has no start()/stop() (the 2017 peer called them anyway): keep them as no-ops.
    start () { return this; }
    stop () { return this; }
}

module.exports = RPCPeer;
