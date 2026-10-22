// Soundtrack playback. "original" decodes the audio track of intro.mp4 (exact);
// "synth" renders the WebAudio re-creation from soundtrack.js. The animation
// clock follows the audio clock while it plays, so picture and sound stay locked.
import { renderLegoIntroAudio } from './soundtrack.js';

export class Soundtrack {
  constructor() {
    this.ctx = null;
    this.out = null;
    this.buffers = {};
    this.source = null;
    this.t0 = 0;
  }

  ensureContext() {
    if (!this.ctx) {
      this.ctx = new AudioContext();
      this.out = this.ctx.createGain();
      this.out.connect(this.ctx.destination);
    }
    return this.ctx.resume();
  }

  async load(mode) {
    if (this.buffers[mode]) return this.buffers[mode];
    if (mode === 'original') {
      const data = await (await fetch('./intro.mp4')).arrayBuffer();
      this.buffers[mode] = await this.ctx.decodeAudioData(data);
    } else {
      this.buffers[mode] = await renderLegoIntroAudio(this.ctx.sampleRate);
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
    this.source = src;
  }

  stop() {
    if (this.source) { try { this.source.stop(); } catch { /* already stopped */ } this.source.disconnect(); }
    this.source = null;
  }

  get time() { return this.ctx.currentTime - this.t0; }

  set muted(m) { if (this.out) this.out.gain.value = m ? 0 : 1; }
}
