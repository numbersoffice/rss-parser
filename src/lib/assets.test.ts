import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { after, test } from 'node:test'

// config resolves DATA_DIR at import time, so this has to be set before the
// modules under test are pulled in.
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rss-assets-'))
process.env.DATA_DIR = root
process.env.PUBLIC_BASE_URL = 'http://localhost:3000'

const { assetsDir } = await import('../config.js')
const {
  assetUsage,
  galleryAssetNames,
  parseGallery,
  postAssetName,
  recomputeAssetUsage,
  unlinkAssets,
} = await import('./assets.js')

fs.mkdirSync(assetsDir, { recursive: true })
after(() => fs.rmSync(root, { recursive: true, force: true }))

const write = (name: string, size: number): void =>
  fs.writeFileSync(path.join(assetsDir, name), Buffer.alloc(size))

/**
 * The running total is maintained incrementally rather than measured on read,
 * so these cover the adjustments and the resync that backstops them. Storing an
 * image is covered by the end-to-end harness, since it needs a live download.
 */

test('an empty directory measures as zero', async () => {
  assert.deepEqual(await recomputeAssetUsage(), { files: 0, bytes: 0 })
  assert.deepEqual(assetUsage(), { files: 0, bytes: 0 })
})

test('recompute sums real file sizes', async () => {
  write('a.jpg', 1000)
  write('b.webp', 2000)
  write('c.png', 3000)
  assert.deepEqual(await recomputeAssetUsage(), { files: 3, bytes: 6000 })
})

test('reading the total does not touch the filesystem', async () => {
  // A file appearing without going through this module is deliberately not
  // noticed until the next resync — that is what makes reads free.
  write('external.jpg', 500)
  assert.deepEqual(assetUsage(), { files: 3, bytes: 6000 })
  assert.deepEqual(await recomputeAssetUsage(), { files: 4, bytes: 6500 })
})

test('unlinking decrements by the real size', async () => {
  const removed = await unlinkAssets(['b.webp'])
  assert.equal(removed, 1)
  assert.deepEqual(assetUsage(), { files: 3, bytes: 4500 })
  // And the running total still agrees with the directory.
  assert.deepEqual(await recomputeAssetUsage(), { files: 3, bytes: 4500 })
})

test('unlinking something already gone changes nothing', async () => {
  const before = assetUsage()
  const removed = await unlinkAssets(['not-there.jpg'])
  assert.equal(removed, 0)
  assert.deepEqual(assetUsage(), before)
})

test('unsafe names are refused without touching the total', async () => {
  const before = assetUsage()
  assert.equal(await unlinkAssets(['../../etc/passwd', 'sub/nested.jpg']), 0)
  assert.deepEqual(assetUsage(), before)
  assert.ok(fs.existsSync(path.join(assetsDir, 'a.jpg')), 'unrelated files untouched')
})

test('subdirectories are not counted as files', async () => {
  // Nothing here creates one — names are sanitised so they cannot contain a
  // separator — but data/ is a mounted volume, and counting a directory's own
  // size as image bytes would be wrong.
  fs.mkdirSync(path.join(assetsDir, 'sub'), { recursive: true })
  assert.deepEqual(await recomputeAssetUsage(), { files: 3, bytes: 4500 })
})

test('a failed resync leaves the previous total intact', async () => {
  const before = assetUsage()
  fs.rmSync(assetsDir, { recursive: true, force: true })
  assert.deepEqual(await recomputeAssetUsage(), before, 'kept the last known good value')
  fs.mkdirSync(assetsDir, { recursive: true })
})

test('postAssetName keeps the cover name and indexes gallery children', () => {
  // The cover must be byte-for-byte the historical name so existing files and
  // rows keep resolving; children append their 1-based index.
  assert.equal(postAssetName(3, 'abc'), '3-abc')
  assert.equal(postAssetName(3, 'abc', 0), '3-abc')
  assert.equal(postAssetName(3, 'abc', 1), '3-abc-1')
  assert.equal(postAssetName(3, 'abc', 11), '3-abc-11')
})

test('gallery JSON round-trips to its asset filenames', () => {
  const gallery = [
    { asset: '3-abc-1.jpg', bytes: 10, mime: 'image/jpeg', imageUrl: 'https://cdn/1' },
    { asset: '3-abc-2.webp', bytes: 20, mime: 'image/webp', imageUrl: 'https://cdn/2' },
  ]
  const json = JSON.stringify(gallery)
  assert.deepEqual(parseGallery(json), gallery)
  assert.deepEqual(galleryAssetNames(json), ['3-abc-1.jpg', '3-abc-2.webp'])
})

test('a null or malformed gallery yields no names, never throws', () => {
  assert.deepEqual(galleryAssetNames(null), [])
  assert.deepEqual(galleryAssetNames(undefined), [])
  assert.deepEqual(galleryAssetNames(''), [])
  assert.deepEqual(galleryAssetNames('not json'), [])
  assert.deepEqual(galleryAssetNames('{"not":"an array"}'), [])
  // An array whose entries lack a string `asset` contributes nothing.
  assert.deepEqual(galleryAssetNames('[{"bytes":1},null,42]'), [])
})
