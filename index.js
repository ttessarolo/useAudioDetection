import { useEffect, useRef } from "react";
import SpeechDetector from "./lib/detector.js";

export default function useSpeechDetector(params, config) {
  const detectorRef = useRef();

  useEffect(() => {
    if (!detectorRef.current) {
      detectorRef.current = new SpeechDetector(params, config);
    }
    detectorRef.current.start();

    return () => detectorRef.current.stop();
  }, [config, params]);

  return detectorRef;
}

export { default as useAudioDetection } from "./lib/useAudioDetection";
