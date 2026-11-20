// 선두 추적 카메라. 지수 평활(k = 4/s). 소용돌이에서는 위에서 내려다보는 고정 시점.
import { Vector3, type PerspectiveCamera } from 'three';
import type { Race } from '../race/race';

const K = 4;

export class FollowCamera {
  readonly target = new Vector3();
  private wantTarget = new Vector3();
  private wantPosition = new Vector3();
  private first = true;

  constructor(private camera: PerspectiveCamera) {}

  /** 다음 update에서 평활 없이 바로 옮긴다. */
  snap() {
    this.first = true;
  }

  /** positions = 보간된 구슬 위치(scene.renderPos), dt = 프레임 시간(초) */
  update(race: Race, positions: Float32Array, dt: number) {
    // 아직 달리는 구슬 중 선두. 모두 들어왔으면 마지막 구슬.
    const order = race.ranking();
    const leader = order.find((i) => Number.isNaN(race.finishTime[i])) ?? order[order.length - 1];
    const funnel = race.map.funnel;
    // 세로 화면에서는 좌우가 좁으므로 더 물러난다
    const back = this.camera.aspect < 1 ? 1.5 : 1;
    if (funnel && race.progress[leader] >= funnel.s - 0.2) {
      this.wantTarget.fromArray(funnel.center);
      this.wantTarget.y -= funnel.rOuter * 0.2;
      // 소용돌이 지름이 화면의 좁은 쪽에 다 들어오는 높이
      const fit = (funnel.rOuter * 1.25) / (Math.tan((this.camera.fov * Math.PI) / 360) * Math.min(1, this.camera.aspect));
      this.wantPosition.set(funnel.center[0], funnel.center[1] + fit, funnel.center[2] + fit * 0.3);
    } else {
      this.wantTarget.fromArray(positions, leader * 3);
      this.wantPosition.set(this.wantTarget.x + 0.3, this.wantTarget.y + 2.4 * back, this.wantTarget.z + 4.2 * back);
    }
    const t = this.first ? 1 : 1 - Math.exp(-K * dt);
    this.first = false;
    this.target.lerp(this.wantTarget, t);
    this.camera.position.lerp(this.wantPosition, t);
    this.camera.lookAt(this.target);
  }
}
