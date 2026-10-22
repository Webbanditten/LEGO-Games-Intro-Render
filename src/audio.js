// Soundtrack playback. "original" decodes the audio track of intro.mp4 (exact: a stream
// copy of it, assets/intro-audio.m4a, 250 kB instead of the 6.5 MB video); "synth" renders
// the WebAudio re-creation from soundtrack.js. The animation clock follows the audio clock
// while it plays, so picture and sound stay locked.
import { renderLegoIntroAudio } from './soundtrack.js';

const ORIGINAL_URL = './assets/intro-audio.m4a';

const fetchBytes = (url) => fetch(url).then((r) => {
  if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
  return r.arrayBuffer();
});

export class Soundtrack {
  constructor() {
    this.ctx = null;
    this.out = null;
    this.buffers = {};   // mode -> Promise<AudioBuffer>, one shared load per mode
    this.bytes = null;   // prefetched original soundtrack (Promise<ArrayBuffer>)
    this.source = null;
    this.t0 = 0;
    this.from = 0;
  }

  // Downloads the original soundtrack ahead of the Play click. Decoding has to wait for
  // the AudioContext, which browsers only let us start from a user gesture.
  prefetch() {
    if (!this.bytes) {
      this.bytes = fetchBytes(ORIGINAL_URL);
      this.bytes.catch(() => {});   // not unhandled: the error surfaces in load()
    }
  }

  ensureContext() {
    if (!this.ctx) {
      this.ctx = new AudioContext();
      this.out = this.ctx.createGain();
      this.out.connect(this.ctx.destination);
    }
    return this.ctx.resume();
  }

  // Overlapping calls share one load; a failed load is forgotten so a later call retries.
  load(mode) {
    if (!this.buffers[mode]) {
      let job;
      if (mode === 'original') {
        const bytes = this.bytes || fetchBytes(ORIGINAL_URL);
        this.bytes = null;   // decodeAudioData detaches the ArrayBuffer: use it once
        job = bytes.then((data) => this.ctx.decodeAudioData(data));
      } else {
        job = renderLegoIntroAudio(this.ctx.sampleRate);
      }
      this.buffers[mode] = job.catch((e) => { delete this.buffers[mode]; throw e; });
    }
    return this.buffers[mode];
  }

  play(buffer, offset = 0) {
    this.stop();
    const src = this.ctx.createBufferSource();
    src.buffer = buffer;
    src.connect(this.out);
    const when = this.ctx.currentTime + 0.03;
    if (offset < buffer.duration) src.start(when, Math.max(0, offset));
    this.t0 = when - offset;
    this.from = offset;
    this.source = src;
  }

  stop() {
    if (this.source) { try { this.source.stop(); } catch { /* already stopped */ } this.source.disconnect(); }
    this.source = null;
  }

  // The raw audio clock: it only advances while the audio output is really running.
  get rawTime() { return this.ctx.currentTime; }

  // Soundtrack time being heard right now. getOutputTimestamp() pairs the audio clock with
  // performance.now() (smooth, and its contextTime already excludes the output latency);
  // the extrapolation is capped so a stalled clock freezes instead of running ahead.
  // Until the first sample at the play() offset is heard (the source starts 30 ms ahead,
  // plus the output latency) the clock holds at that offset, so a resume or a Sound switch
  // never replays frames that were already shown.
  get time() {
    const c = this.ctx;
    const ts = c.getOutputTimestamp ? c.getOutputTimestamp() : null;
    let t;
    if (ts && ts.performanceTime > 0 && ts.contextTime > 0) {
      const ext = Math.min(0.1, Math.max(0, (performance.now() - ts.performanceTime) / 1000));
      t = ts.contextTime + ext - this.t0;
    } else {
      t = c.currentTime - (c.baseLatency || 0) - (c.outputLatency || 0) - this.t0;   // Safari: no outputLatency
    }
    return Math.max(this.from, t);
  }
}
