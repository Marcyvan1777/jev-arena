/** Synthesised arena sound: no audio files to license or download. Everything is built from noise and oscillators. */
type Cue = 'whoosh' | 'hit' | 'heavy' | 'block' | 'bell' | 'knockdown' | 'count' | 'finish';

class Sfx {
  private ctx: AudioContext | null = null; private master: GainNode | null = null; private crowdGain: GainNode | null = null; private noise: AudioBuffer | null = null;
  enabled = (() => { try { return localStorage.getItem('jev-arena-sound') !== 'off'; } catch { return true; } })();

  /** Browsers only allow audio after a user gesture, so this is called from the first click. */
  unlock() {
    if (this.ctx || typeof AudioContext === 'undefined') { void this.ctx?.resume(); return; }
    this.ctx = new AudioContext(); this.master = this.ctx.createGain(); this.master.gain.value = this.enabled ? 0.55 : 0; this.master.connect(this.ctx.destination);
    const length = this.ctx.sampleRate * 2; this.noise = this.ctx.createBuffer(1, length, this.ctx.sampleRate);
    const data = this.noise.getChannelData(0); let last = 0;
    for (let i = 0; i < length; i++) { const white = Math.random() * 2 - 1; last = (last + 0.04 * white) / 1.04; data[i] = last * 6; } // brown-ish noise
    const crowd = this.ctx.createBufferSource(); crowd.buffer = this.noise; crowd.loop = true;
    const filter = this.ctx.createBiquadFilter(); filter.type = 'bandpass'; filter.frequency.value = 520; filter.Q.value = 0.4;
    this.crowdGain = this.ctx.createGain(); this.crowdGain.gain.value = 0.05; crowd.connect(filter).connect(this.crowdGain).connect(this.master); crowd.start();
  }
  setEnabled(on: boolean) {
    this.enabled = on; try { localStorage.setItem('jev-arena-sound', on ? 'on' : 'off'); } catch { /* storage may be blocked */ }
    if (this.ctx && this.master) this.master.gain.setTargetAtTime(on ? 0.55 : 0, this.ctx.currentTime, 0.05);
  }
  /** Crowd excitement from 0 (murmur) to 1 (roar). */
  crowd(level: number) { if (this.ctx && this.crowdGain) this.crowdGain.gain.setTargetAtTime(0.04 + level * 0.22, this.ctx.currentTime, 0.25); }

  private burst(duration: number, frequency: number, gain: number, type: BiquadFilterType = 'lowpass', sweepTo?: number) {
    if (!this.ctx || !this.master || !this.noise) return;
    const t = this.ctx.currentTime, src = this.ctx.createBufferSource(); src.buffer = this.noise; src.playbackRate.value = 1 + Math.random() * 0.3;
    const filter = this.ctx.createBiquadFilter(); filter.type = type; filter.frequency.setValueAtTime(frequency, t); if (sweepTo) filter.frequency.exponentialRampToValueAtTime(sweepTo, t + duration);
    const env = this.ctx.createGain(); env.gain.setValueAtTime(gain, t); env.gain.exponentialRampToValueAtTime(0.0005, t + duration);
    src.connect(filter).connect(env).connect(this.master); src.start(t, Math.random()); src.stop(t + duration + 0.05);
  }
  private tone(frequency: number, duration: number, gain: number, type: OscillatorType = 'sine', glideTo?: number) {
    if (!this.ctx || !this.master) return;
    const t = this.ctx.currentTime, osc = this.ctx.createOscillator(), env = this.ctx.createGain();
    osc.type = type; osc.frequency.setValueAtTime(frequency, t); if (glideTo) osc.frequency.exponentialRampToValueAtTime(glideTo, t + duration);
    env.gain.setValueAtTime(gain, t); env.gain.exponentialRampToValueAtTime(0.0005, t + duration);
    osc.connect(env).connect(this.master); osc.start(t); osc.stop(t + duration + 0.05);
  }
  play(cue: Cue) {
    if (!this.enabled || !this.ctx) return;
    switch (cue) {
      case 'whoosh': this.burst(0.16, 900, 0.18, 'bandpass', 2600); break;
      case 'hit': this.burst(0.12, 1400, 0.7); this.tone(120, 0.16, 0.5, 'sine', 55); break;
      case 'heavy': this.burst(0.28, 1100, 1); this.tone(90, 0.34, 0.85, 'sine', 38); this.tone(180, 0.12, 0.3, 'square', 70); break;
      case 'block': this.burst(0.1, 2400, 0.45, 'highpass'); this.tone(220, 0.1, 0.25, 'triangle', 140); break;
      case 'knockdown': this.tone(70, 0.6, 0.9, 'sine', 30); this.burst(0.5, 500, 0.8); break;
      case 'count': this.tone(660, 0.14, 0.25, 'square'); break;
      case 'bell': for (let i = 0; i < 2; i++) window.setTimeout(() => { this.tone(880, 1.3, 0.45, 'sine'); this.tone(1760, 0.9, 0.2, 'sine'); this.tone(2640, 0.5, 0.1, 'sine'); }, i * 260); break;
      case 'finish': for (let i = 0; i < 3; i++) window.setTimeout(() => { this.tone(880, 1.3, 0.5, 'sine'); this.tone(1760, 0.9, 0.22, 'sine'); }, i * 300); break;
    }
  }
}
export const sfx = new Sfx();
export type { Cue };
