import { DT, GRAVITY, WORLD_SCALE } from '../config';

const ROLL_MIN_SPEED = 0.02 * WORLD_SCALE; // 2 cm/s
import type { Body, PhysicsWorld } from './world';

/**
 * 구름 저항: 접촉 중인 구슬의 각속도를 줄인다.
 * 토크 = coeff · r · N, 속이 찬 구 I = 0.4·m·r² 이므로 각감속 = coeff·g / (0.4·r).
 * ponytail: 수직항력을 m·g로 근사한다(경사·원심력 무시). 소용돌이 감쇠가 어색하면 접촉 임펄스에서 N을 읽을 것.
 */
export function applyRollingResistance(world: PhysicsWorld, body: Body, radius: number, coeff: number, canRest: boolean) {
  const w = body.angularSpeed();
  // 아주 느릴 때는 저항을 걸지 않는다. 걸면 정지 마찰처럼 작용해 쐐기 꼭짓점에 정면으로 닿은 구슬이 그대로 선다.
  // 결승 뒤 받침 상자에 들어간 구슬(canRest)은 멈춰야 하므로 예외.
  if (w === 0 || (!canRest && w * radius < ROLL_MIN_SPEED) || !world.inContact(body)) return;
  const dw = ((coeff * GRAVITY) / (0.4 * radius)) * DT;
  body.scaleAngularVelocity(Math.max(0, 1 - dw / w));
}
