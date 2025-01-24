// Based on work by:
// https://github.com/solyarisoftware/WeBAD

// Other Worklet Processors
// https://github.com/thurti/vad-audio-worklet/tree/main?tab=readme-ov-file

// AudioVolumeMeterProcessor
// Copyright (c) 2022 The Chromium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.
// https://github.com/GoogleChromeLabs/web-audio-samples/tree/main/src/audio-worklet/basic/volume-meter

const AudioVolumeMeterProcessor = `
/* global currentTime */

const SMOOTHING_FACTOR = 0.8;
const FRAME_PER_SECOND = 60;
const FRAME_INTERVAL = 1 / FRAME_PER_SECOND;

/**
 *  Measure microphone volume.
 *
 * @class VolumeMeter
 * @extends AudioWorkletProcessor
 */
class VolumeMeter extends AudioWorkletProcessor {

  constructor() {
    super();
    this._lastUpdate = currentTime;
    this._volume = 0;
  }

  calculateRMS(inputChannelData) {
    // Calculate the squared-sum.
    let sum = 0;
    for (let i = 0; i < inputChannelData.length; i++) {
      sum += inputChannelData[i] * inputChannelData[i];
    }

    // Calculate the RMS level and update the volume.
    let rms = Math.sqrt(sum / inputChannelData.length);
    this._volume = Math.max(rms, this._volume * SMOOTHING_FACTOR);
  }

  process(inputs, outputs) {
    // This example only handles mono channel.
    const inputChannelData = inputs[0][0];

    // Post a message to the node every 16ms.
if (currentTime - this._lastUpdate > FRAME_INTERVAL) {
  this.calculateRMS(inputChannelData);
  this.port.postMessage(this._volume);
  this._lastUpdate = currentTime;
}

    return true;
  }
}

registerProcessor("meter", VolumeMeter);
`;

const AudioProcessorSrc = URL.createObjectURL(
  new Blob([AudioVolumeMeterProcessor], {
    type: "application/javascript"
  })
);

const defConfig = {
  timeoutMsecs: 50,
  prespeechstartMsecs: 600,
  speakingMinVolume: 0.02,
  silenceVolume: 0.001,
  muteVolume: 0.0001,
  maxInterSpeechSilenceMs: 600,
  samplePollingMs: 16, //50,
  minSignalDuration: 400,
  minAverageSignalVolume: 0.04
};

export default class SpeechDetector {
  volume = 0;
  volumeState = "mute";
  speechstarted = false;
  silenceItems = 0;
  signalItems = 0;
  speechstartTime = 0;
  prerecordingItems = 0;
  speechVolumesList = [];
  isAborted = false;

  constructor({
    stream,
    onSpeech,
    onEvent,
    recordingEnabled = true,
    MediaDevices = navigator.mediaDevices,
    AudioCtx = AudioContext,
    AudioWorkletNd = AudioWorkletNode,
    MediaRec = MediaRecorder,
    config = {}
  } = {}) {
    this.config = { ...defConfig, ...config };
    this.recordingEnabled = recordingEnabled;
    this.onEvent = onEvent;
    this.onSpeech = onSpeech;

    this.config.maxSilenceItems = Math.round(
      this.config.maxInterSpeechSilenceMs / this.config.samplePollingMs
    );

    this.context = new AudioCtx({ sampleRate: 16000 });
    //this.context.resume();

    if (stream) {
      this.connectStream(stream, AudioWorkletNd, MediaRec);
    } else {
      MediaDevices.getUserMedia({
        audio: {
          mandatory: {
            googEchoCancellation: "false",
            googAutoGainControl: "false",
            googNoiseSuppression: "false",
            googHighpassFilter: "false"
          },
          optional: []
        }
      }).then((stream) => this.connectStream(stream, AudioWorkletNd, MediaRec));
    }
  }

  connectStream(stream, AudioWorkletNd, MediaRec) {
    this.mediaStreamSource = this.context.createMediaStreamSource(stream);

    // Setup the recorder
    this.recorder = new MediaRec(stream);

    this.recorder.ondataavailable = ({ data }) => {
      if (!this.isAborted && data) {
        if (this.onSpeech) this.onSpeech(data);
        this.dispatchEvent("audio-data", data);
      }
      this.isAborted = false;
    };

    // Setup the audio meter
    this.context.audioWorklet.addModule(AudioProcessorSrc).then((k) => {
      const audioMeterNode = new AudioWorkletNd(this.context, "meter");
      audioMeterNode.port.onmessage = ({ data }) => {
        if (!this.recordingEnabled) return;

        this.volume = data;
        this.prerecording();
        this.sampleThresholdsDecision();
      };

      // Connect the audio meter
      this.mediaStreamSource
        .connect(audioMeterNode)
        .connect(this.context.destination);
    });
  }

  mute(timestamp, duration) {
    const eventData = {
      detail: {
        volume: this.volume,
        timestamp,
        duration
      }
    };

    this.dispatchEvent("mute", eventData);

    // mic is muted (is closed)
    // trigger event on transition
    if (this.volumeState !== "mute") {
      this.dispatchEvent("muted-mic", eventData);
      this.volumeState = "mute";
    }
  }

  signal(timestamp, duration) {
    this.silenceItems = 0;

    const eventData = {
      detail: {
        volume: this.volume,
        timestamp,
        duration,
        items: ++this.signalItems
      }
    };
    if (!this.speechstarted) {
      this.speechstarted = true;
      this.speechstartTime = timestamp;
      this.speechVolumesList = [];

      this.dispatchEvent("speech-start", eventData);
    }

    this.speechVolumesList.push(this.volume);

    this.dispatchEvent("signal", eventData);

    // mic is unmuted (is open)
    // trigger event on transition
    if (this.volumeState === "mute") {
      this.dispatchEvent("unmuted-mic", eventData);
      this.volumeState = "signal";
    }
  }

  silence(timestamp, duration) {
    this.signalItems = 0;

    const eventData = {
      detail: {
        event: "silence",
        volume: this.volume,
        timestamp,
        duration,
        items: ++this.silenceItems
      }
    };

    this.dispatchEvent("silence", eventData);

    // mic is unmuted (goes ON)
    // trigger event on transition
    if (this.volumeState === "mute") {
      this.dispatchEvent("unmuted-mic", eventData);
      this.volumeState = "silence";
    }

    //
    // after a MAX_INTERSPEECH_SILENCE_MSECS
    // a verdict event is generated:
    //   speech-abort if audio chunk is to brief or at too low volume
    //   speech-stop  if audio chunk appears to be a valid speech
    //
    if (
      this.speechstarted &&
      this.silenceItems === this.config.maxSilenceItems
    ) {
      const signalDuration = duration - this.config.maxInterSpeechSilenceMs;
      const averageSignalValue = this.averageSignal();

      // speech abort
      // signal duration too short
      if (signalDuration < this.config.minSignalDuration) {
        eventData.detail.abort = `signal duration (${signalDuration}) < minSignalDuration (${this.config.minSignalDuration})`;
        this.dispatchEvent("speech-abort", eventData);
      }

      // speech abort
      // signal level too low
      else if (averageSignalValue < this.config.minAverageSignalVolume) {
        eventData.detail.abort = `signal average volume (${averageSignalValue}) < minAverageSignalValue (${this.config.minAverageSignalVolume})`;
        this.dispatchEvent("speech-abort", eventData);
      }

      // speech stop
      // audio chunk appears to be a valid speech
      else {
        this.dispatchEvent("speech-stop", eventData);
      }

      this.speechstarted = false;
    }
  }

  sampleThresholdsDecision() {
    if (!this.recordingEnabled) return;
    const timestamp = Date.now();
    const duration = timestamp - this.speechstartTime;

    //
    // MUTE
    // mic is OFF/mute (volume is ~0)
    //
    if (this.volume < this.config.muteVolume) this.mute(timestamp, duration);
    //
    // SIGNAL
    // audio detection, maybe it's SPEECH
    //
    else if (this.volume > this.config.speakingMinVolume)
      this.signal(timestamp, duration);
    //
    // SILENCE
    // mic is ON. Audio level is low (background noise)
    //
    //(meter.volume < config.silenceVolume )
    else this.silence(timestamp, duration);
  }

  prerecording() {
    ++this.prerecordingItems;

    const eventData = {
      detail: {
        volume: this.volume,
        timestamp: Date.now(),
        items: this.prerecordingItems
      }
    };

    // emit event 'prespeech-start' every prespeech-startMsecs.
    // considering that prespeech-startMsecs is a multimple of timeoutMsecs
    if (
      this.prerecordingItems * this.config.timeoutMsecs >=
      this.config.prespeechstartMsecs
    ) {
      // emit the event if speech is not started
      if (!this.speechstarted) {
        this.dispatchEvent("pre-speech-start", eventData);
      }

      this.prerecordingItems = 0;
    }
  }

  averageSignal() {
    return (
      this.speechVolumesList.reduce((a, b) => a + b) /
      this.speechVolumesList.length
    ).toFixed(4);
  }

  dispatchEvent(eventName, eventData) {
    switch (eventName) {
      case "speech-start": {
        this.recorder.start();
        this.context.resume();
        break;
      }
      case "speech-stop": {
        this.isAborted = false;
        this.recorder.stop();
        break;
      }
      case "speech-abort": {
        this.isAborted = true;
        this.recorder.stop();
        break;
      }
      default: {
      }
    }

    if (this.onEvent) this.onEvent(eventName, eventData);
  }

  start() {
    this.recordingEnabled = true;
    this.context.resume();
    this.dispatchEvent("speech-detector-start", {});
  }
  resume() {
    this.recordingEnabled = true;
    this.context.resume();
    this.dispatchEvent("speech-detector-resume", {});
  }
  stop() {
    this.recordingEnabled = false;
    this.context.suspend();
    if (this.recorder) this.recorder.stop();
    this.dispatchEvent("speech-detector-stop", {});
  }
}

export { default as AudioDetector } from "./AudioDetector";
