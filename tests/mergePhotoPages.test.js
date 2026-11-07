import test from 'node:test'
import assert from 'node:assert/strict'
import { mergePhotoPages } from '../src/lib/mergePhotoPages.js'

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
