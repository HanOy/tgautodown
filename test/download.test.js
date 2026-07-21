import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

import { sanitizeFileName, fmtSize, saveMedia } from '../src/tg/download.js';

test('sanitizeFileName: replaces Windows-illegal characters', () => {
  assert.equal(sanitizeFileName('a/b\\c:d*e?f"g<h>i|j'), 'a_b_c_d_e_f_g_h_i_j');
});

test('sanitizeFileName: collapses spaces to underscores', () => {
  assert.equal(sanitizeFileName('hello world  foo.txt'), 'hello_world_foo.txt');
});

test('sanitizeFileName: trims whitespace', () => {
  assert.equal(sanitizeFileName('   spaced.mp4  '), 'spaced.mp4');
});

test('sanitizeFileName: caps at 255 chars', () => {
  const long = 'a'.repeat(500) + '.txt';
  const out = sanitizeFileName(long);
  assert.ok(out.length <= 255, `got ${out.length}`);
  assert.ok(out.endsWith('.txt'));
});

test('sanitizeFileName: empty/whitespace becomes "unnamed"', () => {
  assert.equal(sanitizeFileName(''), 'unnamed');
  assert.equal(sanitizeFileName('   '), 'unnamed');
});

test('fmtSize: formats common sizes', () => {
  assert.equal(fmtSize(0), '0 B');
  assert.equal(fmtSize(512), '512.00 B');
  assert.equal(fmtSize(2048), '2.00 KB');
  assert.equal(fmtSize(5 * 1024 * 1024), '5.00 MB');
  assert.equal(fmtSize(2 * 1024 * 1024 * 1024), '2.00 GB');
});

test('saveMedia: skips when file already complete', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tgad-test-'));
  const savePath = path.join(dir, 'already.mp4');
  fs.writeFileSync(savePath, Buffer.alloc(2048, 0xab));

  let called = 0;
  await saveMedia(
    {
      downloadMedia: async () => {
        called++;
        throw new Error('should not be called');
      },
    },
    { id: 1 },
    savePath,
    () => {},
    2048,
  );
  assert.equal(called, 0);
  fs.rmSync(dir, { recursive: true });
});

test('saveMedia: skips when size unknown and file exists', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tgad-test-'));
  const savePath = path.join(dir, 'unknown-size.jpg');
  fs.writeFileSync(savePath, 'whatever');

  let called = 0;
  await saveMedia(
    {
      downloadMedia: async () => { called++; throw new Error('should not be called'); },
    },
    { id: 1 },
    savePath,
    () => {},
    0, // expected size unknown → always trust existing file
  );
  assert.equal(called, 0);
  fs.rmSync(dir, { recursive: true });
});

test('saveMedia: writes fresh download when file does not exist', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tgad-test-'));
  const savePath = path.join(dir, 'fresh.jpg');
  const dlPath = savePath + '.dl';

  const fakeBuffer = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0]);
  await saveMedia(
    {
      downloadMedia: async (_msg, opts) => {
        fs.writeFileSync(opts.outputFile, fakeBuffer);
        // Don't return — mimics real GramJS behavior with outputFile
      },
    },
    { id: 1 },
    savePath,
    (err, saved) => {
      assert.equal(err, null);
      assert.equal(saved, savePath);
    },
    fakeBuffer.length,
  );

  assert.ok(fs.existsSync(savePath), 'final file should exist');
  assert.ok(!fs.existsSync(dlPath), '.dl file should be renamed away');
  assert.deepEqual(fs.readFileSync(savePath), fakeBuffer);
  fs.rmSync(dir, { recursive: true });
});

test('saveMedia: renames .dl when outputFile is set but downloadMedia returns nothing', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tgad-test-'));
  const savePath = path.join(dir, 'video.mp4');
  const dlPath = savePath + '.dl';

  await saveMedia(
    {
      downloadMedia: async (_msg, opts) => {
        fs.writeFileSync(opts.outputFile, Buffer.from([1, 2, 3]));
        return undefined;
      },
    },
    { id: 1 },
    savePath,
    (err) => { assert.equal(err, null); },
    3,
  );

  assert.ok(fs.existsSync(savePath));
  assert.ok(!fs.existsSync(dlPath));
  fs.rmSync(dir, { recursive: true });
});

test('saveMedia: invokes onDone with error when download throws', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tgad-test-'));
  const savePath = path.join(dir, 'fail.jpg');

  await saveMedia(
    {
      downloadMedia: async () => { throw new Error('network down'); },
    },
    { id: 1 },
    savePath,
    (err, saved) => {
      assert.ok(err instanceof Error);
      assert.equal(err.message, 'network down');
      assert.equal(saved, savePath);
    },
    100,
  );
  fs.rmSync(dir, { recursive: true });
});

test('saveMedia: works when download returns a Buffer (no outputFile)', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tgad-test-'));
  const savePath = path.join(dir, 'buf.mp4');
  const buf = Buffer.from('hello world');

  await saveMedia(
    {
      downloadMedia: async () => buf,
    },
    { id: 1 },
    savePath,
    (err) => { assert.equal(err, null); },
    buf.length,
  );
  assert.equal(fs.readFileSync(savePath, 'utf8'), 'hello world');
  fs.rmSync(dir, { recursive: true });
});