import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const dist = path.join(root, 'dist');
const skip = new Set(['.git', 'node_modules', 'dist', '.wrangler']);

fs.rmSync(dist, { recursive: true, force: true });
fs.mkdirSync(dist);

function copy(source, target) {
  for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
    if (skip.has(entry.name)) continue;
    const from = path.join(source, entry.name);
    const to = path.join(target, entry.name);
    if (entry.isDirectory()) {
      fs.mkdirSync(to);
      copy(from, to);
    } else if (entry.isFile()) {
      fs.copyFileSync(from, to);
    }
  }
}

copy(root, dist);
fs.writeFileSync(path.join(dist, '.assetsignore'), '.git/\nnode_modules/\n');
