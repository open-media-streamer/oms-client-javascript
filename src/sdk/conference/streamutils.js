// Copyright (C) <2018> Intel Corporation
//
// SPDX-License-Identifier: Apache-2.0

// This file doesn't have public APIs.
/* eslint-disable valid-jsdoc */

'use strict';

import * as PublicationModule from '../base/publication.js';
import * as MediaFormatModule from '../base/mediaformat.js';
import * as CodecModule from '../base/codec.js';
import * as SubscriptionModule from './subscription.js';
import Logger from '../base/logger.js';

/**
 * @function extractBitrateMultiplier
 * @desc Extract bitrate multiplier from a string like "x0.2".
 * @return {Promise<Object, Error>} The float number after "x".
 * @private
 */
function extractBitrateMultiplier(input) {
  if (typeof input !== 'string' || !input.startsWith('x')) {
    Logger.warning('Invalid bitrate multiplier input.');
    return 0;
  }
  return Number.parseFloat(input.replace(/^x/, ''));
}

// eslint-disable-next-line require-jsdoc
function sortNumbers(x, y) {
  return x - y;
}

// eslint-disable-next-line require-jsdoc
function sortResolutions(x, y) {
  if (x.width !== y.width) {
    return x.width - y.width;
  } else {
    return x.height - y.height;
  }
}

/**
 * @function convertToPublicationSettings
 * @desc Convert mediaInfo received from server to PublicationSettings.
 * @private
 */
export function convertToPublicationSettings(mediaInfo) {
  const audio = [];
  const video = [];
  let audioCodec;
  let videoCodec;
  let resolution;
  let framerate;
  let bitrate;
  let keyFrameInterval;
  let rid;
  for (const track of mediaInfo.tracks) {
    if (track.type === 'audio') {
      if (track.format) {
        audioCodec = new CodecModule.AudioCodecParameters(
            track.format.codec, track.format.channelNum,
            track.format.sampleRate);
      }
      const audioPublicationSettings =
          new PublicationModule.AudioPublicationSettings(audioCodec);
      audioPublicationSettings._trackId = track.id;
      audio.push(audioPublicationSettings);
    } else if (track.type === 'video') {
      if (track.format) {
        videoCodec = new CodecModule.VideoCodecParameters(
            track.format.codec, track.format.profile);
      }
      if (track.parameters) {
        if (track.parameters.resolution) {
          resolution = new MediaFormatModule.Resolution(
              track.parameters.resolution.width,
              track.parameters.resolution.height);
        }
        framerate = track.parameters.framerate;
        bitrate = track.parameters.bitrate * 1000;
        keyFrameInterval = track.parameters.keyFrameInterval;
      }
      if (track.rid) {
        rid = track.rid;
      }
      const videoPublicationSettings =
          new PublicationModule.VideoPublicationSettings(
              videoCodec, resolution, framerate, bitrate,
              keyFrameInterval, rid);
      videoPublicationSettings._trackId = track.id;
      video.push(videoPublicationSettings);
    }
  }

  return new PublicationModule.PublicationSettings(audio, video);
}

/**
 * @function convertToSubscriptionCapabilities
 * @desc Convert mediaInfo received from server to SubscriptionCapabilities.
 * @private
 */
export function convertToSubscriptionCapabilities(mediaInfo) {
  let audio;
  let video;

  for (const track of mediaInfo.tracks) {
    if (track.type === 'audio') {
      const audioCodecs = [];
      if (track.optional && track.optional.format) {
        for (const audioCodecInfo of track.optional.format) {
          const audioCodec = new CodecModule.AudioCodecParameters(
              audioCodecInfo.codec, audioCodecInfo.channelNum,
              audioCodecInfo.sampleRate);
          audioCodecs.push(audioCodec);
        }
      }
      audioCodecs.sort();
      audio = new SubscriptionModule.AudioSubscriptionCapabilities(audioCodecs);
    } else if (track.type === 'video') {
      const videoCodecs = [];
      if (track.optional && track.optional.format) {
        for (const videoCodecInfo of track.optional.format) {
          const videoCodec = new CodecModule.VideoCodecParameters(
              videoCodecInfo.codec, videoCodecInfo.profile);
          videoCodecs.push(videoCodec);
        }
      }
      videoCodecs.sort();
      if (!track.optional?.parameters) {
        video = new SubscriptionModule.VideoSubscriptionCapabilities(
            videoCodecs, [], [], [], []);
      } else {
        const resolutions = Array.from(
            track.optional.parameters.resolution,
            (r) => new MediaFormatModule.Resolution(r.width, r.height));
        resolutions.sort(sortResolutions);
        const bitrates = Array.from(
            track.optional.parameters.bitrate,
            (bitrate) => extractBitrateMultiplier(bitrate));
        bitrates.push(1.0);
        bitrates.sort(sortNumbers);
        const frameRates =
            JSON.parse(JSON.stringify(track.optional.parameters.framerate));
        frameRates.sort(sortNumbers);
        const keyFrameIntervals = JSON.parse(
            JSON.stringify(track.optional.parameters.keyFrameInterval));
        keyFrameIntervals.sort(sortNumbers);
        video = new SubscriptionModule.VideoSubscriptionCapabilities(
            videoCodecs, resolutions, frameRates, bitrates, keyFrameIntervals);
      }
    }
  }
  return new SubscriptionModule.SubscriptionCapabilities(audio, video);
}
