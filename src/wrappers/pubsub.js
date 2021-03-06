/**
 * @fileoverview Handlers for Pubsub instrumentation
 */

const {
    tracer,
    moduleUtils,
    eventInterface,
    utils,
} = require('epsagon');
const traceContext = require('../trace_context.js');

/**
 * Handle subscriber event emitter of eventName='message'
 * @param {Message} message received message.
 * @param {*} originalHandler listener callback function.
 * @param {*} requestFunctionThis request arguments.
 */
function pubSubSubscriberMiddleware(message, originalHandler, requestFunctionThis) {
    let originalHandlerSyncErr;
    try {
        // Initialize tracer and evnets.
        tracer.restart();
        const { slsEvent: pubSubEvent, startTime: pubSubStartTime } =
        eventInterface.initializeEvent(
            'pubsub',
            requestFunctionThis.projectId,
            'messagePullingListener',
            'trigger'
        );
        tracer.addEvent(pubSubEvent);
        // Getting message data.
        const messageId = message.id;
        const triggerMetadata = { messageId };
        let payload = {};
        pubSubEvent.setId(messageId);
        const messageData = (message.data && JSON.parse(`${message.data}`));
        if (messageData && typeof messageData === 'object') {
            payload = messageData;
        }
        eventInterface.finalizeEvent(pubSubEvent, pubSubStartTime, null, triggerMetadata, payload);

        const { label, setError, getTraceUrl } = tracer;
        // eslint-disable-next-line no-param-reassign
        message.epsagon = {
            label,
            setError,
            getTraceUrl,
        };
        const { slsEvent: nodeEvent, startTime: nodeStartTime } = eventInterface.initializeEvent(
            'node_function', 'message_handler', 'execute', 'runner'
        );
        let runnerResult;
        try {
            runnerResult = originalHandler(message, {});
        } catch (err) {
            originalHandlerSyncErr = err;
        }
        const originalHandlerName = originalHandler.name;
        if (originalHandlerName) {
            nodeEvent.getResource().setName(originalHandlerName);
        }
        // Handle and finalize async user function.
        if (utils.isPromise(runnerResult)) {
            let originalHandlerAsyncError;
            runnerResult.catch((err) => {
                originalHandlerAsyncError = err;
                throw err;
            }).finally(() => {
                eventInterface.finalizeEvent(nodeEvent, nodeStartTime, originalHandlerAsyncError);
                tracer.sendTrace(() => {});
            });
        } else {
            // Finalize sync user function.
            eventInterface.finalizeEvent(nodeEvent, nodeStartTime, originalHandlerSyncErr);
            tracer.sendTrace(() => {});
        }
        tracer.addRunner(nodeEvent, runnerResult);
    } catch (err) {
        tracer.addException(err);
    }
    // Throwing error in case of sync user function.
    if (originalHandlerSyncErr) {
        throw originalHandlerSyncErr;
    }
}

/**
 * Wraps pubsub subscriber event emitter function with tracing.
 * @param {Function} wrappedFunction pubsub init function
 * @return {Function} updated wrapped init
 */
function pubSubSubscriberWrapper(wrappedFunction) {
    traceContext.init();
    tracer.getTrace = traceContext.get;
    return function internalPubSubSubscriberWrapper(eventName, callback) {
        if (eventName !== 'message') {
            return wrappedFunction.apply(this, [eventName, callback]);
        }
        const requestFunctionThis = this;
        const patchedCallback = message => traceContext.RunInContext(
            tracer.createTracer,
            () => pubSubSubscriberMiddleware(message, callback, requestFunctionThis)
        );
        return wrappedFunction.apply(this, [eventName, patchedCallback]);
    };
}

module.exports = {
    /**
     * Initializes the pubsub tracer
     */
    init() {
        moduleUtils.patchModule(
            '@google-cloud/pubsub/build/src/subscription',
            'on',
            pubSubSubscriberWrapper,
            subscription => subscription.Subscription.prototype
        );
    },
};
