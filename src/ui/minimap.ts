// 미니맵: 긴 판 전체를 세로 띠로 줄여 구슬이 어디쯤 왔는지 보여 준다. 가로와 세로 배율이 다르다.
import type { BuiltMap } from '../map/build';
import type { Race } from '../race/race';

export class Minimap {
  private c: CanvasRenderingContext2D;
  private back?: HTMLCanvasElement;
  private map?: BuiltMap;

  constructor(private canvas: HTMLCanvasElement) {
    this.c = canvas.getContext('2d')!;
  }

  private xy(x: number, y: number): [number, number] {
    const m = this.map!;
    return [((x + m.halfWidth) / (2 * m.halfWidth)) * this.canvas.width, ((m.top - y) / (m.top - m.bottom)) * this.canvas.height];
  }

  /** 고정 구조물은 한 번만 그려 둔다. */
  setMap(map: BuiltMap) {
    this.map = map;
    // 내부 해상도는 고정이고 화면 크기는 CSS가 정한다
    this.canvas.width = 68;
    this.canvas.height = 1040;
    const back = document.createElement('canvas');
    back.width = this.canvas.width;
    back.height = this.canvas.height;
    const c = back.getContext('2d')!;
    c.fillStyle = 'rgba(20, 23, 29, 0.75)';
    c.fillRect(0, 0, back.width, back.height);
    c.strokeStyle = 'rgba(255, 255, 255, 0.45)';
    c.fillStyle = 'rgba(255, 255, 255, 0.45)';
    c.lineWidth = 1.5;
    for (const v of map.visuals) {
      if (v.kind === 'hole') {
        c.fillStyle = '#e5484d';
        c.fillRect(...this.xy(v.pos[0], v.pos[1]), 4, 4);
        c.fillStyle = 'rgba(255, 255, 255, 0.45)';
      } else if (v.kind === 'peg') {
        if (v.radius > 0.05) c.fillRect(...this.xy(v.pos[0], v.pos[1]), 2, 2);
      } else if (v.color !== 'plate') {
        // 상자의 긴 축을 선 하나로
        const a = 2 * Math.atan2(v.rot[2], v.rot[3]);
        const dx = Math.cos(a) * v.half[0];
        const dy = Math.sin(a) * v.half[0];
        c.beginPath();
        c.moveTo(...this.xy(v.pos[0] - dx, v.pos[1] - dy));
        c.lineTo(...this.xy(v.pos[0] + dx, v.pos[1] + dy));
        c.stroke();
      }
    }
    c.fillStyle = '#f2c94c';
    c.fillRect(0, this.xy(0, map.finishY)[1], back.width, 3);
    this.back = back;
  }

  draw(race: Race, colors: string[]) {
    if (!this.back) return;
    const c = this.c;
    c.clearRect(0, 0, this.canvas.width, this.canvas.height);
    c.drawImage(this.back, 0, 0);
    for (let i = race.n - 1; i >= 0; i--) {
      const [x, y] = this.xy(race.pos[i * 3], race.pos[i * 3 + 1]);
      c.fillStyle = colors[i];
      c.beginPath();
      c.arc(x, y, 5, 0, 2 * Math.PI);
      c.fill();
    }
  }
}
