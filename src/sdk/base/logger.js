// MIT License
//
// Copyright (c) 2012 Universidad Politécnica de Madrid
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in all
// copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
// SOFTWARE.

// Copyright (C) <2018> Intel Corporation
//
// SPDX-License-Identifier: Apache-2.0

// This file is borrowed from lynckia/licode with some modifications.

/* global window */

'use strict';

/*
 * API to write logs based on traditional logging mechanisms: debug, trace,
 * info, warning, error
 */
const Logger = (function() {
  const DEBUG = 0;
  const TRACE = 1;
  const INFO = 2;
  const WARNING = 3;
  const ERROR = 4;
  const NONE = 5;

  const noOp = function() {};

  // |that| is the object to be returned.
  const that = {
    DEBUG: DEBUG,
    TRACE: TRACE,
    INFO: INFO,
    WARNING: WARNING,
    ERROR: ERROR,
    NONE: NONE,
  };

  that.log = (...args) => {
    window.console.log((new Date()).toISOString(), ...args);
  };

  const bindType = function(type) {
    if (typeof window.console[type] === 'function') {
      return (...args) => {
        window.console[type]((new Date()).toISOString(), ...args);
      };
    } else {
      return that.log;
    }
  };

  const setLogLevel = function(level) {
    if (level <= DEBUG) {
      that.debug = bindType('debug');
    } else {
      that.debug = noOp;
    }
    if (level <= TRACE) {
      that.trace = bindType('trace');
    } else {
      that.trace = noOp;
    }
    if (level <= INFO) {
      that.info = bindType('info');
    } else {
      that.info = noOp;
    }
    if (level <= WARNING) {
      that.warning = bindType('warn');
    } else {
      that.warning = noOp;
    }
    if (level <= ERROR) {
      that.error = bindType('error');
    } else {
      that.error = noOp;
    }
  };

  setLogLevel(ERROR); // Default level.

  that.setLogLevel = setLogLevel;

  return that;
}());

export default Logger;
