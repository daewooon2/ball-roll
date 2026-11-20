// 단위: 1 unit = 0.1 m. 맵 JSON은 m 단위이고 map/build.ts에서 WORLD_SCALE을 곱한다.
export const WORLD_SCALE = 10;
export const GRAVITY = 9.81 * WORLD_SCALE; // 98.1 units/s²
export const DT = 1 / 240;
export const STEPS_PER_SEC = 240;

export const FLOOR_COLLIDER_THICKNESS = 0.03 * WORLD_SCALE; // 터널링 방지용 (렌더는 10mm)
export const FLOOR_VISUAL_THICKNESS = 0.01 * WORLD_SCALE;
export const WALL_THICKNESS = 0.01 * WORLD_SCALE;

export const MAX_RACE_STEPS = STEPS_PER_SEC * 120; // 이 시간이 지나면 미완주 처리
export const STUCK_SPEED = 0.01 * WORLD_SCALE; // 0.01 m/s
export const STUCK_STEPS = 480; // 2초
export const STUCK_KICK = 0.1 * WORLD_SCALE; // 0.1 m/s
export const OOB_DISTANCE = 0.3 * WORLD_SCALE; // 중심선에서 이만큼 벗어나면 코스로 되돌린다
export const START_JITTER = 0.005 * WORLD_SCALE; // 초기 속도 섭동 상한

export const MAX_MARBLES = 30;

export type QualityName = 'low' | 'normal' | 'high';
export const QUALITY: Record<QualityName, { dpr: number; shadowMap: boolean; glass: boolean }> = {
  low: { dpr: 1, shadowMap: false, glass: false },
  normal: { dpr: 2, shadowMap: false, glass: false },
  high: { dpr: 2, shadowMap: true, glass: true },
};
