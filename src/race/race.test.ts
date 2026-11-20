import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildMap, projectToCenterline } from '../map/build';
import { validateMap } from '../map/schema';
import { Race } from './race';

const json = JSON.parse(fs.readFileSync('public/maps/wood-v1.json', 'utf8'));
const entries = ['수박', '수박', '키위', '키위', '참외'].map((name) => ({ name, weight: 1 }));

function run(seed: number) {
  const race = new Race(buildMap(validateMap(json)), { seed, entries });
  race.start();
  while (!race.done) race.tick();
  const result = { order: race.ranking(), times: Array.from(race.finishTime), steps: race.step, slots: race.slot };
  race.free();
  return result;
}

describe('경주', () => {
  it('같은 시드로 두 번 돌리면 순위와 도착 시각이 같다', () => {
    const a = run(0x1234abcd);
    const b = run(0x1234abcd);
    expect(b).toEqual(a);
    expect(a.times.every((t) => !Number.isNaN(t))).toBe(true); // 전원 완주
  });

  it('시드가 다르면 출발 슬롯이 달라진다', () => {
    const slots = new Set([1, 2, 3, 4, 5, 6].map((s) => run(s * 7919).slots.join()));
    expect(slots.size).toBeGreaterThan(1);
  });

  it('맵 검증: 잘못된 조각을 거부한다', () => {
    expect(() => validateMap({ ...json, pieces: [{ type: 'ramp' }] })).toThrow(/pieces\[0\]/);
    expect(() => validateMap({ ...json, units: 'cm' })).toThrow();
  });

  it('진행도는 중심선을 따라 증가한다', () => {
    const map = buildMap(validateMap(json));
    const first = map.centerline[0];
    const last = map.centerline[map.centerline.length - 1];
    expect(projectToCenterline(map, first[0], first[1], first[2]).s).toBe(0);
    expect(projectToCenterline(map, last[0], last[1], last[2]).s).toBeCloseTo(map.cumulative[map.cumulative.length - 1], 3);
  });
});

describe('확장 기능', () => {
  const short = JSON.parse(fs.readFileSync('public/maps/wood-short.json', 'utf8'));
  const run2 = () => {
    const race = new Race(buildMap(validateMap(short)), {
      seed: 77,
      skills: true,
      entries: [
        { name: '가', weight: 3 },
        { name: '나', weight: 1 },
        { name: '다', weight: 1 },
      ],
    });
    race.start();
    while (!race.done) race.tick();
    const out = { order: race.ranking(), boosts: race.events.length, first: race.winners('first', 2), last: race.winners('last', 2) };
    race.free();
    return out;
  };

  it('다른 맵 JSON, 가중치, 스킬, 여러 명 당첨이 같은 시드에서 재현된다', () => {
    const a = run2();
    expect(run2()).toEqual(a);
    expect(a.order).toHaveLength(3);
    expect(a.boosts).toBeGreaterThan(0);
    expect(a.first).toEqual(a.order.slice(0, 2));
    expect(a.last).toEqual([a.order[2], a.order[1]]);
  });
});
