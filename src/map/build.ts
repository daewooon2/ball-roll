// 코스 JSON(m) → 물리 충돌체와 렌더 정보(unit). three, DOM을 쓰지 않는다.
// 규칙: 굴러가는 면 하나는 cuboid 하나. 같은 평면의 cuboid를 맞대면 이음새에서 튄다(0단계 측정).
import {
  DT,
  FLOOR_COLLIDER_THICKNESS as TC,
  FLOOR_VISUAL_THICKNESS as TV,
  WALL_THICKNESS as WT,
  WORLD_SCALE as S,
} from '../config';
import type { ColliderSpec, Material, Quat, Vec3 } from '../physics/world';
import type { MapJson, RampPiece, V3 } from './schema';

export type Visual =
  | { kind: 'box'; half: Vec3; pos: Vec3; rot: Quat }
  | { kind: 'prism'; points: number[]; color: string }
  | { kind: 'mesh'; vertices: number[]; indices: number[] };

export interface PinSpec {
  pos: Vec3;
  rot: Quat;
  radius: number;
  height: number;
  headRadius: number;
  density: number;
  friction?: number;
  despawnY: number;
}

/** 움직이는 장애물(운동학 강체). 자세는 스텝 번호만으로 정해진다. */
export interface MoverSpec {
  /** 강체 기준 로컬 충돌체 */
  colliders: ColliderSpec[];
  visual: { kind: 'prism'; points: number[]; color: string } | { kind: 'boxes'; halves: Vec3[]; offset: Vec3; color: string };
  pos: Vec3;
  rot: Quat;
  /** 0~1. 한 주기 안에서의 시작 위치 */
  phase: number;
  /** 로컬 y축 둘레 회전(rad/스텝) */
  spin?: number;
  /** dir 방향으로 amp·sin 왕복. period는 스텝 수 */
  slide?: { dir: Vec3; amp: number; period: number };
}

/** step 스텝째의 자세를 배열의 i번째 칸에 쓴다. */
export function moverPose(m: MoverSpec, step: number, pos: Float32Array | number[], rot: Float32Array | number[], i: number) {
  const k = m.slide ? m.slide.amp * Math.sin(2 * Math.PI * (step / m.slide.period + m.phase)) : 0;
  for (let a = 0; a < 3; a++) pos[i * 3 + a] = m.pos[a] + (m.slide ? m.slide.dir[a] * k : 0);
  const angle = m.spin ? m.spin * step + m.phase * 2 * Math.PI : 0;
  const q = m.spin ? qmul(m.rot, [0, Math.sin(angle / 2), 0, Math.cos(angle / 2)]) : m.rot;
  for (let a = 0; a < 4; a++) rot[i * 4 + a] = q[a];
}

export interface BuiltMap {
  id: string;
  material: Material;
  marble: { radius: number; density: number; rolling: number };
  statics: ColliderSpec[];
  /** statics 안에서 결승 센서의 위치 */
  finishIndex: number;
  finishTopY: number;
  /** 이보다 아래로 떨어지면 코스 밖 */
  floorY: number;
  visuals: Visual[];
  pins: PinSpec[];
  movers: MoverSpec[];
  gate: { pos: Vec3; rot: Quat; half: Vec3; up: Vec3; lift: number; liftSteps: number };
  /** n개 중 k번째 출발 슬롯의 구슬 위치 */
  slotPosition(k: number, n: number): Vec3;
  /** 출발 지점의 [내리막 방향, 옆 방향] */
  startAxes: [Vec3, Vec3];
  centerline: Vec3[];
  /** centerline 각 점까지의 누적 길이 */
  cumulative: number[];
  funnel?: { center: Vec3; rOuter: number; s: number };
}

const rad = (deg: number) => (deg * Math.PI) / 180;
const scale = (v: V3): Vec3 => [v[0] * S, v[1] * S, v[2] * S];

function qmul(a: Quat, b: Quat): Quat {
  return [
    a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
    a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
    a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
    a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
  ];
}
function qrot(q: Quat, v: Vec3): Vec3 {
  const [x, y, z, w] = q;
  const tx = 2 * (y * v[2] - z * v[1]);
  const ty = 2 * (z * v[0] - x * v[2]);
  const tz = 2 * (x * v[1] - y * v[0]);
  return [v[0] + w * tx + y * tz - z * ty, v[1] + w * ty + z * tx - x * tz, v[2] + w * tz + x * ty - y * tx];
}
/** yaw 0 → 로컬 x가 +x, yaw 90 → +z. */
const qYaw = (deg: number): Quat => [0, Math.sin(-rad(deg) / 2), 0, Math.cos(-rad(deg) / 2)];
/** 로컬 +x 쪽이 내려가게 기울인다. */
const qSlope = (deg: number): Quat => [0, 0, Math.sin(-rad(deg) / 2), Math.cos(-rad(deg) / 2)];

/** 조각의 로컬 좌표계. 로컬 x = 진행 방향, y = 면의 법선, z = 옆. */
class Frame {
  constructor(
    readonly origin: Vec3,
    readonly rot: Quat,
  ) {}
  at(local: Vec3): Vec3 {
    const r = qrot(this.rot, local);
    return [this.origin[0] + r[0], this.origin[1] + r[1], this.origin[2] + r[2]];
  }
  dir(local: Vec3): Vec3 {
    return qrot(this.rot, local);
  }
}

export function buildMap(json: MapJson): BuiltMap {
  const statics: ColliderSpec[] = [];
  const visuals: Visual[] = [];
  const pins: PinSpec[] = [];
  const movers: MoverSpec[] = [];
  const line: Vec3[] = [];
  const frames = new Map<string, Frame>();
  const ramps = new Map<string, RampPiece>();
  const r = json.marble.radius * S;
  const marbleMass = json.marble.density * (4 / 3) * Math.PI * r ** 3;
  let finishIndex = -1;
  let finishTopY = 0;
  let floorY = Infinity;
  let funnel: BuiltMap['funnel'];

  /** 충돌체와 렌더가 같은 상자 */
  const box = (f: Frame, center: Vec3, half: Vec3) => {
    const pos = f.at(center);
    statics.push({ shape: { kind: 'box', half }, pos, rot: f.rot });
    visuals.push({ kind: 'box', half, pos, rot: f.rot });
  };

  for (const p of json.pieces) {
    switch (p.type) {
      case 'ramp': {
        const f = new Frame(scale(p.pos), qmul(qYaw(p.yawDeg), qSlope(p.slopeDeg)));
        frames.set(p.id, f);
        ramps.set(p.id, p);
        const L = p.length * S;
        const hw = (p.width * S) / 2 + WT;
        const tc = p.thickness ? p.thickness * S : TC;
        // 바닥: 충돌체는 아래로 두껍게, 렌더는 얇게
        statics.push({ shape: { kind: 'box', half: [L / 2, tc / 2, hw] }, pos: f.at([L / 2, -tc / 2, 0]), rot: f.rot });
        visuals.push({ kind: 'box', half: [L / 2, TV / 2, hw] as Vec3, pos: f.at([L / 2, -TV / 2, 0]), rot: f.rot });
        const rails = p.rails ?? [p.railH, p.railH];
        [-1, 1].forEach((side, i) => {
          const h = rails[i] * S;
          if (h > 0) box(f, [L / 2, h / 2, side * (hw - WT / 2)], [L / 2, h / 2, WT / 2]);
        });
        if (p.backWall) box(f, [-WT / 2, (p.backWall * S) / 2, 0], [WT / 2, (p.backWall * S) / 2, hw]);
        line.push(f.at([0, r, 0]), f.at([L, r, 0]));
        break;
      }
      case 'drop': {
        const f = new Frame(scale(p.pos), qYaw(p.yawDeg));
        const [len, h, w] = scale(p.size);
        box(f, [len + WT / 2, h / 2, 0], [WT / 2, h / 2, w / 2 + WT]);
        for (const side of [-1, 1])
          if (p.open !== (side > 0 ? '+z' : '-z'))
            box(f, [len / 2, h / 2, side * (w / 2 + WT / 2)], [len / 2, h / 2, WT / 2]);
        break;
      }
      case 'wedge': {
        const base = frames.get(p.on)!;
        const f = new Frame(base.at([p.at[0] * S, 0, p.at[1] * S]), qmul(base.rot, qYaw(p.yawDeg ?? 0)));
        const [w, h, l] = scale(p.size);
        const local: Vec3[] = [];
        // 꼭짓점이 오르막(-x)을 향한다. 고정 쐐기는 판에 2mm 묻어 틈을 없애고, 움직이는 쐐기는 1mm 띄운다.
        for (const y of [(p.slide ? 0.001 : -0.002) * S, h])
          for (const [x, z] of [
            [-l / 2, 0],
            [l / 2, -w / 2],
            [l / 2, w / 2],
          ])
            local.push([x, y, z]);
        const color = p.color ?? 'red';
        if (p.slide) {
          const points = local.flat();
          movers.push({
            colliders: [{ shape: { kind: 'hull', points }, pos: [0, 0, 0] }],
            visual: { kind: 'prism', points, color },
            pos: f.origin,
            rot: f.rot,
            phase: p.slide.phase ?? 0,
            slide: { dir: base.dir([0, 0, 1]), amp: p.slide.amp * S, period: p.slide.period / DT },
          });
        } else {
          const points = local.flatMap((v) => f.at(v));
          statics.push({ shape: { kind: 'hull', points }, pos: [0, 0, 0] });
          visuals.push({ kind: 'prism', points, color });
        }
        break;
      }
      case 'spinner': {
        // 판의 법선을 축으로 도는 막대(또는 십자). 바닥에서 1mm 떠 있다.
        const base = frames.get(p.on)!;
        const half: Vec3 = [(p.length * S) / 2, 0.0075 * S, 0.004 * S];
        const offset: Vec3 = [0, half[1] + 0.001 * S, 0];
        const halves: Vec3[] = p.cross ? [half, [half[2], half[1], half[0]]] : [half];
        movers.push({
          colliders: halves.map((h) => ({ shape: { kind: 'box', half: h }, pos: offset })),
          visual: { kind: 'boxes', halves, offset, color: p.color ?? 'red' },
          pos: base.at([p.at[0] * S, 0, p.at[1] * S]),
          rot: base.rot,
          phase: p.phase ?? 0,
          spin: ((p.rpm * 2 * Math.PI) / 60) * DT,
        });
        break;
      }
      case 'pins': {
        const base = frames.get(p.on)!;
        const radius = p.radius * S;
        const height = p.height * S;
        const headRadius = radius * 1.25;
        const volume = Math.PI * radius ** 2 * height + (4 / 3) * Math.PI * headRadius ** 3;
        const density = (p.massRatio * marbleMass) / volume;
        const gap = p.spacing * S;
        p.layout.split('-').forEach((count, row) => {
          for (let c = 0; c < +count; c++) {
            const pos = base.at([
              p.at[0] * S - row * gap * (Math.sqrt(3) / 2),
              0,
              p.at[1] * S + (c - (+count - 1) / 2) * gap,
            ]);
            pins.push({ pos, rot: base.rot, radius, height, headRadius, density, friction: p.friction, despawnY: pos[1] - p.despawnDrop * S });
          }
        });
        break;
      }
      case 'funnel': {
        const c = scale(p.pos);
        const rI = p.rInner * S;
        const rO = p.rOuter * S;
        const H = (rO - rI) * Math.tan(rad(p.angleDeg));
        const N = p.segments;
        const vertices: number[] = [];
        const indices: number[] = [];
        for (let k = 0; k < N; k++) {
          const a = (k / N) * 2 * Math.PI;
          const cos = Math.cos(a);
          const sin = Math.sin(a);
          vertices.push(c[0] + rI * cos, c[1], c[2] + rI * sin);
          vertices.push(c[0] + rO * cos, c[1] + H, c[2] + rO * sin);
          vertices.push(c[0] + rO * cos, c[1] + H + p.rimH * S, c[2] + rO * sin);
          const i = k * 3;
          const j = ((k + 1) % N) * 3;
          // 감기 방향 통일: 법선이 구슬이 구르는 쪽(위·안쪽)을 향한다
          indices.push(i, j, i + 1, j, j + 1, i + 1); // 원뿔면
          indices.push(i + 1, j + 1, i + 2, j + 1, j + 2, i + 2); // 테두리 벽
        }
        statics.push({ shape: { kind: 'trimesh', vertices, indices }, pos: [0, 0, 0] });
        visuals.push({ kind: 'mesh', vertices, indices });
        line.push([c[0], c[1] + H, c[2]], c);
        funnel = { center: [c[0], c[1] + H, c[2]], rOuter: rO, s: 0 };
        break;
      }
      case 'finish': {
        const c = scale(p.pos);
        const half = scale(p.size).map((v) => v / 2) as Vec3;
        const [tw, depth, td] = scale(p.tray);
        const f = new Frame([c[0], c[1] - half[1] - depth, c[2]], [0, 0, 0, 1]);
        finishIndex = statics.length;
        finishTopY = c[1] + half[1];
        statics.push({ shape: { kind: 'box', half }, pos: c, sensor: true });
        // 받침 상자: 바닥 + 벽 4개
        statics.push({ shape: { kind: 'box', half: [tw / 2 + WT, TC / 2, td / 2 + WT] }, pos: f.at([0, -TC / 2, 0]) });
        visuals.push({ kind: 'box', half: [tw / 2 + WT, TV / 2, td / 2 + WT], pos: f.at([0, -TV / 2, 0]), rot: f.rot });
        const wh = depth / 2;
        for (const side of [-1, 1]) {
          box(f, [side * (tw / 2 + WT / 2), wh, 0], [WT / 2, wh, td / 2 + WT]);
          box(f, [0, wh, side * (td / 2 + WT / 2)], [tw / 2, wh, WT / 2]);
        }
        floorY = f.origin[1] - TC;
        line.push(c);
        break;
      }
    }
  }

  const centerline = json.centerline ? json.centerline.map(scale) : line;
  const cumulative = [0];
  for (let i = 1; i < centerline.length; i++) {
    const a = centerline[i - 1];
    const b = centerline[i];
    cumulative.push(cumulative[i - 1] + Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]));
  }

  // 출발 게이트
  const sf = frames.get(json.start.on)!;
  const sr = ramps.get(json.start.on)!;
  const at = json.start.at * S;
  const barHalf: Vec3 = [0.002 * S, r * 1.5, (sr.width * S) / 2];
  const pitch = 2 * r + 0.0002 * S; // 뒷줄과의 간격
  const slotW = json.start.slotWidth * S;

  const map: BuiltMap = {
    id: json.id,
    material: { friction: json.marble.friction, restitution: json.marble.restitution },
    marble: { radius: r, density: json.marble.density, rolling: json.marble.rollingResistance },
    statics,
    finishIndex,
    finishTopY,
    floorY,
    visuals,
    pins,
    movers,
    gate: {
      pos: sf.at([at, barHalf[1], 0]),
      rot: sf.rot,
      half: barHalf,
      up: sf.dir([0, 1, 0]),
      lift: 0.03 * S,
      liftSteps: Math.max(1, Math.round(json.start.liftTime / DT)),
    },
    slotPosition(k, n) {
      const cols = Math.min(n, json.start.slots);
      const row = Math.floor(k / json.start.slots);
      const col = k % json.start.slots;
      return sf.at([at - barHalf[0] - r - 0.0001 * S - row * pitch, r, (col - (cols - 1) / 2) * slotW]);
    },
    startAxes: [sf.dir([1, 0, 0]), sf.dir([0, 0, 1])],
    centerline,
    cumulative,
    funnel,
  };
  if (funnel) funnel.s = projectToCenterline(map, ...funnel.center).s;
  return map;
}

/** 점 p에서 중심선까지: 누적 길이 s, 거리, 최근접점, 그 구간의 진행 방향. */
export function projectToCenterline(map: BuiltMap, px: number, py: number, pz: number) {
  const { centerline: line, cumulative } = map;
  let best = { s: 0, dist: Infinity, point: line[0], tangent: [1, 0, 0] as Vec3 };
  for (let i = 1; i < line.length; i++) {
    const a = line[i - 1];
    const b = line[i];
    const d: Vec3 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const len2 = d[0] * d[0] + d[1] * d[1] + d[2] * d[2];
    if (len2 === 0) continue;
    const t = Math.min(1, Math.max(0, ((px - a[0]) * d[0] + (py - a[1]) * d[1] + (pz - a[2]) * d[2]) / len2));
    const q: Vec3 = [a[0] + d[0] * t, a[1] + d[1] * t, a[2] + d[2] * t];
    const dist = Math.hypot(px - q[0], py - q[1], pz - q[2]);
    if (dist < best.dist) {
      const len = Math.sqrt(len2);
      best = { s: cumulative[i - 1] + len * t, dist, point: q, tangent: [d[0] / len, d[1] / len, d[2] / len] };
    }
  }
  return best;
}
