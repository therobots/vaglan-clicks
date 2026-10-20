import { readFile } from 'node:fs/promises'
import { createClient } from '@supabase/supabase-js'

const loadLocalEnv = async () => {
  try {
    const source = await readFile('.env.local', 'utf8')
    for (const line of source.split(/\r?\n/)) {
      const match = line.match(/^\s*(VITE_SUPABASE_URL|VITE_SUPABASE_ANON_KEY)\s*=\s*(.*?)\s*$/)
      if (!match || process.env[match[1]]) continue
      process.env[match[1]] = match[2].replace(/^(['"])(.*)\1$/, '$2')
    }
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
  }
}

await loadLocalEnv()

const supabaseUrl = process.env.VITE_SUPABASE_URL
const supabaseAnonKey = process.env.VITE_SUPABASE_ANON_KEY
if (!supabaseUrl || !supabaseAnonKey) {
  console.error('Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY (or add them to .env.local).')
  process.exit(1)
}

const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: { autoRefreshToken: false, persistSession: false },
})
const results = []
const probeId = crypto.randomUUID()
const isAuthorizationFailure = (error) =>
  error?.code === '42501' ||
  [401, 403].includes(Number(error?.status ?? error?.statusCode)) ||
  /permission denied|row-level security|not authorized|insufficient privilege/i.test(
    error?.message || '',
  )
const isMissingSecretColumn = (error) =>
  ['42703', 'PGRST204'].includes(error?.code) &&
  /admin_pin/i.test(error?.message || '')
const errorSummary = (error) =>
  error?.code ? `${error.code}: ${error.message}` : error?.message || 'Unknown error'

const test = async (
  label,
  expected,
  operation,
  successCheck = () => true,
  secureFailureCheck = isAuthorizationFailure,
) => {
  try {
    const result = await operation()
    const error = result?.error
    const ok =
      expected === 'DENY'
        ? Boolean(error && secureFailureCheck(error))
        : !error && successCheck(result)
    results.push({
      label,
      status: ok ? 'PASS' : 'FAIL',
      detail: ok
        ? expected === 'DENY'
          ? 'Access denied as expected'
          : 'Access allowed as expected'
        : error
          ? errorSummary(error)
          : expected === 'DENY'
            ? 'Operation did not return an authorization error'
            : 'Unexpected response',
    })
    return result
  } catch (error) {
    const ok = expected === 'DENY' && secureFailureCheck(error)
    results.push({
      label,
      status: ok ? 'PASS' : 'FAIL',
      detail: ok ? 'Access denied as expected' : errorSummary(error),
    })
    return { error }
  }
}

const photosResult = await test('Read public preview columns', 'ALLOW', () =>
  supabase
    .from('photos')
    .select('id,preview_url,filename,timestamp,is_free,created_at,expires_at')
    .limit(1),
  ({ data }) =>
    (data || []).every((photo) => Date.parse(photo.expires_at) > Date.now()),
)
await test('Read public gallery pricing', 'ALLOW', () =>
  supabase
    .from('gallery_state')
    .select('id,first_photo_cents,extra_photo_cents,tip_options_cents,currency')
    .eq('id', 1)
    .maybeSingle(),
)
const nightsResult = await test('Read public gallery nights', 'ALLOW', () =>
  supabase.rpc('gallery_nights'),
)
await test('Read public gallery server clock', 'ALLOW', () =>
  supabase.rpc('gallery_server_now'),
)
const currentNight = nightsResult?.data?.[0]?.night_key
if (currentNight) {
  const slotsResult = await test('Read public gallery time slots', 'ALLOW', () =>
    supabase.rpc('gallery_slots', { night_key_input: currentNight }),
  )
  const firstSlot = slotsResult?.data?.[0]
  await test('Read public paginated gallery photos', 'ALLOW', () =>
    supabase.rpc('gallery_photos', {
      night_key_input: currentNight,
      slot_start_input: firstSlot?.slot_start || null,
      slot_end_input: firstSlot?.slot_end || null,
      before_timestamp_input: null,
      before_photo_id_input: null,
      limit_input: 10,
    }),
  )
}

const photo = photosResult?.data?.[0]
const photoId = photo?.id || probeId
await test('Update photos as anon (no matching ID)', 'DENY', () =>
  supabase.from('photos').update({ is_free: false }).eq('id', probeId),
)
await test('Delete photos as anon (no matching ID)', 'DENY', () =>
  supabase.from('photos').delete().eq('id', probeId),
)

const insertedId = crypto.randomUUID()
const insertResult = await test('Insert photo row as anon', 'DENY', () =>
  supabase.from('photos').insert({
    id: insertedId,
    preview_url: 'https://audit.invalid/security-probe.jpg',
    filename: `__security_audit_${insertedId}`,
    timestamp: Date.now(),
    is_free: false,
  }),
)
if (!insertResult?.error) {
  const cleanup = await supabase.from('photos').delete().eq('id', insertedId)
  results.push({
    label: 'Cleanup inserted audit row',
    status: cleanup.error ? 'FAIL' : 'PASS',
    detail: cleanup.error
      ? `Remove row ${insertedId} manually: ${errorSummary(cleanup.error)}`
      : 'Temporary test row removed',
  })
}

for (const [label, name, args] of [
  ['Call PIN verifier as anon', 'verify_gallery_admin_pin', { pin_input: 'not-a-real-pin' }],
  ['Read original path as anon', 'get_photo_original_path', { photo_id_input: photoId }],
  ['Validate admin session as anon', 'validate_gallery_admin_session', { hash_input: '0'.repeat(64) }],
  ['Create admin session as anon', 'create_gallery_admin_session', {
    hash_input: '0'.repeat(64),
    expiry_input: new Date().toISOString(),
  }],
]) {
  await test(label, 'DENY', () => supabase.rpc(name, args))
}

for (const [label, name] of [
  ['Call gallery reset as anon', 'reset_gallery_photos'],
]) {
  if (process.env.AUDIT_ALLOW_MUTATING_RPCS === '1') {
    await test(label, 'DENY', () => supabase.rpc(name))
  } else {
    results.push({
      label,
      status: 'SKIP',
      detail: 'Set AUDIT_ALLOW_MUTATING_RPCS=1 only on staging or after explicit approval',
    })
  }
}

await test('Read admin PIN column as anon', 'DENY', () =>
  supabase.from('gallery_state').select('admin_pin').eq('id', 1).maybeSingle(),
  () => true,
  isMissingSecretColumn,
)
await test('List private originals bucket as anon', 'DENY', () =>
  supabase.storage.from('photo-originals').list('', { limit: 1 }),
)
await test('Download private original as anon', 'DENY', () =>
  supabase.storage.from('photo-originals').download('security-audit/nonexistent.jpg'),
)
const uploadPath = `.security-audit/${probeId}.txt`
const uploadResult = await test('Upload to public previews bucket as anon', 'DENY', () =>
  supabase.storage.from('photos').upload(uploadPath, 'audit'),
)
if (!uploadResult?.error) {
  const cleanup = await supabase.storage.from('photos').remove([uploadPath])
  results.push({
    label: 'Cleanup uploaded audit object',
    status: cleanup.error ? 'FAIL' : 'PASS',
    detail: cleanup.error
      ? `Remove ${uploadPath} manually: ${errorSummary(cleanup.error)}`
      : 'Temporary test object removed',
  })
}
await test('Delete from public previews bucket as anon (no matching path)', 'DENY', () =>
  supabase.storage.from('photos').remove([`.security-audit/${probeId}.txt`]),
)

if (photo?.is_free) {
  await test('Request authorized free-photo download', 'ALLOW', () =>
    supabase.functions.invoke('gallery-admin', {
      body: { action: 'download-free', photoId: photo.id },
    }),
    (result) => Boolean(result?.data?.url),
  )
} else {
  results.push({
    label: 'Request authorized free-photo download',
    status: 'SKIP',
    detail: 'No free photo is available for this anon-key check',
  })
}

const labelWidth = Math.max(...results.map(({ label }) => label.length))
console.log(`\n${'Test'.padEnd(labelWidth)}  Result  Details`)
console.log(`${'-'.repeat(labelWidth)}  ------  -------`)
for (const result of results) {
  console.log(
    `${result.label.padEnd(labelWidth)}  ${result.status.padEnd(6)}  ${result.detail}`,
  )
}

if (results.some(({ status }) => status === 'FAIL')) process.exitCode = 1
