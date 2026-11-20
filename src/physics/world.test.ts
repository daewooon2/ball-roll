// 0단계 완료 기준 3가지.
import { describe, expect, it } from 'vitest';
import { DT, FLOOR_COLLIDER_THICKNESS, GRAVITY, WORLD_SCALE } from '../config';
import { makeRng, shuffle } from '../rng';
import { PhysicsWorld, type Quat } from './world';

const R = 0.008 * WORLD_SCALE;
const MAT = { friction: 0.4, restitution: 0.3 };
const marble = (w: PhysicsWorld, pos: [number, number, number]) =>
  w.addDynamic([{ shape: { kind: 'ball', radius: R }, pos: [0, 0, 0], density: 2500 }], pos);

describe('0단계 물리 검증', () => {
  it('경사판 가속도가 (5/7)·g·sinθ의 ±5% 이내', () => {
    const theta = (6 * Math.PI) / 180;
    const w = new PhysicsWorld(MAT);
    // z축 회전으로 +x 쪽이 내려가게 기울인 판. 윗면이 원점을 지난다.
    const rot: Quat = [0, 0, -Math.sin(theta / 2), Math.cos(theta / 2)];
    const h = FLOOR_COLLIDER_THICKNESS / 2;
    w.addStatic({ shape: { kind: 'box', half: [20, h, 2] }, pos: [h * Math.sin(-theta), -h * Math.cos(theta), 0], rot });
    const up = [Math.sin(theta), Math.cos(theta)];
    const b = marble(w, [-8 + up[0] * R, 8 * Math.tan(theta) + up[1] * R, 0]);
    const speedAt: number[] = [];
    for (let i = 1; i <= 240; i++) {
      w.step();
      if (i === 60 || i === 240) speedAt.push(b.speed());
    }
    const a = (speedAt[1] - speedAt[0]) / (180 * DT);
    const expected = (5 / 7) * GRAVITY * Math.sin(theta);
    expect(Math.abs(a / expected - 1)).toBeLessThan(0.05);
    w.free();
  });

  it('3 m/s로 바닥에 던져도 터널링 0회', () => {
    const w = new PhysicsWorld(MAT);
    const h = FLOOR_COLLIDER_THICKNESS / 2;
    w.addStatic({ shape: { kind: 'box', half: [500, h, 500] }, pos: [0, -h, 0] });
    const v = 3 * WORLD_SCALE;
    const bodies = [];
    // 높이와 입사각을 바꿔 가며 100개
    for (let i = 0; i < 100; i++) {
      const ang = (i % 10) * 0.15; // 수직에서 최대 1.35rad
      const b = marble(w, [(i % 10) * 4 - 20, R + 0.001 + i * 0.0037, Math.floor(i / 10) * 4 - 20]);
      b.setVelocity([0, -v * Math.cos(ang), v * Math.sin(ang)]);
      bodies.push(b);
    }
    // 터널링 = 판 아랫면보다 내려감. 한 스텝에 깊이 박혔다가 밀려 나오는 것은 통과가 아니다.
    let tunneled = 0;
    for (let i = 0; i < 480; i++) {
      w.step();
      for (const b of bodies) if (b.position()[1] < -FLOOR_COLLIDER_THICKNESS) tunneled++;
    }
    expect(tunneled).toBe(0);
    for (const b of bodies) expect(b.position()[1]).toBeGreaterThan(0);
    w.free();
  });

  // 측정 결과: 같은 평면의 cuboid 두 개를 맞대면(butt joint) 1 m/s에서 최대 9mm 튄다(Rapier 0.19.3).
  // 그래서 코스는 굴러가는 면 하나를 cuboid 하나로 만들고, 조각 사이는 낙하로만 잇는다(map/build.ts).
  // 여기서는 코스에 실제로 있는 접합, 즉 바닥판과 난간이 만나는 모서리를 검증한다.
  it('cuboid 이음새(바닥판–난간 모서리)에서 튐 0회', () => {
    const w = new PhysicsWorld(MAT);
    const h = FLOOR_COLLIDER_THICKNESS / 2;
    w.addStatic({ shape: { kind: 'box', half: [15, h, 0.75] }, pos: [15, -h, 0] });
    for (let i = 0; i < 30; i++) w.addStatic({ shape: { kind: 'box', half: [0.5, 0.15, 0.05] }, pos: [i + 0.5, 0.05, 0.8] });
    const b = marble(w, [0.3, R, 0.3]);
    b.setVelocity([10, 0, 3]); // 난간 쪽으로 비스듬히 → 난간(조각 30개)을 타고 구른다
    let maxY = 0;
    let railSteps = 0;
    for (let i = 0; i < 1500 && b.position()[0] < 29; i++) {
      w.step();
      const p = b.position();
      maxY = Math.max(maxY, p[1]);
      if (p[2] > 0.75 - R - 0.01) railSteps++;
    }
    expect(b.position()[0]).toBeGreaterThan(20);
    expect(railSteps).toBeGreaterThan(5); // 실제로 난간에 닿았는지
    expect(maxY - R).toBeLessThan(R * 0.02);
    w.free();
  });
});

describe('rng', () => {
  it('같은 시드는 같은 수열, 셔플은 순열', () => {
    const a = makeRng(0xdeadbeef);
    const b = makeRng(0xdeadbeef);
    for (let i = 0; i < 100; i++) expect(a()).toBe(b());
    const s = shuffle([0, 1, 2, 3, 4, 5, 6, 7], makeRng(1));
    expect(s.slice().sort()).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    expect(shuffle([0, 1, 2, 3, 4, 5, 6, 7], makeRng(1))).toEqual(s);
  });
});
