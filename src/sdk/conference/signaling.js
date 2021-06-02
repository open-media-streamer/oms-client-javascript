// Copyright (C) <2018> Intel Corporation
//
// SPDX-License-Identifier: Apache-2.0

/* global io, Promise, setTimeout, clearTimeout */
import Logger from '../base/logger.js';
import * as EventModule from '../base/event.js';
import {ConferenceError} from './error.js';
import {Base64} from '../base/base64.js';

'use strict';

const reconnectionAttempts = 10;
const maxSequence = 2147483647;

// eslint-disable-next-line require-jsdoc
function handleResponse(status, data, resolve, reject) {
  if (status === 'ok' || status === 'success') {
    resolve(data);
  } else if (status === 'error') {
    reject(data);
  } else {
    Logger.error('MCU returns unknown ack.');
  }
}

/**
 * @class SioSignaling
 * @classdesc Socket.IO signaling channel for ConferenceClient. It is not recommended to directly access this class.
 * @memberof Owt.Conference
 * @extends Owt.Base.EventDispatcher
 * @constructor
 */
export class SioSignaling extends EventModule.EventDispatcher {
  // eslint-disable-next-line require-jsdoc
  constructor() {
    super();
    this._socket = null;
    this._loggedIn = false;
    this._reconnectTimes = 0;
    this._reconnectionTicket = null;
    this._refreshReconnectionTicket = null;
    this._messageSequence = 0;
  }

  /**
   * @function connect
   * @instance
   * @desc Connect to a portal.
   * @memberof Oms.Conference.SioSignaling
   * @return {Promise<Object, Error>} Return a promise resolved with the data returned by portal if successfully logged in. Or return a promise rejected with a newly created Oms.Error if failed.
   * @param {string} host Host of the portal.
   * @param {string} isSecured Is secure connection or not.
   * @param {string} loginInfo Information required for logging in.
   * @private.
   */
  connect(host, isSecured, loginInfo) {
    return new Promise((resolve, reject) => {
      const opts = {
        'reconnection': true,
        'reconnectionAttempts': reconnectionAttempts,
        'force new connection': true,
      };
      this._socket = io(host, opts);
      ['participant', 'text', 'stream', 'progress'].forEach((
          notification) => {
        this._socket.on(notification, (data) => {
          this.dispatchEvent(new EventModule.MessageEvent('data', {
            message: {
              notification: notification,
              data: data,
            },
          }));
          this._incrementMessageSequence();
        });
      });
      this._socket.on('reconnecting', () => {
        this._reconnectTimes++;
      });
      this._socket.on('reconnect_failed', () => {
        if (this._reconnectTimes >= reconnectionAttempts) {
          this.dispatchEvent(new EventModule.OwtEvent('disconnect'));
        }
      });
      this._socket.on('connect_error', (e) => {
        reject(`connect_error:${host}`);
      });
      this._socket.on('drop', () => {
        this._reconnectTimes = reconnectionAttempts;
      });
      this._socket.on('disconnect', () => {
        this._clearReconnectionTask();
        if (this._reconnectTimes >= reconnectionAttempts) {
          this._loggedIn = false;
          this.dispatchEvent(new EventModule.OwtEvent('disconnect'));
        }
      });
      this._socket.emit('login', loginInfo, (status, data) => {
        if (status === 'ok') {
          this._loggedIn = true;
          this._onReconnectionTicket(data.reconnectionTicket);
          this._socket.on('connect', () => {
            // re-login with reconnection ticket.
            this._socket.emit('relogin', this._reconnectionTicket, (status,
                data) => {
              if (status === 'ok') {
                this._reconnectTimes = 0;
                if (typeof data === 'object') {
                  if (Array.isArray(data.messages)) {
                    let isMissingStart = false;
                    for (const msg of data.messages) {
                      if (isMissingStart) {
                        this.dispatchEvent(
                            new EventModule.MessageEvent('data', {
                              message: {
                                notification: msg.event,
                                data: msg.data,
                              },
                            }));
                        this._incrementMessageSequence();
                      } else if (msg.seq === this._messageSequence) {
                        isMissingStart = true;
                      }
                    }
                  }
                  this._onReconnectionTicket(data.ticket);
                } else {
                  this._onReconnectionTicket(data);
                }
              } else {
                this.dispatchEvent(new EventModule.OwtEvent('disconnect'));
              }
            });
          });
        }
        handleResponse(status, data, resolve, reject);
      });
    });
  }

  /**
   * @function disconnect
   * @instance
   * @desc Disconnect from a portal.
   * @memberof Oms.Conference.SioSignaling
   * @return {Promise<Object, Error>} Return a promise resolved with the data returned by portal if successfully disconnected. Or return a promise rejected with a newly created Oms.Error if failed.
   * @private.
   */
  disconnect() {
    if (!this._socket || this._socket.disconnected) {
      return Promise.reject(new ConferenceError(
          'Portal is not connected.'));
    }
    return new Promise((resolve, reject) => {
      this._socket.emit('logout', (status, data) => {
        // Maximize the reconnect times to disable reconnection.
        this._reconnectTimes = reconnectionAttempts;
        this._socket.disconnect();
        handleResponse(status, data, resolve, reject);
      });
    });
  }

  /**
   * @function send
   * @instance
   * @desc Send data to portal.
   * @memberof Oms.Conference.SioSignaling
   * @return {Promise<Object, Error>} Return a promise resolved with the data returned by portal. Or return a promise rejected with a newly created Oms.Error if failed to send the message.
   * @param {string} requestName Name defined in client-server protocol.
   * @param {string} requestData Data format is defined in client-server protocol.
   * @private.
   */
  send(requestName, requestData) {
    return new Promise((resolve, reject) => {
      this._socket.emit(requestName, requestData, (status, data) => {
        handleResponse(status, data, resolve, reject);
      });
    });
  }

  /**
   * @function _onReconnectionTicket
   * @instance
   * @desc Parse reconnection ticket and schedule ticket refreshing.
   * @param {string} ticketString Reconnection ticket.
   * @memberof Owt.Conference.SioSignaling
   * @private.
   */
  _onReconnectionTicket(ticketString) {
    this._reconnectionTicket = ticketString;
    const ticket = JSON.parse(Base64.decodeBase64(ticketString));
    // Refresh ticket 1 min or 10 seconds before it expires.
    const now = Date.now();
    const millisecondsInOneMinute = 60 * 1000;
    const millisecondsInTenSeconds = 10 * 1000;
    if (ticket.notAfter <= now - millisecondsInTenSeconds) {
      Logger.warning('Reconnection ticket expires too soon.');
      return;
    }
    let refreshAfter = ticket.notAfter - now - millisecondsInOneMinute;
    if (refreshAfter < 0) {
      refreshAfter = ticket.notAfter - now - millisecondsInTenSeconds;
    }
    this._clearReconnectionTask();
    this._refreshReconnectionTicket = setTimeout(() => {
      this._socket.emit('refreshReconnectionTicket', (status, data) => {
        if (status !== 'ok') {
          Logger.warning('Failed to refresh reconnection ticket.');
          return;
        }
        this._onReconnectionTicket(data);
      });
    }, refreshAfter);
  }

  /**
   * @function _clearReconnectionTask
   * @instance
   * @desc Stop trying to refresh reconnection ticket.
   * @memberof Owt.Conference.SioSignaling
   * @private.
   */
  _clearReconnectionTask() {
    clearTimeout(this._refreshReconnectionTicket);
    this._refreshReconnectionTicket = null;
  }

  /**
   * @function _clearReconnectionTask
   * @instance
   * @desc Increase the message sequence.
   * @memberof Owt.Conference.SioSignaling
   * @private.
   */
  _incrementMessageSequence() {
    if (this._messageSequence === maxSequence) {
      this._messageSequence = 0;
    } else {
      this._messageSequence++;
    }
  }
}
