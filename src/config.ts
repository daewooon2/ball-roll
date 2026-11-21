// 단위: 1 unit = 0.1 m. 맵 JSON은 m 단위이고 map/build.ts에서 WORLD_SCALE을 곱한다.
export const WORLD_SCALE = 10;
export const GRAVITY = 9.81 * WORLD_SCALE; // 98.1 units/s²
export const DT = 1 / 240;
export const STEPS_PER_SEC = 240;

export const FLOOR_COLLIDER_THICKNESS = 0.03 * WORLD_SCALE; // 터널링 방지용 (렌더는 10mm)
export const FLOOR_VISUAL_THICKNESS = 0.01 * WORLD_SCALE;
export const WALL_THICKNESS = 0.02 * WORLD_SCALE; // 판 테두리. 두꺼워서 테두리에 닿는 벽 끝이 그 속에 묻힌다

export const MAX_RACE_STEPS = STEPS_PER_SEC * 120; // 이 시간이 지나면 미완주 처리
export const STUCK_SPEED = 0.01 * WORLD_SCALE; // 0.01 m/s
export const STUCK_STEPS = 480; // 2초
// 안전망: 결승 구간에 첫 구슬이 들어온 뒤 이만큼 지나도 안 끝나면 결승 깔때기 벽을 없앤다(막대와 박자가 맞아 못 들어가는 구슬)
export const DRAIN_STEPS = STEPS_PER_SEC * 40;
// 뭉침 폭발: 구슬 BURST_COUNT개 이상이 한 구슬에서 BURST_RADIUS 안에 모이면 바깥으로 BURST_SPEED로 흩는다
export const BURST_RADIUS = 0.03 * WORLD_SCALE;
export const BURST_COUNT = 4;
export const BURST_SPEED = 1.3 * WORLD_SCALE;
export const BURST_COOLDOWN = STEPS_PER_SEC * 2;
// 막대의 빨간 끝에 닿은 구슬은 이 속력으로 튕겨 나간다
export const TIP_SPEED = 1.0 * WORLD_SCALE;
export const STALL_STEPS = STEPS_PER_SEC * 3; // 이만큼 더 내려가지 못하면(바퀴와 박자가 맞아 맴도는 구슬) 밀어 준다
export const STUCK_KICK = 0.15 * WORLD_SCALE; // 0.15 m/s
export const START_JITTER = 0.005 * WORLD_SCALE; // 초기 속도 섭동 상한

export const MAX_MARBLES = 30;

export type QualityName = 'low' | 'normal' | 'high';
export const QUALITY: Record<QualityName, { dpr: number; shadowMap: boolean; glass: boolean }> = {
  low: { dpr: 1, shadowMap: false, glass: false },
  normal: { dpr: 2, shadowMap: false, glass: false },
  high: { dpr: 2, shadowMap: true, glass: true },
};
