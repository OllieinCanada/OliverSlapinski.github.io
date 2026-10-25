import { SourceTextModule } from 'node:vm';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const roots = ['dist', 'scripts', 'tests'];
const files = ['cli.mjs', ...roots.flatMap((root) => readdirSync(root).filter((name) => name.endsWith('.mjs')).map((name) => join(root, name)))];
for (const file of files) {
  new SourceTextModule(readFileSync(file, 'utf8'), { identifier: file });
}
console.log(`Syntax checked ${files.length} JavaScript modules.`);
