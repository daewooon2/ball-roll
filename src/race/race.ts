// 경주 한 판. 시간은 스텝 번호로만 센다(Date, performance.now 금지). DOM, three를 쓰지 않는다.
import {
  MAX_RACE_STEPS,
  OOB_DISTANCE,
  START_JITTER,
  STEPS_PER_SEC,
  STUCK_KICK,
  STUCK_SPEED,
  STUCK_STEPS,
  WORLD_SCALE,
} from '../config';
import { moverPose, projectToCenterline, type BuiltMap } from '../map/build';
import { applyRollingResistance } from '../physics/rolling';
import { PhysicsWorld, type Body } from '../physics/world';
import { makeRng, shuffle, type Rng } from '../rng';

export interface Entry {
  name: string;
  /** 구슬 질량 배수. 기본 1. */
  weight: number;
}

export interface RaceOptions {
  seed: number;
  entries: Entry[];
  /** 무작위 부스트 스킬 */
  skills?: boolean;
}

export interface RaceEvent {
  step: number;
  marble: number;
  kind: 'boost';
}

export class Race {
  readonly n: number;
  step = 0;
  started = false;
  done = false;
  /** 끼임 안전망 임펄스 횟수, 코스 밖으로 나가 되돌린 횟수 */
  kicks = 0;
  resets = 0;
  /** 진단용: 임펄스·복귀가 일어난 지점의 진행도 */
  readonly kickAt: number[] = [];
  readonly resetAt: number[] = [];

  // 렌더 보간용: 직전 스텝과 현재 스텝의 자세
  readonly pos: Float32Array;
  readonly rot: Float32Array;
  readonly prevPos: Float32Array;
  readonly prevRot: Float32Array;
  readonly pinPos: Float32Array;
  readonly pinRot: Float32Array;
  readonly prevPinPos: Float32Array;
  readonly prevPinRot: Float32Array;
  readonly pinAlive: Uint8Array;
  readonly gatePos = new Float32Array(3);
  readonly prevGatePos = new Float32Array(3);
  /** 움직이는 장애물. 자세는 스텝 번호에서 계산한다. */
  readonly moverPos: Float32Array;
  readonly moverRot: Float32Array;
  readonly prevMoverPos: Float32Array;
  readonly prevMoverRot: Float32Array;

  /** 구슬 i의 출발 슬롯 */
  readonly slot: number[];
  readonly progress: Float32Array;
  /** 결승 시각(스텝, 소수 포함). 미완주는 NaN. */
  readonly finishTime: Float64Array;
  /** 도착 순서대로의 구슬 번호 */
  readonly finishOrder: number[] = [];
  readonly events: RaceEvent[] = [];

  private world: PhysicsWorld;
  private rng: Rng;
  private marbles: Body[] = [];
  private pinBodies: (Body | null)[] = [];
  private gate: Body;
  private moverBodies: Body[] = [];
  private gateRot = new Float32Array(4);
  private marbleOf = new Map<number, number>(); // 충돌체 핸들 → 구슬 번호
  private finishHandle = -1;
  private slow: Uint16Array;
  private skillAt: number[] = [];

  constructor(
    readonly map: BuiltMap,
    readonly options: RaceOptions,
  ) {
    const n = (this.n = options.entries.length);
    const { radius, density } = map.marble;
    this.rng = makeRng(options.seed);
    this.world = new PhysicsWorld(map.material);
    map.statics.forEach((spec, i) => {
      const h = this.world.addStatic(spec);
      if (i === map.finishIndex) this.finishHandle = h;
    });

    this.pos = new Float32Array(n * 3);
    this.rot = new Float32Array(n * 4);
    this.progress = new Float32Array(n);
    this.finishTime = new Float64Array(n).fill(NaN);
    this.slow = new Uint16Array(n);

    // 출발 슬롯은 시드 셔플로 정한다
    const order = shuffle(
      options.entries.map((_, i) => i),
      this.rng,
    );
    this.slot = new Array(n);
    order.forEach((marble, k) => (this.slot[marble] = k));
    const [along, across] = map.startAxes;
    for (let i = 0; i < n; i++) {
      const body = this.world.addDynamic(
        [{ shape: { kind: 'ball', radius }, pos: [0, 0, 0], density: density * options.entries[i].weight }],
        map.slotPosition(this.slot[i], n),
      );
      const ja = this.rng() * START_JITTER;
      const jz = (this.rng() * 2 - 1) * START_JITTER;
      body.setVelocity([along[0] * ja + across[0] * jz, along[1] * ja + across[1] * jz, along[2] * ja + across[2] * jz]);
      this.marbleOf.set(body.colliders[0], i);
      this.marbles.push(body);
      if (options.skills) this.skillAt.push(Math.floor((3 + this.rng() * 17) * STEPS_PER_SEC));
    }

    const g = map.gate;
    this.gate = this.world.addKinematic([{ shape: { kind: 'box', half: g.half }, pos: [0, 0, 0], friction: 0 }], g.pos, g.rot);

    const pn = map.pins.length;
    this.pinPos = new Float32Array(pn * 3);
    this.pinRot = new Float32Array(pn * 4);
    this.pinAlive = new Uint8Array(pn).fill(1);
    for (const p of map.pins) {
      this.pinBodies.push(
        this.world.addDynamic(
          [
            { shape: { kind: 'cylinder', halfHeight: p.height / 2, radius: p.radius }, pos: [0, p.height / 2, 0], density: p.density, friction: p.friction },
            { shape: { kind: 'ball', radius: p.headRadius }, pos: [0, p.height + p.headRadius * 0.4, 0], density: p.density, friction: p.friction },
          ],
          p.pos,
          p.rot,
          { sleeping: true },
        ),
      );
    }

    const mn = map.movers.length;
    this.moverPos = new Float32Array(mn * 3);
    this.moverRot = new Float32Array(mn * 4);
    map.movers.forEach((m, i) => {
      moverPose(m, 0, this.moverPos, this.moverRot, i);
      const at = (a: Float32Array, k: number, len: number) => Array.from(a.subarray(k * len, k * len + len));
      this.moverBodies.push(this.world.addKinematic(m.colliders, at(this.moverPos, i, 3) as [number, number, number], at(this.moverRot, i, 4) as [number, number, number, number]));
    });
    this.prevMoverPos = this.moverPos.slice();
    this.prevMoverRot = this.moverRot.slice();

    this.read();
    this.prevPos = this.pos.slice();
    this.prevRot = this.rot.slice();
    this.prevPinPos = this.pinPos.slice();
    this.prevPinRot = this.pinRot.slice();
    this.prevGatePos.set(this.gatePos);
    for (let i = 0; i < n; i++) this.updateProgress(i);
  }

  private read() {
    this.marbles.forEach((b, i) => b.read(this.pos, this.rot, i));
    this.pinBodies.forEach((b, i) => b?.read(this.pinPos, this.pinRot, i));
    this.gate.read(this.gatePos, this.gateRot, 0);
  }

  private updateProgress(i: number) {
    const p = projectToCenterline(this.map, this.pos[i * 3], this.pos[i * 3 + 1], this.pos[i * 3 + 2]);
    this.progress[i] = p.s;
    return p;
  }

  start() {
    this.started = true;
  }

  /** 물리 한 스텝 + 경주 판정. */
  tick() {
    if (!this.started || this.done) return;
    const { map, world, n } = this;
    const r = map.marble.radius;
    this.prevPos.set(this.pos);
    this.prevRot.set(this.rot);
    this.prevPinPos.set(this.pinPos);
    this.prevPinRot.set(this.pinRot);
    this.prevGatePos.set(this.gatePos);

    if (this.step < map.gate.liftSteps) {
      const k = (map.gate.lift * (this.step + 1)) / map.gate.liftSteps;
      const g = map.gate;
      this.gate.moveTo([g.pos[0] + g.up[0] * k, g.pos[1] + g.up[1] * k, g.pos[2] + g.up[2] * k]);
    }
    this.prevMoverPos.set(this.moverPos);
    this.prevMoverRot.set(this.moverRot);
    map.movers.forEach((m, i) => {
      moverPose(m, this.step + 1, this.moverPos, this.moverRot, i);
      this.moverBodies[i].poseTo(this.moverPos, this.moverRot, i);
    });
    if (map.marble.rolling > 0)
      this.marbles.forEach((b, i) => applyRollingResistance(world, b, r, map.marble.rolling, !Number.isNaN(this.finishTime[i])));

    world.step();
    this.step++;
    this.read();

    // 결승: 같은 스텝에 들어온 구슬은 결승 평면(센서 윗면)을 지난 시점을 보간해 가르고, 그래도 같으면 시드 난수
    const arrivals: { i: number; t: number; tie: number }[] = [];
    for (const [h1, h2] of world.sensorEvents) {
      const i = this.marbleOf.get(h1 === this.finishHandle ? h2 : h2 === this.finishHandle ? h1 : -1);
      if (i === undefined || !Number.isNaN(this.finishTime[i])) continue;
      const y0 = this.prevPos[i * 3 + 1] - r - map.finishTopY;
      const y1 = this.pos[i * 3 + 1] - r - map.finishTopY;
      const frac = y0 > y1 ? Math.min(1, Math.max(0, y0 / (y0 - y1))) : 1;
      arrivals.push({ i, t: this.step - 1 + frac, tie: this.rng() });
    }
    arrivals.sort((a, b) => a.t - b.t || a.tie - b.tie);
    for (const a of arrivals) {
      this.finishTime[a.i] = a.t;
      this.finishOrder.push(a.i);
    }

    for (let i = 0; i < n; i++) {
      if (!Number.isNaN(this.finishTime[i])) continue;
      const b = this.marbles[i];
      const p = this.updateProgress(i);
      // 코스 밖으로 나간 구슬은 가장 가까운 중심선 위로 되돌린다
      if (p.dist > OOB_DISTANCE || this.pos[i * 3 + 1] < map.floorY) {
        b.teleport([p.point[0], p.point[1] + r, p.point[2]]);
        this.resets++;
        this.resetAt.push(p.s);
        continue;
      }
      // 끼임 안전망
      if (this.step > map.gate.liftSteps && b.speed() < STUCK_SPEED) {
        if (++this.slow[i] >= STUCK_STEPS) {
          // 수평면 안의 무작위 방향으로 민다. 진행 방향으로만 밀면 쐐기 앞에 낀 아치가 풀리지 않는다.
          const a = this.rng() * 2 * Math.PI;
          b.addVelocity([Math.cos(a) * STUCK_KICK, STUCK_KICK * 0.3, Math.sin(a) * STUCK_KICK]);
          this.slow[i] = 0;
          this.kicks++;
          this.kickAt.push(p.s);
        }
      } else this.slow[i] = 0;
      // 스킬: 발동 시점과 크기 모두 시드 PRNG
      if (this.step === this.skillAt[i]) {
        const v = (0.2 + this.rng() * 0.3) * WORLD_SCALE;
        b.addVelocity([p.tangent[0] * v, p.tangent[1] * v, p.tangent[2] * v]);
        this.events.push({ step: this.step, marble: i, kind: 'boost' });
      }
    }

    // 쓰러져 코스 아래로 떨어진 핀은 치운다
    this.pinBodies.forEach((b, i) => {
      if (b && this.pinPos[i * 3 + 1] < map.pins[i].despawnY) {
        world.remove(b);
        this.pinBodies[i] = null;
        this.pinAlive[i] = 0;
      }
    });

    if (this.finishOrder.length === n || this.step >= MAX_RACE_STEPS) this.done = true;
  }

  /** 현재 순위: 결승한 구슬(도착 순) → 나머지(진행도 순). */
  ranking(): number[] {
    const rest = [];
    for (let i = 0; i < this.n; i++) if (Number.isNaN(this.finishTime[i])) rest.push(i);
    rest.sort((a, b) => this.progress[b] - this.progress[a] || a - b);
    return [...this.finishOrder, ...rest];
  }

  /**
   * 당첨 구슬들. 아직 정해지지 않았으면 null.
   * first는 앞에서 count번째까지 들어오면 확정, last는 경주가 끝나야 확정된다.
   */
  winners(mode: 'first' | 'last', count = 1): number[] | null {
    const k = Math.min(count, this.n);
    if (mode === 'first') return this.finishOrder.length >= k || this.done ? this.ranking().slice(0, k) : null;
    return this.done ? this.ranking().slice(-k).reverse() : null;
  }

  free() {
    this.world.free();
  }
}
