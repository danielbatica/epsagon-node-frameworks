/**
 * @fileoverview Runner for Express application
 */
const uuid4 = require('uuid4');
const {
    utils,
    eventInterface,
    event,
    errorCode,
} = require('epsagon');
const { extractEpsagonHeader } = require('../http.js');

/**
 * Creates an Event representing the running Hapi (runner)
 * @param {Object} req The Hapi's request data
 * @param {Int} startTime Runner start time
 * @return {Object} The runner event
 */
function createRunner(req, startTime) {
    const hapiEvent = new event.Event([
        `hapi-${uuid4()}`,
        utils.createTimestampFromTime(startTime),
        null,
        'runner',
        0,
        errorCode.ErrorCode.OK,
    ]);
    const resource = new event.Resource([
        req.url.host,
        'hapi',
        req.method,
    ]);

    hapiEvent.setResource(resource);
    eventInterface.createTraceIdMetadata(hapiEvent);

    return hapiEvent;
}


/**
 * Terminates the running Hapi (runner)
 * @param {Object} hapiEvent runner's Hapi event
 * @param {Request} req The Hapi's request data
 * @param {Response} res response data
 * @param {Int} startTime Runner start time
 */
function finishRunner(hapiEvent, req, res, startTime) {
    hapiEvent.setDuration(utils.createDurationTimestamp(startTime));
    eventInterface.addToMetadata(hapiEvent, {
        url: req.url.href,
        route: req.route.path,
        query: req.url.search,
        status_code: res.statusCode,
    }, {
        request_headers: req.headers,
        params: req.params,
        response_headers: res.headers,
    });

    if (extractEpsagonHeader(req.headers)) {
        eventInterface.addToMetadata(hapiEvent, {
            http_trace_id: extractEpsagonHeader(req.headers),
        });
    }

    if (res.statusCode >= 500) {
        hapiEvent.setErrorCode(errorCode.ErrorCode.EXCEPTION);
    }
}

module.exports.createRunner = createRunner;
module.exports.finishRunner = finishRunner;
