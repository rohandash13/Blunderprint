const SAMPLE_RATE = 24000;

// Converts mic input to 16-bit PCM in ~100 ms chunks off the main thread.
const WORKLET = `
class PcmCapture extends AudioWorkletProcessor {
  constructor() { super(); this.buf = new Int16Array(2400); this.n = 0; }
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (ch) {
      for (let i = 0; i < ch.length; i++) {
        const s = Math.max(-1, Math.min(1, ch[i]));
        this.buf[this.n++] = s < 0 ? s * 0x8000 : s * 0x7fff;
        if (this.n === this.buf.length) {
          this.port.postMessage(this.buf.buffer, [this.buf.buffer]);
          this.buf = new Int16Array(2400);
          this.n = 0;
        }
      }
    }
    return true;
  }
}
registerProcessor("pcm-capture", PcmCapture);
`;

export class Mic {
  private ctx?: AudioContext;
  private stream?: MediaStream;

  async start(onChunk: (pcm: ArrayBuffer) => void): Promise<void> {
    this.ctx = new AudioContext({ sampleRate: SAMPLE_RATE });
    await this.ctx.resume();
    const url = URL.createObjectURL(new Blob([WORKLET], { type: "application/javascript" }));
    await this.ctx.audioWorklet.addModule(url);
    URL.revokeObjectURL(url);
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
    });
    const source = this.ctx.createMediaStreamSource(this.stream);
    const node = new AudioWorkletNode(this.ctx, "pcm-capture");
    node.port.onmessage = (e: MessageEvent<ArrayBuffer>) => onChunk(e.data);
    source.connect(node);
  }

  stop(): void {
    this.stream?.getTracks().forEach((t) => t.stop());
    void this.ctx?.close();
    this.ctx = undefined;
    this.stream = undefined;
  }
}

export class Player {
  private ctx = new AudioContext({ sampleRate: SAMPLE_RATE });
  private nextTime = 0;
  private sources: AudioBufferSourceNode[] = [];

  play(chunk: ArrayBuffer): void {
    const usable = chunk.byteLength - (chunk.byteLength % 2);
    if (usable === 0) return;
    const pcm = new Int16Array(chunk, 0, usable / 2);
    const audio = this.ctx.createBuffer(1, pcm.length, SAMPLE_RATE);
    const ch = audio.getChannelData(0);
    for (let i = 0; i < pcm.length; i++) ch[i] = pcm[i] / 0x8000;
    const src = this.ctx.createBufferSource();
    src.buffer = audio;
    src.connect(this.ctx.destination);
    const at = Math.max(this.ctx.currentTime, this.nextTime);
    src.start(at);
    this.nextTime = at + audio.duration;
    this.sources.push(src);
    src.onended = () => {
      this.sources = this.sources.filter((s) => s !== src);
    };
  }

  /** Barge-in: stop agent speech immediately when the user starts talking. */
  stop(): void {
    this.sources.forEach((s) => s.stop());
    this.sources = [];
    this.nextTime = 0;
  }

  resume(): Promise<void> {
    return this.ctx.resume();
  }
}
