// Dump the raw asar header so we can see how nested entries are stored.
const fs = require('node:fs');

const file = process.argv[2] || 'release/win-unpacked/resources/app.asar';
const fd = fs.openSync(file, 'r');
const sizeBuf = Buffer.alloc(16);
fs.readSync(fd, sizeBuf, 0, 16, 0);
const headerSize = sizeBuf.readUInt32LE(12);
const headerBuf = Buffer.alloc(headerSize);
fs.readSync(fd, headerBuf, 0, headerSize, 16);
fs.closeSync(fd);

const header = JSON.parse(headerBuf.toString('utf8'));
const electron = header.files?.electron;
console.log('top-level keys:', Object.keys(header.files || {}).join(', '));
console.log('\nelectron entry keys:', Object.keys(electron?.files || {}).join(', '));
console.log('\nelectron/ai:', JSON.stringify(electron?.files?.ai, null, 1)?.slice(0, 700));
console.log('\nelectron/main.cjs:', JSON.stringify(electron?.files?.['main.cjs']));
