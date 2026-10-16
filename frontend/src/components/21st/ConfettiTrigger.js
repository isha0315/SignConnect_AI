import confetti from 'canvas-confetti';

/**
 * 21st.dev inspired Confetti Celebration (Magic UI pattern)
 */
export function fireConfetti(x = 0.5, y = 0.6) {
  try {
    confetti({
      particleCount: 80,
      spread: 70,
      origin: { x, y },
      colors: ['#06b6d4', '#8b5cf6', '#10b981', '#f59e0b', '#ec4899'],
      disableForReducedMotion: true,
      scalar: 1.1,
    });
  } catch (e) {
    console.warn('[Confetti] trigger failed:', e);
  }
}

export function fireConfettiCannons() {
  try {
    const end = Date.now() + 600;
    const colors = ['#06b6d4', '#8b5cf6', '#10b981'];

    (function frame() {
      confetti({
        particleCount: 3,
        angle: 60,
        spread: 55,
        origin: { x: 0, y: 0.8 },
        colors: colors,
      });
      confetti({
        particleCount: 3,
        angle: 120,
        spread: 55,
        origin: { x: 1, y: 0.8 },
        colors: colors,
      });

      if (Date.now() < end) {
        requestAnimationFrame(frame);
      }
    })();
  } catch (e) {
    console.warn('[Confetti] cannon trigger failed:', e);
  }
}
