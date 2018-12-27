// Copyright (C) <2018> Intel Corporation
//
// SPDX-License-Identifier: Apache-2.0

'use strict';

import * as EventModule from '../base/event.js'
import { SioSignaling as Signaling } from './signaling.js'
import Logger from '../base/logger.js'
import { Base64 } from '../base/base64.js'
import { ConferenceError } from './error.js'
import * as Utils from '../base/utils.js'
import * as StreamModule from '../base/stream.js'
import { Participant } from './participant.js'
import { ConferenceInfo } from './info.js'
import { ConferencePeerConnectionChannel } from './channel.js'
import { RemoteMixedStream, ActiveAudioInputChangeEvent, LayoutChangeEvent } from './mixedstream.js'
import * as StreamUtilsModule from './streamutils.js'

const SignalingState = {
  READY: 1,
  CONNECTING: 2,
  CONNECTED: 3
};

const protocolVersion = '1.0';

/**
 * @class ParticipantEvent
 * @classDesc Class ParticipantEvent represents a participant event.
   @extends Oms.Base.OmsEvent
 * @memberof Oms.Conference
 * @hideconstructor
 */
const ParticipantEvent = function(type, init) {
  const that = new EventModule.OmsEvent(type, init);
  /**
   * @member {Oms.Conference.Participant} participant
   * @instance
   * @memberof Oms.Conference.ParticipantEvent
   */
  that.participant = init.participant;
  return that;
};

/**
 * @class ConferenceClientConfiguration
 * @classDesc Configuration for ConferenceClient.
 * @memberOf Oms.Conference
 * @hideconstructor
 */
class ConferenceClientConfiguration {
  constructor() {
    /**
     * @member {?RTCConfiguration} rtcConfiguration
     * @instance
     * @memberof Oms.Conference.ConferenceClientConfiguration
     * @desc It will be used for creating PeerConnection.
     * @see {@link https://www.w3.org/TR/webrtc/#rtcconfiguration-dictionary|RTCConfiguration Dictionary of WebRTC 1.0}.
     * @example
     * // Following object can be set to conferenceClientConfiguration.rtcConfiguration.
     * {
     *   iceServers: [{
     *      urls: "stun:example.com:3478"
     *   }, {
     *     urls: [
     *       "turn:example.com:3478?transport=udp",
     *       "turn:example.com:3478?transport=tcp"
     *     ],
     *      credential: "password",
     *      username: "username"
     *   }
     * }
     */
    this.rtcConfiguration = undefined;
  }
}

/**
 * @class ConferenceClient
 * @classdesc The ConferenceClient handles PeerConnections between client and server. For conference controlling, please refer to REST API guide.
 * Events:
 *
 * | Event Name            | Argument Type                    | Fired when       |
 * | --------------------- | ---------------------------------| ---------------- |
 * | streamadded           | Oms.Base.StreamEvent             | A new stream is available in the conference. |
 * | participantjoined     | Oms.Conference.ParticipantEvent  | A new participant joined the conference. |
 * | messagereceived       | Oms.Base.MessageEvent            | A new message is received. |
 * | serverdisconnected    | Oms.Base.OmsEvent                | Disconnected from conference server. |
 *
 * @memberof Oms.Conference
 * @extends Oms.Base.EventDispatcher
 * @constructor
 * @param {?Oms.Conference.ConferenceClientConfiguration } config Configuration for ConferenceClient.
 * @param {?Oms.Conference.SioSignaling } signalingImpl Signaling channel implementation for ConferenceClient. SDK uses default signaling channel implementation if this parameter is undefined. Currently, a Socket.IO signaling channel implementation was provided as ics.conference.SioSignaling. However, it is not recommended to directly access signaling channel or customize signaling channel for ConferenceClient as this time.
 */
export const ConferenceClient = function(config, signalingImpl) {
  Object.setPrototypeOf(this, new EventModule.EventDispatcher());
  config = config || {};
  const self = this;
  let signalingState = SignalingState.READY;
  const signaling = signalingImpl ? signalingImpl : (new Signaling());
  let me;
  let room;
  let remoteStreams = new Map(); // Key is stream ID, value is a RemoteStream.
  const participants = new Map(); // Key is participant ID, value is a Participant object.
  const publishChannels = new Map(); // Key is MediaStream's ID, value is pc channel.
  const channels = new Map(); // Key is channel's internal ID, value is channel.

  function onSignalingMessage (notification, data) {
    if (notification === 'soac' || notification === 'progress') {
      if (!channels.has(data.id)) {
        Logger.warning('Cannot find a channel for incoming data.');
        return;
      }
      channels.get(data.id).onMessage(notification, data);
    } else if (notification === 'stream') {
      if (data.status === 'add') {
        fireStreamAdded(data.data);
      } else if (data.status === 'remove') {
        fireStreamRemoved(data);
      } else if (data.status === 'update') {
        // Broadcast audio/video update status to channel so specific events can be fired on publication or subscription.
        if (data.data.field === 'audio.status' || data.data.field ===
          'video.status') {
          channels.forEach(c => {
            c.onMessage(notification, data);
          });
        } else if (data.data.field === 'activeInput') {
          fireActiveAudioInputChange(data);
        } else if (data.data.field === 'video.layout') {
          fireLayoutChange(data);
        } else if (data.data.field === '.') {
          updateRemoteStream(data.data.value);
        } else {
          Logger.warning('Unknown stream event from MCU.');
        }
      }
    } else if (notification === 'text') {
      fireMessageReceived(data);
    } else if(notification === 'participant'){
      fireParticipantEvent(data);
    }
  };

  signaling.addEventListener('data', (event) => {
    onSignalingMessage(event.message.notification, event.message.data);
  });

  signaling.addEventListener('disconnect', () => {
    clean();
    signalingState = SignalingState.READY;
    self.dispatchEvent(new EventModule.OmsEvent('serverdisconnected'));
  });

  function fireParticipantEvent(data) {
    if (data.action === 'join') {
      data = data.data;
      const participant = new Participant(data.id, data.role, data.user)
      participants.set(data.id, participant);
      const event = new ParticipantEvent('participantjoined', { participant: participant });
      self.dispatchEvent(event);
    } else if (data.action === 'leave') {
      const participantId = data.data;
      if (!participants.has(participantId)) {
        Logger.warning(
          'Received leave message from MCU for an unknown participant.');
        return;
      }
      const participant = participants.get(participantId);
      participants.delete(participantId);
      participant.dispatchEvent(new EventModule.OmsEvent('left'));
    }
  }

  function fireMessageReceived(data) {
    const messageEvent = new EventModule.MessageEvent('messagereceived', {
      message: data.message,
      origin: data.from,
      to: data.to
    });
    self.dispatchEvent(messageEvent);
  }

  function fireStreamAdded(info) {
    const stream = createRemoteStream(info);
    remoteStreams.set(stream.id, stream);
    const streamEvent = new StreamModule.StreamEvent('streamadded', {
      stream: stream
    });
    self.dispatchEvent(streamEvent);
  }

  function fireStreamRemoved(info) {
    if (!remoteStreams.has(info.id)) {
      Logger.warning('Cannot find specific remote stream.');
      return;
    }
    const stream = remoteStreams.get(info.id);
    const streamEvent = new EventModule.OmsEvent('ended');
    remoteStreams.delete(stream.id);
    stream.dispatchEvent(streamEvent);
  }

  function fireActiveAudioInputChange(info) {
    if (!remoteStreams.has(info.id)) {
      Logger.warning('Cannot find specific remote stream.');
      return;
    }
    const stream = remoteStreams.get(info.id);
    const streamEvent = new ActiveAudioInputChangeEvent(
      'activeaudioinputchange', {
        activeAudioInputStreamId: info.data.value
      });
    stream.dispatchEvent(streamEvent);
  }

  function fireLayoutChange(info) {
    if (!remoteStreams.has(info.id)) {
      Logger.warning('Cannot find specific remote stream.');
      return;
    }
    const stream = remoteStreams.get(info.id);
    const streamEvent = new LayoutChangeEvent(
      'layoutchange', {
        layout: info.data.value
      });
    stream.dispatchEvent(streamEvent);
  }

  function updateRemoteStream(streamInfo) {
    if (!remoteStreams.has(streamInfo.id)) {
      Logger.warning('Cannot find specific remote stream.');
      return;
    }
    const stream = remoteStreams.get(streamInfo.id);
    stream.settings = StreamUtilsModule.convertToPublicationSettings(streamInfo
      .media);
    stream.capabilities = StreamUtilsModule.convertToSubscriptionCapabilities(
      streamInfo.media);
    const streamEvent = new EventModule.OmsEvent('updated');
    stream.dispatchEvent(streamEvent);
  }

  function createRemoteStream(streamInfo) {
    if (streamInfo.type === 'mixed') {
      return new RemoteMixedStream(streamInfo);
    } else {
      let audioSourceInfo, videoSourceInfo;
      if (streamInfo.media.audio) {
        audioSourceInfo = streamInfo.media.audio.source;
      }
      if (streamInfo.media.video) {
        videoSourceInfo = streamInfo.media.video.source;
      }
      const stream = new StreamModule.RemoteStream(streamInfo.id, streamInfo.info
        .owner, undefined, new StreamModule.StreamSourceInfo(audioSourceInfo,
          videoSourceInfo), streamInfo.info.attributes);
      stream.settings = StreamUtilsModule.convertToPublicationSettings(
        streamInfo.media);
      stream.capabilities = StreamUtilsModule.convertToSubscriptionCapabilities(
        streamInfo.media);
      return stream;
    }
  }

  function sendSignalingMessage(type, message) {
    return signaling.send(type, message);
  };

  function createPeerConnectionChannel() {
    // Construct an signaling sender/receiver for ConferencePeerConnection.
    const signalingForChannel = Object.create(EventModule.EventDispatcher);
    signalingForChannel.sendSignalingMessage = sendSignalingMessage;
    const pcc = new ConferencePeerConnectionChannel(config, signalingForChannel);
    pcc.addEventListener('id', (messageEvent) => {
      channels.set(messageEvent.message, pcc);
    });
    return pcc;
  }

  function clean() {
    participants.clear();
    remoteStreams.clear();
  }

  Object.defineProperty(this, 'info', {
    configurable: false,
    get: () => {
      if (!room) {
        return null;
      }
      return new ConferenceInfo(room.id, Array.from(participants, x => x[
        1]), Array.from(remoteStreams, x => x[1]), me);
    }
  });

  /**
   * @function join
   * @instance
   * @desc Join a conference.
   * @memberof Oms.Conference.ConferenceClient
   * @returns {Promise<ConferenceInfo, Error>} Return a promise resolved with current conference's information if successfully join the conference. Or return a promise rejected with a newly created Oms.Error if failed to join the conference.
   * @param {string} token Token is issued by conference server(nuve).
   */
  this.join = function(tokenString) {
    return new Promise((resolve, reject) => {
      const token = JSON.parse(Base64.decodeBase64(tokenString));
      const isSecured = (token.secure === true);
      let host = token.host;
      if (typeof host !== 'string') {
        reject(new ConferenceError('Invalid host.'));
        return;
      }
      if (host.indexOf('http') === -1) {
        host = isSecured ? ('https://' + host) : ('http://' + host);
      }
      if (signalingState !== SignalingState.READY) {
        reject(new ConferenceError('connection state invalid'));
        return;
      }

      signalingState = SignalingState.CONNECTING;

      const loginInfo = {
        token: tokenString,
        userAgent: Utils.sysInfo(),
        protocol: protocolVersion
      };

      signaling.connect(host, isSecured, loginInfo).then((resp) => {
        signalingState = SignalingState.CONNECTED;
        room = resp.room;
        if (room.streams !== undefined) {
          for (const st of room.streams) {
            if (st.type === 'mixed') {
              st.viewport = st.info.label;
            }
            remoteStreams.set(st.id, createRemoteStream(st));
          };
        }
        if (resp.room && resp.room.participants !== undefined) {
          for (const p of resp.room.participants) {
            participants.set(p.id, new Participant(p.id, p.role, p.user));
            if (p.id === resp.id) {
              me = participants.get(p.id);
            }
          }
        }
        resolve(new ConferenceInfo(resp.room.id, Array.from(participants
          .values()), Array.from(remoteStreams.values()), me));
      }, (e) => {
        signalingState = SignalingState.READY;
        reject(new ConferenceError(e))
      });
    });
  };

  /**
   * @function publish
   * @memberof Oms.Conference.ConferenceClient
   * @instance
   * @desc Publish a LocalStream to conference server. Other participants will be able to subscribe this stream when it is successfully published.
   * @param {Oms.Base.LocalStream} stream The stream to be published.
   * @param {Oms.Base.PublishOptions} options Options for publication.
   * @returns {Promise<Publication, Error>} Returned promise will be resolved with a newly created Publication once specific stream is successfully published, or rejected with a newly created Error if stream is invalid or options cannot be satisfied. Successfully published means PeerConnection is established and server is able to process media data.
   */
  this.publish = function(stream, options) {
    if (!(stream instanceof StreamModule.LocalStream)) {
      return Promise.reject(new ConferenceError('Invalid stream.'));
    }
    if (publishChannels.has(stream.mediaStream.id)) {
      return Promise.reject(new ConferenceError(
        'Cannot publish a published stream.'));
    }
    const channel = createPeerConnectionChannel();
    return channel.publish(stream, options);
  };

  /**
   * @function subscribe
   * @memberof Oms.Conference.ConferenceClient
   * @instance
   * @desc Subscribe a RemoteStream from conference server.
   * @param {Oms.Base.RemoteStream} stream The stream to be subscribed.
   * @param {Oms.Conference.SubscribeOptions} options Options for subscription.
   * @returns {Promise<Subscription, Error>} Returned promise will be resolved with a newly created Subscription once specific stream is successfully subscribed, or rejected with a newly created Error if stream is invalid or options cannot be satisfied. Successfully subscribed means PeerConnection is established and server was started to send media data.
   */
  this.subscribe = function(stream, options) {
    if (!(stream instanceof StreamModule.RemoteStream)) {
      return Promise.reject(new ConferenceError('Invalid stream.'));
    }
    const channel = createPeerConnectionChannel();
    return channel.subscribe(stream, options);
  };

  /**
   * @function send
   * @memberof Oms.Conference.ConferenceClient
   * @instance
   * @desc Send a text message to a participant or all participants.
   * @param {string} message Message to be sent.
   * @param {string} participantId Receiver of this message. Message will be sent to all participants if participantId is undefined.
   * @returns {Promise<void, Error>} Returned promise will be resolved when conference server received certain message.
   */
  this.send = function(message, participantId) {
    if (participantId === undefined) {
      participantId = 'all';
    }
    return sendSignalingMessage('text', { to: participantId, message: message });
  };

  /**
   * @function leave
   * @memberOf Oms.Conference.ConferenceClient
   * @instance
   * @desc Leave a conference.
   * @returns {Promise<void, Error>} Returned promise will be resolved with undefined once the connection is disconnected.
   */
  this.leave = function() {
    return signaling.disconnect().then(() => {
      clean();
      signalingState = SignalingState.READY;
    });
  };
};
