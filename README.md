# useAudioDetection

`useAudioDetection` is a React library that provides a hook for detecting audio and speech using the Web Audio API. It is useful for applications that require speech detection, such as voice assistants or voice recorders.

## References

_This package is based on the original work of Giorgio Robino (https://github.com/solyarisoftware) WeBAD, which can be found in this repository: https://github.com/solyarisoftware/WeBAD. The audioWorklet used to detect audio signal is AudioVolumeMeterProcessor Copyright (c) 2022 The Chromium Authors (https://github.com/GoogleChromeLabs/web-audio-samples/tree/main/src/audio-worklet/basic/volume-meter/)_

## Installation

You can install the library via npm:

```bash
npm install useAudioDetection
```

## Usage

Here is a basic example of how to use `useAudioDetection` in a React component:

```javascript
import React from "react";
import useSpeechDetector from "useAudioDetection";

function BasicSpeechComponent() {
  const detectorRef = useSpeechDetector({
    onSpeech: (audioData) => {
      // Do something with audioData...
      console.log("Speech detected");
    }
  });

  return (
    <div>
      <h1>Basic Speech Detection</h1>
    </div>
  );
}

export default BasicSpeechComponent;
```

Here is a more advanced example of how to use `useAudioDetection` in a React component:

```javascript
import React, { useState } from "react";
import useSpeechDetector from "useAudioDetection";

function SpeechComponent() {
  const [events, setEvents] = useState([]);
  const detectorRef = useSpeechDetector(
    {
      onSpeech: (data) => {
        console.log("Speech data:", data);
      },
      onEvent: (eventName, eventData) => {
        setEvents((prevEvents) => [...prevEvents, { eventName, eventData }]);
      }
    },
    {
      timeoutMsecs: 50,
      prespeechstartMsecs: 600,
      speakingMinVolume: 0.02,
      silenceVolume: 0.001,
      muteVolume: 0.0001,
      maxInterSpeechSilenceMs: 600,
      samplePollingMs: 16,
      minSignalDuration: 400,
      minAverageSignalVolume: 0.04
    }
  );

  return (
    <div>
      <h1>Speech Detection</h1>
      <ul>
        {events.map((event, index) => (
          <li key={index}>
            {event.eventName}: {JSON.stringify(event.eventData)}
          </li>
        ))}
      </ul>
    </div>
  );
}

export default SpeechComponent;
```

## API

### `useSpeechDetector(params, config)`

- `params`: An object containing the `onSpeech` and `onEvent` callbacks.
  - `onSpeech(data)`: Callback called when speech is detected.
  - `onEvent(eventName, eventData)`: Callback called for various audio detection events.
- `config`: A configuration object to customize the behavior of the audio detection.

## Events

The events that can be detected include:

- `speech-start`: Start of speech.
- `speech-stop`: End of speech.
- `speech-abort`: Speech aborted due to insufficient duration or volume.
- `mute`: Microphone muted.
- `signal`: Audio signal detected.
- `silence`: Silence detected.
- `pre-speech-start`: Pre-speech detection.

## License

This project is licensed under the BSD-style license. See the LICENSE file for details.
