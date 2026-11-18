"use strict";

/* These methods are shared between the different types of KitDevices */
module.exports = {
    setName: {
        serial: (device, name, callback) => {
            device.serial.rpc.call('set-name', [name], (err) => {
                if (err) {
                    return callback(err);
                }

                /* Need to update & save the name on the object itself */
                device.cacheName(name);
                callback(null);
            });
        },
        http: (device, name, callback) => {
            device.http.fetch('/util/set-name', {
                method: 'POST',
                headers: {
                    'Accept': 'application/json',
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    newName: name
                })
            }).then((res) => {
                return res.json();
            }).then((data) => {
                return callback(null, data);
            }).catch((err) => {
                return callback(err);
            });;
        }
    },
    listWifiNetworks: {
        serial: (device, callback) => {
            device.serial.rpc.call('wifi-scan', callback);
        },
        http: undefined
    },
    wifiConnectionStatus: {
        serial: (device, callback) => {
            device.serial.rpc.call('wifi-connection-status', callback);
        },
        http: (device, callback) => {
            device.http.fetch('/util/wifi-connection-status')
                .then((res) => {
                    return res.json();
                }).then((data) => {
                    return callback(null, data);
                }).catch((err) => {
                    return callback(err);
                });
        }
    },
    connectToWifi: {
        serial: (device, ssid, password, callback) => {
            device.serial.rpc.call('wifi-connect', [ssid, password], (err, status) => {
                if (err) {
                    return callback(err);
                }

                /* Save & update the network connection */
                device.setupNetwork(status);
                callback(null);
            });
        },
        http: undefined
    },
    getBattery: {
        serial: (device, callback) => {
            device.serial.rpc.call('battery-status', callback);
        },
        http: (device, callback) => {
            device.http.fetch('/util/battery')
                .then((res) => {
                    return res.json();
                }).then((data) => {
                    return callback(null, data);
                }).catch((err) => {
                    return callback(err);
                });
        }
    },
    getDiskUsage: {
        serial: (device, callback) => {
            device.serial.rpc.call('disk-usage', callback);
        },
        http: (device, callback) => {
            device.http.fetch('/util/disk-usage')
                .then((res) => {
                    return res.json();
                }).then((data) => {
                    return callback(null, data);
                }).catch((err) => {
                    return callback(err);
                });
        }
    },
    factoryReset: {
        serial: null,
        http: (device, name, callback) => {
            device.http.fetch('/util/factory-reset', {
                method: 'POST',
                headers: {
                    'Accept': 'application/json',
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    name: name
                })
            }).then((res) => {
                return res.json();
            }).then((data) => {
                return callback(data.error, data.status === 'success');
            }).catch((err) => {
                return callback(err);
            });
        }
    },
    getProgram: {
        serial: null,
        http: (device, id, callback) => {
            device.http.fetch(`/program/${id}`)
                .then(res => {
                    return res.json();
                })
                .then(data => {
                    callback(null, data);
                })
                .catch(err => {
                    callback(err);
                })
        }
    },
    setProgram: {
        serial: null,
        http: (device, id, program, callback) => {
            device.http.fetch(`/program/${id}`, {
                method: 'POST',
                headers: {
                    'Accept': 'application/json',
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    program: program
                })
            })
            .then(res => {
                return res.json();
            })
            .then(data => {
                callback(null, data);
            })
            .catch(err => {
                callback(err);
            })
        }
    }
};
