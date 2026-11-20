// `import * as wasm from './x.wasm'` (wasm ESM 통합)을 지원하는 최소 Vite 플러그인.
// 브라우저: .wasm을 별도 파일로 내보내고 스트리밍으로 받는다. Node(Vitest, sim): 파일을 직접 읽는다.
// vite-plugin-wasm은 Vitest 5 러너에서 가상 모듈 경로 오류로 동작하지 않아 직접 만들었다.
import fs from 'node:fs';
import type { Plugin } from 'vite';

export default function wasm(): Plugin {
  return {
    name: 'wasm-esm',
    enforce: 'pre',
    load(id, options) {
      if (!id.endsWith('.wasm')) return;
      const mod = new WebAssembly.Module(fs.readFileSync(id));
      const sources = [...new Set(WebAssembly.Module.imports(mod).map((i) => i.module))];
      const names = WebAssembly.Module.exports(mod).map((e) => e.name);
      const file = JSON.stringify(id);
      const imports = `{ ${sources.map((s, i) => `${JSON.stringify(s)}: m${i}`).join(', ')} }`;
      return [
        ...sources.map((s, i) => `import * as m${i} from ${JSON.stringify(s)};`),
        options?.ssr
          ? `import fs from 'node:fs';
             const { exports: x } = new WebAssembly.Instance(new WebAssembly.Module(fs.readFileSync(${file})), ${imports});`
          : `import url from ${JSON.stringify(id + '?url')};
             const { instance: { exports: x } } = await WebAssembly.instantiateStreaming(fetch(url), ${imports});`,
        ...names.map((n) => `export const ${n} = x.${n};`),
      ].join('\n');
    },
  };
}
