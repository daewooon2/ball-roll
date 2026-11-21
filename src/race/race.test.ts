import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildMap, moverPose } from '../map/build';
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
    expect(() => validateMap({ ...json, pieces: [{ type: 'wall' }] })).toThrow(/pieces\[0\]/);
    expect(() => validateMap({ ...json, units: 'cm' })).toThrow();
    expect(() => validateMap({ ...json, finishY: 1 })).toThrow();
  });

  it('구슬 30개도 출발 칸 안에 겹치지 않게 선다', () => {
    const map = buildMap(validateMap(json));
    const d = map.marble.radius * 2;
    const at = Array.from({ length: 30 }, (_, k) => map.slotPosition(k, 30, k % 2 ? 1 : -1));
    for (const [x, y] of at) expect(Math.abs(x) <= map.halfWidth - d / 2 && y < map.top - d / 2).toBe(true);
    at.forEach((a, i) => at.slice(i + 1).forEach((b) => expect(Math.hypot(a[0] - b[0], a[1] - b[1])).toBeGreaterThanOrEqual(d)));
  });
});

describe('확장 기능', () => {
  const run2 = () => {
    const race = new Race(buildMap(validateMap(json)), {
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

  it('가중치, 스킬, 여러 명 당첨이 같은 시드에서 재현된다', () => {
    const a = run2();
    expect(run2()).toEqual(a);
    expect(a.order).toHaveLength(3);
    expect(a.boosts).toBeGreaterThan(0);
    expect(a.first).toEqual(a.order.slice(0, 2));
    expect(a.last).toEqual([a.order[2], a.order[1]]);
  });
});

describe('움직이는 장애물', () => {
  it('자세가 스텝 번호만으로 정해지고 주기적으로 되돌아온다', () => {
    const map = buildMap(validateMap(json));
    const slider = map.movers.find((m) => m.slide)!;
    const spinner = map.movers.find((m) => m.spin)!;
    const pose = (m: typeof slider, step: number) => {
      const pos = [0, 0, 0];
      const rot = [0, 0, 0, 0];
      moverPose(m, step, pos, rot, 0);
      return [...pos, ...rot];
    };
    const near = (a: number[], b: number[]) => a.every((v, i) => Math.abs(v - b[i]) < 1e-6);
    expect(near(pose(slider, 0), pose(slider, slider.slide!.period))).toBe(true);
    expect(near(pose(slider, 0), pose(slider, slider.slide!.period / 4))).toBe(false);
    expect(near(pose(spinner, 0), pose(spinner, 1))).toBe(false);
  });
});
