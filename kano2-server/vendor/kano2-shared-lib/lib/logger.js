"use strict";

/*
 * Minimal replacement for kano2-shared-lib/lib/logger (the 2017 file was not on the image).
 * API used by kano2-server: Logger.getLogger(name, level) -> { debug, info, warn, error, log }
 */

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40, silent: 100 },
      loggers = {};

function getLogger (name, level) {
    name = name || 'kano2';
    level = LEVELS[level] !== undefined ? level : 'info';

    if (loggers[name]) {
        loggers[name].level = level;
        return loggers[name];
    }

    let logger = { name: name, level: level };

    function emit (lvl, sink, args) {
        if (LEVELS[lvl] >= LEVELS[logger.level]) {
            sink.call(console, `${new Date().toISOString()} [${name}] ${lvl.toUpperCase()}`, ...args);
        }
    }

    logger.debug = (...a) => emit('debug', console.log, a);
    logger.info = (...a) => emit('info', console.log, a);
    logger.warn = (...a) => emit('warn', console.warn, a);
    logger.error = (...a) => emit('error', console.error, a);
    logger.log = logger.info;

    loggers[name] = logger;
    return logger;
}

module.exports = { getLogger, LEVELS };
