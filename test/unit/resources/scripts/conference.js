// Copyright (C) <2017> Intel Corporation
//
// SPDX-License-Identifier: Apache-2.0

'use strict';

import {ConferenceClient} from '../../../../src/sdk/conference/client.js';
import {ConferencePeerConnectionChannel} from '../../../../src/sdk/conference/channel.js';
import * as EventModule from '../../../../src/sdk/base/event.js'
import * as StreamUtils from '../../../../src/sdk/conference/streamutils.js';
import * as SubscriptionModule from '../../../../src/sdk/conference/subscription.js'
import {TransportSettings, TransportType} from '../../../../src/sdk/base/transport.js';

const expect = chai.expect;
chai.use(chaiAsPromised);

describe('Unit tests for ConferenceClient', function() {
  describe('Create a ConferenceClient.', function() {
    it('Create a ConferenceClient with or without configuration should success.',
       done => {
         let confclient = new ConferenceClient({});
         expect(confclient).to.be.an.instanceof(EventModule.EventDispatcher);
         confclient = new ConferenceClient({});
         expect(confclient).to.be.an.instanceof(EventModule.EventDispatcher);
         done();
       });

    it('Event should be fired on correct target.', done => {
      let conf1 = new ConferenceClient({});
      let conf2 = new ConferenceClient({});
      conf1.addEventListener('test', () => {
        done('Event should not be fired on conf1.');
      });
      conf2.addEventListener('test', () => {
        done();
      });
      conf2.dispatchEvent(new EventModule.OwtEvent('test'));
    });

    it('Event listener should not be triggered after removeEventListener.',
       done => {
         const conf1 = new ConferenceClient({});
         const listener = () => {
           done('Event listener should not be fired.');
         };
         conf1.addEventListener('test', listener);
         conf1.removeEventListener('test', listener);
         conf1.dispatchEvent(new EventModule.OwtEvent('test'));
         done();
       });
  });
});

describe('Unit tests for ConferencePeerConnectionChannel.', () => {
  describe('Tests for codecs.', () => {
    it('Correctly detect the type of publishOptions elements.', () => {
      // For each element in paramters, [object to be tested, is
      // RTCRtpEncodingParameters, is OwtEncodingParameters].
      const parameters = [
        [[{scalabilityMode: 'L3T3'}], true, false],
        [
          [
            {rid: 'q', active: true, scaleResolutionDownBy: 4.0},
            {rid: 'h', active: true, scaleResolutionDownBy: 2.0},
            {rid: 'f', active: true}
          ],
          true, false
        ],
        [true, false, false],
        [
          [
            {
              codec: {
                name: 'h264',
              },
            },
            {
              codec: {
                name: 'vp9',
              },
            },
            {
              codec: {
                name: 'vp8',
              },
            }
          ],
          false, true
        ]
      ];
      const channel = new ConferencePeerConnectionChannel();
      for (const [p, isRtpEncodingParameters, isOwtEncodingParameters] of
               parameters) {
        expect(channel._isRtpEncodingParameters(p))
            .to.equal(isRtpEncodingParameters);
        expect(channel._isOwtEncodingParameters(p))
            .to.equal(isOwtEncodingParameters);
      }
    });
  });
});

describe('Unit tests for Subscription.', () => {
  it('Get transport returns correct TransportSettings.', () => {
    const transportSettings =
        new TransportSettings(TransportType.WEBRTC, 'randomId');
    const subscription = new SubscriptionModule.Subscription(
        'sessionId', undefined, transportSettings);
    expect(subscription.transport).to.equal(transportSettings);
  });
});

describe('Unit tests for StreamUtils.', () => {
  it('Convert server messages to subscription capabilities.', () => {
    const messages = [
      [
        {
          'tracks': [
            {
              'id': '35951ba82cf14a8cb0348ab64517fb80-2',
              'type': 'audio',
              'source': 'mic',
              'format': {'channelNum': 2, 'sampleRate': 48000, 'codec': 'opus'},
              'optional': {
                'format': [
                  {'sampleRate': 16000, 'codec': 'isac'},
                  {'sampleRate': 32000, 'codec': 'isac'},
                  {'channelNum': 1, 'sampleRate': 16000, 'codec': 'g722'},
                  {'codec': 'pcma'}, {'codec': 'pcmu'},
                  {'channelNum': 2, 'sampleRate': 48000, 'codec': 'aac'},
                  {'codec': 'ac3'}, {'codec': 'nellymoser'}, {'codec': 'ilbc'}
                ]
              },
              'status': 'active',
              'mid': '2'
            },
            {
              'id': '35951ba82cf14a8cb0348ab64517fb80-3',
              'type': 'video',
              'source': 'camera',
              'format': {'codec': 'vp8'},
              'optional': {
                'format': [
                  {'profile': 'CB', 'codec': 'h264'},
                  {'profile': 'B', 'codec': 'h264'}, {'codec': 'vp9'}
                ],
                'parameters': {
                  'resolution': [
                    {'width': 480, 'height': 360},
                    {'width': 426, 'height': 320},
                    {'width': 320, 'height': 240},
                    {'width': 212, 'height': 160},
                    {'width': 160, 'height': 120}, {'width': 352, 'height': 288}
                  ],
                  'bitrate': ['x0.8', 'x0.6', 'x0.4', 'x0.2'],
                  'framerate': [6, 12, 15, 24],
                  'keyFrameInterval': [100, 30, 5, 2, 1]
                }
              },
              'status': 'active',
              'mid': '3'
            }
          ]
        },
        {
          'audio': {
            'codecs': [
              {'name': 'isac', 'clockRate': 16000},
              {'name': 'isac', 'clockRate': 32000},
              {'name': 'g722', 'channelCount': 1, 'clockRate': 16000},
              {'name': 'pcma'}, {'name': 'pcmu'},
              {'name': 'aac', 'channelCount': 2, 'clockRate': 48000},
              {'name': 'ac3'}, {'name': 'nellymoser'}, {'name': 'ilbc'}
            ]
          },
          'video': {
            'codecs': [
              {'name': 'h264', 'profile': 'CB'},
              {'name': 'h264', 'profile': 'B'}, {'name': 'vp9'}
            ],
            'resolutions': [
              {'width': 160, 'height': 120}, {'width': 212, 'height': 160},
              {'width': 320, 'height': 240}, {'width': 352, 'height': 288},
              {'width': 426, 'height': 320}, {'width': 480, 'height': 360}
            ],
            'frameRates': [6, 12, 15, 24],
            'bitrateMultipliers': [0.2, 0.4, 0.6, 0.8, 1],
            'keyFrameIntervals': [1, 2, 5, 30, 100]
          }
        }
      ],
      [
        // Audio only.
        {
          'tracks': [{
            'id': '35951ba82cf14a8cb0348ab64517fb80-2',
            'type': 'audio',
            'source': 'mic',
            'format': {'channelNum': 2, 'sampleRate': 48000, 'codec': 'opus'},
            'optional': {
              'format': [
                {'sampleRate': 16000, 'codec': 'isac'},
                {'sampleRate': 32000, 'codec': 'isac'},
                {'channelNum': 1, 'sampleRate': 16000, 'codec': 'g722'},
                {'codec': 'pcma'}, {'codec': 'pcmu'},
                {'channelNum': 2, 'sampleRate': 48000, 'codec': 'aac'},
                {'codec': 'ac3'}, {'codec': 'nellymoser'}, {'codec': 'ilbc'}
              ]
            },
            'status': 'active',
            'mid': '2'
          }]
        },
        {
          'audio': {
            'codecs': [
              {'name': 'isac', 'clockRate': 16000},
              {'name': 'isac', 'clockRate': 32000},
              {'name': 'g722', 'channelCount': 1, 'clockRate': 16000},
              {'name': 'pcma'}, {'name': 'pcmu'},
              {'name': 'aac', 'channelCount': 2, 'clockRate': 48000},
              {'name': 'ac3'}, {'name': 'nellymoser'}, {'name': 'ilbc'}
            ]
          }
        }
      ],
      [
        // Transcoding is disabled.
        {
          'tracks': [
            {
              'type': 'audio',
              'format': {'codec': 'opus', 'sampleRate': 48000, 'channelNum': 2},
              'optional': {},
              'status': 'active'
            },
            {
              'type': 'video',
              'format': {'codec': 'vp8'},
              'parameters': {
                'resolution': {'width': 640, 'height': 480},
                'framerate': 24,
                'keyFrameInterval': 100
              },
              'optional': {},
              'status': 'active'
            }
          ]
        },
        {
          'audio': {'codecs': []},
          'video': {
            'codecs': [],
            'resolutions': [],
            'frameRates': [],
            'bitrateMultipliers': [],
            'keyFrameIntervals': []
          }
        }
      ]
    ];
    for (const [message, capabilities] of messages) {
      // Stringify to avoid type comparison.
      expect(JSON.stringify(
                 StreamUtils.convertToSubscriptionCapabilities(message)))
          .to.equal(JSON.stringify(capabilities));
    }
  });
});