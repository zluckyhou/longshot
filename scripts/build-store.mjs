import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstatSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, mkdirSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const manifest = JSON.parse(readFileSync(join(root, 'manifest.json'), 'utf8'));
if (!/^\d+\.\d+\.\d+(\.\d+)?$/.test(manifest.version)) {
  throw new Error('A numeric Chrome extension version is required');
}

/** Collect only shipped files, without following symlinks or adding host metadata. */
function shippedFiles(relative) {
  const path = join(root, relative);
  const stat = lstatSync(path);
  if (stat.isSymbolicLink()) throw new Error(`Unexpected symlink: ${relative}`);
  if (!stat.isDirectory()) return [relative];
  return readdirSync(path).sort().filter(name => !name.startsWith('.'))
    .flatMap(name => shippedFiles(`${relative}/${name}`));
}

const files = ['manifest.json', ...['_locales', 'fonts', 'icons', 'src'].flatMap(shippedFiles)];
for (const file of files.filter(file => file.endsWith('.js'))) {
  execFileSync(process.execPath, ['--check', join(root, file)], { stdio: 'pipe' });
}
const temporary = mkdtempSync(join(tmpdir(), 'longshot-store-'));
const output = join(root, 'store', `longshot-${manifest.version}.zip`);
try {
  const archive = join(temporary, 'upload.zip');
  execFileSync('zip', ['-X', '-q', archive, ...files], { cwd: root, stdio: 'pipe' });
  execFileSync('unzip', ['-t', archive], { stdio: 'pipe' });
  mkdirSync(dirname(output), { recursive: true });
  renameSync(archive, output);
  const checksum = createHash('sha256').update(readFileSync(output)).digest('hex');
  writeFileSync(`${output}.sha256`, `${checksum}  longshot-${manifest.version}.zip\n`);
  console.log(`${output}\n${files.length} files, ${statSync(output).size} bytes`);
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
