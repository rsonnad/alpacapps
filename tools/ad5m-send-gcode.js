#!/usr/bin/env node
/**
 * Upload and optionally start a FlashForge Adventurer 5M Pro G-code job.
 *
 * Required env:
 *   AD5M_CHECK_CODE - printer LAN access code
 *
 * Optional env:
 *   AD5M_SERIAL, AD5M_IP, AD5M_PROXY_URL, AD5M_PROXY_SECRET, AD5M_SSH_HOST
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const args = process.argv.slice(2);
const start = args.includes('--start');
const allowAdhesion = args.includes('--allow-adhesion');
const fileArg = args.find((arg) => !arg.startsWith('--'));

if (!fileArg) {
  console.error('Usage: AD5M_CHECK_CODE=... node tools/ad5m-send-gcode.js <file.gcode> [--start] [--allow-adhesion]');
  process.exit(2);
}

const filePath = path.resolve(fileArg);
const filename = path.basename(filePath);
const gcode = fs.readFileSync(filePath, 'utf8');

const config = {
  ip: process.env.AD5M_IP || '192.168.1.123',
  tcpPort: Number(process.env.AD5M_TCP_PORT || 8899),
  httpPort: Number(process.env.AD5M_HTTP_PORT || 8898),
  serialNumber: process.env.AD5M_SERIAL || 'SNMSQE9C09604',
  checkCode: process.env.AD5M_CHECK_CODE,
  proxyUrl: process.env.AD5M_PROXY_URL || 'http://127.0.0.1:8913',
  proxySecret: process.env.AD5M_PROXY_SECRET,
  sshHost: process.env.AD5M_SSH_HOST || 'alpuca@100.74.59.97',
};

if (!config.checkCode) {
  console.error('Missing AD5M_CHECK_CODE.');
  process.exit(2);
}
if (!config.proxySecret) {
  console.error('Missing AD5M_PROXY_SECRET.');
  process.exit(2);
}

function validateGcode() {
  const errors = [];
  if (!gcode.includes('; HEADER_BLOCK_START')) errors.push('missing Orca header block');
  if (!gcode.includes('M190 S')) errors.push('missing bed heat command');
  if (!gcode.includes('M104 S')) errors.push('missing nozzle heat command');
  if (!gcode.includes('G90')) errors.push('missing absolute positioning command');
  if (!gcode.includes('M83')) errors.push('missing relative extrusion command');
  if (!allowAdhesion) {
    if (gcode.includes(';TYPE:Brim')) errors.push('contains brim/boat adhesion; pass --allow-adhesion if requested');
    if (/;\s*brim_type\s*=\s*(?!no_brim\b)\S+/i.test(gcode)) errors.push('brim_type is not no_brim');
    if (/;\s*raft_layers\s*=\s*[1-9]/i.test(gcode)) errors.push('raft layers are enabled');
  }

  const xy = [];
  for (const line of gcode.split(/\r?\n/)) {
    if (!/^G[01]\s/.test(line)) continue;
    const x = line.match(/\bX(-?\d+(?:\.\d+)?)/);
    const y = line.match(/\bY(-?\d+(?:\.\d+)?)/);
    if (x) xy.push(Number(x[1]));
    if (y) xy.push(Number(y[1]));
  }
  const min = Math.min(...xy);
  const max = Math.max(...xy);
  if (!Number.isFinite(min) || !Number.isFinite(max)) {
    errors.push('no X/Y motion found');
  } else if (min < -115 || max > 115) {
    errors.push(`X/Y motion outside centered AD5M range: ${min.toFixed(2)}..${max.toFixed(2)}`);
  }

  if (errors.length) {
    console.error(`Refusing to send ${filename}: ${errors.join('; ')}`);
    process.exit(1);
  }
}

function ssh(remoteCommand) {
  return execFileSync('ssh', [
    '-F', '/dev/null',
    '-i', `${process.env.HOME}/.ssh/id_ed25519`,
    '-o', 'IdentitiesOnly=yes',
    '-o', 'IdentityAgent=none',
    '-o', 'PreferredAuthentications=publickey',
    '-o', 'PasswordAuthentication=no',
    '-o', 'StrictHostKeyChecking=accept-new',
    config.sshHost,
    remoteCommand,
  ], { encoding: 'utf8' });
}

function scp(localPath, remotePath) {
  execFileSync('scp', [
    '-F', '/dev/null',
    '-i', `${process.env.HOME}/.ssh/id_ed25519`,
    '-o', 'IdentitiesOnly=yes',
    '-o', 'IdentityAgent=none',
    '-o', 'PreferredAuthentications=publickey',
    '-o', 'PasswordAuthentication=no',
    '-o', 'StrictHostKeyChecking=accept-new',
    localPath,
    `${config.sshHost}:${remotePath}`,
  ], { stdio: 'inherit' });
}

function curlJson(url, payload) {
  const body = JSON.stringify(payload).replace(/'/g, "'\\''");
  return ssh(
    `curl -sS -m 120 -X POST '${url}' ` +
    `-H 'Content-Type: application/json' ` +
    `-H 'Authorization: Bearer ${config.proxySecret}' ` +
    `-d '${body}'`
  );
}

validateGcode();

const remotePath = `/tmp/${filename}`;
scp(filePath, remotePath);

const uploadResult = curlJson(`${config.proxyUrl}/upload-local`, {
  ip: config.ip,
  localPath: remotePath,
  serialNumber: config.serialNumber,
  checkCode: config.checkCode,
});
console.log(uploadResult.trim());

if (!start) {
  console.log(`Uploaded ${filename}; not started. Add --start to print.`);
  process.exit(0);
}

const startBody = JSON.stringify({
  serialNumber: config.serialNumber,
  checkCode: config.checkCode,
  fileName: filename,
  levelingBeforePrint: false,
}).replace(/'/g, "'\\''");

const startResult = ssh(
  `curl -sS -m 30 -X POST http://${config.ip}:${config.httpPort}/printGcode ` +
  `-H 'Content-Type: application/json' -d '${startBody}'`
);
console.log(startResult.trim());
