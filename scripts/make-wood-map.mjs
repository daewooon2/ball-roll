// public/maps/*.json 생성기. 지그재그 단 수나 경사를 바꾸면 아래 조각 좌표가 전부 따라 바뀌므로
// 손으로 고치는 대신 여기 파라미터를 바꾸고 `npm run map` 으로 다시 만든다.
// 게임 코드는 JSON만 읽는다.
import fs from 'node:fs';

const rad = (d) => (d * Math.PI) / 180;
const round = (v) => Math.round(v * 1e4) / 1e4;
const COLORS = ['red', 'orange', 'green', 'blue', 'purple', 'yellow'];

function make(P) {
  const pieces = [];
  let x = 0;
  let y = 0;
  let dir = 1;
  let color = 0;
  let end;
  const line = [];
  P.tiers.forEach((t, i) => {
    const id = `r${i + 1}`;
    const length = t.length + (i ? P.gap : 0); // 둘째 단부터는 낙하구 벽 밑에서 시작
    pieces.push({
      type: 'ramp', id, pos: [x, y, 0], yawDeg: dir > 0 ? 0 : 180, slopeDeg: t.slope,
      length, width: P.width, railH: P.railH, ...(i ? {} : { backWall: 0.03 }),
    });
    for (const [along, across, size] of t.wedges ?? []) {
      const wedge = { type: 'wedge', on: id, at: [along, across], size: size ?? P.wedge, color: COLORS[color++ % COLORS.length] };
      if (across === 'L' || across === 'R') {
        // 난간에 붙는 쐐기: 빗면 하나가 난간과 나란하도록 반각만큼 돌려, 난간을 타고 오는 구슬을 안쪽으로 밀어낸다
        const side = across === 'R' ? 1 : -1;
        const [w, , l] = wedge.size;
        const half = Math.atan(w / 2 / l);
        wedge.at = [along, side * (P.width / 2 - (l / 2) * Math.sin(half) + 0.001)];
        wedge.yawDeg = round((-side * half * 180) / Math.PI);
      }
      pieces.push(wedge);
    }
    if (t.pins)
      pieces.push({
        type: 'pins', on: id, at: [t.pins[0], 0], layout: t.pins[1], spacing: 0.02, radius: 0.004, height: 0.022,
        massRatio: P.pinMass, friction: P.pinFriction, despawnDrop: (length - t.pins[0]) * Math.sin(rad(t.slope)) + 0.03,
      });
    end = { x: x + dir * length * Math.cos(rad(t.slope)), y: y - length * Math.sin(rad(t.slope)) };
    line.push([x, y, 0], [end.x, end.y, 0]);
    if (i < P.tiers.length - 1) {
      pieces.push({ type: 'drop', pos: [end.x, end.y - P.drop - 0.01, 0], yawDeg: dir > 0 ? 0 : 180, size: [P.gap, P.drop + 0.05, P.width] });
      x = end.x + dir * P.gap;
      y = end.y - P.drop;
      dir = -dir;
    }
  });

  // 마지막 단 끝: 좌우 대칭 홈통. 양쪽에서 가운데 구멍으로 굴러 내려가 아래 물길로 떨어지고, 물길이 소용돌이로 보낸다.
  // (한쪽으로만 흐르는 홈통은 출구 쪽 출발 슬롯이 0.2초쯤 먼저 도착해 카이제곱 기준을 넘겼다.)
  const G = P.gutter;
  const gx = end.x + (dir * G.width) / 2;
  const gy = end.y - P.drop;
  const half = P.width / 2 + 0.01;
  const gLen = (half - G.hole / 2) / Math.cos(rad(G.slope));
  const holeY = gy - gLen * Math.sin(rad(G.slope));
  pieces.push({ type: 'drop', pos: [end.x, gy - 0.01, 0], yawDeg: dir > 0 ? 0 : 180, size: [G.width, P.drop + 0.05, P.width + 0.02] });
  for (const side of [-1, 1]) {
    const near = side * dir < 0 ? 1 : 0; // 윗단 쪽 난간(로컬 z 기준): 윗단 밑으로 구슬이 들어가지 않게 높인다
    const rails = [P.railH, P.railH];
    rails[near] = 0.04;
    pieces.push({
      type: 'ramp', id: side < 0 ? 'gutterA' : 'gutterB', pos: [gx, gy, side * half], yawDeg: side < 0 ? 90 : 270, slopeDeg: G.slope,
      length: gLen, width: G.width, railH: P.railH, rails, thickness: 0.01,
    });
  }
  line.push([gx, gy, 0]);

  const C = P.chute;
  const cx = end.x - dir * 0.005;
  const cy = holeY - 0.045;
  const cLen = G.width + 0.01 + C.run;
  pieces.push({
    type: 'ramp', id: 'chute', pos: [cx, cy, 0], yawDeg: dir > 0 ? 0 : 180, slopeDeg: C.slope, length: cLen, width: C.width,
    railH: P.railH, backWall: 0.03,
    thickness: 0.01, // 끝이 소용돌이 테두리 위로 넘어가므로, 밑으로 도는 구슬을 막지 않게 얇게
  });
  const cEnd = { x: cx + dir * cLen * Math.cos(rad(C.slope)), y: cy - cLen * Math.sin(rad(C.slope)) };
  line.push([cx, cy, 0], [cEnd.x, cEnd.y, 0]);

  // 소용돌이: 물길 중심선이 테두리 안쪽 inset 지점에서 접선이 되게 놓는다.
  // 물길 끝은 테두리 안쪽으로 overhang만큼 들어간다. 테두리 밖에서 끝나면 느린 구슬이 틈으로 떨어진다.
  const F = P.funnel;
  const H = (F.rOuter - F.rInner) * Math.tan(rad(F.angleDeg));
  const fx = cEnd.x + dir * (Math.sqrt(F.rOuter ** 2 - (F.rOuter - F.inset) ** 2) - F.overhang);
  const fz = F.rOuter - F.inset;
  const fy = cEnd.y - 0.02 - F.rimH - H; // 물길 윗면이 테두리보다 20mm 높다
  pieces.push({ type: 'funnel', pos: [fx, fy, fz], rOuter: F.rOuter, rInner: F.rInner, angleDeg: F.angleDeg, segments: F.segments, rimH: F.rimH });
  pieces.push({ type: 'finish', pos: [fx, fy - 0.03, fz], size: [0.05, 0.02, 0.05], tray: P.tray });
  line.push([fx, fy + H - 0.008, fz], [fx, fy - 0.008, fz], [fx, fy - 0.038, fz]);

  // 받침 상자 바닥이 y = 0.02가 되게 전체를 올린다
  const lift = 0.02 - (fy - 0.03 - 0.01 - P.tray[1]);
  for (const p of pieces) {
    if (p.pos) p.pos = [p.pos[0], p.pos[1] + lift, p.pos[2]].map(round);
    for (const k of ['at', 'size', 'length', 'despawnDrop']) if (p[k] !== undefined) p[k] = Array.isArray(p[k]) ? p[k].map(round) : round(p[k]);
  }
  return {
    id: P.id, name: P.name, units: 'm',
    marble: { radius: 0.008, density: 2500, friction: 0.4, restitution: 0.3, rollingResistance: 0.01 },
    start: { on: 'r1', at: 0.13, slots: 5, slotWidth: 0.02, liftTime: 0.3 },
    pieces,
    // 진행도 계산용 중심선: 구슬 중심 높이(면 + 반지름)를 지난다
    centerline: line.map(([lx, ly, lz]) => [lx, ly + lift + 0.008, lz].map(round)),
  };
}

const common = {
  width: 0.18, railH: 0.02, drop: 0.07, gap: 0.07,
  wedge: [0.03, 0.015, 0.04],
  gutter: { width: 0.06, slope: 8, hole: 0.044 },
  chute: { width: 0.05, slope: 8, run: 0.3 },
  funnel: { rOuter: 0.15, rInner: 0.012, angleDeg: 20, segments: 72, rimH: 0.025, inset: 0.03, overhang: 0.03 },
  tray: [0.16, 0.06, 0.16],
  pinMass: 0.7,
  pinFriction: 0, // 쓰러진 핀이 경사를 미끄러져 내려가 길을 비운다
};

// 장애물 배치 규칙 (시뮬레이션으로 확인한 것)
// 1. 쐐기와 쐐기, 쐐기와 난간 사이 틈은 구슬 지름의 두 배(32mm) 이상으로 둔다. 좁으면 구슬 둘이 나란히 끼어 아치를 만든다.
// 2. 첫 장애물은 모든 출발 슬롯에 똑같아야 한다. 쐐기는 규칙 1 때문에 한 줄에 다섯 개를 놓을 수 없어
//    슬롯마다 지연이 달라지고, 그 시간 차(최대 0.5초)가 결승까지 그대로 남아 특정 슬롯이 유리해진다.
//    그래서 첫 단에는 쐐기 대신 폭 전체에 고르게 선 핀 밭을 둔다.
// 3. 쐐기 줄은 좌우 대칭이고 폭 전체를 덮어야 한다. 가운데에만 두면 난간을 타고 내려오는 구슬이 전부 피해 가
//    바깥 슬롯이 0.4초쯤 먼저 도착한다. 'L'/'R'은 난간에 붙는 쐐기.
const ROW_A = (along, rail) => [[along, 'L', rail], [along, 0], [along, 'R', rail]];
const ROW_B = (along) => [[along, -0.032], [along, 0.032]]; // 꼭짓점이 슬롯 줄 ±20과 ±40 사이: 두 줄을 같은 정도로 건드린다
const maps = [
  {
    ...common, id: 'wood-v1', name: '나무 코스',
    tiers: [
      { slope: 3.2, length: 0.8, pins: [0.34, '9-8-9'] },
      { slope: 3.2, length: 0.8, wedges: [...ROW_A(0.3, [0.019, 0.015, 0.04]), ...ROW_B(0.55)] },
      { slope: 3.2, length: 0.8, wedges: [...ROW_A(0.3), ...ROW_B(0.55)] },
      { slope: 3.2, length: 0.8, wedges: ROW_A(0.4) },
      { slope: 3.2, length: 0.8, pins: [0.45, '4-3-2-1'] },
    ],
  },
  {
    // 계획서의 3단 구성 그대로인 짧은 코스. 15초 안팎에 끝난다(1,000시드 튜닝은 하지 않았다).
    ...common, id: 'wood-short', name: '짧은 나무 코스 (3단)',
    tiers: [
      { slope: 5, length: 0.8, pins: [0.34, '9-8-9'] },
      { slope: 5, length: 0.8, wedges: [...ROW_A(0.3), ...ROW_B(0.55)] },
      { slope: 5, length: 0.8, pins: [0.45, '4-3-2-1'] },
    ],
  },
];

for (const P of maps) {
  const file = `public/maps/${P.id}.json`;
  // 조각 하나를 한 줄에
  const { pieces, centerline, ...head } = make(P);
  const body = pieces.map((p) => '  ' + JSON.stringify(p)).join(',\n');
  const tail = ` "pieces": [\n${body}\n ],\n "centerline": ${JSON.stringify(centerline)}\n}\n`;
  fs.writeFileSync(file, JSON.stringify(head, null, 1).replace(/\n}$/, ',\n') + tail);
  console.log(file);
}
fs.writeFileSync('public/maps/index.json', JSON.stringify(maps.map((m) => ({ id: m.id, name: m.name })), null, 1) + '\n');
