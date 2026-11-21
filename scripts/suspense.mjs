// 결승 구간이 얼마나 "될 듯 말 듯"한지: 결승 방에 먼저 들어온 구슬이 1등을 놓치는 비율과, 방에 들어와 1등이 나올 때까지 걸린 시간.
// node scripts/suspense.mjs [시드 수] [구슬 수] [방 높이 m]
import fs from 'node:fs';
import { createServer } from 'vite';
const server = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'error' });
try {
  const { buildMap } = await server.ssrLoadModule('/src/map/build.ts');
  const { validateMap } = await server.ssrLoadModule('/src/map/schema.ts');
  const { Race } = await server.ssrLoadModule('/src/race/race.ts');
  const map = buildMap(validateMap(JSON.parse(fs.readFileSync('public/maps/wood-v1.json', 'utf8'))));
  const N = +(process.argv[2] ?? 100), n = +(process.argv[3] ?? 5), room = +(process.argv[4] ?? 0.25) * 10;
  let upsets = 0, falls = 0;
  const waits = [];
  for (let s = 1; s <= N; s++) {
    const race = new Race(map, { seed: Math.imul(s, 0x9e3779b1) >>> 0, entries: Array.from({ length: n }, (_, i) => ({ name: 'm' + i, weight: 1 })) });
    race.start();
    let first = -1, at = 0;
    while (!race.finishOrder.length && !race.done) {
      race.tick();
      if (first < 0) for (let i = 0; i < n; i++) if (race.pos[i * 3 + 1] - map.finishY < room) { first = i; at = race.step; break; }
    }
    if (race.finishOrder[0] !== first) upsets++;
    waits.push((race.step - at) / 240);
    falls += race.falls ? race.falls.reduce((a, b) => a + b, 0) : 0;
    race.free();
  }
  waits.sort((a, b) => a - b);
  console.log(`구슬 ${n}개, ${N}판: 방에 먼저 온 구슬이 1등을 놓친 판 ${upsets} (${((100 * upsets) / N).toFixed(0)}%), 방에서 1등까지 중앙값 ${waits[N >> 1].toFixed(1)}초 (최소 ${waits[0].toFixed(1)}, 최대 ${waits[N - 1].toFixed(1)}), 1등까지 구멍에 빠진 횟수 판당 ${(falls / N).toFixed(1)}`);
} finally { await server.close(); }
