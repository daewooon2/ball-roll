// three.js 장면. race의 상태를 읽기만 한다.
// 드로콜: 판 1 + 나무 벽 1 + 색 블록 1 + 핀 1 + 결승선 1 + 구슬 1 + 그림자 1 + 게이트 1 + 움직이는 장애물마다 1
import {
  BoxGeometry,
  BufferAttribute,
  type BufferGeometry,
  CanvasTexture,
  CircleGeometry,
  Color,
  CylinderGeometry,
  DirectionalLight,
  HemisphereLight,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  NearestFilter,
  PerspectiveCamera,
  PlaneGeometry,
  RingGeometry,
  Quaternion,
  RepeatWrapping,
  Scene as ThreeScene,
  SphereGeometry,
  SRGBColorSpace,
  Vector3,
  WebGLRenderer,
  type Material,
  type Object3D,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { QUALITY, type QualityName } from '../config';
import type { BuiltMap } from '../map/build';
import type { Race } from '../race/race';

const COLORS: Record<string, number> = {
  red: 0xe5484d,
  orange: 0xf08c3a,
  yellow: 0xf2c94c,
  green: 0x4caf6e,
  blue: 0x3f8fe0,
  purple: 0x9b6bdf,
  peg: 0xdfe4ec,
};

function canvasTexture(w: number, h: number, draw: (c: CanvasRenderingContext2D) => void) {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  draw(canvas.getContext('2d')!);
  const t = new CanvasTexture(canvas);
  t.colorSpace = SRGBColorSpace;
  return t;
}

// 나무결은 내려받지 않고 그린다(다운로드 0바이트). 무늬 위치는 고정이라 Math.random을 쓰지 않는다.
function woodTexture() {
  const t = canvasTexture(256, 256, (c) => {
    c.fillStyle = '#c99a62';
    c.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 90; i++) {
      const y = (i * 97) % 256;
      c.strokeStyle = `rgba(${90 + ((i * 53) % 60)}, 55, 20, ${0.08 + ((i * 31) % 10) / 60})`;
      c.lineWidth = 1 + ((i * 7) % 3);
      c.beginPath();
      c.moveTo(0, y);
      c.bezierCurveTo(80, y + ((i * 13) % 9) - 4, 170, y - ((i * 17) % 9) + 4, 256, y);
      c.stroke();
    }
  });
  t.wrapS = t.wrapT = RepeatWrapping;
  return t;
}

// 구슬이 구르는 게 보이도록 띠와 점을 넣는다. 인스턴스 색과 곱해진다.
const marbleTexture = () =>
  canvasTexture(128, 64, (c) => {
    c.fillStyle = '#fff';
    c.fillRect(0, 0, 128, 64);
    c.fillStyle = 'rgba(0,0,0,0.28)';
    c.fillRect(0, 26, 128, 12);
    c.fillStyle = 'rgba(255,255,255,0.9)';
    for (let i = 0; i < 4; i++) c.fillRect(i * 32 + 10, 29, 12, 6);
  });

const blobTexture = () =>
  canvasTexture(64, 64, (c) => {
    const g = c.createRadialGradient(32, 32, 2, 32, 32, 32);
    g.addColorStop(0, 'rgba(0,0,0,0.45)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    c.fillStyle = g;
    c.fillRect(0, 0, 64, 64);
  });

function checkerTexture() {
  const t = canvasTexture(2, 2, (c) => {
    c.fillStyle = '#fff';
    c.fillRect(0, 0, 2, 2);
    c.fillStyle = '#111';
    c.fillRect(0, 0, 1, 1);
    c.fillRect(1, 1, 1, 1);
  });
  t.magFilter = NearestFilter;
  t.wrapS = t.wrapT = RepeatWrapping;
  return t;
}

/** 합칠 도형에 꼭짓점 색을 입힌다. */
function paint<T extends BufferGeometry>(g: T, color: string | undefined, fallback: string) {
  const rgb = new Color(COLORS[color ?? fallback] ?? color).toArray();
  const n = g.getAttribute('position').count * 3;
  g.setAttribute('color', new BufferAttribute(new Float32Array(n).map((_, i) => rgb[i % 3]), 3));
  return g;
}

export class Scene {
  readonly renderer: WebGLRenderer;
  readonly camera = new PerspectiveCamera(45, 1, 0.05, 300);
  private scene = new ThreeScene();
  private sun = new DirectionalLight(0xffffff, 2.2);
  private wood = new MeshStandardMaterial({ map: woodTexture(), roughness: 0.75 });
  private statics: Object3D[] = [];
  private dynamics: Object3D[] = [];
  private marbles?: InstancedMesh;
  private blobs?: InstancedMesh;
  private gate?: Mesh;
  private trap: Mesh[] = [];
  /** 뭉침 폭발 효과: 퍼지며 사라지는 고리 */
  private flash = new Mesh(new RingGeometry(0.7, 1, 32), new MeshBasicMaterial({ color: 0xfff1a8, transparent: true, depthWrite: false }));
  private flashAt = -Infinity;
  private movers: Mesh[] = [];
  private quality = QUALITY.normal;
  /** 이번 프레임에 그린(보간된) 구슬 위치. 이름표가 읽는다. */
  renderPos = new Float32Array(0);

  constructor(readonly canvas: HTMLCanvasElement) {
    this.renderer = new WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.setClearColor(0x20242c);
    this.scene.add(new HemisphereLight(0xdfe9ff, 0x4a3a2a, 1.4));
    this.sun.shadow.mapSize.set(1024, 1024);
    // 그림자 영역은 카메라가 보는 곳 주변만 덮는다
    Object.assign(this.sun.shadow.camera, { left: -5, right: 5, top: 5, bottom: -5, near: 1, far: 40 });
    this.sun.shadow.bias = -0.002;
    this.scene.add(this.sun, this.sun.target);
    this.flash.visible = false;
    this.scene.add(this.flash);
  }

  /** (x, y)에서 터지는 효과를 시작한다. */
  burst(x: number, y: number) {
    this.flash.position.set(x, y, 0.3);
    this.flashAt = performance.now(); // 화면 효과용. 경주 시간과 무관
  }

  setQuality(name: QualityName) {
    this.quality = QUALITY[name];
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, this.quality.dpr));
    this.renderer.shadowMap.enabled = this.quality.shadowMap;
    this.sun.castShadow = this.quality.shadowMap;
    this.resize();
  }

  resize() {
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    if (!w || !h) return;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    // 패널이 가린 만큼 장면을 옆이나 위로 민다
    if (this.shiftX || this.shiftY) this.camera.setViewOffset(w, h, -this.shiftX, -this.shiftY, w, h);
    else this.camera.clearViewOffset();
    this.camera.updateProjectionMatrix();
  }

  private shiftX = 0;
  private shiftY = 0;
  /** 장면 중심을 화면에서 (dx, dy)px 옮긴다. 입력 패널에 구슬이 가리지 않게 할 때 쓴다. */
  setViewShift(dx: number, dy: number) {
    this.shiftX = dx;
    this.shiftY = dy;
    this.resize();
  }

  private clear(list: Object3D[]) {
    for (const o of list) {
      this.scene.remove(o);
      const m = o as Mesh;
      m.geometry?.dispose();
      if (m.material !== this.wood) (m.material as Material)?.dispose();
    }
    list.length = 0;
  }

  /** 코스의 고정 메시를 만든다. */
  setMap(map: BuiltMap) {
    this.clear(this.statics);
    const walls: BufferGeometry[] = [];
    const blocks: BufferGeometry[] = [];
    const pegs: BufferGeometry[] = [];
    const trapBlocks: BufferGeometry[] = [];
    const q = new Quaternion();
    const add = (mesh: Mesh) => {
      mesh.receiveShadow = true;
      this.scene.add(mesh);
      this.statics.push(mesh);
    };
    for (const v of map.visuals) {
      if (v.kind === 'hole') continue;
      if (v.kind === 'peg') {
        const g = new CylinderGeometry(v.radius, v.radius, v.height, v.radius > 0.05 ? 24 : 10).rotateX(Math.PI / 2).translate(v.pos[0], v.pos[1], v.pos[2]);
        // 벽의 둥근 끝은 벽과 같은 나무
        if (v.color === 'wood') (v.trap ? trapBlocks : walls).push(g);
        else pegs.push(paint(g, v.color, 'peg'));
        continue;
      }
      const g = new BoxGeometry(v.half[0] * 2, v.half[1] * 2, v.half[2] * 2);
      g.applyQuaternion(q.fromArray(v.rot));
      g.translate(v.pos[0], v.pos[1], v.pos[2]);
      if (v.color === 'plate') {
        // 판은 벽보다 어둡게 칠해 구슬과 장애물이 도드라지게 한다. 나무결은 판 길이만큼 되풀이한다.
        const tex = woodTexture();
        tex.repeat.set(1, v.half[1] / v.half[0]);
        add(new Mesh(g, new MeshStandardMaterial({ map: tex, color: 0x6f6a78, roughness: 0.9 })));
      } else if (v.trap) trapBlocks.push(g);
      else if (v.color) blocks.push(paint(g, v.color, 'red'));
      else walls.push(g);
    }
    if (walls.length) add(new Mesh(mergeGeometries(walls), this.wood));
    if (blocks.length) add(new Mesh(mergeGeometries(blocks), new MeshStandardMaterial({ vertexColors: true, roughness: 0.6 })));
    if (pegs.length) add(new Mesh(mergeGeometries(pegs), new MeshStandardMaterial({ vertexColors: true, roughness: 0.35, metalness: 0.3 })));
    // 안전망이 걸리면 사라지는 결승 깔때기 벽은 따로 둔다
    this.trap = trapBlocks.length ? [new Mesh(mergeGeometries(trapBlocks), this.wood)] : [];
    // 다른 벽과 윗면이 겹치는 곳이 깜빡이지 않게 아주 조금 높인다
    for (const m of this.trap) m.scale.z = 1.01;
    this.trap.forEach(add);
    for (const g of [...walls, ...blocks, ...pegs, ...trapBlocks]) g.dispose();

    // 구멍 함정: 검은 구멍 + 붉은 테두리
    const holes = map.visuals.filter((v) => v.kind === 'hole');
    if (holes.length) {
      const dark = mergeGeometries(holes.map((v) => new CircleGeometry(v.radius, 24).translate(v.pos[0], v.pos[1], 0.006)));
      const rim = mergeGeometries(holes.map((v) => new RingGeometry(v.radius, v.radius * 1.25, 24).translate(v.pos[0], v.pos[1], 0.007)));
      add(new Mesh(dark, new MeshBasicMaterial({ color: 0x050505 })));
      add(new Mesh(rim, new MeshBasicMaterial({ color: 0xe5484d })));
    }

    // 결승선
    const checker = checkerTexture();
    checker.repeat.set(map.halfWidth / 0.2, 1);
    const line = new Mesh(new PlaneGeometry(map.halfWidth * 2, 0.4), new MeshBasicMaterial({ map: checker }));
    line.position.set(0, map.finishY, 0.01);
    add(line);
  }

  /** 경주 하나의 움직이는 메시(구슬, 그림자, 게이트, 움직이는 장애물)를 만든다. */
  setRace(race: Race, colors: string[]) {
    this.clear(this.dynamics);
    const { map, n } = race;
    const r = map.marble.radius;
    const add = <T extends Object3D>(o: T) => {
      this.scene.add(o);
      this.dynamics.push(o);
      return o;
    };
    this.renderPos = new Float32Array(n * 3);

    const glass = this.quality.glass
      ? new MeshPhysicalMaterial({ map: marbleTexture(), roughness: 0.05, transmission: 0.55, thickness: r, ior: 1.5 })
      : new MeshStandardMaterial({ map: marbleTexture(), roughness: 0.15, metalness: 0.1 });
    this.marbles = add(new InstancedMesh(new SphereGeometry(r, 24, 16), glass, n));
    this.marbles.castShadow = true;
    this.marbles.frustumCulled = false;
    const c = new Color();
    colors.forEach((css, i) => this.marbles!.setColorAt(i, c.set(css)));

    if (!this.quality.shadowMap) {
      const blob = new MeshBasicMaterial({ map: blobTexture(), transparent: true, depthWrite: false });
      this.blobs = add(new InstancedMesh(new CircleGeometry(r * 1.5, 16), blob, n));
      this.blobs.frustumCulled = false;
    } else this.blobs = undefined;

    const q = new Quaternion();
    this.movers = map.movers.map(({ halves, parts, color, shift, tips }) => {
      const geometry = mergeGeometries(
        parts
          ? parts.map(({ half: h, pos, rot }) => new BoxGeometry(h[0] * 2, h[1] * 2, h[2] * 2).applyQuaternion(q.fromArray(rot)).translate(pos[0], pos[1], pos[2]))
          : halves.map((h) => new BoxGeometry(h[0] * 2, h[1] * 2, h[2] * 2).translate(shift, 0, 0)),
      );
      const mesh = new Mesh(geometry, new MeshStandardMaterial({ color: COLORS[color] ?? color, roughness: 0.5 }));
      mesh.castShadow = true;
      if (tips) {
        const h = tips.half;
        const red = mergeGeometries(tips.at.map((x) => new BoxGeometry(h[0] * 2, h[1] * 2, h[2] * 2).translate(x, 0, 0)));
        mesh.add(new Mesh(red, new MeshStandardMaterial({ color: COLORS.red, roughness: 0.4 })));
      }
      return add(mesh);
    });

    const g = map.gate;
    this.gate = add(new Mesh(new BoxGeometry(g.half[0] * 2, g.half[1] * 2, g.half[2] * 2), new MeshStandardMaterial({ color: 0x2f3742 })));
  }

  private m = new Matrix4();
  private q0 = new Quaternion();
  private q1 = new Quaternion();
  private v = new Vector3();
  private one = new Vector3(1, 1, 1);

  /** alpha = 직전 스텝과 현재 스텝 사이의 보간 비율 */
  render(race: Race, alpha: number, target: Vector3) {
    const { m, q0, q1, v } = this;
    const lerp = (a: Float32Array, b: Float32Array, i: number) => a[i] + (b[i] - a[i]) * alpha;
    const r = race.map.marble.radius;
    for (let i = 0; i < race.n; i++) {
      const k = i * 3;
      v.set(lerp(race.prevPos, race.pos, k), lerp(race.prevPos, race.pos, k + 1), lerp(race.prevPos, race.pos, k + 2));
      v.toArray(this.renderPos, k);
      q0.fromArray(race.prevRot, i * 4).slerp(q1.fromArray(race.rot, i * 4), alpha);
      this.marbles!.setMatrixAt(i, m.compose(v, q0, this.one));
      // 그림자는 판 위에, 빛 반대쪽으로 조금 밀어 놓는다
      if (this.blobs) this.blobs.setMatrixAt(i, m.makeTranslation(v.x - r * 0.3, v.y - r * 0.4, 0.012));
    }
    this.marbles!.instanceMatrix.needsUpdate = true;
    if (this.blobs) this.blobs.instanceMatrix.needsUpdate = true;

    this.movers.forEach((mesh, i) => {
      const k = i * 3;
      mesh.position.set(lerp(race.prevMoverPos, race.moverPos, k), lerp(race.prevMoverPos, race.moverPos, k + 1), lerp(race.prevMoverPos, race.moverPos, k + 2));
      mesh.quaternion.fromArray(race.prevMoverRot, i * 4).slerp(q1.fromArray(race.moverRot, i * 4), alpha);
    });
    this.gate!.position.set(lerp(race.prevGatePos, race.gatePos, 0), lerp(race.prevGatePos, race.gatePos, 1), lerp(race.prevGatePos, race.gatePos, 2));

    const k = (performance.now() - this.flashAt) / 450;
    this.flash.visible = k < 1;
    if (k < 1) {
      this.flash.scale.setScalar(0.3 + k * 1.6);
      (this.flash.material as MeshBasicMaterial).opacity = 1 - k;
    }
    // 빛은 보는 곳을 따라다닌다(판이 길어서 한자리에 두면 그림자 영역을 벗어난다)
    this.sun.target.position.copy(target);
    this.sun.position.copy(target).add(v.set(3, 5, 12));
    this.renderer.render(this.scene, this.camera);
  }

  /** 구슬 i의 화면 좌표(px). 카메라 뒤에 있으면 null. */
  screenPosition(i: number, out: { x: number; y: number }) {
    const v = this.v.fromArray(this.renderPos, i * 3).project(this.camera);
    if (v.z > 1) return null;
    out.x = (v.x * 0.5 + 0.5) * this.canvas.clientWidth;
    out.y = (-v.y * 0.5 + 0.5) * this.canvas.clientHeight;
    return out;
  }
}
