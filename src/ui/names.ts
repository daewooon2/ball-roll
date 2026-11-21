import { MAX_MARBLES } from '../config';
import type { Entry } from '../race/race';

/**
 * "수박*2, 키위/3*2, 참외" → 구슬 목록. 쉼표나 줄바꿈으로 나눈다.
 * 이름*개수 = 구슬 복제, 이름/가중치 = 구슬 질량 배수. 최대 MAX_MARBLES개.
 */
export function parseNames(text: string): Entry[] {
  const entries: Entry[] = [];
  for (const raw of text.split(/[,\n]/)) {
    let token = raw.trim();
    let count = 1;
    let weight = 1;
    const c = token.match(/\s*[*×]\s*(\d+)$/); // '자두*10', '자두 * 10', '자두×10'
    if (c) {
      count = +c[1];
      token = token.slice(0, c.index).trim();
    }
    const w = token.match(/\s*\/\s*(\d+(?:\.\d+)?)$/);
    if (w) {
      weight = Math.min(10, Math.max(0.1, +w[1]));
      token = token.slice(0, w.index).trim();
    }
    if (!token) continue;
    for (let i = 0; i < count && entries.length < MAX_MARBLES; i++) entries.push({ name: token, weight });
  }
  return entries;
}

/** 구슬마다 다른 색. 황금각으로 색상을 돌린다. */
export const marbleColor = (i: number) => `hsl(${Math.round((i * 137.5) % 360)}, 72%, 56%)`;

/** 구슬별 색. 이름이 같으면 같은 색(처음 나온 순서대로 색을 붙인다). */
export function entryColors(entries: { name: string }[]) {
  const order = new Map<string, number>();
  return entries.map((e) => marbleColor(order.get(e.name) ?? order.set(e.name, order.size).get(e.name)!));
}
