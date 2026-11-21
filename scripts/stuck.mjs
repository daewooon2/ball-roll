// 디버그용: 끼임 임펄스가 일어난 자리(m)를 모아 많은 순으로 찍는다. node scripts/stuck.mjs [시드 수] [맵] [구슬 수]
import fs from 'node:fs';
import { createServer } from 'vite';
const server = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'error' });
try {
  const { buildMap } = await server.ssrLoadModule('/src/map/build.ts');
  const { validateMap } = await server.ssrLoadModule('/src/map/schema.ts');
  const { Race } = await server.ssrLoadModule('/src/race/race.ts');
  const map = buildMap(validateMap(JSON.parse(fs.readFileSync(`public/maps/${process.argv[3] ?? 'wood-v1'}.json`, 'utf8'))));
  const n = +(process.argv[4] ?? 5);
  const spots = new Map();
  for (let s = 1; s <= +(process.argv[2] ?? 30); s++) {
    const race = new Race(map, { seed: Math.imul(s, 0x9e3779b1) >>> 0, entries: Array.from({ length: n }, (_, i) => ({ name: 'm' + i, weight: 1 })) });
    race.start();
    let kicks = 0;
    while (!race.done) {
      race.tick();
      if (race.kicks > kicks) {
        kicks = race.kicks;
        // 방금 밀린 구슬 = 속도가 정확히 임펄스 크기인 구슬을 찾는 대신, 진행도가 kickAt과 같은 구슬을 찾는다
        const at = race.kickAt[race.kickAt.length - 1];
        for (let i = 0; i < n; i++) if (race.progress[i] === at) {
          const key = `${(race.pos[i * 3] / 10).toFixed(2)},${(race.pos[i * 3 + 1] / 10).toFixed(2)}`;
          spots.set(key, (spots.get(key) ?? 0) + 1);
        }
      }
    }
    race.free();
  }
  console.log([...spots].sort((a, b) => b[1] - a[1]).slice(0, 25).map(([k, c]) => `${k} ×${c}`).join('\n'));
} finally { await server.close(); }
