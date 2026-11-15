import assert from 'node:assert/strict'
import { test } from 'node:test'
import preview, { isVisiblePreview, previewPath } from '../api/preview.js'

const project = 'https://gallery.supabase.co'
const visible = {
  album_id: '042',
  is_hidden: false,
  watermark_baked: true,
  expires_at: '2099-01-01T00:00:00Z',
}

test('a previously listed preview stops passing access checks when hidden or expired', () => {
  assert.equal(isVisiblePreview(visible, '042'), true)
  assert.equal(isVisiblePreview({ ...visible, is_hidden: true }, '042'), false)
  assert.equal(isVisiblePreview({ ...visible, expires_at: '2000-01-01T00:00:00Z' }, '042'), false)
  assert.equal(isVisiblePreview(visible, 'other'), false)
  assert.equal(isVisiblePreview({ ...visible, watermark_baked: false }, '042'), false)
})

test('preview storage paths cannot point to originals or another project', () => {
  assert.deepEqual(previewPath(`${project}/storage/v1/object/public/public-previews/night/photo.webp`, project), {
    bucket: 'public-previews', path: 'night/photo.webp',
  })
  assert.equal(previewPath(`${project}/storage/v1/object/public/private-originals/photo.jpg`, project), null)
  assert.equal(previewPath('https://other.supabase.co/storage/v1/object/public/public-previews/photo.webp', project), null)
  assert.equal(previewPath(`${project}/storage/v1/object/public/public-previews/../photo.webp`, project), null)
})

test('preview endpoint rejects malformed and unknown requests before storage access', async () => {
  const response = () => ({
    headers: {},
    setHeader(name, value) { this.headers[name] = value },
    end(body) { this.body = body },
  })
  const invalid = response()
  await preview({ method: 'GET', url: '/api/preview?id=bad&album=042&size=thumbnail' }, invalid)
  assert.equal(invalid.statusCode, 400)
  const unknown = response()
  await preview({ method: 'GET', url: '/api/preview?id=00000000-0000-4000-8000-000000000000&album=042&size=original' }, unknown)
  assert.equal(unknown.statusCode, 400)
})
