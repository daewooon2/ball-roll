// 화면 없이 여러 시드를 돌려 공정성과 경주 시간을 잰다. `npm run sim -- --seeds 1000`
import { STEPS_PER_SEC, WORLD_SCALE } from '../config';
import { buildMap } from '../map/build';
import { validateMap } from '../map/schema';
import { Race } from '../race/race';

/** 시드 묶음 하나의 원자료. 묶음끼리 이어 붙일 수 있다. */
export interface SimBatch {
  slotWins: number[];
  /** 마지막 구슬이 들어올 때까지 걸린 시간(초) */
  raceSec: number[];
  /** 1등이 들어올 때까지 걸린 시간(초) */
  firstSec: number[];
  unfinished: number;
  /** 끼임 임펄스·코스 이탈 복귀·미완주가 일어난 지점(m, 중심선 누적 길이) */
  kickAt: number[];
  resetAt: number[];
  stuckAt: number[];
  /** 중심선 꼭짓점들의 누적 길이(m). 위 지점이 어느 구간인지 볼 때 쓴다. */
  marks: number[];
}

export function simulate(mapJson: unknown, seeds: number, marbles = 5, firstSeed = 1): SimBatch {
  const map = buildMap(validateMap(mapJson));
  const entries = Array.from({ length: marbles }, (_, i) => ({ name: `m${i}`, weight: 1 }));
  const out: SimBatch = {
    slotWins: new Array(Math.min(marbles, 5)).fill(0),
    raceSec: [],
    firstSec: [],
    unfinished: 0,
    kickAt: [],
    resetAt: [],
    stuckAt: [],
    marks: map.cumulative.map((s) => s / WORLD_SCALE),
  };
  for (let s = 0; s < seeds; s++) {
    // 시드를 흩어 놓는다(연속 정수 시드끼리의 상관을 피함)
    const race = new Race(map, { seed: Math.imul(firstSeed + s, 0x9e3779b1) >>> 0, entries });
    race.start();
    while (!race.done) race.tick();
    out.raceSec.push(race.step / STEPS_PER_SEC);
    out.kickAt.push(...race.kickAt.map((v) => v / WORLD_SCALE));
    out.resetAt.push(...race.resetAt.map((v) => v / WORLD_SCALE));
    for (let i = 0; i < marbles; i++)
      if (Number.isNaN(race.finishTime[i])) {
        out.unfinished++;
        out.stuckAt.push(race.progress[i] / WORLD_SCALE);
      }
    if (race.finishOrder.length) {
      const winner = race.finishOrder[0];
      out.slotWins[race.slot[winner] % out.slotWins.length]++;
      out.firstSec.push(race.finishTime[winner] / STEPS_PER_SEC);
    }
    race.free();
  }
  return out;
}

export function merge(batches: SimBatch[]): SimBatch {
  const out = { ...batches[0], slotWins: batches[0].slotWins.map(() => 0), raceSec: [], firstSec: [], unfinished: 0, kickAt: [], resetAt: [], stuckAt: [] } as SimBatch;
  for (const b of batches) {
    b.slotWins.forEach((w, i) => (out.slotWins[i] += w));
    out.unfinished += b.unfinished;
    for (const k of ['raceSec', 'firstSec', 'kickAt', 'resetAt', 'stuckAt'] as const) out[k].push(...b[k]);
  }
  return out;
}

export const median = (a: number[]) => {
  const s = a.slice().sort((x, y) => x - y);
  return s.length ? (s[(s.length - 1) >> 1] + s[s.length >> 1]) / 2 : NaN;
};

/** 슬롯별 우승 횟수가 균등한지: χ² = Σ (O − E)² / E */
export function chiSquare(observed: number[]) {
  const expected = observed.reduce((a, b) => a + b, 0) / observed.length;
  return observed.reduce((sum, o) => sum + (o - expected) ** 2 / expected, 0);
}

/** 지점들을 중심선 구간별로 센다. "구간번호:횟수" */
export function bySegment(points: number[], marks: number[]) {
  const counts = new Map<number, number>();
  for (const p of points) {
    let seg = marks.findIndex((m) => m > p + 1e-6);
    seg = seg < 0 ? marks.length - 1 : seg;
    counts.set(seg, (counts.get(seg) ?? 0) + 1);
  }
  return [...counts].sort((a, b) => a[0] - b[0]).map(([seg, c]) => `${seg}:${c}`).join(' ') || '-';
}
