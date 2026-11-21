// 추격 카메라. 판 아래쪽에서 위를 올려다보며 선두를 따라 내려간다(구슬이 화면 쪽으로 달려온다).
// - 출발 전·섞는 동안: 출발 칸을 보는 고정 시점(시드와 무관해서 셔플해도 바뀌지 않는다)
// - 달리는 동안: 선두와 2등을 함께 담고, 빠를수록 화각이 넓어지고, 선두가 좌우로 움직이면 따라 돈다
// - 결승 직전: 바짝 다가가 낮게 깔린다. climax가 켜지면 게임이 잠깐 느리게 돌린다
import { Vector3, type PerspectiveCamera } from 'three';
import type { Race } from '../race/race';

const BASE_FOV = 42;
const smooth = (k: number, dt: number) => 1 - Math.exp(-k * dt);

export class FollowCamera {
  readonly target = new Vector3();
  /** 선두가 결승선 바로 앞에 있고 아직 아무도 들어오지 않았다 */
  climax = false;
  /** 게임이 넣는다: 구슬이 결승 입구 앞에 있으면 그 입구. 카메라가 바짝 다가간다 */
  zoom: [number, number] | null = null;
  private wantTarget = new Vector3();
  private lastY = 0;
  private first = true;
  private speed = 0;
  private dist = 10;
  private tilt = 0.3;
  private sway = 0;

  constructor(private camera: PerspectiveCamera) {}

  /** 다음 update에서 평활 없이 바로 옮긴다. */
  snap() {
    this.first = true;
  }

  /** positions = 구슬 위치, dt = 프레임 시간(초, 실제 시간) */
  update(race: Race, positions: Float32Array, dt: number) {
    const { map } = race;
    const cam = this.camera;
    const W = map.halfWidth * 2;
    /** 폭 w가 화면에 꽉 차는 거리 */
    const fit = (w: number) => w / (2 * Math.tan((BASE_FOV * Math.PI) / 360) * Math.min(1, cam.aspect));
    let dist = fit(W * 1.3);
    let tilt = 0.3;
    let sway = 0;
    let fov = BASE_FOV;
    this.climax = false;

    if (!race.released) {
      this.wantTarget.set(0, map.startY + 0.5, 0);
    } else {
      // 아직 달리는 구슬 중 선두와 2등. 모두 들어왔으면 마지막 구슬.
      const order = race.ranking();
      const running = order.filter((i) => Number.isNaN(race.finishTime[i]));
      const leader = running[0] ?? order[order.length - 1];
      const x = positions[leader * 3];
      const y = positions[leader * 3 + 1];
      const gap = running.length > 1 ? Math.min(W, positions[running[1] * 3 + 1] - y) : 0;
      if (dt > 0) this.speed += (Math.abs(y - this.lastY) / dt - this.speed) * smooth(3, dt);
      this.lastY = y;
      const toGo = y - map.finishY;
      // 결승 구덩이: 판 폭 전체가 보이게 다가가 낮게 깔리고, 1등이 나올 때까지 느리게 돈다
      // 1등이 나온 뒤에도 남은 구슬이 들어오는 동안 같은 시점을 유지한다. 느리게 도는 것은 1등이 나올 때까지만.
      const finale = toGo < W * 1.4;
      this.climax = finale && race.finishOrder.length === 0;
      dist = fit(finale ? W * 1.02 : W * 0.85 + gap * 0.6);
      tilt = finale ? 0.62 : 0.5;
      sway = finale ? 0 : x * 0.6;
      // 선두보다 조금 아래(앞)를 본다
      // 결승 직전에는 선두와 결승선 사이를 본다
      this.wantTarget.set(finale ? 0 : x * 0.5, finale ? y - Math.min(toGo * 0.5, W * 0.3) : y + gap * 0.35 - W * 0.2, 0);
      fov = BASE_FOV + Math.min(14, this.speed * 0.5);
      if (this.zoom) {
        // 들어갈 것 같은 순간: 입구를 화면 가운데에 두고 판 폭의 40%만 보이게 다가간다
        this.wantTarget.set(this.zoom[0], this.zoom[1] + W * 0.08, 0);
        dist = fit(W * 0.4);
        tilt = 0.55;
        sway = 0;
        fov = BASE_FOV;
      }
    }

    const k = this.first ? 1 : smooth(2.5, dt);
    this.dist += (dist - this.dist) * k;
    this.tilt += (tilt - this.tilt) * k;
    this.sway += (sway - this.sway) * k;
    this.target.lerp(this.wantTarget, this.first ? 1 : smooth(6, dt));
    this.first = false;
    cam.position.set(this.target.x + this.sway, this.target.y - Math.sin(this.tilt) * this.dist, Math.cos(this.tilt) * this.dist);
    cam.fov += (fov - cam.fov) * k;
    cam.updateProjectionMatrix();
    cam.up.set(0, 1, 0);
    cam.lookAt(this.target);
  }
}
