// 

/*!
 * hemera
 * Copyright(c) 2016 Dustin Deus (deusdustin@gmail.com)
 * MIT Licensed
 */

'use strict'

/**
 * Module Dependencies
 */

const
  EventEmitter = require('events'),
  Bloomrun = require('bloomrun'),
  Errio = require('errio'),
  Hoek = require('hoek'),
  _ = require('lodash')

const
  Errors = require('./errors'),
  Constants = require('./constants'),
  Ext = require('./ext'),
  Util = require('./util'),
  DefaultLogger = require('./logger')

//Config
var defaultConfig = {
  timeout: 2000,
  debug: false,
  crashOnFatal: true,
  logLevel: 'silent'
}

/**
 * @class Hemera
 */
class Hemera extends EventEmitter {

  
  
  
  
  
  

  

  
  
  
  
  

  
  
  
  
  
  
  
  
  
  

  constructor(transport, params) {

    super()

    this._config = Hoek.applyToDefaults(defaultConfig, params || {})
    this._catalog = Bloomrun()
    this._transport = transport
    this._topics = {}
    this._plugins = {}

    //Special variables for act and add
    this.context$ = {}
    this.meta$ = {}
    this.delegate$ = {}
    this.plugin$ = {}
    this.trace$ = {}
    this.request$ = {
      duration: 0,
      parentId: '',
      timestamp: 0,
      id: ''
    }

    //Define extension points
    this._extensions = {
      onClientPreRequest: new Ext('onClientPreRequest'),
      onClientPostRequest: new Ext('onClientPostRequest'),
      onServerPreHandler: new Ext('onServerPreHandler'),
      onServerPreRequest: new Ext('onServerPreRequest'),
      onServerPreResponse: new Ext('onServerPreResponse')
    }

    /**
     * Client - Extension points
     */
    this._extensions.onClientPreRequest.subscribe(function (next) {

      let pattern = this._pattern

      let prevCtx = this._prevContext
      let cleanPattern = this._cleanPattern
      let ctx = this

      //Shared context
      ctx.context$ = pattern.context$ || prevCtx.context$

      //Set metadata by passed pattern or current message context
      ctx.meta$ = Hoek.merge(pattern.meta$ || {}, ctx.meta$)
        //Is only passed by msg
      ctx.delegate$ = pattern.delegate$ || {}

      //Tracing
      ctx.trace$ = pattern.trace$ || {}
      ctx.trace$.parentSpanId = prevCtx.trace$.spanId
      ctx.trace$.traceId = prevCtx.trace$.traceId || Util.randomId()
      ctx.trace$.spanId = pattern.trace$ ? pattern.trace$.spanId : Util.randomId()
      ctx.trace$.timestamp = Util.nowHrTime()
      ctx.trace$.service = pattern.topic
      ctx.trace$.method = Util.pattern(pattern)

      //Request
      let request = {
        id: pattern.requestId$ || Util.randomId(),
        parentId: ctx.request$.id,
        timestamp: Util.nowHrTime(),
        duration: 0
      }

      //Build msg
      let message = {
        pattern: cleanPattern,
        meta$: ctx.meta$,
        delegate$: ctx.delegate$,
        trace$: ctx.trace$,
        request$: request
      }

      ctx._message = message

      ctx.log.info(pattern, `ACT_OUTBOUND - ID:${String(ctx._message.request$.id)}`)

      ctx.emit('onClientPreRequest', ctx)

      next()
    })

    this._extensions.onClientPostRequest.subscribe(function (next) {

      let ctx = this
      let pattern = this._pattern
      let msg = ctx._response.value

      //Pass to act context
      ctx.request$ = msg.request$ || {}
      ctx.request$.service = pattern.topic
      ctx.request$.method = Util.pattern(pattern)
      ctx.trace$ = msg.trace$ || {}
      ctx.meta$ = msg.meta$ || {}

      ctx.log.info(`ACT_INBOUND - ID:${ctx.request$.id} (${ctx.request$.duration / 1000000}ms)`)

      ctx.emit('onClientPostRequest', ctx)

      next()
    })

    /**
     * Server - Extension points
     */
    this._extensions.onServerPreRequest.subscribe(function (next) {

      let msg = this._request.value
      let ctx = this

      if (msg) {

        ctx.meta$ = msg.meta$ || {}
        ctx.trace$ = msg.trace$ || {}
        ctx.delegate$ = msg.delegate$ || {}
        ctx.request$ = msg.request$ || {}
      }

      ctx.emit('onServerPreRequest', ctx)

      next()
    })

    this._extensions.onServerPreRequest.subscribe(function (next) {

      next()

    })

    this._extensions.onServerPreResponse.subscribe(function (next) {

      let ctx = this
      let result = this._response

      let message = {
        meta$: ctx.meta$ || {},
        trace$: ctx.trace$ || {},
        request$: ctx.request$,
        result: result instanceof Error ? null : result,
        error: result instanceof Error ? Errio.stringify(result) : null
      }

      let endTime = Util.nowHrTime()
      message.request$.duration = endTime - message.request$.timestamp
      message.trace$.duration = endTime - message.request$.timestamp

      ctx._message = message

      ctx.emit('onServerPreResponse', ctx)

      next()

    })

    this.log = this._config.logger || new DefaultLogger({
      level: this._config.logLevel
    })
  }

  /**
   * @readonly
   *
   * @memberOf Hemera
   */
  get plugins() {

    return this._plugins
  }

  /**
   * @readonly
   *
   * @memberOf Hemera
   */
  get catalog() {

    return this._catalog
  }

  /**
   * @readonly
   *
   * @memberOf Hemera
   */
  get transport() {

    return this._transport
  }

  /**
   * @readonly
   *
   * @memberOf Hemera
   */
  get topics() {

    return this._topics
  }
    /**
     *
     *
     * @param {any} type
     * @param {any} handler
     *
     * @memberOf Hemera
     */
  ext(type, handler) {

    this._extensions[type].subscribe(handler)

  }
  /**
   * @param {any} plugin
   *
   * @memberOf Hemera
   */
  use(params) {

    if (this._plugins[params.attributes.name]) {
      let error = new Errors.HemeraError(Constants.PLUGIN_ALREADY_IN_USE, {
        plugin: params.attributes.name
      })
      this.log.error(error)
      throw (error)
    }

    //Create new execution context
    let ctx = this.createContext()
    ctx.plugin$ = params.attributes
    params.plugin.call(ctx, params.options)

    this.log.info(params.attributes.name, Constants.PLUGIN_ADDED)
    this._plugins[params.attributes.name] = ctx.plugin$

  }

  /**
   * @memberOf Hemera
   */
  fatal() {

    process.exit(1)
  }

  /**
   * @param {any} cb
   *
   * @memberOf Hemera
   */
  ready(cb) {

    this._transport.on('connect', () => {

      this.log.info(Constants.TRANSPORT_CONNECTED)
      cb.call(this)
    })
  }

  /**
   *
   * @returns
   *
   * @memberOf Hemera
   */
  timeout() {

    return this.transport.timeout.apply(this.transport, arguments)
  }
  /**
   * Add response
   *
   * @returns
   *
   * @memberOf Hemera
   */
  send() {

    return this.transport.publish.apply(this.transport, arguments)
  }

  /**
   * Act
   *
   * @returns
   *
   * @memberOf Hemera
   */
  sendRequest() {

    return this.transport.request.apply(this.transport, arguments)
  }

  /**
   *
   *
   *
   * @memberOf Hemera
   */
  reply() {

    let self = this;

    if (self._response instanceof Error) {

      self.log.error(self._response)
    }

    self._extensions.onServerPreResponse.invoke(self, function (err) {

      if (err) {

        let error = new Errors.HemeraError(Constants.EXTENSION_ERROR).causedBy(err)

        self.log.error(error)
        throw (error)
      }

      const msg = Util.stringifyJSON(self._message)

      if (self._shouldCrash) {

        //Send error back to callee
        return self.send(self._replyTo, msg, () => {

          //let it crash
          if (self._config.crashOnFatal) {

            self.fatal()
          }
        })

      }

      return this.send(this._replyTo, msg)

    })

  }

  /**
   * @param {any} topic
   * @returns
   *
   * @memberOf Hemera
   */
  subscribe(topic) {

    let self = this

    //Avoid duplicate subscribers of the emit stream
    //We use one subscriber per topic
    if (self._topics[topic]) {
      return
    }

    //Queue group names allow load balancing of services
    self.transport.subscribe(topic, {
      'queue': 'queue.' + topic
    }, (request, replyTo) => {

      //Create new execution context
      let ctx = this.createContext()
      ctx._shouldCrash = false
      ctx._replyTo = replyTo
      ctx._request = Util.parseJSON(request)
      ctx._pattern = {}
      ctx._actMeta = {}

      //Extension point 'onServerPreRequest'
      self._extensions.onServerPreRequest.invoke(ctx, function (err) {

        let self = this

        if (err) {

          let error = new Errors.HemeraError(Constants.EXTENSION_ERROR).causedBy(err)

          self.log.error(error)
          throw (error)
        }

        //Invalid payload
        if (self._request.error) {

          let error = new Errors.ParseError(Constants.PAYLOAD_PARSING_ERROR, {
            topic
          }).causedBy(self._request.error)

          return self.reply(replyTo, error)
        }

        self._pattern = self._request.value.pattern
        self._actMeta = self._catalog.lookup(self._pattern)

        //Check if a handler is registered with this pattern
        if (self._actMeta) {

          //Extension point 'onServerPreHandler'
          self._extensions.onServerPreHandler.invoke(ctx, function (err) {

            if (err) {

              self._response = new Errors.HemeraError(Constants.EXTENSION_ERROR).causedBy(err)

              self.log.error(self._response)

              //Send message
              return self.reply()
            }

            try {

              let action = self._actMeta.action.bind(self)

              //Call action
              action(self._request.value.pattern, (err, resp) => {

                if (err) {

                  self._response = new Errors.BusinessError(Constants.IMPLEMENTATION_ERROR, {
                    pattern: self._pattern
                  }).causedBy(err)

                  return self.reply()
                }

                self._response = resp

                //Send message
                self.reply()
              })

            } catch (err) {

              self._response = new Errors.ImplementationError(Constants.IMPLEMENTATION_ERROR, {
                pattern: self._pattern
              }).causedBy(err)

              self._shouldCrash = true

              self.reply()
            }

          })

        } else {

          self.log.info({
            topic
          }, Constants.PATTERN_NOT_FOUND)

          self._response = new Errors.PatternNotFound(Constants.PATTERN_NOT_FOUND, {
            pattern: self._pattern
          })

          //Send error back to callee
          self.reply()
        }

      })

    })

    this._topics[topic] = true

  }

  /**
   * @param {any} pattern
   * @param {any} cb
   *
   * @memberOf Hemera
   */
  add(pattern, cb) {

    //Topic is needed to subscribe on a subject in NATS
    if (!pattern.topic) {

      let error = new Errors.HemeraError(Constants.NO_TOPIC_TO_SUBSCRIBE, {
        pattern
      })

      this.log.error(error)
      throw (error)
    }

    if (typeof cb !== 'function') {

      let error = new Errors.HemeraError(Constants.MISSING_IMPLEMENTATION, {
        pattern
      })

      this.log.error(error)
      throw (error)
    }

    let origPattern = _.cloneDeep(pattern)

    let schema = {}

    //Remove objects (rules) from pattern
    _.each(pattern, function (v, k) {

      if (_.isObject(v)) {
        schema[k] = _.clone(v)
        delete origPattern[k]
      }
    })

    //Create message object which represent the object behind the matched pattern
    let actMeta = {
      schema: schema,
      pattern: origPattern,
      action: cb
    }

    let handler = this._catalog.lookup(origPattern)

    //Check if pattern is already registered
    if (handler) {

      let error = new Errors.HemeraError(Constants.PATTERN_ALREADY_IN_USE, {
        pattern
      })

      this.log.error(error)
      throw (error)
    }

    //Add to bloomrun
    this._catalog.add(origPattern, actMeta)

    this.log.info(origPattern, Constants.ADD_ADDED)

    //Subscribe on topic
    this.subscribe(pattern.topic)
  }

  /**
   * @param {any} pattern
   * @param {any} cb
   *
   * @memberOf Hemera
   */
  act(pattern, cb) {

    //Topic is needed to subscribe on a subject in NATS
    if (!pattern.topic) {

      let error = new Errors.HemeraError(Constants.NO_TOPIC_TO_REQUEST, {
        pattern
      })

      this.log.error(error)
      throw (error)
    }

    //Create new execution context
    let ctx = this.createContext()
    ctx._pattern = pattern
    ctx._prevContext = this
    ctx._cleanPattern = Util.cleanPattern(pattern)
    ctx._response = {}
    ctx._request = {}

    ctx._extensions.onClientPreRequest.invoke(ctx, function onPreRequest(err) {

      let self = this

      if (err) {

        let error = new Errors.HemeraError(Constants.EXTENSION_ERROR).causedBy(err)

        self.log.error(error)
        throw (error)
      }

      //Encode msg to JSON
      self._request = Util.stringifyJSON(self._message)

      //Send request
      let sid = self.sendRequest(pattern.topic, self._request, (response) => {

        self._response = Util.parseJSON(response)

        try {

          //If payload is invalid
          if (self._response.error) {

            let error = new Errors.ParseError(Constants.PAYLOAD_PARSING_ERROR, {
              pattern: self._cleanPattern
            }).causedBy(self._response.error)

            self.log.error(error)

            if (typeof cb === 'function') {

              return cb.call(self, error)
            }
          }

          //Extension point 'onClientPostRequest'
          self._extensions.onClientPostRequest.invoke(ctx, function (err) {

            if (err) {

              let error = new Errors.HemeraError(Constants.EXTENSION_ERROR).causedBy(err)

              self.log.error(error)
              throw (error)
            }

            if (typeof cb === 'function') {

              if (self._response.value.error) {

                let error = new Errors.BusinessError(Constants.BUSINESS_ERROR, {
                  pattern: self._cleanPattern
                }).causedBy(Errio.parse(self._response.value.error))

                self.log.error(error)

                //Error is already wrapped
                return cb.call(self, Errio.parse(self._response.value.error))
              }

              cb.apply(self, [null, self._response.value.result])
            }

          })

        } catch (err) {

          let error = new Errors.FatalError(Constants.FATAL_ERROR, {
            pattern: self._cleanPattern
          }).causedBy(err)

          self.log.fatal(error)

          //Let it crash
          if (self._config.crashOnFatal) {

            self.fatal()
          }
        }
      })

      //Handle timeout
      self.handleTimeout(sid, pattern, cb)

    })

  }

  /**
   * @param {any} sid
   * @param {any} pattern
   * @param {any} cb
   *
   * @memberOf Hemera
   */
  handleTimeout(sid, pattern, cb) {

    //Handle timeout
    this.timeout(sid, pattern.timeout$ || this._config.timeout, 1, () => {

      let error = new Errors.TimeoutError(Constants.ACT_TIMEOUT_ERROR, {
        pattern
      })

      this.log.error(error)

      if (typeof cb === 'function') {

        try {

          cb.call(this, error)
        } catch (err) {

          let error = new Errors.FatalError(Constants.FATAL_ERROR, {
            pattern
          }).causedBy(err)

          this.log.fatal(error)

          //Let it crash
          if (this._config.crashOnFatal) {

            this.fatal()
          }
        }
      }
    })
  }

  /**
   * @returns
   *
   * @memberOf Hemera
   */
  createContext() {

    var self = this

    //Create new instance of hemera but with pointer on the previous propertys
    //So we are able to create a scope per act without lossing the reference to the core api.
    var ctx = Object.create(self)

    return ctx
  }

  /**
   * @memberOf Hemera
   */
  list(params) {

    return this._catalog.list(params)
  }

  /**
   * @returns
   *
   * @memberOf Hemera
   */
  close() {

    return this.transport.close()
  }
}

module.exports = Hemera
