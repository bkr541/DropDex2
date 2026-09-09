/// <reference lib="webworker" />

import { wsolaTimeStretch, type WsolaTimeStretchInput } from './wsolaTimeStretch';

interface StretchRequest extends WsolaTimeStretchInput {
  requestId: number;
}

interface StretchSuccess {
  requestId: number;
  ok: true;
  channels: Float32Array[];
  sampleRate: number;
}

interface StretchFailure {
  requestId: number;
  ok: false;
  error: string;
}

type StretchResponse = StretchSuccess | StretchFailure;

self.onmessage = (event: MessageEvent<StretchRequest>) => {
  const request = event.data;
  let response: StretchResponse;
  try {
    const result = wsolaTimeStretch(request);
    response = {
      requestId: request.requestId,
      ok: true,
      channels: result.channels,
      sampleRate: result.sampleRate,
    };
    self.postMessage(response, { transfer: result.channels.map((channel) => channel.buffer) });
  } catch (error) {
    response = {
      requestId: request.requestId,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
    self.postMessage(response);
  }
};
