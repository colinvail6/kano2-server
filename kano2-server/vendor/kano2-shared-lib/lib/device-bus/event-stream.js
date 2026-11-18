"use strict";

const EventEmitter = require('events');

class EventStream extends EventEmitter {
    constructor (channel) {
        super();
        this.channel = channel;
        // NOTE: the old code did `this.listeners = {}`, which shadowed EventEmitter#listeners().

        this.channel.listen('event', this.processEvent.bind(this));
    }

    processEvent (message) {
        if (message.type && message.type === 'event') {
            // An unhandled 'error' event would throw and kill the process in Node 22.
            if (message.name === 'error' && this.listenerCount('error') === 0) {
                console.log('Unhandled device error event', JSON.stringify(message.detail));
                return;
            }
            this.emit(message.name, message.detail);
        }
    }

    stop (callback) {
        this.channel.close(callback);
    }
}

module.exports = EventStream;
