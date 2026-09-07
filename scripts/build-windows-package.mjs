import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { createHash } from 'node:crypto';
import { basename, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = resolve(import.meta.dirname, '..');
const dist = join(root, 'dist');
const packageName = 'ticketplus-assistant-windows-x64';
const stage = join(dist, packageName);
const cache = join(dist, '.cache');
const nodeVersion = process.versions.node;
const nodeArchiveName = `node-v${nodeVersion}-win-x64.zip`;
const nodeArchive = join(cache, nodeArchiveName);
const nodeUrl = `https://nodejs.org/dist/v${nodeVersion}/${nodeArchiveName}`;
const extractedNode = join(cache, `node-v${nodeVersion}-win-x64`);

function run(command, args, cwd = root) {
  const result = spawnSync(command, args, { cwd, stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} exited with ${result.status}`);
}

function quotePowerShell(value) {
  return `'${value.replaceAll("'", "''")}'`;
}

function extractZip(archive, destination) {
  if (process.platform === 'win32') {
    run('powershell.exe', [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      `Expand-Archive -LiteralPath ${quotePowerShell(archive)} -DestinationPath ${quotePowerShell(destination)} -Force`,
    ]);
  } else {
    run('unzip', ['-q', archive, '-d', destination]);
  }
}

function createZip(sourceDirectory, archive) {
  if (process.platform === 'win32') {
    run('powershell.exe', [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      `Compress-Archive -LiteralPath ${quotePowerShell(sourceDirectory)} -DestinationPath ${quotePowerShell(archive)} -Force`,
    ]);
  } else {
    run('zip', ['-qr', basename(archive), basename(sourceDirectory)], resolve(sourceDirectory, '..'));
  }
}

async function download(url, destination) {
  console.log(`Downloading official Node.js runtime: ${url}`);
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Download failed: HTTP ${response.status}`);
  writeFileSync(destination, Buffer.from(await response.arrayBuffer()));
}

mkdirSync(cache, { recursive: true });
if (!existsSync(nodeArchive)) await download(nodeUrl, nodeArchive);

rmSync(extractedNode, { recursive: true, force: true });
extractZip(nodeArchive, cache);
if (!existsSync(join(extractedNode, 'node.exe'))) throw new Error('node.exe was not found after extraction');

rmSync(stage, { recursive: true, force: true });
mkdirSync(join(stage, 'runtime'), { recursive: true });

for (const directory of ['src', 'ui']) {
  cpSync(join(root, directory), join(stage, directory), { recursive: true });
}
mkdirSync(join(stage, 'node_modules'), { recursive: true });
cpSync(
  join(root, 'node_modules', 'playwright-core'),
  join(stage, 'node_modules', 'playwright-core'),
  { recursive: true },
);

for (const file of [
  'package.json',
  'package-lock.json',
  '.env.example',
  'START-WINDOWS.cmd',
  'WINDOWS-README.txt',
]) {
  copyFileSync(join(root, file), join(stage, file));
}
copyFileSync(join(extractedNode, 'node.exe'), join(stage, 'runtime', 'node.exe'));
for (const license of readdirSync(extractedNode).filter((name) => /^LICENSE/i.test(name))) {
  copyFileSync(join(extractedNode, license), join(stage, 'runtime', `NODE-${license}`));
}

const archive = join(dist, `${packageName}.zip`);
rmSync(archive, { force: true });
createZip(stage, archive);

const digest = createHash('sha256').update(readFileSync(archive)).digest('hex');
writeFileSync(`${archive}.sha256`, `${digest}  ${basename(archive)}\n`);

console.log(`\nWindows portable package created:\n${archive}\nSHA-256: ${digest}`);
