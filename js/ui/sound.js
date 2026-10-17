let context;
let enabled = true;

export function setSoundEnabled(value) { enabled = value; }

// Resume synchronously from a real gesture, before any IndexedDB/network await.
export function unlockSound() {
  if (!enabled) return;
  try {
    const Audio = window.AudioContext || window.webkitAudioContext;
    if (!Audio) return;
    context ??= new Audio();
    if (context.state === 'suspended') context.resume().catch(() => {});
  } catch { /* Recording works even when audio is unavailable. */ }
}

export function playSound(kind) {
  if (!enabled || context?.state !== 'running') return;
  const notes = {
    tap: [440], tile: [523, 659], level: [523, 659, 784], complete: [523, 659, 784, 1047]
  }[kind] ?? [];
  try {
    notes.forEach((frequency, index) => {
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      const start = context.currentTime + index * .085;
      oscillator.type = 'sine';
      oscillator.frequency.value = frequency;
      gain.gain.setValueAtTime(0, start);
      gain.gain.linearRampToValueAtTime(.045, start + .008);
      gain.gain.exponentialRampToValueAtTime(.001, start + .09);
      oscillator.connect(gain);
      gain.connect(context.destination);
      oscillator.start(start);
      oscillator.stop(start + .1);
      oscillator.onended = () => { oscillator.disconnect(); gain.disconnect(); };
    });
  } catch { /* A suspended audio device must never interrupt saving. */ }
}

export function initSound() {
  document.addEventListener('pointerdown', unlockSound, { capture: true, passive: true });
  document.addEventListener('keydown', event => {
    if (event.key === 'Enter' || event.key === ' ') unlockSound();
  }, true);
  document.addEventListener('click', event => {
    if (event.target.closest('button:not(:disabled), summary')) playSound('tap');
  }, true);
}
