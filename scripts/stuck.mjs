// 디버그용: 미완주가 나온 시드와 그 구슬의 마지막 위치(m)를 찍는다. node scripts/stuck.mjs [시드 수] [맵] [구슬 수]
import fs from 'node:fs';
import { createServer } from 'vite';
const server = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'error' });
try {
  const { buildMap } = await server.ssrLoadModule('/src/map/build.ts');
  const { validateMap } = await server.ssrLoadModule('/src/map/schema.ts');
  const { Race } = await server.ssrLoadModule('/src/race/race.ts');
  const map = buildMap(validateMap(JSON.parse(fs.readFileSync(`public/maps/${process.argv[3] ?? 'wood-v1'}.json`, 'utf8'))));
  const n = +(process.argv[4] ?? 5);
  for (let s = 1; s <= +(process.argv[2] ?? 30); s++) {
    const seed = Math.imul(s, 0x9e3779b1) >>> 0;
    const race = new Race(map, { seed, entries: Array.from({ length: n }, (_, i) => ({ name: 'm' + i, weight: 1 })) });
    race.start();
    while (!race.done) race.tick();
    for (let i = 0; i < n; i++) if (Number.isNaN(race.finishTime[i]))
      console.log('seed', seed, 'marble', i, 'pos', [0, 1, 2].map((k) => (race.pos[i * 3 + k] / 10).toFixed(4)).join(','), 's', (race.progress[i] / 10).toFixed(3), 'kicks', race.kicks);
    race.free();
  }
} finally { await server.close(); }
