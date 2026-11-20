// three.js 장면. race의 상태를 읽기만 한다.
// 드로콜: 나무 1 + 소용돌이 1 + 쐐기 1 + 구슬 1 + 핀 1 + 그림자 1 + 게이트 1 = 7
import {
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  CircleGeometry,
  Color,
  CylinderGeometry,
  DirectionalLight,
  DoubleSide,
  HemisphereLight,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  PerspectiveCamera,
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

const WEDGE_COLORS: Record<string, number> = {
  red: 0xe5484d,
  orange: 0xf08c3a,
  yellow: 0xf2c94c,
  green: 0x4caf6e,
  blue: 0x3f8fe0,
  purple: 0x9b6bdf,
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

export class Scene {
  readonly renderer: WebGLRenderer;
  readonly camera = new PerspectiveCamera(45, 1, 0.05, 300);
  private scene = new ThreeScene();
  private sun = new DirectionalLight(0xffffff, 2.2);
  private wood = new MeshStandardMaterial({ map: woodTexture(), roughness: 0.75 });
  private statics: Object3D[] = [];
  private dynamics: Object3D[] = [];
  private marbles?: InstancedMesh;
  private pins?: InstancedMesh;
  private blobs?: InstancedMesh;
  private gate?: Mesh;
  private quality = QUALITY.normal;
  /** 이번 프레임에 그린(보간된) 구슬 위치. 이름표와 카메라가 읽는다. */
  renderPos = new Float32Array(0);

  constructor(readonly canvas: HTMLCanvasElement) {
    this.renderer = new WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.setClearColor(0x20242c);
    this.scene.add(new HemisphereLight(0xdfe9ff, 0x4a3a2a, 1.4));
    this.sun.position.set(6, 14, 9);
    this.sun.shadow.mapSize.set(1024, 1024);
    // 그림자 영역은 카메라가 보는 곳 주변만 덮는다
    Object.assign(this.sun.shadow.camera, { left: -5, right: 5, top: 5, bottom: -5, near: 1, far: 40 });
    this.sun.shadow.bias = -0.002;
    this.scene.add(this.sun, this.sun.target);
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
    const boxes: BufferGeometry[] = [];
    const prisms: BufferGeometry[] = [];
    const q = new Quaternion();
    const add = (mesh: Mesh) => {
      mesh.receiveShadow = true;
      this.scene.add(mesh);
      this.statics.push(mesh);
    };
    for (const v of map.visuals) {
      if (v.kind === 'box') {
        const g = new BoxGeometry(v.half[0] * 2, v.half[1] * 2, v.half[2] * 2);
        g.applyQuaternion(q.fromArray(v.rot));
        g.translate(v.pos[0], v.pos[1], v.pos[2]);
        boxes.push(g);
      } else if (v.kind === 'prism') {
        // 점 6개(아래 삼각형 0-2, 위 삼각형 3-5) → 윗면 + 옆면 3개. 면마다 법선이 따로라 인덱스 없이 만든다.
        const p = (i: number) => v.points.slice(i * 3, i * 3 + 3);
        const tris = [3, 4, 5, 0, 1, 4, 0, 4, 3, 1, 2, 5, 1, 5, 4, 2, 0, 3, 2, 3, 5].flatMap(p);
        const g = new BufferGeometry();
        g.setAttribute('position', new BufferAttribute(new Float32Array(tris), 3));
        g.computeVertexNormals();
        const c = new Color(WEDGE_COLORS[v.color] ?? v.color);
        const rgb = c.toArray();
        g.setAttribute('color', new BufferAttribute(new Float32Array(tris.length).map((_, i) => rgb[i % 3]), 3));
        prisms.push(g);
      } else {
        const g = new BufferGeometry();
        g.setAttribute('position', new BufferAttribute(new Float32Array(v.vertices), 3));
        g.setIndex(v.indices);
        g.computeVertexNormals();
        // 위에서 내려다보면 원뿔이 평평한 원으로 보이므로, 낮은 곳일수록 어둡게 칠해 깊이를 보인다
        let lo = Infinity;
        let hi = -Infinity;
        for (let i = 1; i < v.vertices.length; i += 3) {
          lo = Math.min(lo, v.vertices[i]);
          hi = Math.max(hi, v.vertices[i]);
        }
        const shade = new Float32Array(v.vertices.length);
        for (let i = 0; i < shade.length; i += 3) shade.fill(0.35 + (0.65 * (v.vertices[i + 1] - lo)) / (hi - lo), i, i + 3);
        g.setAttribute('color', new BufferAttribute(shade, 3));
        add(new Mesh(g, new MeshStandardMaterial({ color: 0xd6a066, roughness: 0.7, side: DoubleSide, vertexColors: true })));
      }
    }
    if (boxes.length) add(new Mesh(mergeGeometries(boxes), this.wood));
    if (prisms.length)
      add(new Mesh(mergeGeometries(prisms), new MeshStandardMaterial({ vertexColors: true, roughness: 0.6, side: DoubleSide })));
    for (const g of [...boxes, ...prisms]) g.dispose();
  }

  /** 경주 하나의 움직이는 메시(구슬, 핀, 그림자, 게이트)를 만든다. */
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

    if (map.pins.length) {
      const p = map.pins[0];
      const body = new CylinderGeometry(p.radius * 0.8, p.radius, p.height, 10).translate(0, p.height / 2, 0);
      const head = new SphereGeometry(p.headRadius, 10, 8).translate(0, p.height + p.headRadius * 0.4, 0);
      this.pins = add(
        new InstancedMesh(mergeGeometries([body, head]), new MeshStandardMaterial({ color: 0xf4f1ea, roughness: 0.4 }), map.pins.length),
      );
      this.pins.castShadow = true;
      this.pins.frustumCulled = false;
    } else this.pins = undefined;

    if (!this.quality.shadowMap) {
      const blob = new MeshBasicMaterial({ map: blobTexture(), transparent: true, depthWrite: false });
      // 경사면에 반쯤 묻히지 않게 카메라 쪽으로 당긴다
      Object.assign(blob, { polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 });
      this.blobs = add(new InstancedMesh(new CircleGeometry(r * 1.5, 16).rotateX(-Math.PI / 2), blob, n));
      this.blobs.frustumCulled = false;
    } else this.blobs = undefined;

    const g = map.gate;
    this.gate = add(new Mesh(new BoxGeometry(g.half[0] * 2, g.half[1] * 2, g.half[2] * 2), new MeshStandardMaterial({ color: 0x2f3742 })));
    this.gate.quaternion.fromArray(g.rot);
  }

  private m = new Matrix4();
  private q0 = new Quaternion();
  private q1 = new Quaternion();
  private v = new Vector3();
  private one = new Vector3(1, 1, 1);
  private zero = new Vector3(0, 0, 0);

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
      if (this.blobs) {
        v.y -= r - 0.01;
        this.blobs.setMatrixAt(i, m.makeTranslation(v.x, v.y, v.z));
      }
    }
    this.marbles!.instanceMatrix.needsUpdate = true;
    if (this.blobs) this.blobs.instanceMatrix.needsUpdate = true;

    if (this.pins) {
      for (let i = 0; i < race.pinAlive.length; i++) {
        const k = i * 3;
        v.set(lerp(race.prevPinPos, race.pinPos, k), lerp(race.prevPinPos, race.pinPos, k + 1), lerp(race.prevPinPos, race.pinPos, k + 2));
        q0.fromArray(race.prevPinRot, i * 4).slerp(q1.fromArray(race.pinRot, i * 4), alpha);
        this.pins.setMatrixAt(i, m.compose(v, q0, race.pinAlive[i] ? this.one : this.zero));
      }
      this.pins.instanceMatrix.needsUpdate = true;
    }
    this.gate!.position.set(lerp(race.prevGatePos, race.gatePos, 0), lerp(race.prevGatePos, race.gatePos, 1), lerp(race.prevGatePos, race.gatePos, 2));

    if (this.quality.shadowMap) {
      this.sun.target.position.copy(target);
      this.sun.position.copy(target).add(v.set(3, 12, 5));
    }
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
