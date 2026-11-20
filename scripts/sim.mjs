// npm run sim -- --seeds 1000 [--marbles 5] [--map wood-v1] [--first 1] [--jobs N]
// Vite의 SSR 로더로 src/sim/headless.ts를 Node에서 실행한다. 시드를 프로세스 여러 개에 나눠 돌린다.
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : fallback;
};
const seeds = +arg('seeds', 100);
const marbles = +arg('marbles', 5);
const mapId = arg('map', 'wood-v1');
const first = +arg('first', 1);
const jobs = Math.min(seeds, +arg('jobs', Math.max(1, os.cpus().length - 1)));

const server = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'error' });
try {
  const sim = await server.ssrLoadModule('/src/sim/headless.ts');
  if (process.argv.includes('--child')) {
    const batch = sim.simulate(JSON.parse(fs.readFileSync(`public/maps/${mapId}.json`, 'utf8')), seeds, marbles, first);
    process.stdout.write(JSON.stringify(batch));
  } else {
    const t0 = Date.now();
    const per = Math.ceil(seeds / jobs);
    const batches = await Promise.all(
      Array.from({ length: jobs }, (_, j) => {
        const count = Math.min(per, seeds - j * per);
        if (count <= 0) return null;
        const args = [fileURLToPath(import.meta.url), '--child', '--seeds', count, '--first', first + j * per, '--marbles', marbles, '--map', mapId];
        return new Promise((resolve, reject) =>
          execFile(process.execPath, args.map(String), { maxBuffer: 1 << 28 }, (err, out) => (err ? reject(err) : resolve(JSON.parse(out)))),
        );
      }).filter(Boolean),
    );
    const r = sim.merge(batches);
    console.log(`맵 ${mapId}, 시드 ${seeds}개, 구슬 ${marbles}개 (${((Date.now() - t0) / 1000).toFixed(1)}초 소요, 프로세스 ${batches.length}개)`);
    console.log(`슬롯별 우승: ${r.slotWins.join(' ')}`);
    console.log(`카이제곱: ${sim.chiSquare(r.slotWins).toFixed(2)} (구슬 5개 기준 임계값 9.49)`);
    console.log(`경주 시간 중앙값: ${sim.median(r.raceSec).toFixed(1)}초 (최소 ${Math.min(...r.raceSec).toFixed(1)}, 최대 ${Math.max(...r.raceSec).toFixed(1)}), 1등 도착 중앙값 ${sim.median(r.firstSec).toFixed(1)}초`);
    console.log(`미완주: ${r.unfinished}개, 끼임 임펄스: ${r.kickAt.length}회, 코스 이탈 복귀: ${r.resetAt.length}회`);
    console.log(`구간별(중심선 구간 번호:횟수) 미완주 ${sim.bySegment(r.stuckAt, r.marks)} | 임펄스 ${sim.bySegment(r.kickAt, r.marks)} | 복귀 ${sim.bySegment(r.resetAt, r.marks)}`);
  }
} finally {
  await server.close();
}
