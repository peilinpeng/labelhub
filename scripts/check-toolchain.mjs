// npm 在跨目录分组升级时可能遗漏直接依赖；在安装前校验两棵锁文件。
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
const read = (path) => JSON.parse(readFileSync(new URL(`../${path}`, import.meta.url), 'utf8'));
const paths = ['apps/web', 'packages/schema-renderer', 'packages/schema-designer'];
const version = read('apps/web/package.json').devDependencies.vitest;
assert.match(version, /^\d+\.\d+\.\d+$/, 'Vitest 必须使用精确版本');
for (const path of paths) {
  assert.equal(read(`${path}/package.json`).devDependencies.vitest, version, `${path} 的 Vitest 版本不一致`);
}
assert.equal(read('apps/web/package.json').devDependencies['@vitest/coverage-v8'], version, 'coverage 必须与 Vitest 同版');
for (const path of ['package-lock.json', 'apps/web/package-lock.json']) {
  const packages = read(path).packages;
  for (const [name, entry] of Object.entries(packages)) {
    if (name.endsWith('node_modules/vitest') || name.endsWith('node_modules/@vitest/coverage-v8')) {
      assert.equal(entry.version, version, `${path} 中 ${name} 的锁版本不一致`);
    }
  }
}
console.log(`Vitest / coverage / 共享包锁版本一致：${version}`);
