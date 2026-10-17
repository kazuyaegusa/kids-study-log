import { localDateKey, completedPokemon, streakInfo } from '../core.js';
import { $, create } from './dom.js';
import { objectURL } from '../images.js';

export function pokemonPortrait(artwork, url, completed, className = '') {
  const image = create('img', `partner-image${completed ? '' : ' silhouette'} ${className}`);
  image.src = url;
  image.alt = completed ? artwork.pokemonName : '相棒の影。名前は？？？';
  return image;
}

export function renderCompanion(entries, artwork, months, settings, imageURLs) {
  const today = localDateKey();
  const streak = streakInfo(entries, today);
  const completed = completedPokemon(entries, months);
  const avatar = completed.find(month => month.id === settings.avatarMonth) ?? artwork;
  const avatarBox = $('#player-avatar');
  avatarBox.replaceChildren();
  if (avatar?.artType === 'pokemon') {
    avatarBox.append(pokemonPortrait(avatar, objectURL(avatar.artwork, imageURLs),
      completed.some(month => month.id === avatar.id)));
  } else avatarBox.append(create('span', '', '？'));
  const companion = $('#companion-portrait');
  companion.replaceChildren();
  if (artwork?.artType === 'pokemon') {
    companion.append(pokemonPortrait(artwork, objectURL(artwork.artwork, imageURLs),
      completed.some(month => month.id === artwork.id)));
  } else companion.append(create('span', 'unselected-partner', '？'));
  $('#companion-name').textContent = completed.some(month => month.id === artwork?.id) ? artwork.pokemonName : '？？？';
  const day = Math.floor(Date.parse(`${today}T00:00:00Z`) / 86400000);
  const lines = artwork?.artType !== 'pokemon'
    ? ['どの影が気になる？ 相棒を選ぼう！']
    : streak.recordedToday
      ? streak.current >= 3
        ? [`${streak.current}日連続！ その調子！`, `${streak.current}日連続！ 一緒に進んでいるね！`]
        : ['今日のマスが開いたね！', '今日の冒険も楽しかったね！', 'またひとつ、色が見えてきたね！']
      : streak.restarting ? ['また今日から！ 一緒に冒険しよう！']
        : ['今日も一緒に冒険しよう！', '今日はどんな発見があるかな？', '少しずつ、一緒に進もう！'];
  $('#companion-message').textContent = lines[day % lines.length];
  $('#streak-count').textContent = `${streak.current}日`;
  $('#streak-label').textContent = streak.restarting ? 'また今日から！' : '連続記録';
  const minutes = entries.filter(entry => entry.date === today).reduce((sum, entry) => sum + entry.minutes, 0);
  $('#goal-minutes').textContent = String(minutes);
  $('#goal-target').textContent = `/ ${settings.dailyGoal} 分`;
  const ring = $('#goal-ring');
  const progress = Math.min(minutes / settings.dailyGoal, 1);
  ring.classList.toggle('achieved', progress === 1);
  ring.setAttribute('aria-valuenow', String(minutes));
  ring.setAttribute('aria-valuemax', String(Math.max(minutes, settings.dailyGoal)));
  ring.setAttribute('aria-valuetext', `今日${minutes}分、目標${settings.dailyGoal}分${progress === 1 ? '、達成' : ''}`);
  $('#goal-arc').style.strokeDashoffset = String(100 * (1 - progress));
  $('#goal-caption').textContent = progress === 1 ? '目標達成！' : '今日の目標';
  return streak;
}
