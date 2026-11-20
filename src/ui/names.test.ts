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
});
