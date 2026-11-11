import test from 'node:test'
import assert from 'node:assert/strict'
import { comparePhotoCursor, mergePhotoPages } from '../src/lib/mergePhotoPages.js'

test('mergePhotoPages deduplicates by ID and replaces existing photo rows', () => {
  const current = [
    { id: 'existing', timestamp: 2000, is_free: false },
    { id: 'older', timestamp: 1000 },
  ]
  const incoming = [
    { id: 'newer', timestamp: 3000 },
    { id: 'existing', timestamp: 2000, is_free: true },
  ]

  assert.deepEqual(mergePhotoPages(current, incoming), [
    { id: 'newer', timestamp: 3000 },
    { id: 'existing', timestamp: 2000, is_free: true },
    { id: 'older', timestamp: 1000 },
  ])
})

test('mergePhotoPages uses photo ID for deterministic timestamp ties', () => {
  const current = [{ id: 'a', timestamp: 1000 }]
  const incoming = [{ id: 'b', timestamp: 1000 }]

  assert.deepEqual(mergePhotoPages(current, incoming), [
    { id: 'b', timestamp: 1000 },
    { id: 'a', timestamp: 1000 },
  ])
})

test('photo cursors use ascending timestamp and UUID order for before/after pages', () => {
  const cursor = { id: '00000000-0000-0000-0000-000000000002', timestamp: 2000 }
  const older = { id: 'ffffffff-ffff-ffff-ffff-ffffffffffff', timestamp: 1000 }
  const sameTimeOlderId = { id: '00000000-0000-0000-0000-000000000001', timestamp: 2000 }
  const newer = { id: '00000000-0000-0000-0000-000000000001', timestamp: 3000 }
  const sameTimeNewerId = { id: '00000000-0000-0000-0000-000000000003', timestamp: 2000 }

  assert.ok(comparePhotoCursor(older, cursor) < 0)
  assert.ok(comparePhotoCursor(sameTimeOlderId, cursor) < 0)
  assert.ok(comparePhotoCursor(newer, cursor) > 0)
  assert.ok(comparePhotoCursor(sameTimeNewerId, cursor) > 0)
})
