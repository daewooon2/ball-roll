import { DT, GRAVITY } from '../config';
import type { Body, PhysicsWorld } from './world';

/**
 * 구름 저항: 접촉 중인 구슬의 각속도를 줄인다.
 * 토크 = coeff · r · N, 속이 찬 구 I = 0.4·m·r² 이므로 각감속 = coeff·g / (0.4·r).
 * ponytail: 수직항력을 m·g로 근사한다(경사·원심력 무시). 소용돌이 감쇠가 어색하면 접촉 임펄스에서 N을 읽을 것.
 */
export function applyRollingResistance(world: PhysicsWorld, body: Body, radius: number, coeff: number) {
  const w = body.angularSpeed();
  if (w === 0 || !world.inContact(body)) return;
  const dw = ((coeff * GRAVITY) / (0.4 * radius)) * DT;
  body.scaleAngularVelocity(Math.max(0, 1 - dw / w));
}
