// 진입점. 이름 입력 화면을 먼저 띄우고, 그동안 three.js와 Rapier(wasm)를 받는다.
import './ui/style.css';
import { STEPS_PER_SEC, type QualityName } from './config';
import type { Game } from './game';
import type { Race } from './race/race';
import { parseSeed, seedToHex } from './rng';
import { marbleColor, parseNames } from './ui/names';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const names = $<HTMLTextAreaElement>('names');
const winnersInput = $<HTMLInputElement>('winners');
const mapSelect = $<HTMLSelectElement>('map');
const qualitySelect = $<HTMLSelectElement>('quality');
const skillsBox = $<HTMLInputElement>('skills');
const startButton = $<HTMLButtonElement>('start');
const panel = $<HTMLFormElement>('panel');
const rank = $('rank');
const banner = $('banner');
const message = $('message');
const winRadio = () => panel.querySelector<HTMLInputElement>('input[name=win]:checked')!;

// 시드를 새로 고르는 것은 경주 밖의 일이라 rng.ts를 쓰지 않는다. 경주 안의 난수는 전부 이 시드에서 나온다.
const randomSeed = () => crypto.getRandomValues(new Uint32Array(1))[0];

// ---- URL ↔ 상태. 같은 빌드에서 같은 링크는 같은 경주를 재생한다. ----
const url = new URLSearchParams(location.search);
let seed = parseSeed(url.get('seed')) ?? randomSeed();
names.value = url.get('names') ?? '수박*2, 키위*2, 참외';
if (url.get('win') === 'last') panel.querySelector<HTMLInputElement>('input[value=last]')!.checked = true;
winnersInput.value = String(Math.max(1, +(url.get('n') ?? 1) || 1));
skillsBox.checked = url.get('skills') === '1';
if (url.get('q') === 'low' || url.get('q') === 'high') qualitySelect.value = url.get('q')!;
let mapId = url.get('map') ?? 'wood-v1';

function syncUrl() {
  const p = new URLSearchParams({ seed: seedToHex(seed), names: names.value, win: winRadio().value, n: winnersInput.value, map: mapId });
  if (skillsBox.checked) p.set('skills', '1');
  if (qualitySelect.value !== 'normal') p.set('q', qualitySelect.value);
  history.replaceState(null, '', `?${p}`);
  $('seed').textContent = seedToHex(seed);
}

// ---- 게임 ----
let game: Game | undefined;
let mapJson: unknown;
let entries = parseNames(names.value);
let announced = false;

function prepare() {
  entries = parseNames(names.value);
  $('count').textContent = `구슬 ${entries.length}개 (최대 30개)`;
  syncUrl();
  const ok = entries.length >= 2;
  message.textContent = ok ? '' : '이름을 두 개 이상 넣어 주세요.';
  if (!game) return;
  startButton.disabled = !ok;
  if (!ok) return;
  announced = false;
  banner.hidden = true;
  game.prepare(entries, seed, skillsBox.checked, entries.map((_, i) => marbleColor(i)));
  drawRank(game.race!);
}

async function loadMap(id: string) {
  const res = await fetch(`maps/${encodeURIComponent(id)}.json`);
  if (!res.ok) throw new Error(`맵 "${id}"을(를) 찾을 수 없습니다.`);
  mapJson = await res.json();
  game!.loadMap(mapJson);
  mapId = id;
}

/** 입력 패널이 덮은 영역을 피해 장면 중심을 옮긴다. */
function layout() {
  if (!game) return;
  const r = panel.getBoundingClientRect();
  if (panel.hidden) game.scene.setViewShift(0, 0);
  else if (r.width > innerWidth * 0.7) game.scene.setViewShift(0, -r.height / 2);
  else game.scene.setViewShift(-(innerWidth - r.left) / 2, 0);
}
addEventListener('resize', layout);

const winCount = () => Math.min(entries.length, Math.max(1, Math.floor(+winnersInput.value) || 1));

function drawRank(race: Race) {
  const order = race.ranking();
  const winners = race.winners(winRadio().value as 'first' | 'last', winCount());
  while (rank.children.length > order.length) rank.lastChild!.remove();
  order.forEach((m, k) => {
    const li = (rank.children[k] ?? rank.appendChild(document.createElement('li'))) as HTMLElement;
    const t = race.finishTime[m];
    li.className = winners?.includes(m) ? 'win' : '';
    li.innerHTML = `<b>${k + 1}</b><i style="background:${marbleColor(m)}"></i><span></span><time>${Number.isNaN(t) ? '' : (t / STEPS_PER_SEC).toFixed(2) + '초'}</time>`;
    li.querySelector('span')!.textContent = entries[m].name; // 이름은 사용자 입력이므로 textContent로만 넣는다
  });
  if (winners && !announced) {
    announced = true;
    banner.textContent = `🎉 당첨: ${winners.map((m) => entries[m].name).join(', ')}`;
    banner.hidden = false;
  }
  if (race.done) $('again').hidden = false;
}

async function boot() {
  syncUrl();
  $('count').textContent = `구슬 ${entries.length}개 (최대 30개)`;
  try {
    const [{ Game }, maps] = await Promise.all([import('./game'), fetch('maps/index.json').then((r) => r.json())]);
    for (const m of maps as { id: string; name: string }[]) mapSelect.add(new Option(m.name, m.id));
    game = new Game($<HTMLCanvasElement>('view'), $('labels'));
    if (import.meta.env.DEV) Object.assign(window, { game }); // 개발 중 콘솔에서 들여다보기 위한 것
    game.setQuality(qualitySelect.value as QualityName);
    await loadMap(mapId).catch(() => loadMap('wood-v1'));
    mapSelect.value = mapId;
    let lastDraw = 0;
    game.onFrame = (race) => {
      const now = performance.now(); // 화면 갱신 주기용. 경주 시간은 스텝 번호로 센다.
      if (race.started && now - lastDraw > 200) {
        lastDraw = now;
        drawRank(race);
      }
    };
    startButton.textContent = '시작';
    // 브라우저가 새로 고침 때 입력란을 예전 값으로 되돌려 놓을 수 있다. 링크에 이름이 있으면 링크가 이긴다.
    if (url.has('names')) names.value = url.get('names')!;
    prepare();
    layout();
  } catch (e) {
    message.textContent = `불러오지 못했습니다: ${(e as Error).message}`;
  }
}

// ---- 이벤트 ----
let debounce = 0;
names.addEventListener('input', () => {
  clearTimeout(debounce);
  debounce = window.setTimeout(prepare, 250);
});
for (const el of [winnersInput, ...panel.querySelectorAll<HTMLInputElement>('input[name=win]')]) el.addEventListener('change', syncUrl);
skillsBox.addEventListener('change', prepare);
qualitySelect.addEventListener('change', () => {
  game?.setQuality(qualitySelect.value as QualityName);
  prepare();
});
mapSelect.addEventListener('change', async () => {
  try {
    await loadMap(mapSelect.value);
    prepare();
  } catch (e) {
    message.textContent = (e as Error).message;
  }
});
$('shuffle').addEventListener('click', () => {
  seed = randomSeed();
  prepare();
});
panel.addEventListener('submit', (e) => {
  e.preventDefault();
  if (!game?.race || entries.length < 2) return;
  panel.hidden = true;
  $('hud').hidden = false;
  $('again').hidden = true;
  layout();
  game.start();
});
$('again').addEventListener('click', () => {
  seed = randomSeed();
  panel.hidden = false;
  $('hud').hidden = true;
  rank.replaceChildren();
  prepare();
  layout();
});
$('share').addEventListener('click', async () => {
  syncUrl();
  try {
    await navigator.clipboard.writeText(location.href);
    $('share').textContent = '복사됨';
  } catch {
    prompt('이 링크를 복사하세요', location.href);
  }
  setTimeout(() => ($('share').textContent = '링크 복사'), 1500);
});

// 녹화와 맵 편집은 누를 때 불러온다
const recordButton = $<HTMLButtonElement>('record');
recordButton.hidden = !('MediaRecorder' in window && 'captureStream' in HTMLCanvasElement.prototype);
recordButton.addEventListener('click', async () => (await import('./ui/record')).toggleRecording($<HTMLCanvasElement>('view'), recordButton));
$('edit').addEventListener('click', async () =>
  (await import('./ui/editor')).openEditor(mapJson, (json) => {
    game!.loadMap(json); // 형식이 틀리면 던진다 → 편집기가 오류를 보여 준다
    mapJson = json;
    prepare();
  }),
);

boot();
