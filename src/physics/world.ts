// Rapier를 import하는 유일한 파일. 엔진을 바꿀 때는 이 파일만 다시 쓴다.
import RAPIER from '@dimforge/rapier3d';
import { DT, GRAVITY } from '../config';

export type Vec3 = [number, number, number];
export type Quat = [number, number, number, number]; // x, y, z, w

export type Shape =
  | { kind: 'box'; half: Vec3 }
  | { kind: 'ball'; radius: number }
  | { kind: 'cylinder'; halfHeight: number; radius: number }
  | { kind: 'hull'; points: number[] }
  | { kind: 'trimesh'; vertices: number[]; indices: number[] };

export interface ColliderSpec {
  shape: Shape;
  pos: Vec3;
  rot?: Quat;
  sensor?: boolean;
  friction?: number;
  restitution?: number;
  density?: number;
}

export interface Material {
  friction: number;
  restitution: number;
}

const v3 = (v: Vec3) => ({ x: v[0], y: v[1], z: v[2] });
const q4 = (q: Quat) => ({ x: q[0], y: q[1], z: q[2], w: q[3] });

export class Body {
  constructor(
    readonly rb: RAPIER.RigidBody,
    readonly colliders: number[],
  ) {}

  /** 위치와 회전을 배열의 i번째 칸에 쓴다. */
  read(pos: Float32Array, rot: Float32Array, i: number) {
    const t = this.rb.translation();
    const r = this.rb.rotation();
    pos[i * 3] = t.x;
    pos[i * 3 + 1] = t.y;
    pos[i * 3 + 2] = t.z;
    rot[i * 4] = r.x;
    rot[i * 4 + 1] = r.y;
    rot[i * 4 + 2] = r.z;
    rot[i * 4 + 3] = r.w;
  }
  position(): Vec3 {
    const t = this.rb.translation();
    return [t.x, t.y, t.z];
  }
  velocity(): Vec3 {
    const v = this.rb.linvel();
    return [v.x, v.y, v.z];
  }
  speed(): number {
    const v = this.rb.linvel();
    return Math.hypot(v.x, v.y, v.z);
  }
  setVelocity(v: Vec3) {
    this.rb.setLinvel(v3(v), true);
  }
  addVelocity(v: Vec3) {
    const c = this.rb.linvel();
    this.rb.setLinvel({ x: c.x + v[0], y: c.y + v[1], z: c.z + v[2] }, true);
  }
  angularSpeed(): number {
    const w = this.rb.angvel();
    return Math.hypot(w.x, w.y, w.z);
  }
  scaleAngularVelocity(f: number) {
    const w = this.rb.angvel();
    this.rb.setAngvel({ x: w.x * f, y: w.y * f, z: w.z * f }, false);
  }
  teleport(pos: Vec3) {
    this.rb.setTranslation(v3(pos), true);
    this.rb.setLinvel({ x: 0, y: 0, z: 0 }, true);
    this.rb.setAngvel({ x: 0, y: 0, z: 0 }, true);
  }
  /** 운동학 강체 전용: 다음 스텝의 위치. */
  moveTo(pos: Vec3) {
    this.rb.setNextKinematicTranslation(v3(pos));
  }
  /** 운동학 강체 전용: 다음 스텝의 자세(배열의 i번째 칸에서 읽는다). */
  poseTo(pos: Float32Array, rot: Float32Array, i: number) {
    this.rb.setNextKinematicTranslation({ x: pos[i * 3], y: pos[i * 3 + 1], z: pos[i * 3 + 2] });
    this.rb.setNextKinematicRotation({ x: rot[i * 4], y: rot[i * 4 + 1], z: rot[i * 4 + 2], w: rot[i * 4 + 3] });
  }
}

export class PhysicsWorld {
  private world: RAPIER.World;
  private queue = new RAPIER.EventQueue(true);
  /** 직전 step()에서 시작된 센서 교차 [충돌체 핸들, 충돌체 핸들]. */
  readonly sensorEvents: [number, number][] = [];

  constructor(
    private material: Material,
    gravity: Vec3 = [0, -GRAVITY, 0],
  ) {
    this.world = new RAPIER.World(v3(gravity));
    this.world.timestep = DT;
  }

  private desc(spec: ColliderSpec): RAPIER.ColliderDesc {
    const s = spec.shape;
    let d: RAPIER.ColliderDesc | null;
    switch (s.kind) {
      case 'box':
        d = RAPIER.ColliderDesc.cuboid(s.half[0], s.half[1], s.half[2]);
        break;
      case 'ball':
        d = RAPIER.ColliderDesc.ball(s.radius);
        break;
      case 'cylinder':
        d = RAPIER.ColliderDesc.cylinder(s.halfHeight, s.radius);
        break;
      case 'hull':
        d = RAPIER.ColliderDesc.convexHull(new Float32Array(s.points));
        break;
      case 'trimesh':
        d = RAPIER.ColliderDesc.trimesh(
          new Float32Array(s.vertices),
          new Uint32Array(s.indices),
          RAPIER.TriMeshFlags.FIX_INTERNAL_EDGES,
        );
        break;
    }
    if (!d) throw new Error(`충돌체를 만들 수 없음: ${s.kind}`);
    d.setTranslation(spec.pos[0], spec.pos[1], spec.pos[2])
      .setFriction(spec.friction ?? this.material.friction)
      .setRestitution(spec.restitution ?? this.material.restitution);
    if (spec.rot) d.setRotation(q4(spec.rot));
    if (spec.density !== undefined) d.setDensity(spec.density);
    if (spec.friction === 0) d.setFrictionCombineRule(RAPIER.CoefficientCombineRule.Min);
    // 잘 튕기는 것(반발 1 이상)은 구슬의 반발과 평균 내지 않고 큰 값을 쓴다
    if ((spec.restitution ?? 0) >= 1) d.setRestitutionCombineRule(RAPIER.CoefficientCombineRule.Max);
    if (spec.sensor) d.setSensor(true).setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS);
    return d;
  }

  /** 고정 충돌체. 충돌체 핸들을 돌려준다. */
  addStatic(spec: ColliderSpec): number {
    return this.world.createCollider(this.desc(spec)).handle;
  }

  removeStatic(handle: number) {
    this.world.removeCollider(this.world.getCollider(handle), false);
  }

  /** 동적 강체. colliders의 pos/rot은 강체 기준 로컬 좌표. */
  addDynamic(colliders: ColliderSpec[], pos: Vec3, rot?: Quat, opts: { sleeping?: boolean } = {}): Body {
    const bd = RAPIER.RigidBodyDesc.dynamic().setTranslation(pos[0], pos[1], pos[2]);
    if (rot) bd.setRotation(q4(rot));
    if (opts.sleeping) bd.setSleeping(true);
    else bd.setCanSleep(false);
    return this.attach(this.world.createRigidBody(bd), colliders);
  }

  addKinematic(colliders: ColliderSpec[], pos: Vec3, rot?: Quat): Body {
    const bd = RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(pos[0], pos[1], pos[2]);
    if (rot) bd.setRotation(q4(rot));
    return this.attach(this.world.createRigidBody(bd), colliders);
  }

  private attach(rb: RAPIER.RigidBody, colliders: ColliderSpec[]): Body {
    return new Body(
      rb,
      colliders.map((c) => this.world.createCollider(this.desc(c), rb).handle),
    );
  }

  remove(body: Body) {
    this.world.removeRigidBody(body.rb);
  }

  /** 실제 접촉점이 하나라도 있는지. */
  inContact(body: Body): boolean {
    const mine = this.world.getCollider(body.colliders[0]);
    let touching = false;
    this.world.contactPairsWith(mine, (other) => {
      if (touching) return;
      this.world.contactPair(mine, other, (manifold) => {
        if (manifold.numContacts() > 0) touching = true;
      });
    });
    return touching;
  }

  step() {
    this.sensorEvents.length = 0;
    this.world.step(this.queue);
    this.queue.drainCollisionEvents((h1, h2, started) => {
      if (started) this.sensorEvents.push([h1, h2]);
    });
  }

  free() {
    this.queue.free();
    this.world.free();
  }
}
