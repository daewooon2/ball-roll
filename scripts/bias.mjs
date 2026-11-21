// 디버그용: 슬롯별로 중심선 체크포인트 통과 시각(초) 평균과 최종 평균 순위를 찍는다. node scripts/bias.mjs [시드 수] [맵]
import fs from 'node:fs';
import { createServer } from 'vite';
const server = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'error' });
try {
  const { buildMap } = await server.ssrLoadModule('/src/map/build.ts');
  const { validateMap } = await server.ssrLoadModule('/src/map/schema.ts');
  const { Race } = await server.ssrLoadModule('/src/race/race.ts');
  const map = buildMap(validateMap(JSON.parse(fs.readFileSync(`public/maps/${process.argv[3] ?? 'wood-v1'}.json`, 'utf8'))));
  const marks = [...map.marks.slice(1), map.startY - map.finishY];
  const N = +(process.argv[2] ?? 100), n = 5;
  const sum = Array.from({ length: n }, () => new Array(marks.length).fill(0));
  const rank = new Array(n).fill(0), wins = new Array(n).fill(0);
  for (let s = 1; s <= N; s++) {
    const race = new Race(map, { seed: Math.imul(s, 0x9e3779b1) >>> 0, entries: Array.from({ length: n }, (_, i) => ({ name: 'm' + i, weight: 1 })) });
    const next = new Array(n).fill(0);
    race.start();
    while (!race.done) {
      race.tick();
      for (let i = 0; i < n; i++)
        while (next[i] < marks.length && (race.progress[i] >= marks[next[i]] || !Number.isNaN(race.finishTime[i]))) sum[race.slot[i]][next[i]++] += race.step / 240;
    }
    race.finishOrder.forEach((m, k) => { rank[race.slot[m]] += k + 1; if (k === 0) wins[race.slot[m]]++; });
    race.free();
  }
  console.log('marks(m):', marks.map((m) => (m / 10).toFixed(2)).join(' '));
  for (let k = 0; k < n; k++) console.log(`slot ${k}: wins ${wins[k]} rank ${(rank[k] / N).toFixed(2)} | ` + sum[k].map((t) => (t / N).toFixed(2)).join(' '));
} finally { await server.close(); }
