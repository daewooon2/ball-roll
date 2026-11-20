// 빌드 결과(dist)의 gzip 크기를 파일별로, 그리고 합계로 출력한다. 목표: 합계 1.0MB 이하.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const files = fs.readdirSync('dist', { recursive: true }).filter((f) => fs.statSync(path.join('dist', f)).isFile());
let total = 0;
for (const f of files.sort()) {
  const gz = zlib.gzipSync(fs.readFileSync(path.join('dist', f)), { level: 9 }).length;
  total += gz;
  console.log(`${(gz / 1024).toFixed(1).padStart(8)} KB  ${f}`);
}
console.log(`${(total / 1024).toFixed(1).padStart(8)} KB  합계 (gzip) — 목표 1024 KB 이하: ${total <= 1024 * 1024 ? '통과' : '초과'}`);
if (total > 1024 * 1024) process.exitCode = 1;
