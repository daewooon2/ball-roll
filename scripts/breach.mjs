// 결승에서 구슬이 벽을 뚫는 횟수를 센다: 깔때기 벽이 아직 있는데(정리 전) 깔때기 아래 바깥 공간에 구슬이 있으면 뚫린 것.
// node scripts/breach.mjs [시드 수] [구슬 수]
import fs from 'node:fs';
import { createServer } from 'vite';
const server = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'error' });
try {
  const { buildMap } = await server.ssrLoadModule('/src/map/build.ts');
  const { validateMap } = await server.ssrLoadModule('/src/map/schema.ts');
  const { Race } = await server.ssrLoadModule('/src/race/race.ts');
  const json = JSON.parse(fs.readFileSync('public/maps/wood-v1.json', 'utf8'));
  const map = buildMap(validateMap(json));
  // 깔때기 벽(trap) 두 장: 높이는 x의 일차식
  const walls = json.pieces.filter((p) => p.trap).map((p) => ({ a: p.a.map((v) => v * 10), b: p.b.map((v) => v * 10) }));
  const neck = Math.min(...walls.map((w) => Math.abs(w.b[0])));
  const wallY = (x) => {
    const w = walls.find((k) => Math.sign(k.a[0]) === Math.sign(x)) ?? walls[0];
    return w.b[1] + ((Math.abs(x) - neck) / (Math.abs(w.a[0]) - neck)) * (w.a[1] - w.b[1]);
  };
  const N = +(process.argv[2] ?? 100), n = +(process.argv[3] ?? 5);
  let breaches = 0, races = 0, resets = 0;
  for (let s = 1; s <= N; s++) {
    const race = new Race(map, { seed: Math.imul(s, 0x9e3779b1) >>> 0, entries: Array.from({ length: n }, (_, i) => ({ name: 'm' + i, weight: 1 })) });
    race.start();
    const out = new Set();
    while (!race.done && !race.draining) {
      race.tick();
      for (let i = 0; i < n; i++) {
        const x = race.pos[i * 3], y = race.pos[i * 3 + 1];
        if (Number.isNaN(race.finishTime[i]) && Math.abs(x) > neck + 0.12 && y < wallY(x) - 0.2 && y > map.finishY && !out.has(i)) { out.add(i); if (process.env.WHERE) console.log("breach", (x / 10).toFixed(3), ((y - map.finishY) / 10).toFixed(3), "prev", (race.prevPos[i * 3] / 10).toFixed(3), ((race.prevPos[i * 3 + 1] - map.finishY) / 10).toFixed(3)); }
      }
    }
    breaches += out.size;
    if (out.size) races++;
    resets += race.resets;
    race.free();
  }
  console.log(`구슬 ${n}개, ${N}판: 벽을 뚫은 구슬 ${breaches}개 (${races}판), 판 밖으로 나간 횟수 ${resets}`);
} finally { await server.close(); }
