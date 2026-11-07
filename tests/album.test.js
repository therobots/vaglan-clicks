import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildGalleryAlbumUrl,
  parseAlbumParam,
  validateAlbumId,
} from '../src/lib/album.js';

test('valid album ids are preserved with leading zeros', () => {
  assert.equal(validateAlbumId('042'), '042');
  assert.equal(validateAlbumId('A_9-2'), 'A_9-2');
  assert.throws(() => validateAlbumId('42?'), /invalid album/i);
});

test('buildGalleryAlbumUrl keeps the base path and a single album parameter', () => {
  assert.equal(
    buildGalleryAlbumUrl('https://gallery.example.com/path/', '042'),
    'https://gallery.example.com/path/?album=042',
  );
  assert.equal(
    buildGalleryAlbumUrl('https://gallery.example.com/path?foo=bar', '043'),
    'https://gallery.example.com/path?foo=bar&album=043',
  );
});

test('album params are rejected when missing, duplicated, invalid, or outside the trusted path', () => {
  assert.equal(parseAlbumParam('https://gallery.example.com/?', 'https://gallery.example.com/'), null);
  assert.equal(parseAlbumParam('https://gallery.example.com/?album=042&album=043', 'https://gallery.example.com/'), null);
  assert.equal(parseAlbumParam('https://gallery.example.com/?album=bad id', 'https://gallery.example.com/'), null);
  assert.equal(parseAlbumParam('https://evil.example/?album=042', 'https://gallery.example.com/'), null);
  assert.equal(parseAlbumParam('https://gallery.example.com/other/?album=042', 'https://gallery.example.com/path/'), null);
  assert.equal(parseAlbumParam('https://gallery.example.com/path/?album=042', 'https://gallery.example.com/path/'), '042');
  assert.equal(parseAlbumParam('https://gallery.example.com/path/child/?album=042', 'https://gallery.example.com/path/'), '042');
});
