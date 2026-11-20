// 디버그용: node scripts/trace.mjs [seed] [초] [간격초] — 구슬 위치를 m 단위로 찍는다
import fs from 'node:fs';
import { createServer } from 'vite';
const server = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'error' });
try {
  const { buildMap } = await server.ssrLoadModule('/src/map/build.ts');
  const { validateMap } = await server.ssrLoadModule('/src/map/schema.ts');
  const { Race } = await server.ssrLoadModule('/src/race/race.ts');
  const map = buildMap(validateMap(JSON.parse(fs.readFileSync(`public/maps/${process.argv[5] ?? 'wood-v1'}.json`, 'utf8'))));
  const n = +(process.argv[6] ?? 5);
  const race = new Race(map, { seed: +(process.argv[2] ?? 1), entries: Array.from({ length: n }, (_, i) => ({ name: 'm' + i, weight: 1 })) });
  const secs = +(process.argv[3] ?? 10), every = +(process.argv[4] ?? 0.5);
  console.log('centerline(m):', map.centerline.map((p) => p.map((v) => (v / 10).toFixed(3)).join(',')).join(' | '));
  race.start();
  for (let s = 0; s <= secs * 240 && !race.done; s++) {
    if (s % Math.round(every * 240) === 0)
      console.log((s / 240).toFixed(2) + 's', Array.from({ length: Math.min(n, 5) }, (_, i) => [0, 1, 2].map((k) => (race.pos[i * 3 + k] / 10).toFixed(3)).join(',') + ` s=${(race.progress[i] / 10).toFixed(2)}`).join('  '), `fin=${race.finishOrder.length} kicks=${race.kicks} resets=${race.resets} pins=${race.pinAlive.reduce((a, b) => a + b, 0)}`);
    race.tick();
  }
  console.log('done', race.done, 'step', race.step, 'order', race.finishOrder.join(','));
} finally { await server.close(); }
