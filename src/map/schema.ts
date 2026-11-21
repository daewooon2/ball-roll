// 코스 JSON 형식. 뒤로 기울인 판 위를 구슬이 굴러 내려간다.
// 좌표는 판 위의 2차원 [x, y] (m). x = 가로(가운데 0), y = 위쪽이 +. 각도는 도.
export type V2 = [number, number];

/** 두 점을 잇는 벽. t = 두께(기본 6mm). */
export interface WallPiece {
  type: 'wall';
  a: V2;
  b: V2;
  t?: number;
  /** 끝을 두께의 반만큼 늘리지 않고 a, b에서 딱 자른다. 두꺼운 벽끼리 모서리를 맞출 때 쓴다. */
  flush?: boolean;
  /** 결승 깔때기 벽: 너무 오래 걸리면 사라지는 안전망. */
  trap?: boolean;
  /** 닿은 구슬을 벽 반대쪽으로 이 속력(m/s)으로 밀어낸다. 벽을 따라 쓸려 가는 구슬도 튕긴다. */
  pop?: number;
  /** 반발 계수. 주면 잘 튕기는 벽이 된다. */
  bounce?: number;
  color?: string;
}

/** 고정 블록. size = [가로, 세로], deg = 판 위에서 돌린 각. */
export interface BoxPiece {
  type: 'box';
  at: V2;
  size: V2;
  deg?: number;
  color?: string;
}

/** 둥근 핀. bounce를 주면 그만큼 잘 튕기는 범퍼가 된다(반발 계수). */
export interface PegPiece {
  type: 'peg';
  at: V2;
  r: number;
  bounce?: number;
  /** 핀볼의 팝 범퍼: 닿은 구슬을 이 속력(m/s)으로 바깥으로 튕겨 낸다. */
  pop?: number;
  color?: string;
}

/** 도는 막대. length = 막대 전체 길이, rpm의 부호가 회전 방향, cross면 십자. */
export interface SpinnerPiece {
  type: 'spinner';
  at: V2;
  length: number;
  rpm: number;
  cross?: boolean;
  /** true면 at이 막대의 한쪽 끝(축)이고 막대는 그 끝에서 length만큼 뻗는다. 축을 벽에 박아 반대쪽 끝만 보이게 할 때. */
  end?: boolean;
  /** 막대 두께(m). 기본 8mm */
  thick?: number;
  /** 막대 양 끝 이 길이(m)만큼을 잘 튕기는 빨간 끝으로 만든다 */
  tips?: number;
  /** 주면 중심에서 이만큼의 팔이 고르게 뻗는다(3이면 Y자). 팔 하나의 길이는 length/2. */
  arms?: number;
  phase?: number;
  color?: string;
}

/** 좌우로 왕복하는 블록. amp = 진폭(m), period = 주기(초), phase = 0~1. */
export interface SliderPiece {
  type: 'slider';
  at: V2;
  size: V2;
  deg?: number;
  amp: number;
  period: number;
  phase?: number;
  color?: string;
}

/** 구멍 함정: 구슬 중심이 반지름 r 안에 들어오면 빠져서 to(구간 맨 위)로 되돌아간다. 구슬 하나당 max번까지. */
export interface HolePiece {
  type: 'hole';
  at: V2;
  r: number;
  to: V2;
  max?: number;
}

export type Piece = WallPiece | BoxPiece | PegPiece | SpinnerPiece | SliderPiece | HolePiece;

export interface MapJson {
  id: string;
  name: string;
  units: 'm';
  marble: { radius: number; density: number; friction: number; restitution: number; rollingResistance: number };
  /** 판이 수평에서 기운 각. 클수록 빠르다. */
  tiltDeg: number;
  /** 판 안쪽 폭, 위 끝과 아래 끝의 y, 벽 높이 */
  width: number;
  top: number;
  bottom: number;
  wallH: number;
  /** 출발 게이트(가로 막대)의 윗면 y. 구슬은 그 위에 한 줄에 slots개씩 선다. */
  start: { y: number; slots: number; slotWidth: number; liftTime: number };
  /** 결승선의 y. 그 아래부터 bottom까지가 받침 칸이다. */
  finishY: number;
  /** 구간이 시작하는 y들(진단 출력용) */
  marks?: number[];
  /** 결승 입구(아슬아슬한 순간을 잡는 곳). 구슬이 여기 가까우면 화면이 잠깐 느려진다. */
  spot?: V2;
  pieces: Piece[];
}

const num = (v: unknown) => typeof v === 'number' && Number.isFinite(v);
const pos = (v: unknown) => num(v) && (v as number) > 0;
const v2 = (v: unknown) => Array.isArray(v) && v.length === 2 && v.every(num);

const FIELDS: Record<Piece['type'], [string, (v: unknown) => boolean][]> = {
  wall: [
    ['a', v2],
    ['b', v2],
  ],
  box: [
    ['at', v2],
    ['size', v2],
  ],
  peg: [
    ['at', v2],
    ['r', pos],
  ],
  spinner: [
    ['at', v2],
    ['length', pos],
    ['rpm', num],
  ],
  hole: [
    ['at', v2],
    ['r', pos],
    ['to', v2],
  ],
  slider: [
    ['at', v2],
    ['size', v2],
    ['amp', num],
    ['period', pos],
  ],
};

/** 형식이 틀리면 어느 조각의 어느 필드인지 알려 주며 던진다. */
export function validateMap(data: unknown): MapJson {
  const m = data as MapJson;
  const fail = (msg: string): never => {
    throw new Error(`맵 형식 오류: ${msg}`);
  };
  if (!m || typeof m !== 'object') fail('객체가 아님');
  if (typeof m.id !== 'string') fail('id');
  if (m.units !== 'm') fail('units는 "m"이어야 함');
  for (const k of ['radius', 'density', 'friction', 'restitution', 'rollingResistance'] as const)
    if (!num(m.marble?.[k])) fail(`marble.${k}`);
  for (const k of ['tiltDeg', 'width', 'wallH'] as const) if (!pos(m[k])) fail(k);
  for (const k of ['top', 'bottom', 'finishY'] as const) if (!num(m[k])) fail(k);
  for (const k of ['y', 'slots', 'slotWidth', 'liftTime'] as const) if (!num(m.start?.[k])) fail(`start.${k}`);
  if (!(m.top > m.start.y && m.start.y > m.finishY && m.finishY > m.bottom)) fail('top > start.y > finishY > bottom 이어야 함');
  if (m.wallH <= m.marble.radius * 2) fail('wallH는 구슬 지름보다 커야 함');
  if (!Array.isArray(m.pieces)) fail('pieces');
  m.pieces.forEach((p, i) => {
    const fields = FIELDS[p?.type];
    if (!fields) fail(`pieces[${i}].type = ${p?.type}`);
    for (const [key, ok] of fields)
      if (!ok((p as unknown as Record<string, unknown>)[key])) fail(`pieces[${i}] (${p.type}).${key}`);
  });
  return m;
}
