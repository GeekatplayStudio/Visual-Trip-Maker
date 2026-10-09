import { TransportMode } from '../types';

class AudioEngine {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private engineOsc: OscillatorNode | null = null;
  private engineGain: GainNode | null = null;
  private isMuted: boolean = false;
  private volume: number = 0.5;
  private currentMode: TransportMode | null = null;

  private initContext() {
    if (!this.ctx) {
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.ctx = new AudioCtx();
      this.masterGain = this.ctx.createGain();
      this.masterGain.gain.setValueAtTime(this.volume, this.ctx.currentTime);
      this.masterGain.connect(this.ctx.destination);
    }

    if (this.ctx.state === 'suspended') {
      this.ctx.resume();
    }
  }

  public setMute(muted: boolean) {
    this.isMuted = muted;
    if (this.masterGain && this.ctx) {
      this.masterGain.gain.setValueAtTime(muted ? 0 : this.volume, this.ctx.currentTime);
    }
  }

  public setVolume(vol: number) {
    this.volume = Math.max(0, Math.min(1, vol));
    if (this.masterGain && this.ctx && !this.isMuted) {
      this.masterGain.gain.setValueAtTime(this.volume, this.ctx.currentTime);
    }
  }

  public playWaypointChime() {
    if (this.isMuted) return;
    try {
      this.initContext();
      if (!this.ctx || !this.masterGain) return;

      const now = this.ctx.currentTime;
      const chimeGain = this.ctx.createGain();
      chimeGain.gain.setValueAtTime(0.35, now);
      chimeGain.gain.exponentialRampToValueAtTime(0.0001, now + 1.6);
      chimeGain.connect(this.masterGain);

      // Harmonious harp chords: C5, E5, G5, B5, C6
      const freqs = [523.25, 659.25, 783.99, 987.77, 1046.5];
      freqs.forEach((freq, idx) => {
        const osc = this.ctx!.createOscillator();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq, now + idx * 0.06);
        osc.connect(chimeGain);
        osc.start(now + idx * 0.06);
        osc.stop(now + 1.8);
      });
    } catch {
      // Audio autoplay policy fallback
    }
  }

  public playCameraShutter() {
    if (this.isMuted) return;
    try {
      this.initContext();
      if (!this.ctx || !this.masterGain) return;

      const now = this.ctx.currentTime;
      const clickOsc = this.ctx.createOscillator();
      const clickGain = this.ctx.createGain();

      clickOsc.type = 'triangle';
      clickOsc.frequency.setValueAtTime(2200, now);
      clickOsc.frequency.exponentialRampToValueAtTime(80, now + 0.08);

      clickGain.gain.setValueAtTime(0.4, now);
      clickGain.gain.exponentialRampToValueAtTime(0.001, now + 0.09);

      clickOsc.connect(clickGain);
      clickGain.connect(this.masterGain);

      clickOsc.start(now);
      clickOsc.stop(now + 0.1);
    } catch {
      // Fallback
    }
  }

  public updateEngineSound(mode: TransportMode, isPlaying: boolean, speedKmh: number) {
    if (this.isMuted || !isPlaying) {
      this.stopEngineSound();
      return;
    }

    try {
      this.initContext();
      if (!this.ctx || !this.masterGain) return;

      if (!this.engineOsc || this.currentMode !== mode) {
        this.stopEngineSound();
        this.currentMode = mode;

        this.engineOsc = this.ctx.createOscillator();
        this.engineGain = this.ctx.createGain();
        this.engineGain.gain.setValueAtTime(0.05, this.ctx.currentTime);

        switch (mode) {
          case 'airplane':
          case 'propeller':
            this.engineOsc.type = 'sawtooth';
            this.engineOsc.frequency.setValueAtTime(90, this.ctx.currentTime);
            break;
          case 'sports_car':
          case 'motorcycle':
            this.engineOsc.type = 'triangle';
            this.engineOsc.frequency.setValueAtTime(65, this.ctx.currentTime);
            break;
          case 'bullet_train':
          case 'steam_train':
            this.engineOsc.type = 'sine';
            this.engineOsc.frequency.setValueAtTime(50, this.ctx.currentTime);
            break;
          default:
            this.engineOsc.type = 'sine';
            this.engineOsc.frequency.setValueAtTime(40, this.ctx.currentTime);
            break;
        }

        this.engineOsc.connect(this.engineGain);
        this.engineGain.connect(this.masterGain);
        this.engineOsc.start();
      }

      // Modulate pitch with vehicle speed
      if (this.engineOsc) {
        const baseFreq = mode === 'airplane' ? 90 : mode === 'sports_car' ? 65 : 45;
        const targetFreq = baseFreq + Math.min(100, speedKmh * 0.2);
        this.engineOsc.frequency.setTargetAtTime(targetFreq, this.ctx.currentTime, 0.2);
      }
    } catch {
      // Audio not yet unlocked by user interaction
    }
  }

  public stopEngineSound() {
    if (this.engineOsc) {
      try {
        this.engineOsc.stop();
        this.engineOsc.disconnect();
      } catch {
        // Ignored
      }
      this.engineOsc = null;
      this.engineGain = null;
      this.currentMode = null;
    }
  }
}

export const audioEngine = new AudioEngine();
