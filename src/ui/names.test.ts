import { expect, it } from 'vitest';
import { parseNames } from './names';

it('이름*개수, 이름/가중치를 읽는다', () => {
  expect(parseNames('수박*2,키위*2').map((e) => e.name)).toEqual(['수박', '수박', '키위', '키위']);
  expect(parseNames(' 참외 /3*2\n\n포도, ')).toEqual([
    { name: '참외', weight: 3 },
    { name: '참외', weight: 3 },
    { name: '포도', weight: 1 },
  ]);
  expect(parseNames('가*100')).toHaveLength(30); // 최대 30개
  expect(parseNames('*3, /2')).toEqual([]);
  // 기호 앞뒤에 띄어쓰기가 있어도 된다
  expect(parseNames('자두 * 3, 포도 / 2')).toEqual([
    { name: '자두', weight: 1 },
    { name: '자두', weight: 1 },
    { name: '자두', weight: 1 },
    { name: '포도', weight: 2 },
  ]);
});
