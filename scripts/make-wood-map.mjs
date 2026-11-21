// public/maps/*.json 생성기. 구간을 위에서 아래로 쌓아 낙하판 하나를 만든다.
// 구간 순서나 치수를 바꾸면 아래 좌표가 전부 따라 바뀌므로 손으로 고치는 대신 여기를 고치고 `npm run map`.
// 게임 코드는 JSON만 읽는다. 좌표는 판 위의 [x, y] (m), x = 가운데가 0, y = 아래로 갈수록 작아진다.
import fs from 'node:fs';

const round = (v) => Math.round(v * 1e4) / 1e4;
const tan = (d) => Math.tan((d * Math.PI) / 180);
const COLORS = ['red', 'orange', 'green', 'blue', 'purple', 'yellow'];

// 배치 규칙 (시뮬레이션으로 확인한 것)
// 1. 장애물끼리, 장애물과 벽 사이 틈은 구슬 지름(16mm)보다 확실히 넓게, 되도록 두 배(32mm) 이상.
//    그 사이(16~32mm)면 구슬 둘이 아치를 만들어 끼일 수 있다.
// 2. 수평에 가까운 면을 두지 않는다(선반 20° 이상, 블록은 마름모). 평평하면 구슬이 올라앉는다.
// 3. 움직이는 장애물은 운동학 강체라 구슬을 벽에 누르면 튕겨 나간다. 끝이 벽에서 20mm 이상 떨어지게 둔다.
// 4. 첫 구간은 폭 전체에 고른 핀 밭. 출발 슬롯마다 다른 지연을 만들지 않는다.
function make(P) {
  const hw = P.width / 2;
  const pieces = [];
  const marks = [];
  let spot;
  let y = 0; // 다음 구간이 시작하는 높이
  let color = 0;
  const next = () => COLORS[color++ % COLORS.length];
  const wall = (a, b) => pieces.push({ type: 'wall', a, b });
  /** 가운데 맞춘 한 줄 */
  const row = (n, pitch) => Array.from({ length: n }, (_, i) => (i - (n - 1) / 2) * pitch);

  const sections = {
    // 폭 전체에 엇갈린 핀 밭
    pegs(rows = 5) {
      for (let i = 0; i < rows; i++) for (const x of row(i % 2 ? 6 : 7, 0.038)) pieces.push({ type: 'peg', at: [x, y - 0.03 - i * 0.035], r: 0.003 });
      y -= 0.03 + rows * 0.035;
    },
    // 양쪽 벽에서 내려와 cx에 폭 m짜리 입구를 남기는 깔때기
    funnel(cx, m = 0.07, deg = 30) {
      const drop = (hw + Math.abs(cx) - m / 2) * tan(deg);
      wall([-hw, y], [cx - m / 2, y - drop]);
      wall([hw, y], [cx + m / 2, y - drop]);
      y -= drop;
    },
    // 관로: x0에서 시작해 xs의 x로 차례로 꺾이며 내려간다. 벽 사이 수직 폭은 m·sin(deg).
    pipe(x0, xs, m = 0.07, deg = 50) {
      let x = x0;
      for (const nx of xs) {
        const d = Math.abs(nx - x) * tan(deg);
        for (const s of [-1, 1]) wall([x + (s * m) / 2, y], [nx + (s * m) / 2, y - d]);
        x = nx;
        y -= d;
      }
      y -= 0.03;
    },
    // 잘 튕기는 둥근 범퍼
    bumpers(rows = 3) {
      for (let i = 0; i < rows; i++)
        for (const x of row(i % 2 ? 3 : 4, 0.07)) pieces.push({ type: 'peg', at: [x, y - 0.04 - i * 0.065], r: 0.012, bounce: 0.9, color: next() });
      y -= 0.04 + rows * 0.065;
    },
    // 좌우 벽에서 번갈아 나오는 선반
    shelves(n = 4, len = 0.2, deg = 30, gap = 0.12) {
      for (let i = 0; i < n; i++) {
        const side = i % 2 ? 1 : -1;
        wall([side * hw, y - 0.02 - i * gap], [side * (hw - len), y - 0.02 - i * gap - len * tan(deg)]);
      }
      y -= 0.02 + (n - 1) * gap + len * tan(deg) + 0.05;
    },
    // 십자 스피너 두 줄. 좌우가 서로 반대로 돈다.
    spinners(rpm = 40) {
      for (const x of row(3, 0.09)) pieces.push({ type: 'spinner', at: [x, y - 0.06], length: 0.07, rpm: x > 0 ? -rpm : rpm, cross: true, color: next() });
      for (const x of row(2, 0.09)) pieces.push({ type: 'spinner', at: [x, y - 0.15], length: 0.07, rpm: x > 0 ? rpm : -rpm, cross: true, phase: 0.125, color: next() });
      y -= 0.21;
    },
    // 마름모 블록. 홀수 줄은 벽에 반쯤 묻힌 블록으로 벽 타는 길을 막는다.
    diamonds(rows = 3) {
      for (let i = 0; i < rows; i++)
        for (const x of i % 2 ? [-hw, -0.0375, 0.0375, hw] : row(3, 0.075)) pieces.push({ type: 'box', at: [x, y - 0.04 - i * 0.07], size: [0.03, 0.03], deg: 45, color: next() });
      y -= 0.04 + rows * 0.07;
    },
    // 좌우로 왕복하는 마름모. 윗줄 둘은 거울처럼 움직인다.
    sliders() {
      for (const s of [-1, 1]) pieces.push({ type: 'slider', at: [s * 0.075, y - 0.06], size: [0.035, 0.035], deg: 45, amp: s * 0.03, period: 2, color: next() });
      pieces.push({ type: 'slider', at: [0, y - 0.15], size: [0.035, 0.035], deg: 45, amp: 0.08, period: 3, color: next() });
      y -= 0.21;
    },
    // 큰 풍차
    windmill(rpm = 18) {
      pieces.push({ type: 'spinner', at: [0, y - 0.13], length: 0.2, rpm, cross: true, color: next() });
      y -= 0.26;
    },
    // 갈림길: 가운데 입구 아래 마름모가 좌우로 가른다. fast(-1 왼쪽, 1 오른쪽) 쪽은 곧장 떨어지고
    // 반대쪽은 선반 셋을 돌아 내려가 1초쯤 늦는다. 어느 쪽으로 갈지는 입구에서 부딪히는 대로라 순위가 섞인다.
    fork(fast = -1) {
      sections.funnel(0, 0.07);
      pieces.push({ type: 'box', at: [0, y - 0.05], size: [0.04, 0.04], deg: 45, color: next() });
      wall([0, y - 0.05 - 0.02 * Math.SQRT2], [0, y - 0.4]); // 마름모 아래 꼭짓점에서 시작(마름모를 뚫고 올라가지 않게)
      for (let i = 0; i < 3; i++) {
        const [from, to] = i % 2 ? [-fast * hw, -fast * 0.055] : [0, -fast * 0.095];
        wall([from, y - 0.12 - i * 0.09], [to, y - 0.12 - i * 0.09 - 0.095 * tan(30)]);
      }
      for (const dy of [0.16, 0.28]) pieces.push({ type: 'peg', at: [fast * 0.075, y - dy], r: 0.003 });
      y -= 0.43;
    },
    // 지름길: 한가운데 좁은 관(안쪽 30mm)에 들어가면 곧장 떨어지고, 빗나가면 양옆 선반을 돌아 1초 넘게 늦는다.
    // 입구 위의 범퍼가 구슬을 흩어 놓아 선두라도 대개 빗나간다. 뒤따르던 구슬이 쏙 들어가 앞지르는 자리.
    // n = 빗나간 쪽이 도는 선반 수(많을수록 더 늦는다). 맨 끝에 두면 관이 결승선으로 곧장 이어진다.
    jackpot(n = 3) {
      const TUBE = 0.022;
                  sections.funnel(0, 0.11);
      pieces.push({ type: 'peg', at: [0, y - 0.035], r: 0.009, bounce: 0.9, color: next() });
      const t0 = y - 0.085;
      const t1 = t0 - 0.045 - n * 0.09 - 0.09;
      for (const s of [-1, 1]) {
        wall([s * TUBE, t0], [s * TUBE, t1]);
        // 돌아온 길 끝에도 스피너가 하나씩 있어, 다 온 구슬을 다시 쳐올리기도 한다
        pieces.push({ type: 'spinner', at: [s * (TUBE + hw) / 2, t1 + 0.045], length: 0.07, rpm: s * 35, cross: true, color: next() });
        for (let i = 0; i < n; i++) {
          const [from, to] = i % 2 ? [TUBE, TUBE + 0.085] : [hw, hw - 0.085];
          wall([s * from, t0 - 0.03 - i * 0.09], [s * to, t0 - 0.03 - i * 0.09 - 0.085 * tan(30)]);
        }
      }
      y = t1 - 0.02;
    },
    // 통통 튕기는 구간: 닿으면 튕겨 내는 팝 범퍼 두 줄. 사이 틈(36mm)으로 빠져나가기 전에 몇 번씩 튄다.
    bouncers(pop = 0.7) {
      for (let i = 0; i < 2; i++)
        for (const x of row(i % 2 ? 4 : 5, 0.06)) pieces.push({ type: 'peg', at: [x, y - 0.12 - i * 0.07], r: 0.012, pop, color: next() });
      y -= 0.26;
    },
    // 구멍 함정: 빠지면 back 구간 위(그 구간 맨 위)에서 다시 나온다(구슬 하나당 max번). 결승선 바로 앞이라 선두가 빠지면 순위가 뒤집힌다.
    // 구멍 사이에 범퍼를 두어 구슬이 구멍 쪽으로 튕겨 가게 한다. r = 구멍 반지름(구슬 중심이 그 안에 들어오면 빠진다)
    holes(r = 0.014, max = 2, back = 3) {
      const top = [0, marks[Math.max(0, marks.length - 1 - back)] - 0.02];
      const hole = (x, dy) => pieces.push({ type: 'hole', at: [x, y - dy], r, to: top, max });
      const bump = (x, dy) => pieces.push({ type: 'peg', at: [x, y - dy], r: 0.01, bounce: 0.8, color: next() });
      for (const x of [-0.1, 0, 0.1]) hole(x, 0.09);
      for (const x of [-0.05, 0.05]) bump(x, 0.07);
      for (const x of [-0.05, 0.05]) hole(x, 0.18);
      for (const x of [-0.11, 0, 0.11]) bump(x, 0.16);
      for (const x of [-0.1, 0, 0.1]) hole(x, 0.27);
      for (const x of [-0.05, 0.05]) bump(x, 0.25);
      // 양쪽 난간 아래쪽에 붙은 아주 얇은 빨간 벽(11cm): 잘 튕긴다(반발 1.3: 닿으면 더 빨라져 나간다)
      for (const s of [-1, 1]) pieces.push({ type: 'wall', a: [s * (hw - 0.0015), y - 0.2], b: [s * (hw - 0.0015), y - 0.31], t: 0.003, bounce: 1.3, pop: 0.9, color: 'red' });
      y -= 0.32;
    },
    // 결승(문지기 막대): 가파른 깔때기가 좁은 목으로 이어지고, 목 왼쪽 바깥에 축을 둔 긴 막대가 돌면서
    // 끝으로 목 입구를 아래에서 위로 훑는다. 막 들어가려던 구슬이 막대에 걸려 다시 깔때기 위로 밀려 올라간다.
    // 깔때기 벽은 trap(당첨자가 정해지거나 12초가 지나면 사라짐)이라 끝내 못 들어가는 구슬은 없다.
    // 결승(긴 막대): 가파른 깔때기(deg)가 좁은 목(폭 neck)으로 이어지고, 한쪽 끝을 왼쪽 깔때기 벽(px, py)에 박은 긴 막대가
    // 천천히 돌며 다른 끝으로 목 입구를 훑는다. 막 들어가려던 구슬이 막대에 걸려 깔때기 위로 밀려 올라간다.
    // 막대 끝은 난간에서 20mm 넘게 떨어져야 한다(가까우면 구슬을 난간에 눌러 벽을 뚫는다).
    // 막대 중심을 깔때기 안에 두면 회전 원이 목으로 가는 길을 덮어 마지막 구슬이 못 들어간다(측정).
    // 깔때기 벽은 trap(첫 구슬이 이 구간에 들어오고 40초가 지나면 사라지는 안전망)이다.
    gate(rpm = 24, neck = 0.034, len = 0.085, px = -0.06, py = 0.051, deg = 50) {
      const drop = (hw - neck / 2) * tan(deg);
      const yn = y - drop;
      const T = 0.02;
      const c = Math.cos((deg * Math.PI) / 180);
      const sn = Math.sin((deg * Math.PI) / 180);
      for (const s of [-1, 1]) {
        // 벽은 두껍게(T). 깔때기 벽과 목 벽은 안쪽 면이 (xi, yn)에서 정확히 만나게 딱 잘라(flush) 맞추고,
        // 깔때기 벽은 난간을 넘어 테두리(20mm) 속까지 뻗어 이음새가 안 보이게 한다.
        const xi = (s * neck) / 2;
        const xo = s * (hw + 0.004);
        const yo = yn + (hw + 0.004 - neck / 2) * tan(deg);
        pieces.push({ type: 'wall', a: [xo + (s * sn * T) / 2, yo - (c * T) / 2], b: [xi + (s * sn * T) / 2, yn - (c * T) / 2], t: T, flush: true, trap: true });
        pieces.push({ type: 'wall', a: [xi + (s * T) / 2, yn], b: [xi + (s * T) / 2, yn - 0.1], t: T, flush: true });
      }
      // 막대의 가운데(축)는 목 왼쪽 바깥(왼쪽 깔때기 벽 아래)에 있다. 돌면서 오른쪽 끝이 목 입구 바로 아래를 가로질러
      // 목을 막고, 위로 올라갈 때는 깔때기 벽을 뚫고 나와 깔때기 안을 훑는다.
      pieces.push({ type: 'spinner', at: [px, yn + py], length: len, rpm, thick: 0.007, tips: 0.02, color: '#2ee6e6' });
      // 닿으면 아주 세게(초속 1.5m) 튕겨 내는 작은 기둥 여섯(지름 12mm): 아래 3개, 가운데 2개, 위 1개로 엇갈리게.
      // 막대 끝과 깔때기 벽에서 2cm 넘게 띄운다.
      const pop = (x, dy) => pieces.push({ type: 'peg', at: [x, yn + dy], r: 0.006, pop: 1.5, bounce: 1.3, color: 'red' });
      for (const x of [-0.07, 0, 0.07]) pop(x, 0.115);
      for (const x of [-0.035, 0.035]) pop(x, 0.15);
      pop(0, 0.185);
      spot = [0, yn];
      y = yn - 0.1;
    },
    // 마지막: 가운데로 모은 뒤 큰 바퀴가 결승선 바로 앞에서 구슬을 쳐낸다.
    // 바닥에 구멍을 두고 바퀴가 그 위를 쓸게 했더니(될 듯 말 듯) 혼자 남은 구슬이 바퀴와 박자가 맞아 1분 넘게 못 들어갔다. 그래서 열린 방으로 둔다.
    finale(rpm = -25) {
      sections.funnel(0, 0.08);
      pieces.push({ type: 'spinner', at: [0, y - 0.1], length: 0.14, rpm, cross: true, color: next() });
      y -= 0.19;
    },
  };

  for (const [name, ...args] of P.sections) {
    marks.push(round(y));
    sections[name](...args);
  }
  for (const p of pieces) for (const k of ['a', 'b', 'at']) if (p[k]) p[k] = p[k].map(round);
  return {
    id: P.id, name: P.name, units: 'm',
    marble: { radius: 0.008, density: 2500, friction: 0.4, restitution: P.restitution, rollingResistance: 0.01 },
    tiltDeg: P.tilt, width: P.width, top: 0.07, bottom: round(y - 0.07), wallH: 0.02,
    start: { y: 0, slots: 10, slotWidth: 0.018, liftTime: 0.15 },
    finishY: round(y),
    marks,
    ...(spot ? { spot: spot.map(round) } : {}),
    pieces,
  };
}

const maps = [
  {
    id: 'wood-v1', name: '나무 낙하판', width: 0.3, tilt: 21, restitution: 0.4,
    sections: [
      ['pegs', 3], ['funnel', -0.08], ['pipe', -0.08, [0.08, -0.08, 0.08]], ['spinners'], ['funnel', 0.08], ['pipe', 0.08, [-0.08, 0.08]],
      ['fork', -1], ['bouncers'], ['funnel', 0], ['pipe', 0, [0.09, -0.09, 0]], ['sliders'], ['jackpot'], ['bumpers', 3], ['holes', 0.018, 2, 3], ['gate', 26, 0.034, 0.165, -0.055, -0.002],
    ],
  },
];

for (const P of maps) {
  const file = `public/maps/${P.id}.json`;
  // 조각 하나를 한 줄에
  const { pieces, ...head } = make(P);
  const body = pieces.map((p) => '  ' + JSON.stringify(p)).join(',\n');
  fs.writeFileSync(file, JSON.stringify(head, null, 1).replace(/\n}$/, ',\n') + ` "pieces": [\n${body}\n ]\n}\n`);
  console.log(file, `길이 ${(-head.finishY).toFixed(2)}m, 조각 ${pieces.length}개`);
}
fs.writeFileSync('public/maps/index.json', JSON.stringify(maps.map((m) => ({ id: m.id, name: m.name })), null, 1) + '\n');
