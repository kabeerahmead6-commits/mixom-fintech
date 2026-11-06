import { createServerFn } from '@tanstack/react-start'
import { requireSupabaseAuth } from '@/integrations/supabase/auth-middleware'
import { supabaseAdmin } from '@/integrations/supabase/client.server'
import { createHmac, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'

function makeEkoHeaders() {
  const developerKey = process.env['EKO_DEVELOPER_KEY']
  const accessKey = process.env['EKO_ACCESS_KEY']
  if (!developerKey || !accessKey) throw new Error('Eko is not connected yet.')
  const timestamp = Date.now().toString()
  const hmacKey = Buffer.from(accessKey).toString('base64')
  const signature = createHmac('sha256', hmacKey).update(timestamp).digest('base64')
  return {
    developer_key: developerKey,
    'secret-key': signature,
    'secret-key-timestamp': timestamp,
    'content-type': 'application/json',
  }
}

async function callEko(path: string, query: Record<string, string> = {}) {
  const initiator = process.env['EKO_INITIATOR_ID']
  if (!initiator) throw new Error('Eko is not connected yet.')
  const url = new URL(`https://staging.eko.in/ekoapi/v3${path}`)
  url.searchParams.set('initiator_id', initiator)
  for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value)
  const response = await fetch(url, { headers: makeEkoHeaders() })
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
    if (isAdmin) {
      const [{ data: users }, { data: recentTransactions }, { data: rates }] = await Promise.all([
        context.supabase.from('profiles').select('*').order('created_at', { ascending: false }).limit(100),
        context.supabase.from('transactions').select('*').order('created_at', { ascending: false }).limit(25),
        context.supabase.from('commission_rates').select('*').order('service'),
      ])
      return { profile, balance: Number(wallet?.balance ?? 0), transactions: transactions ?? [], isAdmin, users: users ?? [], recentTransactions: recentTransactions ?? [], rates: rates ?? [] }
    }
    return { profile, balance: Number(wallet?.balance ?? 0), transactions: transactions ?? [], isAdmin, users: [], recentTransactions: [], rates: [] }
  })

export const signUp = createServerFn({ method: 'POST' })
  .inputValidator((value: { email: string; password: string; name: string; phone: string; accountType: 'customer' | 'agent'; shopName: string }) => value)
  .handler(async ({ data }) => {
    const password = data.password.trim()
    if (password.length < 8 || password.length > 128) throw new Error('Use a password between 8 and 128 characters.')
    const { supabase } = await import('@/integrations/supabase/client')
    const { error } = await supabase.auth.signUp({
      email: data.email.trim(),
      password,
      options: {
        emailRedirectTo: typeof window === 'undefined' ? undefined : window.location.origin,
        data: { full_name: data.name.trim(), phone: data.phone.trim(), account_type: data.accountType, shop_name: data.shopName.trim() },
      },
    })
    if (error) throw new Error(error.message)
    return { confirmationRequired: true }
  })

export const signIn = createServerFn({ method: 'POST' })
  .inputValidator((value: { email: string; password: string }) => value)
  .handler(async ({ data }) => {
    const { supabase } = await import('@/integrations/supabase/client')
    const { data: authData, error } = await supabase.auth.signInWithPassword({ email: data.email.trim(), password: data.password })
    if (error) throw new Error(error.message)
    if (!authData.user) throw new Error('Sign in could not be completed.')
    const { data: profile } = await supabase.from('profiles').select('blocked').eq('id', authData.user.id).maybeSingle()
    if (profile?.blocked) {
      await supabase.auth.signOut()
      throw new Error('This account is currently paused. Contact support for help.')
    }
    return { userId: authData.user.id }
  })

export const verifyMpin = createServerFn({ method: 'POST' })
  .middleware([requireSupabaseAuth])
  .inputValidator((value: { pin: string }) => value)
  .handler(async ({ data, context }) => {
    if (!/^\d{6}$/.test(data.pin)) throw new Error('Enter your six-digit MPIN.')
    const { data: pinRow } = await supabaseAdmin.from('mpins').select('hash,failed_attempts,locked_until').eq('user_id', context.userId).maybeSingle()
    if (!pinRow) return { needsSetup: true }
    if (pinRow.locked_until && new Date(pinRow.locked_until).getTime() > Date.now()) throw new Error('Too many tries. Please wait 15 minutes before trying again.')
    const pepper = process.env['NEO_MPIN_PEPPER']
    if (!pepper) throw new Error('MPIN is not available right now.')
    const [salt, saved] = pinRow.hash.split(':')
    if (!salt || !saved) throw new Error('MPIN is not available right now.')
    const computed = scryptSync(data.pin + pepper, salt, 64)
    const savedBytes = Buffer.from(saved, 'hex')
    const valid = savedBytes.length === computed.length && timingSafeEqual(savedBytes, computed)
    if (!valid) {
      const attempts = Number(pinRow.failed_attempts ?? 0) + 1
      await supabaseAdmin.from('mpins').update({ failed_attempts: attempts >= 5 ? 0 : attempts, locked_until: attempts >= 5 ? new Date(Date.now() + 15 * 60 * 1000).toISOString() : null }).eq('user_id', context.userId)
      throw new Error(attempts >= 5 ? 'Too many tries. Please wait 15 minutes before trying again.' : `Incorrect MPIN. ${5 - attempts} tries left.`)
    }
    await supabaseAdmin.from('mpins').update({ failed_attempts: 0, locked_until: null }).eq('user_id', context.userId)
    return { needsSetup: false }
  })

export const setMpin = createServerFn({ method: 'POST' })
  .middleware([requireSupabaseAuth])
  .inputValidator((value: { pin: string; confirmPin: string }) => value)
  .handler(async ({ data, context }) => {
    if (!/^\d{6}$/.test(data.pin) || data.pin !== data.confirmPin) throw new Error('Enter matching six-digit MPINs.')
    const pepper = process.env['NEO_MPIN_PEPPER']
    if (!pepper) throw new Error('MPIN is not available right now.')
    const salt = randomBytes(16).toString('hex')
    const hash = scryptSync(data.pin + pepper, salt, 64).toString('hex')
    const { error } = await supabaseAdmin.from('mpins').upsert({ user_id: context.userId, hash, failed_attempts: 0, locked_until: null })
    if (error) throw new Error('Could not save your MPIN. Please try again.')
    return { saved: true }
  })

export const getEkoCatalog = createServerFn({ method: 'GET' })
  .middleware([requireSupabaseAuth])
  .inputValidator((value: { kind: 'categories' | 'banks' }) => value)
  .handler(async ({ data }) => callEko(data.kind === 'categories' ? '/customer/payment/bbps/categories' : '/tools/reference/banks'))

export const getEkoSender = createServerFn({ method: 'GET' })
  .middleware([requireSupabaseAuth])
  .inputValidator((value: { mobile: string }) => value)
  .handler(async ({ data }) => {
    if (!/^\d{10}$/.test(data.mobile)) throw new Error('Enter a valid 10-digit mobile number.')
    const userCode = process.env['EKO_USER_CODE']
    if (!userCode) throw new Error('Eko is not connected yet.')
    return callEko(`/customer/payment/dmt-fino/sender/${encodeURIComponent(data.mobile)}`, { user_code: userCode })
  })

export const updateAdminUser = createServerFn({ method: 'POST' })
  .middleware([requireSupabaseAuth])
  .inputValidator((value: { userId: string; field: 'kyc_status' | 'blocked'; value: string | boolean }) => value)
  .handler(async ({ data, context }) => {
    const { data: adminRole } = await context.supabase.from('user_roles').select('user_id').eq('user_id', context.userId).eq('role', 'admin').maybeSingle()
    if (!adminRole) throw new Error('You do not have permission to update accounts.')
    const update = data.field === 'kyc_status'
      ? { kyc_status: data.value as 'pending' | 'verified' | 'rejected' }
      : { blocked: data.value as boolean }
    const { error } = await supabaseAdmin.from('profiles').update(update).eq('id', data.userId)
    if (error) throw new Error('Could not update the account.')
    return { updated: true }
  })

export const updateCommission = createServerFn({ method: 'POST' })
  .middleware([requireSupabaseAuth])
  .inputValidator((value: { service: string; percent: number }) => value)
  .handler(async ({ data, context }) => {
    const { data: adminRole } = await context.supabase.from('user_roles').select('user_id').eq('user_id', context.userId).eq('role', 'admin').maybeSingle()
    if (!adminRole) throw new Error('You do not have permission to update commissions.')
    if (!Number.isFinite(data.percent) || data.percent < 0 || data.percent > 100) throw new Error('Enter a commission from 0 to 100 percent.')
    const { error } = await supabaseAdmin.from('commission_rates').upsert({ service: data.service, percent: data.percent, updated_at: new Date().toISOString() })
    if (error) throw new Error('Could not update the commission.')
    return { updated: true }
  })

export const applyInternalDemoCredit = createServerFn({ method: 'POST' })
  .middleware([requireSupabaseAuth])
  .inputValidator((value: { amount: number }) => value)
  .handler(async ({ data, context }) => {
    if (!Number.isFinite(data.amount) || data.amount <= 0 || data.amount > 10000) throw new Error('Enter an amount up to ₹10,000.')
    const { data: profile } = await context.supabase.from('profiles').select('kyc_status,blocked').eq('id', context.userId).maybeSingle()
    if (profile?.blocked || profile?.kyc_status !== 'verified') throw new Error('Complete account verification before adding money.')
    const { error } = await supabaseAdmin.rpc('apply_wallet_txn', {
      p_user_id: context.userId, p_direction: 'credit', p_category: 'wallet_topup', p_amount: data.amount,
      p_description: 'Development wallet credit — not a bank deposit', p_status: 'pending', p_fee: 0, p_commission: 0,
      p_counterparty: null, p_meta: { source: 'demo', notice: 'not_real_money' },
    })
    if (error) throw new Error('Wallet credit could not be recorded.')
    return { recorded: true }
  })
