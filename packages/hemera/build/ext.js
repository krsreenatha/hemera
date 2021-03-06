// 

/*!
 * hemera
 * Copyright(c) 2016 Dustin Deus (deusdustin@gmail.com)
 * MIT Licensed
 */

'use strict'

const Items = require('items')

/**
 * @class Ext
 */
class Ext {

  
  

  constructor(type) {

    this._handler = []
    this._type = type
  }
  /**
   *
   *
   * @param {any} handler
   *
   * @memberOf Ext
   */
  add(handler) {

    this._handler.push(handler)

  }

  /**
   *
   *
   * @param {Array<Function>} handlers
   *
   * @memberOf Ext
   */
  addRange(handlers) {

    this._handler = this._handler.concat(handlers)

  }
  /**
   *
   *
   * @param {any} cb
   *
   * @memberOf Ext
   */
  invoke(ctx, cb) {

    const each = (ext, next) => {

      const bind = ctx

      ext.call(bind, next);
    }

    Items.serial(this._handler, each, cb.bind(ctx))

  }
}

module.exports = Ext
