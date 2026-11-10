import { createServerFn } from '@tanstack/react-start'
import { requireSupabaseAuth } from '@/integrations/supabase/auth-middleware'
import { isSixDigitMpin, isValidCommissionPercent } from '@/lib/neobank.validation'

function bytesToHex(bytes: Uint8Array) {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
}

function hexToBytes(value: string) {
  const bytes = new Uint8Array(value.length / 2)
  for (let index = 0; index < bytes.length; index += 1) bytes[index] = Number.parseInt(value.slice(index * 2, index * 2 + 2), 16)
  return bytes
}

function bytesToBase64(bytes: Uint8Array) {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}

async function derivePinHash(pin: string, saltHex: string, pepper: string) {
  const material = await crypto.subtle.importKey('raw', new TextEncoder().encode(pin + pepper), 'PBKDF2', false, ['deriveBits'])
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt: hexToBytes(saltHex), iterations: 120_000, hash: 'SHA-256' }, material, 512)
  return bytesToHex(new Uint8Array(bits))
}

async function makeEkoHeaders(developerKey: string, accessKey: string) {
  const timestamp = Date.now().toString()
  const hmacKey = btoa(accessKey)
  const signingKey = await crypto.subtle.importKey('raw', new TextEncoder().encode(hmacKey), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const signature = bytesToBase64(new Uint8Array(await crypto.subtle.sign('HMAC', signingKey, new TextEncoder().encode(timestamp))))
  return {
    developer_key: developerKey,
    'secret-key': signature,
    'secret-key-timestamp': timestamp,
    'content-type': 'application/json',
  }
}

async function callEko(path: string, credentials: { developerKey: string; accessKey: string; initiator: string }, query: Record<string, string> = {}) {
  const url = new URL(`https://staging.eko.in/ekoapi/v3${path}`)
  url.searchParams.set('initiator_id', credentials.initiator)
  for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value)
  const response = await fetch(url, { headers: await makeEkoHeaders(credentials.developerKey, credentials.accessKey) })
  if (!response.ok) throw new Error(`Eko could not complete that request (${response.status}).`)
  const data: unknown = await response.json()
  return data
}

export const getDashboard = createServerFn({ method: 'GET' })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const userId = context.userId
    const [{ data: profile }, { data: wallet }, { data: transactions }, { data: roles }] = await Promise.all([
      context.supabase.from('profiles').select('*').eq('id', userId).maybeSingle(),
      context.supabase.from('wallets').select('balance').eq('user_id', userId).maybeSingle(),
      context.supabase.from('transactions').select('*').eq('user_id', userId).order('created_at', { ascending: false }).limit(20),
      context.supabase.from('user_roles').select('role').eq('user_id', userId),
    ])
    const isAdmin = Boolean(roles?.some((role) => role.role === 'admin'))
    const isApprovedAgent = Boolean(roles?.some((role) => role.role === 'agent'))
    if (isAdmin) {
      const [{ data: users }, { data: recentTransactions }, { data: rates }] = await Promise.all([
        context.supabase.from('profiles').select('*').order('created_at', { ascending: false }).limit(100),
        context.supabase.from('transactions').select('*').order('created_at', { ascending: false }).limit(25),
        context.supabase.from('commission_rates').select('*').order('service'),
      ])
      return { profile, balance: Number(wallet?.balance ?? 0), transactions: transactions ?? [], isAdmin, isApprovedAgent, users: users ?? [], recentTransactions: recentTransactions ?? [], rates: rates ?? [] }
    }
    return { profile, balance: Number(wallet?.balance ?? 0), transactions: transactions ?? [], isAdmin, isApprovedAgent, users: [], recentTransactions: [], rates: [] }
  })

export const verifyMpin = createServerFn({ method: 'POST' })
  .middleware([requireSupabaseAuth])
  .inputValidator((value: { pin: string }) => value)
  .handler(async ({ data, context }) => {
    if (!isSixDigitMpin(data.pin)) throw new Error('Enter your six-digit MPIN.')
    const { supabaseAdmin } = await import('@/integrations/supabase/client.server')
    const { data: pinRow } = await supabaseAdmin.from('mpins').select('hash,failed_attempts,locked_until').eq('user_id', context.userId).maybeSingle()
    if (!pinRow) return { needsSetup: true }
    if (pinRow.locked_until && new Date(pinRow.locked_until).getTime() > Date.now()) throw new Error('Too many tries. Please wait 15 minutes before trying again.')
    const pepper = process.env['NEO_MPIN_PEPPER']
    if (!pepper) throw new Error('MPIN is not available right now.')
    const [salt, saved] = pinRow.hash.split(':')
    if (!salt || !saved) throw new Error('MPIN is not available right now.')
    const computed = await derivePinHash(data.pin, salt, pepper)
    let diff = computed.length ^ saved.length
    for (let index = 0; index < Math.min(computed.length, saved.length); index += 1) diff |= computed.charCodeAt(index) ^ saved.charCodeAt(index)
    const valid = diff === 0
    if (!valid) {
      const { data: attempts } = await supabaseAdmin.rpc('record_mpin_failure', { p_user_id: context.userId })
      const count = Number(attempts ?? 5)
      throw new Error(count >= 5 ? 'Too many tries. Please wait 15 minutes before trying again.' : `Incorrect MPIN. ${5 - count} tries left.`)
    }
    await supabaseAdmin.from('mpins').update({ failed_attempts: 0, locked_until: null }).eq('user_id', context.userId)
    return { needsSetup: false }
  })

export const setMpin = createServerFn({ method: 'POST' })
  .middleware([requireSupabaseAuth])
  .inputValidator((value: { pin: string; confirmPin: string }) => value)
  .handler(async ({ data, context }) => {
    if (!isSixDigitMpin(data.pin) || data.pin !== data.confirmPin) throw new Error('Enter matching six-digit MPINs.')
    const pepper = process.env['NEO_MPIN_PEPPER']
    if (!pepper) throw new Error('MPIN is not available right now.')
    const saltBytes = crypto.getRandomValues(new Uint8Array(16))
    const salt = bytesToHex(saltBytes)
    const hash = `${salt}:${await derivePinHash(data.pin, salt, pepper)}`
    const { supabaseAdmin } = await import('@/integrations/supabase/client.server')
    const { data: saved, error } = await supabaseAdmin.rpc('set_mpin_once', { p_user_id: context.userId, p_hash: hash })
    if (error) throw new Error('Could not save your MPIN. Please try again.')
    if (!saved) throw new Error('Your MPIN is already set. Sign out and enter your current MPIN.')
    return { saved: true }
  })

export const getSignInStatus = createServerFn({ method: 'GET' })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data: profile } = await context.supabase.from('profiles').select('blocked').eq('id', context.userId).maybeSingle()
    if (profile?.blocked) throw new Error('This account is currently paused. Contact support for help.')
    const { supabaseAdmin } = await import('@/integrations/supabase/client.server')
    const { data: mpin } = await supabaseAdmin.from('mpins').select('user_id').eq('user_id', context.userId).maybeSingle()
    return { needsSetup: !mpin }
  })

export const getEkoCatalog = createServerFn({ method: 'GET' })
  .middleware([requireSupabaseAuth])
  .inputValidator((value: { kind: 'categories' | 'banks' }) => value)
  .handler(async ({ data }) => {
    const developerKey = process.env['EKO_DEVELOPER_KEY']
    const accessKey = process.env['EKO_ACCESS_KEY']
    const initiator = process.env['EKO_INITIATOR_ID']
    if (!developerKey || !accessKey || !initiator) throw new Error('Eko is not connected yet.')
    const result = await callEko(data.kind === 'categories' ? '/customer/payment/bbps/categories' : '/tools/reference/banks', { developerKey, accessKey, initiator })
    return JSON.parse(JSON.stringify(result)) as { status?: number; message?: string; param_attributes?: { list_elements?: Array<{ operator_category_id?: number; operator_category_name?: string; operator_id?: string | number; operator_name?: string; bank_id?: string | number; bank_name?: string }> } }
  })

export const getEkoSender = createServerFn({ method: 'GET' })
  .middleware([requireSupabaseAuth])
  .inputValidator((value: { mobile: string }) => value)
  .handler(async ({ data }) => {
    if (!/^\d{10}$/.test(data.mobile)) throw new Error('Enter a valid 10-digit mobile number.')
    const developerKey = process.env['EKO_DEVELOPER_KEY']
    const accessKey = process.env['EKO_ACCESS_KEY']
    const initiator = process.env['EKO_INITIATOR_ID']
    const userCode = process.env['EKO_USER_CODE']
    if (!developerKey || !accessKey || !initiator || !userCode) throw new Error('Eko is not connected yet.')
    const result = await callEko(`/customer/payment/dmt-fino/sender/${encodeURIComponent(data.mobile)}`, { developerKey, accessKey, initiator }, { user_code: userCode })
    return JSON.parse(JSON.stringify(result)) as { status?: number; message?: string; param_attributes?: { list_elements?: Array<{ operator_category_id?: number; operator_category_name?: string; operator_id?: string | number; operator_name?: string; bank_id?: string | number; bank_name?: string }> } }
  })

export const updateAdminUser = createServerFn({ method: 'POST' })
  .middleware([requireSupabaseAuth])
  .inputValidator((value: { userId: string; field: 'kyc_status' | 'blocked'; value: string | boolean }) => value)
  .handler(async ({ data, context }) => {
    if (data.field === 'kyc_status' && !['pending', 'verified', 'rejected'].includes(String(data.value))) throw new Error('Select a valid verification status.')
    if (data.field === 'blocked' && typeof data.value !== 'boolean') throw new Error('Select a valid account status.')
    const { error } = await context.supabase.rpc('admin_update_profile', {
      p_user_id: data.userId,
      p_kyc_status: data.field === 'kyc_status' ? String(data.value) : null,
      p_blocked: data.field === 'blocked' ? Boolean(data.value) : null,
    })
    if (error) throw new Error(error.message.includes('Forbidden') ? 'You do not have permission to update accounts.' : 'Could not update the account.')
    return { updated: true }
  })

export const updateCommission = createServerFn({ method: 'POST' })
  .middleware([requireSupabaseAuth])
  .inputValidator((value: { service: string; percent: number }) => value)
  .handler(async ({ data, context }) => {
    const { data: adminRole } = await context.supabase.from('user_roles').select('user_id').eq('user_id', context.userId).eq('role', 'admin').maybeSingle()
    if (!adminRole) throw new Error('You do not have permission to update commissions.')
    if (!/^[a-z0-9_]{2,64}$/.test(data.service)) throw new Error('Select a valid service.')
    if (!isValidCommissionPercent(data.percent)) throw new Error('Enter a commission from 0 to 100 percent.')
    const { supabaseAdmin } = await import('@/integrations/supabase/client.server')
    const { error } = await supabaseAdmin.from('commission_rates').upsert({ service: data.service, percent: data.percent, updated_at: new Date().toISOString() })
    if (error) throw new Error('Could not update the commission.')
    return { updated: true }
  })

