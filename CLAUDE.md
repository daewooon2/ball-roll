# 3D 구슬 경주 웹 게임 (공 굴리기 게임)

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
- node scripts/bias.mjs 200     슬롯별 구간 통과 시각
- node scripts/trace.mjs <시드> <초>   구슬 위치 추적, node scripts/stuck.mjs   끼이는 자리 찾기

## 규칙
- src/race, src/physics, src/map, src/rng.ts 는 DOM, three 를 import 하지 않는다
- Rapier 는 src/physics/world.ts 에서만 import 한다
- 물리 스텝은 고정 1/240초. 경주 시간은 스텝 번호로 센다 (Date, performance.now 금지)
- 시뮬레이션에 영향을 주는 난수는 rng.ts 의 시드 PRNG 만 쓴다 (Math.random 금지)
- 단위: 1 unit = 0.1m, 중력 98.1 units/s^2, 구슬 반지름 0.08 unit
- 좌표: x = 판의 가로, y = 판의 위쪽, z = 판에서 솟는 쪽. 판을 기울이는 대신 중력을 기울인다 (맵의 tiltDeg)
- 판은 cuboid 하나, 벽·블록은 cuboid, 핀·범퍼는 cylinder. 판 위에 유리 덮개 충돌체가 있다
- 코스 치수는 코드에 쓰지 말고 public/maps/*.json 에 둔다. 나무 코스는 scripts/make-wood-map.mjs 의 파라미터를 고쳐 다시 만든다
- 물리 값이나 코스를 바꾸면 npm run sim 으로 완주율과 카이제곱 값을 다시 확인한다
- 빌드 결과 gzip 합계 1.0MB 이하를 유지한다

## 코스를 고칠 때 (시뮬레이션으로 확인한 것)
- 벽(wall)은 양 끝에 둥근 마개가 붙어 꺾이는 이음새가 둥글게 이어진다. flush 벽은 마개 없이 딱 잘린다(두꺼운 벽끼리 맞출 때). 판 테두리는 20mm라 테두리에 닿는 벽 끝은 그 속에 묻는다
- 장애물끼리, 장애물과 벽 사이 틈은 32mm(구슬 지름 두 배) 이상. 16~32mm면 구슬 둘이 아치를 만들어 끼인다
- 벽 가까이(구슬이 못 지나가는 거리)에 핀을 두지 않는다. 벽과 핀 사이 홈에 구슬이 앉는다
- 수평에 가까운 면을 두지 않는다 (선반 30°, 블록은 마름모)
- 움직이는 장애물(spinner, slider)은 자세를 스텝 번호에서만 계산한다. 끝이 벽에서 20mm 이상 떨어지게 둔다. 운동학 강체라 구슬이 눌리면 튕겨 나간다
- 공정성 수치(슬롯별 χ²)는 맞추지 않는다. 이름과 출발 자리는 시드로 섞인다. 재미(역전)는 node scripts/suspense.mjs 로 본다
- 결승(gate): 깔때기 → 좁은 목. 막대는 축을 깔때기 벽에 박은 한쪽 끝 막대(spinner.end)로 목 입구만 훑게 한다. 막대 중심을 깔때기 안에 두면 회전 원이 목으로 가는 길을 덮어 마지막 구슬이 못 들어간다. 긴 막대는 회전 방향이 중요하다: 막대가 구슬을 위쪽 모서리(난간과 깔때기 벽 사이)로 몰아가는 방향이면 벽을 뚫는다. breach.mjs 로 확인. 깔때기 벽(trap)은 안전망(40초)으로만 사라진다
- 움직이는 막대가 벽과 엇갈리는 곳은 벽을 20mm로 두껍게 하고 막대 마찰은 0으로 둔다. 얇은 벽(6mm)에서는 100판 중 73판에서 구슬이 벽을 뚫었다. 고친 뒤에는 node scripts/breach.mjs 로 확인
- 구멍 함정(hole): 구슬 중심이 반지름 안에 들어오면 to 로 옮긴다(구슬 하나당 max번). to 는 열린 곳이어야 한다. 생성기는 back 구간 위의 구간 맨 위를 쓴다
- 팝 범퍼(peg.pop)는 닿은 구슬의 속도를 바깥쪽으로 다시 정한다. 경주 판정 코드(race.ts)에서 처리한다
- 어디서 끼이는지는 node scripts/stuck.mjs 로 본다
