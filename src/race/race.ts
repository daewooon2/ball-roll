// 경주 한 판. 시간은 스텝 번호로만 센다(Date, performance.now 금지). DOM, three를 쓰지 않는다.
import {
  BURST_COOLDOWN,
  BURST_COUNT,
  BURST_RADIUS,
  BURST_SPEED,
  DRAIN_STEPS,
  MAX_RACE_STEPS,
  STALL_STEPS,
  START_JITTER,
  STEPS_PER_SEC,
  STUCK_KICK,
  STUCK_SPEED,
  TIP_SPEED,
  STUCK_STEPS,
  WORLD_SCALE,
} from '../config';
import { moverPose, type BuiltMap } from '../map/build';

/** 쿼터니언 q로 로컬 x축(1, 0, 0)을 돌린 방향 */
const xAxis = (q: Float32Array): [number, number] => [1 - 2 * (q[1] * q[1] + q[2] * q[2]), 2 * (q[0] * q[1] + q[3] * q[2])];
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
  kind: 'boost' | 'fall' | 'burst';
  /** burst: 터진 자리 */
  x?: number;
  y?: number;
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
  private gate: Body;
  private moverBodies: Body[] = [];
  private gateRot = new Float32Array(4);
  private marbleOf = new Map<number, number>(); // 충돌체 핸들 → 구슬 번호
  private finishHandle = -1;
  private slow: Uint16Array;
  /** 구슬마다 구멍에 빠진 횟수 */
  readonly falls: Uint8Array;
  /** 결승 구간에 첫 구슬이 들어온 스텝 */
  private finaleStep = 0;
  /** 안전망이 켜졌다(결승 구간이 너무 오래 걸림) */
  draining = false;
  /** 구슬이 가장 멀리 내려간 진행도와 그때의 스텝 */
  private best: Float32Array;
  private bestStep: Uint32Array;
  private skillAt: number[] = [];

  constructor(
    readonly map: BuiltMap,
    readonly options: RaceOptions,
  ) {
    const n = (this.n = options.entries.length);
    const { radius, density } = map.marble;
    this.rng = makeRng(options.seed);
    this.world = new PhysicsWorld(map.material, map.gravity);
    map.statics.forEach((spec, i) => {
      const h = this.world.addStatic(spec);
      if (i === map.finishIndex) this.finishHandle = h;
    });

    this.pos = new Float32Array(n * 3);
    this.rot = new Float32Array(n * 4);
    this.progress = new Float32Array(n);
    this.finishTime = new Float64Array(n).fill(NaN);
    this.slow = new Uint16Array(n);
    this.falls = new Uint8Array(n);
    this.lastWall = new Int32Array(n).fill(-1000);
    this.best = new Float32Array(n).fill(-Infinity);
    this.bestStep = new Uint32Array(n);

    // 출발 슬롯은 시드 셔플로 정한다
    const order = shuffle(
      options.entries.map((_, i) => i),
      this.rng,
    );
    this.slot = new Array(n);
    order.forEach((marble, k) => (this.slot[marble] = k));
    for (let i = 0; i < n; i++) {
      const body = this.world.addDynamic(
        [{ shape: { kind: 'ball', radius }, pos: [0, 0, 0], density: density * options.entries[i].weight }],
        // 같은 슬롯이라도 판마다 자리가 조금씩 다르다. 그래야 초반 궤적이 슬롯마다 굳지 않는다.
        map.slotPosition(this.slot[i], n, this.rng() * 2 - 1),
      );
      body.setVelocity([(this.rng() * 2 - 1) * START_JITTER, -this.rng() * START_JITTER, 0]);
      this.marbleOf.set(body.colliders[0], i);
      this.marbles.push(body);
      if (options.skills) this.skillAt.push(Math.floor((3 + this.rng() * 17) * STEPS_PER_SEC));
    }

    const g = map.gate;
    this.gate = this.world.addKinematic([{ shape: { kind: 'box', half: g.half }, pos: [0, 0, 0], friction: 0 }], g.pos);

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
    this.prevGatePos.set(this.gatePos);
    for (let i = 0; i < n; i++) this.updateProgress(i);
  }

  private read() {
    this.marbles.forEach((b, i) => b.read(this.pos, this.rot, i));
    this.gate.read(this.gatePos, this.gateRot, 0);
  }

  private updateProgress(i: number) {
    return (this.progress[i] = this.map.startY - this.pos[i * 3 + 1]);
  }

  start() {
    this.started = true;
  }

  /** 게이트가 다 열렸는가 */
  get released() {
    return this.step >= this.map.gate.liftSteps;
  }

  /** 물리 한 스텝 + 경주 판정. */
  tick() {
    if (!this.started || this.done) return;
    const { map, world, n } = this;
    const r = map.marble.radius;
    this.prevPos.set(this.pos);
    this.prevRot.set(this.rot);
    this.prevGatePos.set(this.gatePos);

    if (this.step < map.gate.liftSteps) {
      const k = (map.gate.lift * (this.step + 1)) / map.gate.liftSteps;
      this.gate.moveTo([map.gate.pos[0], map.gate.pos[1], map.gate.pos[2] + k]);
    }
    this.prevMoverPos.set(this.moverPos);
    this.prevMoverRot.set(this.moverRot);
    map.movers.forEach((m, i) => {
      moverPose(m, this.step + 1, this.moverPos, this.moverRot, i);
      this.moverBodies[i].poseTo(this.moverPos, this.moverRot, i);
      if (m.tips) this.tipKick(i);
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
      const y0 = this.prevPos[i * 3 + 1] - r - map.finishY;
      const y1 = this.pos[i * 3 + 1] - r - map.finishY;
      const frac = y0 > y1 ? Math.min(1, Math.max(0, y0 / (y0 - y1))) : 1;
      arrivals.push({ i, t: this.step - 1 + frac, tie: this.rng() });
    }
    arrivals.sort((a, b) => a.t - b.t || a.tie - b.tie);
    for (const a of arrivals) {
      this.finishTime[a.i] = a.t;
      this.finishOrder.push(a.i);
    }

    // 안전망: 결승 구간에 첫 구슬이 들어오고 DRAIN_STEPS가 지나도 안 끝나면, 벽은 그대로 두고
    // 1초마다 결승 구간 안에서 가장 앞선 구슬 하나를 결승 입구 안쪽으로 옮겨 준다(순위가 하나씩 정해진다)
    if (!this.draining && this.finaleStep > 0 && this.step - this.finaleStep > DRAIN_STEPS) this.draining = true;
    if (this.draining && map.spot && this.step % STEPS_PER_SEC === 0) {
      let best = -1;
      for (let i = 0; i < n; i++)
        if (Number.isNaN(this.finishTime[i]) && this.pos[i * 3 + 1] < map.trapY && (best < 0 || this.progress[i] > this.progress[best])) best = i;
      if (best >= 0) this.marbles[best].teleport([map.spot[0], map.spot[1] - 0.2, r]);
    }
    for (let i = 0; i < n; i++) {
      if (!Number.isNaN(this.finishTime[i])) continue;
      const b = this.marbles[i];
      const s = this.updateProgress(i);
      // 판 밖으로 나간 구슬(터널링)은 되돌린다
      const [x, y, z] = this.pos.subarray(i * 3, i * 3 + 3);
      if (Math.abs(x) > map.halfWidth || y > map.top || y < map.bottom || z < 0 || z > map.wallH) {
        // 결승 구간까지 왔던 구슬은 결승 깔때기 위로, 아니면 출발 칸으로
        b.teleport([0, (this.best[i] > map.startY - map.trapY ? map.trapY : map.startY) + r, r]);
        this.resets++;
        this.resetAt.push(s);
        continue;
      }
      // 구멍 함정: 빠지면 구간 맨 위로 되돌아간다(자리는 시드 난수로 조금 흩는다)
      const hole = map.holes.find((h) => Math.hypot(x - h.x, y - h.y) < h.r);
      if (hole && this.falls[i] < hole.max) {
        this.falls[i]++;
        b.teleport([hole.to[0] + (this.rng() * 2 - 1) * 0.6, hole.to[1] + r, r]);
        this.events.push({ step: this.step, marble: i, kind: 'fall' });
        this.best[i] = map.startY - hole.to[1];
        this.bestStep[i] = this.step;
        continue;
      }
      // 끼임 안전망
      if (s > this.best[i]) {
        this.best[i] = s;
        this.bestStep[i] = this.step;
      }
      // 밀어내는 벽: 벽을 따라 미끄러지던 속도는 두고, 벽에서 멀어지는 쪽 속도만 정한 값으로 바꾼다(같은 구슬은 0.1초에 한 번)
      for (const w of map.kickWalls) {
        if (this.step - this.lastWall[i] < 24) break;
        const ex = w.bx - w.ax;
        const ey = w.by - w.ay;
        const len2 = ex * ex + ey * ey;
        const t = Math.max(0, Math.min(1, ((x - w.ax) * ex + (y - w.ay) * ey) / len2));
        const nx = x - (w.ax + ex * t);
        const ny = y - (w.ay + ey * t);
        const d = Math.hypot(nx, ny);
        if (d >= w.reach || d === 0) continue;
        const v = b.velocity();
        const vn = (v[0] * nx + v[1] * ny) / d;
        const add = w.speed - Math.min(vn, w.speed);
        b.setVelocity([v[0] + (nx / d) * add, v[1] + (ny / d) * add, 0]);
        this.lastWall[i] = this.step;
        break;
      }
      // 팝 범퍼: 닿으면 범퍼 중심에서 멀어지는 쪽으로 튕겨 낸다
      if (y < map.trapY) this.finaleStep ||= this.step;
      for (const p of map.poppers) {
        const dx = x - p.x;
        const dy = y - p.y;
        const d = Math.hypot(dx, dy);
        if (d >= p.reach || d === 0) continue;
        b.setVelocity([(dx / d) * p.speed, (dy / d) * p.speed, 0]);
      }
      const stalled = this.step - this.bestStep[i] >= STALL_STEPS;
      if (this.released && (stalled || b.speed() < STUCK_SPEED)) {
        if (stalled || ++this.slow[i] >= STUCK_STEPS) {
          // 판 위의 무작위 방향으로 민다. 아래로만 밀면 장애물 앞에 낀 아치가 풀리지 않는다.
          const a = this.rng() * 2 * Math.PI;
          // 천천히라도 움직이고 있는데 못 내려가는 구슬(장애물 위에서 맴도는 것)은 아래로 세게 민다
          const down = stalled ? STUCK_KICK * 3 : 0;
          b.addVelocity([Math.cos(a) * STUCK_KICK, Math.sin(a) * STUCK_KICK - down, 0]);
          this.slow[i] = 0;
          this.bestStep[i] = this.step;
          this.kicks++;
          this.kickAt.push(s);
        }
      } else this.slow[i] = 0;
      // 스킬: 발동 시점과 크기 모두 시드 PRNG
      if (this.step === this.skillAt[i]) {
        const v = (0.2 + this.rng() * 0.3) * WORLD_SCALE;
        b.addVelocity([0, -v, 0]);
        this.events.push({ step: this.step, marble: i, kind: 'boost' });
      }
    }

    if (this.released && this.step % 12 === 0 && this.step - this.lastBurst > BURST_COOLDOWN) this.burst();

    if (this.finishOrder.length === n || this.step >= MAX_RACE_STEPS) this.done = true;
  }

  private lastBurst = -Infinity;
  private lastTip: Int32Array = new Int32Array(0);
  private lastWall: Int32Array;

  /** 움직이는 막대 i의 빨간 끝에 닿은 구슬을 막대 옆쪽(닿은 쪽)으로 튕겨 낸다. 같은 구슬은 0.2초에 한 번. */
  private tipKick(k: number) {
    const m = this.map.movers[k];
    const tips = m.tips!;
    const r = this.map.marble.radius;
    if (this.lastTip.length !== this.n) this.lastTip = new Int32Array(this.n).fill(-1000);
    const q = this.moverRot.subarray(k * 4, k * 4 + 4);
    const ax = xAxis(q);
    const cx = this.moverPos[k * 3];
    const cy = this.moverPos[k * 3 + 1];
    for (let i = 0; i < this.n; i++) {
      if (!Number.isNaN(this.finishTime[i]) || this.step - this.lastTip[i] < 48) continue;
      for (const at of tips.at) {
        const dx = this.pos[i * 3] - (cx + ax[0] * at);
        const dy = this.pos[i * 3 + 1] - (cy + ax[1] * at);
        const along = dx * ax[0] + dy * ax[1];
        const px = dx - ax[0] * along;
        const py = dy - ax[1] * along;
        const side = Math.hypot(px, py);
        if (Math.abs(along) > tips.half[0] + r || side > tips.half[2] + r + 0.015 || side === 0) continue;
        this.marbles[i].setVelocity([(px / side) * TIP_SPEED, (py / side) * TIP_SPEED, 0]);
        this.lastTip[i] = this.step;
        break;
      }
    }
  }

  /** 너무 뭉친 구슬 무리를 찾아 중심에서 바깥으로 흩는다(방향은 시드 난수로 조금 흔든다). */
  private burst() {
    const { n, pos } = this;
    const running: number[] = [];
    for (let i = 0; i < n; i++) if (Number.isNaN(this.finishTime[i])) running.push(i);
    for (const i of running) {
      const near = running.filter((j) => Math.hypot(pos[i * 3] - pos[j * 3], pos[i * 3 + 1] - pos[j * 3 + 1]) < BURST_RADIUS);
      if (near.length < BURST_COUNT) continue;
      const cx = near.reduce((a, j) => a + pos[j * 3], 0) / near.length;
      const cy = near.reduce((a, j) => a + pos[j * 3 + 1], 0) / near.length;
      for (const j of near) {
        const a = Math.atan2(pos[j * 3 + 1] - cy, pos[j * 3] - cx) + (this.rng() - 0.5);
        this.marbles[j].setVelocity([Math.cos(a) * BURST_SPEED, Math.sin(a) * BURST_SPEED, 0]);
      }
      this.lastBurst = this.step;
      this.events.push({ step: this.step, marble: i, kind: 'burst', x: cx, y: cy });
      return;
    }
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
