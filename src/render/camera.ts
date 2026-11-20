// 추격 카메라.
// - 출발 전: 게이트를 보는 고정 시점(시드와 무관해서 셔플해도 바뀌지 않는다)
// - 경사 구간: 선두 뒤쪽 낮은 곳에서 따라가고, 단이 꺾이면 반대편으로 돌아 들어간다. 빠를수록 화각이 넓어진다
// - 소용돌이: 둘레를 돌면서 선두가 배출구에 가까워질수록 내려가며 다가간다
import { Vector3, type PerspectiveCamera } from 'three';
import { projectToCenterline } from '../map/build';
import type { Race } from '../race/race';

const BASE_FOV = 42;
const smooth = (k: number, dt: number) => 1 - Math.exp(-k * dt);

export class FollowCamera {
  readonly target = new Vector3();
  /** 선두가 배출구 바로 앞에 있고 아직 아무도 들어오지 않았다 → 게임이 잠깐 느리게 돌린다 */
  climax = false;
  private wantTarget = new Vector3();
  private wantPosition = new Vector3();
  private lead = new Vector3();
  private lastLead = new Vector3();
  private first = true;
  private side = 1; // 진행 방향(x)의 부호를 평활한 값
  private speed = 0;
  private orbit = 0.6;

  constructor(private camera: PerspectiveCamera) {}

  /** 다음 update에서 평활 없이 바로 옮긴다. */
  snap() {
    this.first = true;
  }

  /** positions = 구슬 위치, dt = 프레임 시간(초, 실제 시간) */
  update(race: Race, positions: Float32Array, dt: number) {
    const { map } = race;
    const cam = this.camera;
    const back = cam.aspect < 1 ? 1.45 : 1; // 세로 화면에서는 좌우가 좁으므로 더 물러난다
    let fov = BASE_FOV;
    let kPos = 5;
    this.climax = false;

    if (!race.started) {
      this.wantTarget.fromArray(map.gate.pos);
      this.wantPosition.set(this.wantTarget.x - 1.4, this.wantTarget.y + 1.7 * back, this.wantTarget.z + 3.6 * back);
      this.side = 1;
    } else {
      // 아직 달리는 구슬 중 선두. 모두 들어왔으면 마지막 구슬.
      const order = race.ranking();
      const leader = order.find((i) => Number.isNaN(race.finishTime[i])) ?? order[order.length - 1];
      this.lead.fromArray(positions, leader * 3);
      if (dt > 0) this.speed += (this.lead.distanceTo(this.lastLead) / dt - this.speed) * smooth(3, dt);
      this.lastLead.copy(this.lead);
      const funnel = map.funnel;

      if (funnel && race.progress[leader] >= funnel.s - 0.2) {
        const rho = Math.hypot(this.lead.x - funnel.center[0], this.lead.z - funnel.center[2]) / funnel.rOuter;
        const near = Math.min(1, Math.max(0.2, rho)); // 1 = 테두리, 0.2 = 배출구 앞
        this.climax = rho < 0.3 && race.finishOrder.length === 0;
        this.orbit += dt * (0.45 + (1 - near) * 0.5);
        const fit = (funnel.rOuter * 1.25) / (Math.tan((BASE_FOV * Math.PI) / 360) * Math.min(1, cam.aspect));
        const d = fit * (0.5 + 0.5 * near);
        this.wantTarget.set(funnel.center[0], funnel.center[1] - funnel.rOuter * (0.45 - 0.25 * near), funnel.center[2]);
        this.wantPosition.set(funnel.center[0] + Math.cos(this.orbit) * d * 0.55, funnel.center[1] + d * 0.8, funnel.center[2] + Math.sin(this.orbit) * d * 0.55);
        kPos = 3;
      } else {
        const p = projectToCenterline(map, this.lead.x, this.lead.y, this.lead.z);
        this.side += (Math.sign(p.tangent[0]) - this.side) * smooth(2.2, dt);
        // 선두보다 조금 앞을 본다
        this.wantTarget.set(this.lead.x + p.tangent[0] * 0.9, this.lead.y + p.tangent[1] * 0.9, this.lead.z + p.tangent[2] * 0.9);
        const pull = 1 + Math.min(0.3, this.speed / 40);
        this.wantPosition.set(this.lead.x - this.side * 2.5 * back * pull, this.lead.y + 1.15 * back * pull, this.lead.z + 2.7 * back * pull);
        fov = BASE_FOV + Math.min(16, this.speed * 0.9);
      }
    }

    const snap = this.first;
    this.first = false;
    this.target.lerp(this.wantTarget, snap ? 1 : smooth(8, dt));
    cam.position.lerp(this.wantPosition, snap ? 1 : smooth(kPos, dt));
    cam.fov += (fov - cam.fov) * (snap ? 1 : smooth(3, dt));
    cam.updateProjectionMatrix();
    cam.lookAt(this.target);
  }
}
