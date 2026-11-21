// three.js와 Rapier를 쓰는 부분. main.ts가 이름 입력 화면을 먼저 띄운 뒤 import()로 불러온다.
import { Quaternion, Vector3 } from 'three';
import { DT, type QualityName } from './config';
import { buildMap, type BuiltMap } from './map/build';
import { validateMap } from './map/schema';
import { Race, type Entry } from './race/race';
import { FollowCamera } from './render/camera';
import { Scene } from './render/scene';
import { Minimap } from './ui/minimap';

export class Game {
  readonly scene: Scene;
  race?: Race;
  private follow: FollowCamera;
  private map?: BuiltMap;
  private labels: HTMLElement[] = [];
  private minimap: Minimap;
  private colors: string[] = [];
  private acc = 0;
  private seenEvents = 0;
  /** 지금 시간 배율(1 = 보통). 아슬아슬한 순간에 부드럽게 낮아진다 */
  private slow = 1;
  private last = 0;
  /** 배속. 물리 스텝은 그대로 1/240초이고 한 프레임에 도는 스텝 수만 바뀐다. */
  speed = 1;
  paused = false;
  /** 프레임마다 불린다(순위 UI 갱신용). */
  onFrame?: (race: Race) => void;

  constructor(
    readonly canvas: HTMLCanvasElement,
    private labelLayer: HTMLElement,
    minimap: HTMLCanvasElement,
  ) {
    this.minimap = new Minimap(minimap);
    this.scene = new Scene(canvas);
    this.follow = new FollowCamera(this.scene.camera);
    new ResizeObserver(() => this.scene.resize()).observe(canvas);
    requestAnimationFrame(this.frame);
  }

  setQuality(q: QualityName) {
    this.scene.setQuality(q);
  }

  /** 형식이 틀리면 던진다. */
  loadMap(json: unknown) {
    this.map = buildMap(validateMap(json));
    this.scene.setMap(this.map);
    this.minimap.setMap(this.map);
  }

  /** 새 경주를 출발선에 세운다. start()를 부르기 전까지는 멈춰 있다. */
  prepare(entries: Entry[], seed: number, skills: boolean, colors: string[]) {
    this.race?.free();
    this.race = new Race(this.map!, { seed, entries, skills });
    this.scene.setRace(this.race, colors);
    this.colors = colors;
    this.labelLayer.replaceChildren(
      ...(this.labels = entries.map((e, i) => {
        const el = document.createElement('span');
        el.textContent = e.name;
        el.style.color = colors[i];
        return el;
      })),
    );
    this.acc = 0;
    this.seenEvents = 0;
    this.slow = 1;
    this.paused = false;
    this.follow.snap();
  }

  start() {
    this.race?.start();
  }

  /** 아직 안 들어온 구슬이 결승 입구 6cm 안에 있는가(들어갈 것 같은 순간) */
  private nearSpot(race: Race) {
    const spot = race.map.spot;
    if (!spot) return false;
    for (let i = 0; i < race.n; i++)
      if (Number.isNaN(race.finishTime[i]) && Math.hypot(race.pos[i * 3] - spot[0], race.pos[i * 3 + 1] - spot[1]) < 0.6) return true;
    return false;
  }

  /** 구슬이 결승 입구(5cm 안)에 있고 입구의 막대와 3cm 안으로 가까운가 */
  private nearMiss(race: Race) {
    const spot = race.map.spot;
    if (!spot || !race.map.movers.length) return false;
    // 입구에서 가장 가까운 움직이는 장애물이 문지기 막대
    let k = 0;
    race.map.movers.forEach((m, i) => {
      const d = (j: number) => Math.hypot(race.map.movers[j].pos[0] - spot[0], race.map.movers[j].pos[1] - spot[1]);
      if (d(i) < d(k)) k = i;
    });
    const half = race.map.movers[k].halves[0]?.[0] ?? 0;
    const q = new Quaternion().fromArray(race.moverRot, k * 4);
    const dir = new Vector3(1, 0, 0).applyQuaternion(q);
    const cx = race.moverPos[k * 3];
    const cy = race.moverPos[k * 3 + 1];
    for (let i = 0; i < race.n; i++) {
      if (!Number.isNaN(race.finishTime[i])) continue;
      const x = race.pos[i * 3];
      const y = race.pos[i * 3 + 1];
      if (Math.hypot(x - spot[0], y - spot[1]) > 0.5) continue;
      // 막대(선분)까지의 거리
      const t = Math.max(-half, Math.min(half, (x - cx) * dir.x + (y - cy) * dir.y));
      if (Math.hypot(x - cx - dir.x * t, y - cy - dir.y * t) < 0.3) return true;
    }
    return false;
  }

  // 고정 스텝 + 렌더 보간
  private frame = (now: number) => {
    requestAnimationFrame(this.frame);
    const frameDt = Math.min(Math.max(0, (now - this.last) / 1000), 0.1); // 탭 전환 뒤 폭주 방지. 음수면 카메라 평활이 발산한다
    this.last = now;
    const race = this.race;
    if (!race) return;
    if (race.started && !race.done && !this.paused) {
      // 결승 구간(climax) 0.7배, 구슬이 결승 입구 앞에서 도는 막대와 아슬아슬하게 가까우면 0.3배. 1등이 나오면 보통 속도로.
      let want = this.follow.climax ? 0.7 : 1;
      if (race.finishOrder.length === 0 && this.nearMiss(race)) want = 0.3;
      this.slow += (want - this.slow) * Math.min(1, frameDt * 6);
      this.acc += frameDt * this.speed * this.slow;
      const maxSteps = 16 * Math.max(1, Math.ceil(this.speed));
      for (let steps = 0; this.acc >= DT && steps < maxSteps; steps++) {
        race.tick();
        this.acc -= DT;
      }
      if (this.acc >= DT) this.acc = 0; // 그래도 못 따라가면 밀린 시간은 버린다
    }
    for (; this.seenEvents < race.events.length; this.seenEvents++) {
      const e = race.events[this.seenEvents];
      if (e.kind === 'burst') this.scene.burst(e.x!, e.y!);
    }
    const alpha = race.started && !race.done ? this.acc / DT : 1;
    this.follow.zoom = race.started && race.finishOrder.length === 0 && this.nearSpot(race) ? race.map.spot : null;
    this.follow.update(race, race.pos, this.paused ? 0 : frameDt);
    this.scene.render(race, alpha, this.follow.target);

    const p = { x: 0, y: 0 };
    this.labels.forEach((el, i) => {
      const s = this.scene.screenPosition(i, p);
      el.style.display = s ? '' : 'none';
      if (s) el.style.transform = `translate(${s.x.toFixed(1)}px, ${s.y.toFixed(1)}px) translate(-50%, -190%)`;
    });
    this.minimap.draw(race, this.colors);
    this.onFrame?.(race);
  };
}
