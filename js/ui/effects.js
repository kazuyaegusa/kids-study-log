import { $, create } from './dom.js';
import { pokemonPortrait } from './companion.js';
import { playSound } from './sound.js';

let timer;
let frame;
let pending;
let finish;
let partnerURL;
const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

function clearCelebration() {
  clearTimeout(timer);
  if ($('#save-celebration').open) $('#save-celebration').close();
  $('#celebration-board').replaceChildren();
  $('#celebration-partner').replaceChildren();
  if (partnerURL) URL.revokeObjectURL(partnerURL);
  partnerURL = null;
  document.querySelectorAll('.just-opened').forEach(tile => tile.classList.remove('just-opened'));
}

export function closeCelebration() {
  if (!pending) return;
  clearCelebration();
  const { gainedExp, todayMinutes, streak, newBadges, goalReached } = pending;
  pending = null;
  const cards = $('#result-cards');
  cards.replaceChildren();
  const values = [
    ['✦', '獲得EXP', gainedExp, 'EXP'],
    ['◷', '今日の合計', todayMinutes, '分'],
    ['🔥', '連続記録', streak, '日']
  ];
  const counters = values.map(([icon, label, value, unit], index) => {
    const card = create('div', 'result-card');
    card.style.setProperty('--delay', `${index * 130}ms`);
    card.setAttribute('aria-label', `${label} ${value} ${unit}`);
    const number = create('span', 'result-number', reduced() ? String(value) : '0');
    number.setAttribute('aria-hidden', 'true');
    const symbol = create('span', 'result-icon', icon);
    symbol.setAttribute('aria-hidden', 'true');
    card.append(symbol, create('span', '', label), number, create('small', '', unit));
    cards.append(card);
    return { number, value, delay: index * 130 };
  });
  const badges = $('#result-badges');
  badges.replaceChildren();
  if (newBadges.length) {
    badges.append(create('h3', '', 'バッジ獲得！'));
    newBadges.forEach(badge => badges.append(create('p', 'new-badge', `${badge.icon} ${badge.name}`)));
  }
  $('#result-goal').hidden = !goalReached;
  $('#result-dialog').showModal();
  $('#continue-adventure').focus();
  if (!reduced()) {
    const start = performance.now();
    const count = now => {
      counters.forEach(({ number, value, delay }) => {
        const ratio = Math.max(0, Math.min(1, (now - start - delay) / 380));
        number.textContent = String(Math.round(value * (1 - (1 - ratio) ** 3)));
      });
      if (now - start < 650) frame = requestAnimationFrame(count);
    };
    frame = requestAnimationFrame(count);
  }
}

export function celebrate(data) {
  pending = data;
  const { gainedExp, before, after, newTile, artwork, complete, board } = data;
  const dialog = $('#save-celebration');
  const stage = $('#celebration-board');
  stage.replaceChildren();
  if (board && !complete) {
    const copy = board.cloneNode(true);
    copy.removeAttribute('id');
    copy.querySelectorAll('[id]').forEach(node => node.removeAttribute('id'));
    copy.querySelectorAll('button').forEach(tile => {
      tile.disabled = true;
      tile.tabIndex = -1;
    });
    stage.append(copy);
  }
  const partner = $('#celebration-partner');
  partner.replaceChildren();
  if (artwork?.artType === 'pokemon') {
    partnerURL = URL.createObjectURL(artwork.artwork);
    partner.append(pokemonPortrait(artwork, partnerURL, complete, complete ? 'name-reveal' : 'partner-hop'));
  }
  $('#celebration-title').textContent = complete
    ? `${artwork.pokemonName}をゲット！`
    : newTile ? '新しいマスが開いた！' : '記録できた！';
  $('#celebration-exp').textContent = `+${gainedExp} EXP`;
  const levelUp = after.level > before.level;
  $('#celebration-extra').hidden = !levelUp;
  $('#celebration-extra').textContent = levelUp ? `レベルアップ！ Lv.${after.level}` : '';
  dialog.classList.toggle('complete', complete);
  dialog.showModal();
  document.body.style.overflow = 'hidden';
  playSound(complete ? 'complete' : levelUp ? 'level' : 'tile');
  clearTimeout(timer);
  timer = setTimeout(closeCelebration, complete ? 2600 : 1600);
  return new Promise(resolve => { finish = resolve; });
}

export function initEffects() {
  const dialog = $('#save-celebration');
  dialog.addEventListener('click', closeCelebration);
  dialog.addEventListener('cancel', event => {
    event.preventDefault();
    closeCelebration();
  });
  $('#continue-adventure').addEventListener('click', () => $('#result-dialog').close());
  $('#result-dialog').addEventListener('close', () => {
    cancelAnimationFrame(frame);
    document.body.style.overflow = '';
    $('#open-record').focus();
    finish?.();
    finish = null;
  });
}
