# 3D 구슬 경주 웹 게임 (또르르 구슬 경주)

설계 문서: docs/PLAN.md (작업 전 해당 단계 섹션을 읽을 것). 계획과 달라진 점과 측정 결과는 README.md.

## 스택
- TypeScript + Vite, three (WebGLRenderer), @dimforge/rapier3d 0.19.3 (버전 고정, 올리지 말 것)
- UI는 프레임워크 없이 DOM 직접 조작
- 테스트: Vitest

## 명령
- npm run dev      개발 서버 (폰에서 보려면 `npm run dev -- --host`)
- npm run build    타입 검사 → 빌드 → dist 의 gzip 크기 출력
- npm run test     단위 테스트
- npm run sim -- --seeds 1000   헤드리스 시뮬레이션 (카이제곱, 경주 시간, 미완주, 구간별 끼임)
- npm run map      scripts/make-wood-map.mjs 로 public/maps/*.json 다시 생성
- node scripts/bias.mjs 200     슬롯별 체크포인트 통과 시각 (어느 구간이 편향을 만드는지)
- node scripts/trace.mjs <시드> <초>   구슬 위치 추적, node scripts/stuck.mjs   미완주 시드 찾기

## 규칙
- src/race, src/physics, src/map, src/rng.ts 는 DOM, three 를 import 하지 않는다
- Rapier 는 src/physics/world.ts 에서만 import 한다
- 물리 스텝은 고정 1/240초. 경주 시간은 스텝 번호로 센다 (Date, performance.now 금지)
- 시뮬레이션에 영향을 주는 난수는 rng.ts 의 시드 PRNG 만 쓴다 (Math.random 금지)
- 단위: 1 unit = 0.1m, 중력 98.1 units/s^2, 구슬 반지름 0.08 unit
- 평면과 난간은 cuboid, 쐐기는 convexHull. trimesh 는 소용돌이에만 쓰고 FIX_INTERNAL_EDGES 를 켠다
- 굴러가는 면 하나는 cuboid 하나로 만든다. 같은 평면의 cuboid 를 맞대면 이음새에서 튄다 (1 m/s 에서 최대 9mm, 0단계 측정)
- 코스 치수는 코드에 쓰지 말고 public/maps/*.json 에 둔다. 나무 코스는 scripts/make-wood-map.mjs 의 파라미터를 고쳐 다시 만든다
- 물리 값이나 코스를 바꾸면 npm run sim 으로 완주율과 카이제곱 값을 다시 확인한다
- 빌드 결과 gzip 합계 1.0MB 이하를 유지한다

## 코스를 고칠 때 (시뮬레이션으로 확인한 것)
- 쐐기와 쐐기, 쐐기와 난간 사이 틈은 32mm(구슬 지름 두 배) 이상. 좁으면 구슬 둘이 아치를 만들어 끼인다
- 첫 장애물은 모든 출발 슬롯에 같아야 한다 (첫 단은 핀 밭). 슬롯마다 다른 지연은 결승까지 남는다
- 쐐기 줄은 좌우 대칭으로 폭 전체를 덮는다 (난간에 붙는 쐐기 포함). 수집부(홈통)도 좌우 대칭
- 소용돌이로 들어가는 물길 끝은 테두리 안쪽까지 넣는다. 밖에서 끝나면 느린 구슬이 틈으로 떨어진다
