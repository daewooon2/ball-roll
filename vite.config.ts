import { defineConfig } from 'vitest/config';
import wasm from './scripts/wasm-plugin.ts';

export default defineConfig({
  base: './', // GitHub Pages 하위 경로에서도 동작
  plugins: [wasm()],
  // 패키지에 main/exports가 없어 Node(SSR) 쪽에서 진입점을 못 찾는다
  resolve: { alias: { '@dimforge/rapier3d': '@dimforge/rapier3d/rapier.js' } },
  // 미리 번들하면 wasm이 불러오는 접착 코드(rapier_wasm3d_bg.js)와 번들 안의 사본이 따로 놀아 깨진다
  optimizeDeps: { exclude: ['@dimforge/rapier3d'] },
  build: { target: 'esnext', assetsInlineLimit: 0 },
  ssr: { noExternal: ['@dimforge/rapier3d'] },
  test: { server: { deps: { inline: ['@dimforge/rapier3d'] } }, testTimeout: 120_000 },
});
