// 시뮬레이션에 영향을 주는 난수는 전부 여기서만 뽑는다.
export type Rng = () => number; // [0, 1)

/** sfc32. seed는 32비트 정수. */
export function makeRng(seed: number): Rng {
  let a = 0x9e3779b9 | 0;
  let b = 0x243f6a88 | 0;
  let c = 0xb7e15162 | 0;
  let d = seed | 0;
  const next = () => {
    const t = (((a + b) | 0) + d) | 0;
    d = (d + 1) | 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) | 0;
    c = (c << 21) | (c >>> 11);
    c = (c + t) | 0;
    return (t >>> 0) / 4294967296;
  };
  for (let i = 0; i < 15; i++) next();
  return next;
}

/** Fisher–Yates. 원본을 바꾸지 않는다. */
export function shuffle<T>(items: readonly T[], rng: Rng): T[] {
  const a = items.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export const seedToHex = (seed: number) => (seed >>> 0).toString(16).padStart(8, '0');

/** 8자리 16진수가 아니면 null. */
export function parseSeed(text: string | null): number | null {
  return text && /^[0-9a-f]{1,8}$/i.test(text) ? parseInt(text, 16) >>> 0 : null;
}
