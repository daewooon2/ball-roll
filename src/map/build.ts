// 코스 JSON(m) → 물리 충돌체와 렌더 정보(unit). three, DOM을 쓰지 않는다.
// 좌표: x = 판의 가로, y = 판의 위쪽, z = 판에서 솟는 쪽. 판 윗면이 z = 0, 구슬 중심은 z = 반지름.
// 판을 기울이는 대신 중력을 기울인다(-y로 g·sin, -z로 g·cos). 판은 cuboid 하나라 이음새가 없다.
import { DT, FLOOR_COLLIDER_THICKNESS as TC, GRAVITY, WALL_THICKNESS as WT, WORLD_SCALE as S } from '../config';
import type { ColliderSpec, Material, Quat, Vec3 } from '../physics/world';
import type { MapJson } from './schema';

export type Visual =
  | { kind: 'box'; half: Vec3; pos: Vec3; rot: Quat; color?: string; trap?: boolean }
  | { kind: 'peg'; pos: Vec3; radius: number; height: number; color?: string; trap?: boolean }
  | { kind: 'hole'; pos: Vec3; radius: number };
// 벽의 둥근 끝(peg, color 'wood')은 렌더에서 벽과 같은 나무 재질로 합친다

/** 움직이는 장애물(운동학 강체). 자세는 스텝 번호만으로 정해진다. */
export interface MoverSpec {
  /** 강체 기준 로컬 충돌체. 로컬 y가 판의 법선(z)이다. */
  colliders: ColliderSpec[];
  halves: Vec3[];
  /** 돌려 놓은 상자들(팔이 여러 개인 바람개비). 있으면 halves 대신 이것으로 그린다 */
  parts?: { half: Vec3; pos: Vec3; rot: Quat }[];
  /** 막대를 축에서 로컬 x로 이만큼 민 곳에 둔다(한쪽 끝이 축인 막대) */
  shift: number;
  /** 막대 양 끝의 잘 튕기는 빨간 끝(로컬 x 위치들) */
  tips?: { half: Vec3; at: number[] };
  color: string;
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
  gravity: Vec3;
  marble: { radius: number; density: number; rolling: number };
  statics: ColliderSpec[];
  /** statics 안에서 결승 센서의 위치 */
  finishIndex: number;
  /** 결승선의 y. 진행도 = startY − y */
  finishY: number;
  startY: number;
  /** 판 안쪽 범위 */
  halfWidth: number;
  top: number;
  bottom: number;
  wallH: number;
  visuals: Visual[];
  movers: MoverSpec[];
  /** 팝 범퍼: 중심에서 reach 안에 들어온 구슬을 speed로 바깥으로 튕긴다 */
  poppers: { x: number; y: number; reach: number; speed: number }[];
  /** 구멍 함정: 빠지면 to로 되돌아간다 */
  holes: { x: number; y: number; r: number; to: [number, number]; max: number }[];
  /** 닿으면 밀어내는 벽: 선분 a-b, 중심선에서 reach 안이면 닿은 것 */
  kickWalls: { ax: number; ay: number; bx: number; by: number; reach: number; speed: number }[];
  /** statics 안에서, 정리 단계에 사라지는 충돌체(결승 구간의 바닥)의 위치 */
  trap: number[];
  /** 결승 구간이 시작하는 높이(바닥의 가장 높은 곳). 바닥이 없으면 -Infinity */
  trapY: number;
  gate: { pos: Vec3; half: Vec3; lift: number; liftSteps: number };
  /** n개 중 k번째 출발 슬롯의 구슬 위치. jitter(-1~1)만큼 슬롯 안에서 옆으로 옮긴다. */
  slotPosition(k: number, n: number, jitter: number): Vec3;
  /** 구간이 시작하는 진행도들(진단용) */
  marks: number[];
  /** 결승 입구. 없으면 null */
  spot: [number, number] | null;
}

const rad = (deg: number) => (deg * Math.PI) / 180;

function qmul(a: Quat, b: Quat): Quat {
  return [
    a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
    a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
    a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
    a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
  ];
}
/** 판 위에서(z축 둘레로) 돌린다. */
const qZ = (deg: number): Quat => [0, 0, Math.sin(rad(deg) / 2), Math.cos(rad(deg) / 2)];
/** 로컬 y를 판의 법선(z)으로 세운다. 원기둥과 움직이는 장애물의 축. */
const UP: Quat = [Math.SQRT1_2, 0, 0, Math.SQRT1_2];

export function buildMap(json: MapJson): BuiltMap {
  const statics: ColliderSpec[] = [];
  const visuals: Visual[] = [];
  const movers: MoverSpec[] = [];
  const poppers: BuiltMap['poppers'] = [];
  const holes: BuiltMap['holes'] = [];
  const kickWalls: BuiltMap['kickWalls'] = [];
  const trap: number[] = [];
  let trapY = -Infinity;
  const r = json.marble.radius * S;
  const H = json.wallH * S;
  const hw = (json.width * S) / 2;
  const top = json.top * S;
  const bottom = json.bottom * S;
  const midY = (top + bottom) / 2;
  const halfLen = (top - bottom) / 2;
  const startY = json.start.y * S;
  const finishY = json.finishY * S;

  /** 충돌체와 렌더가 같은 블록. 판 위에 서 있고 높이는 벽 높이. */
  const box = (x: number, y: number, hx: number, hy: number, deg = 0, color?: string, isTrap?: boolean, restitution?: number) => {
    const pos: Vec3 = [x, y, H / 2];
    const half: Vec3 = [hx, hy, H / 2];
    const rot = qZ(deg);
    if (isTrap) trap.push(statics.length);
    statics.push({ shape: { kind: 'box', half }, pos, rot, restitution });
    visuals.push({ kind: 'box', half, pos, rot, color, trap: isTrap });
  };

  // 판(아래로 두껍게: 터널링 방지), 유리 덮개(구슬이 서로 올라타지 못하게), 테두리
  statics.push({ shape: { kind: 'box', half: [hw + WT, halfLen + WT, TC / 2] }, pos: [0, midY, -TC / 2] });
  visuals.push({ kind: 'box', half: [hw + WT, halfLen + WT, 0.05], pos: [0, midY, -0.05], rot: [0, 0, 0, 1], color: 'plate' });
  statics.push({ shape: { kind: 'box', half: [hw + WT, halfLen + WT, TC / 2] }, pos: [0, midY, H + TC / 2], friction: 0 });
  for (const side of [-1, 1]) {
    box(side * (hw + WT / 2), midY, WT / 2, halfLen + WT);
    box(0, midY + side * (halfLen + WT / 2), hw, WT / 2);
  }

  const finishIndex = statics.length;
  statics.push({ shape: { kind: 'box', half: [hw, (finishY - bottom) / 4, H / 2] }, pos: [0, finishY - (finishY - bottom) / 4, H / 2], sensor: true });

  for (const p of json.pieces) {
    switch (p.type) {
      case 'wall': {
        const [ax, ay] = p.a;
        const [bx, by] = p.b;
        const t = (p.t ?? 0.006) * S;
        if (p.trap) trapY = Math.max(trapY, ay * S, by * S);
        if (p.pop) kickWalls.push({ ax: ax * S, ay: ay * S, bx: bx * S, by: by * S, reach: t / 2 + r + 0.01, speed: p.pop * S });
        box(((ax + bx) / 2) * S, ((ay + by) / 2) * S, (Math.hypot(bx - ax, by - ay) * S) / 2, t / 2, (Math.atan2(by - ay, bx - ax) * 180) / Math.PI, p.color, p.trap, p.bounce);
        // 양 끝에 둥근 마개: 꺾여 이어지는 벽의 모서리가 틈이나 튀어나온 끝 없이 둥글게 이어진다
        if (!p.flush)
          for (const [cx, cy] of [p.a, p.b]) {
            const pos: Vec3 = [cx * S, cy * S, H / 2];
            if (p.trap) trap.push(statics.length);
            statics.push({ shape: { kind: 'cylinder', halfHeight: H / 2, radius: t / 2 }, pos, rot: UP, restitution: p.bounce });
            visuals.push({ kind: 'peg', pos, radius: t / 2, height: H, color: p.color ?? 'wood', trap: p.trap });
          }
        break;
      }
      case 'box':
        box(p.at[0] * S, p.at[1] * S, (p.size[0] * S) / 2, (p.size[1] * S) / 2, p.deg, p.color);
        break;
      case 'hole':
        holes.push({ x: p.at[0] * S, y: p.at[1] * S, r: p.r * S, to: [p.to[0] * S, p.to[1] * S], max: p.max ?? 2 });
        visuals.push({ kind: 'hole', pos: [p.at[0] * S, p.at[1] * S, 0], radius: p.r * S });
        break;
      case 'peg': {
        const pos: Vec3 = [p.at[0] * S, p.at[1] * S, H / 2];
        statics.push({ shape: { kind: 'cylinder', halfHeight: H / 2, radius: p.r * S }, pos, rot: UP, restitution: p.bounce });
        visuals.push({ kind: 'peg', pos, radius: p.r * S, height: H, color: p.color });
        if (p.pop) poppers.push({ x: pos[0], y: pos[1], reach: p.r * S + r + 0.01, speed: p.pop * S });
        break;
      }
      case 'spinner':
      case 'slider': {
        // 판에서 0.1mm 떠 있다. 로컬 좌표는 [가로, 법선, 세로].
        const hy = H / 2 - 0.01;
        let halves: Vec3[];
        const shift = p.type === 'spinner' && p.end ? (p.length * S) / 2 : 0;
        let parts: MoverSpec['parts'];
        let tips: MoverSpec['tips'];
        if (p.type === 'spinner' && p.arms) {
          // 중심에서 팔 arms개가 고르게 뻗는 바람개비. 팔 길이는 length/2
          const R = (p.length * S) / 2;
          parts = Array.from({ length: p.arms }, (_, k) => {
            const t = (2 * Math.PI * k) / p.arms!;
            return { half: [R / 2, hy, 0.004 * S] as Vec3, pos: [(Math.cos(t) * R) / 2, 0, (-Math.sin(t) * R) / 2] as Vec3, rot: [0, Math.sin(t / 2), 0, Math.cos(t / 2)] as Quat };
          });
          halves = [];
        } else if (p.type === 'spinner') {
          const arm: Vec3 = [(p.length * S) / 2, hy, ((p.thick ?? 0.008) * S) / 2];
          halves = p.cross ? [arm, [arm[2], hy, arm[0]]] : [arm];
          if (p.tips && !p.cross) {
            const tl = (p.tips * S) / 2;
            tips = { half: [tl, hy + 0.005, arm[2] + 0.005], at: [shift - arm[0] + tl, shift + arm[0] - tl] };
            // 본체는 빨간 끝 앞에서 끊는다. 겹치면 구슬이 본체(잘 안 튕김)에도 같이 닿아 튕김이 약해진다.
            halves = [[arm[0] - 2 * tl, hy, arm[2]]];
          }
        } else halves = [[(p.size[0] * S) / 2, hy, (p.size[1] * S) / 2]];
        movers.push({
          // 마찰 0: 막대와 벽 사이에 낀 구슬이 물리지 않고 벌어진 쪽으로 미끄러져 나온다
          colliders: [
            ...(parts
              ? parts.map(({ half, pos, rot }) => ({ shape: { kind: 'box' as const, half }, pos, rot, friction: 0 }))
              : halves.map((half) => ({ shape: { kind: 'box' as const, half }, pos: [shift, 0, 0] as Vec3, friction: 0 }))),
            // 빨간 끝은 막대보다 0.5mm 두꺼워 먼저 닿는다
            ...(tips ? tips.at.map((x) => ({ shape: { kind: 'box' as const, half: tips.half }, pos: [x, 0, 0] as Vec3, friction: 0, restitution: 1.3 })) : []),
          ],
          halves,
          parts,
          shift,
          tips,
          color: p.color ?? 'red',
          pos: [p.at[0] * S, p.at[1] * S, H / 2],
          rot: p.type === 'slider' && p.deg ? qmul(qZ(p.deg), UP) : UP,
          phase: p.phase ?? 0,
          ...(p.type === 'spinner'
            ? { spin: ((p.rpm * 2 * Math.PI) / 60) * DT }
            : { slide: { dir: [1, 0, 0] as Vec3, amp: p.amp * S, period: p.period / DT } }),
        });
        break;
      }
    }
  }

  const tilt = rad(json.tiltDeg);
  const barHalf = 0.003 * S;
  const pitch = 2 * r + 0.002 * S; // 윗줄과의 간격
  return {
    id: json.id,
    material: { friction: json.marble.friction, restitution: json.marble.restitution },
    gravity: [0, -GRAVITY * Math.sin(tilt), -GRAVITY * Math.cos(tilt)],
    marble: { radius: r, density: json.marble.density, rolling: json.marble.rollingResistance },
    statics,
    finishIndex,
    finishY,
    startY,
    halfWidth: hw,
    top,
    bottom,
    wallH: H,
    visuals,
    movers,
    poppers,
    holes,
    kickWalls,
    trap,
    trapY,
    // 게이트는 판에서 솟아올라(+z) 길을 연다
    gate: { pos: [0, startY - barHalf, H / 2], half: [hw, barHalf, H / 2], lift: H + 0.1, liftSteps: Math.max(1, Math.round(json.start.liftTime / DT)) },
    slotPosition(k, n, jitter) {
      // 한 줄을 폭 전체에 고르게 편다. 슬롯이 넓으면 그 안에서 흩을 여유도 크다.
      const cols = Math.min(n, json.start.slots);
      const row = Math.floor(k / json.start.slots);
      const col = k % json.start.slots;
      const slotW = Math.max(json.start.slotWidth * S, (2 * hw) / cols);
      return [(col - (cols - 1) / 2) * slotW + jitter * (slotW / 2 - r - 0.001 * S), startY + r + 0.001 * S + row * pitch, r];
    },
    marks: (json.marks ?? []).map((y) => startY - y * S),
    spot: json.spot ? [json.spot[0] * S, json.spot[1] * S] : null,
  };
}
