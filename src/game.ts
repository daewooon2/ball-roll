// three.js와 Rapier를 쓰는 부분. main.ts가 이름 입력 화면을 먼저 띄운 뒤 import()로 불러온다.
import { DT, type QualityName } from './config';
import { buildMap, type BuiltMap } from './map/build';
import { validateMap } from './map/schema';
import { Race, type Entry } from './race/race';
import { FollowCamera } from './render/camera';
import { Scene } from './render/scene';

export class Game {
  readonly scene: Scene;
  race?: Race;
  private follow: FollowCamera;
  private map?: BuiltMap;
  private labels: HTMLElement[] = [];
  private acc = 0;
  private last = 0;
  /** 배속. 물리 스텝은 그대로 1/240초이고 한 프레임에 도는 스텝 수만 바뀐다. */
  speed = 1.5;
  paused = false;
  /** 프레임마다 불린다(순위 UI 갱신용). */
  onFrame?: (race: Race) => void;

  constructor(
    readonly canvas: HTMLCanvasElement,
    private labelLayer: HTMLElement,
  ) {
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
  }

  /** 새 경주를 출발선에 세운다. start()를 부르기 전까지는 멈춰 있다. */
  prepare(entries: Entry[], seed: number, skills: boolean, colors: string[]) {
    this.race?.free();
    this.race = new Race(this.map!, { seed, entries, skills });
    this.scene.setRace(this.race, colors);
    this.labelLayer.replaceChildren(
      ...(this.labels = entries.map((e, i) => {
        const el = document.createElement('span');
        el.textContent = e.name;
        el.style.color = colors[i];
        return el;
      })),
    );
    this.acc = 0;
    this.paused = false;
    this.follow.snap();
  }

  start() {
    this.race?.start();
  }

  // 고정 스텝 + 렌더 보간
  private frame = (now: number) => {
    requestAnimationFrame(this.frame);
    const frameDt = Math.min(Math.max(0, (now - this.last) / 1000), 0.1); // 탭 전환 뒤 폭주 방지. 음수면 카메라 평활이 발산한다
    this.last = now;
    const race = this.race;
    if (!race) return;
    if (race.started && !race.done && !this.paused) {
      // 선두가 배출구 앞에 오면(아직 아무도 못 들어왔을 때) 잠깐 느리게
      this.acc += frameDt * this.speed * (this.follow.climax ? 0.4 : 1);
      const maxSteps = 16 * Math.max(1, Math.ceil(this.speed));
      for (let steps = 0; this.acc >= DT && steps < maxSteps; steps++) {
        race.tick();
        this.acc -= DT;
      }
      if (this.acc >= DT) this.acc = 0; // 그래도 못 따라가면 밀린 시간은 버린다
    }
    const alpha = race.started && !race.done ? this.acc / DT : 1;
    this.follow.update(race, race.pos, this.paused ? 0 : frameDt);
    this.scene.render(race, alpha, this.follow.target);

    const p = { x: 0, y: 0 };
    this.labels.forEach((el, i) => {
      const s = this.scene.screenPosition(i, p);
      el.style.display = s ? '' : 'none';
      if (s) el.style.transform = `translate(${s.x.toFixed(1)}px, ${s.y.toFixed(1)}px) translate(-50%, -190%)`;
    });
    this.onFrame?.(race);
  };
}
