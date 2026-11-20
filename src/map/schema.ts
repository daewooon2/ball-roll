// 코스 JSON 형식. 길이는 전부 m, 각도는 도.
export type V3 = [number, number, number];

/** 경사판. pos = 윗면의 위쪽(오르막) 끝 가운데. yaw 0이면 +x, 90이면 +z 방향으로 내려간다. */
export interface RampPiece {
  type: 'ramp';
  id: string;
  pos: V3;
  yawDeg: number;
  slopeDeg: number;
  length: number;
  width: number;
  railH: number;
  /** 난간 높이를 [로컬 -z쪽, +z쪽]으로 따로 줄 때. 0이면 없음. */
  rails?: [number, number];
  /** 오르막 끝을 막는 벽 높이. */
  backWall?: number;
  /** 바닥 충돌체 두께. 기본 30mm(터널링 방지). 아래로 구슬이 지나가야 하는 곳만 줄인다. */
  thickness?: number;
}

/** 낙하구를 감싸는 ㄷ자 벽. pos = 입구 쪽 바닥 가운데, size = [길이, 높이, 폭]. */
export interface DropPiece {
  type: 'drop';
  pos: V3;
  yawDeg: number;
  size: V3;
  /** 옆벽 한쪽을 뚫을 때(로컬 z 방향). */
  open?: '+z' | '-z';
}

/** 삼각기둥 쐐기. 경사판 위에 놓는다. at = [오르막 끝에서의 거리, 가운데에서 옆으로]. size = [밑변, 높이, 길이]. */
export interface WedgePiece {
  type: 'wedge';
  on: string;
  at: [number, number];
  size: V3;
  color?: string;
  yawDeg?: number;
}

/** 볼링핀. layout "4-3-2-1"은 내리막 쪽 줄부터 센 핀 개수다(맨 위 1개가 먼저 맞는다). */
export interface PinsPiece {
  type: 'pins';
  on: string;
  at: [number, number];
  layout: string;
  spacing: number;
  radius: number;
  height: number;
  /** 핀 질량 / 구슬 질량 */
  massRatio: number;
  /** 핀의 마찰. 0이면 쓰러진 핀이 경사를 미끄러져 내려가 길을 비운다. 생략하면 구슬과 같다. */
  friction?: number;
  /** 핀이 놓인 자리보다 이만큼 떨어지면 제거한다(소용돌이 배출구가 막히지 않게). */
  despawnDrop: number;
}

/** 원뿔 소용돌이. pos = 배출구 가운데. */
export interface FunnelPiece {
  type: 'funnel';
  pos: V3;
  rOuter: number;
  rInner: number;
  angleDeg: number;
  segments: number;
  rimH: number;
}

/** 결승 센서와 받침 상자. pos = 센서 가운데, size = 센서 크기, tray = [폭, 깊이, 길이]. */
export interface FinishPiece {
  type: 'finish';
  pos: V3;
  size: V3;
  tray: V3;
}

export type Piece = RampPiece | DropPiece | WedgePiece | PinsPiece | FunnelPiece | FinishPiece;

export interface MapJson {
  id: string;
  name: string;
  units: 'm';
  marble: { radius: number; density: number; friction: number; restitution: number; rollingResistance: number };
  /** 출발 게이트. on = 경사판 id, at = 막대 위치(오르막 끝에서의 거리). */
  start: { on: string; at: number; slots: number; slotWidth: number; liftTime: number };
  /** 조각은 구슬이 지나가는 순서대로 적는다. */
  pieces: Piece[];
  /** 진행도 계산용 꺾은선. 생략하면 조각 순서에서 만든다. */
  centerline?: V3[];
}

const num = (v: unknown) => typeof v === 'number' && Number.isFinite(v);
const vec = (v: unknown, n = 3) => Array.isArray(v) && v.length === n && v.every(num);

const FIELDS: Record<Piece['type'], [string, (v: unknown) => boolean][]> = {
  ramp: [
    ['id', (v) => typeof v === 'string'],
    ['pos', vec],
    ['yawDeg', num],
    ['slopeDeg', num],
    ['length', num],
    ['width', num],
    ['railH', num],
  ],
  drop: [
    ['pos', vec],
    ['yawDeg', num],
    ['size', vec],
  ],
  wedge: [
    ['on', (v) => typeof v === 'string'],
    ['at', (v) => vec(v, 2)],
    ['size', vec],
  ],
  pins: [
    ['on', (v) => typeof v === 'string'],
    ['at', (v) => vec(v, 2)],
    ['layout', (v) => typeof v === 'string' && /^\d+(-\d+)*$/.test(v)],
    ['spacing', num],
    ['radius', num],
    ['height', num],
    ['massRatio', num],
    ['despawnDrop', num],
  ],
  funnel: [
    ['pos', vec],
    ['rOuter', num],
    ['rInner', num],
    ['angleDeg', num],
    ['segments', (v) => Number.isInteger(v) && (v as number) >= 8],
    ['rimH', num],
  ],
  finish: [
    ['pos', vec],
    ['size', vec],
    ['tray', vec],
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
  for (const k of ['at', 'slots', 'slotWidth', 'liftTime'] as const) if (!num(m.start?.[k])) fail(`start.${k}`);
  if (!Array.isArray(m.pieces)) fail('pieces');
  const ramps = new Set<string>();
  m.pieces.forEach((p, i) => {
    const fields = FIELDS[p?.type];
    if (!fields) fail(`pieces[${i}].type = ${p?.type}`);
    for (const [key, ok] of fields)
      if (!ok((p as unknown as Record<string, unknown>)[key])) fail(`pieces[${i}] (${p.type}).${key}`);
    if (p.type === 'ramp') ramps.add(p.id);
    if ((p.type === 'wedge' || p.type === 'pins') && !ramps.has(p.on))
      fail(`pieces[${i}] (${p.type}).on = "${p.on}" 인 경사판이 앞에 없음`);
  });
  if (!ramps.has(m.start.on)) fail(`start.on = "${m.start.on}"`);
  if (!m.pieces.some((p) => p.type === 'finish')) fail('finish 조각이 없음');
  if (m.centerline && !(Array.isArray(m.centerline) && m.centerline.length >= 2 && m.centerline.every((p) => vec(p))))
    fail('centerline');
  return m;
}
