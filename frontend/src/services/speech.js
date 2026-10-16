/**
 * speech.js — Text-To-Speech helper with server proxy and browser fallback
 */

class SpeechService {
  constructor() {
    this.currentAudio = null;
    this.enabled = true;
  }

  toggle(enabled) {
    this.enabled = enabled;
  }

  speak(text, lang = 'en') {
    if (!this.enabled || !text || !text.trim()) return;

    const trimmed = text.trim();

    // Stop ongoing speech
    if (this.currentAudio) {
      try {
        this.currentAudio.pause();
        this.currentAudio = null;
      } catch (e) {
        // ignore
      }
    }

    if (window.speechSynthesis) {
      window.speechSynthesis.cancel();
    }

    // Try server proxy first
    const audioUrl = `/api/tts?text=${encodeURIComponent(trimmed)}&lang=${lang}`;
    const audio = new Audio(audioUrl);
    this.currentAudio = audio;

    const playPromise = audio.play();
    if (playPromise !== undefined) {
      playPromise.catch((err) => {
        console.warn('[Speech] Audio element play failed, falling back to Web Speech API:', err);
        this._fallbackBrowserSpeech(trimmed, lang);
      });
    }
  }

  _fallbackBrowserSpeech(text, lang) {
    if (!window.speechSynthesis) return;

    try {
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.rate = 1.0;
      utterance.pitch = 1.0;
      utterance.lang = lang === 'hi' ? 'hi-IN' : 'en-US';
      window.speechSynthesis.speak(utterance);
    } catch (e) {
      console.error('[Speech] Browser SpeechSynthesis error:', e);
    }
  }
}

export const speechService = new SpeechService();
