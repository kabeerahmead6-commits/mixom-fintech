import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { supabase } from '@/integrations/supabase/client'
import { Button } from '@/components/ui/button'
import {
  applyInternalDemoCredit, getDashboard, getEkoCatalog, getEkoSender,
  setMpin, signIn, signUp, updateAdminUser, updateCommission, verifyMpin,
} from '@/lib/neobank.functions'
import type { DashboardData } from '@/lib/neobank.types'
import {
  ArrowDownLeft, ArrowLeft, ArrowRight, ArrowUpRight, BadgeCheck, Banknote, Bell,
  BookOpen, BriefcaseBusiness, Check, ChevronDown, ChevronRight, CircleHelp, Clock3,
  CreditCard, Download, Eye, EyeOff, FileClock, Fingerprint, Gauge, HandCoins,
  History, Home, Landmark, LockKeyhole, LogOut, Menu, MoreHorizontal, Phone, Receipt,
  RefreshCw, Search, Settings, Shield, ShieldCheck, Smartphone, Store, User, Users,
  Wallet, X, Zap,
} from 'lucide-react'

export const Route = createFileRoute('/')({
  head: () => ({
    meta: [
      { title: 'NeoBank — your everyday money, made simple' },
      { name: 'description', content: 'A complete digital banking and merchant services platform.' },
      { property: 'og:title', content: 'NeoBank — your everyday money, made simple' },
      { property: 'og:description', content: 'Digital banking, merchant services, and secure payments in one place.' },
      { property: 'og:type', content: 'website' },
      { name: 'twitter:card', content: 'summary' },
    ],
  }),
  component: NeoBankApp,
})

type ActiveTab = 'services' | 'history' | 'help' | 'account'
type Screen = 'home' | 'transfer' | 'bill' | 'recharge' | 'service' | 'settlement' | 'earnings' | 'mpin' | 'profile' | 'admin'
type EkoItem = { operator_category_id?: number; operator_category_name?: string; operator_id?: string | number; operator_name?: string; bank_id?: string | number; bank_name?: string }

type ServiceInfo = { label: string; description: string; category: string; icon: typeof Wallet }
const services: ServiceInfo[] = [
  { label: 'Cash Withdraw', description: 'Aadhaar enabled cash withdrawal', category: 'aeps_withdrawal', icon: HandCoins },
  { label: 'Mini Statement', description: 'View recent bank transactions', category: 'aeps_ministatement', icon: FileClock },
  { label: 'Balance Enquiry', description: 'Check Aadhaar-linked balance', category: 'aeps_balance', icon: Wallet },
  { label: 'UPI Cash Point', description: 'Assisted UPI service', category: 'upi_cash', icon: Smartphone },
  { label: 'Spice ATM', description: 'Assisted cash services', category: 'atm', icon: Landmark },
  { label: 'Money Transfer', description: 'Send money to bank accounts', category: 'dmt', icon: ArrowUpRight },
  { label: 'Loans', description: 'Loan repayment assistance', category: 'loan', icon: HandCoins },
  { label: 'Suraksha Plans', description: 'Explore protection plans', category: 'insurance', icon: ShieldCheck },
  { label: 'Credit Cards', description: 'Credit card bill payment', category: 'bbps_credit_card', icon: CreditCard },
  { label: 'Mobile Prepaid', description: 'Mobile recharge', category: 'mobile_recharge', icon: Smartphone },
  { label: 'Loan Repayment', description: 'Pay loan installments', category: 'bbps_loan_emi', icon: Receipt },
  { label: 'Electricity', description: 'Electricity bill payment', category: 'bbps_electricity', icon: Zap },
  { label: 'DTH', description: 'Television recharge', category: 'dth', icon: Smartphone },
  { label: 'Agent Collection', description: 'Collect payments', category: 'agent_collection', icon: HandCoins },
  { label: 'FASTag', description: 'FASTag recharge', category: 'fastag', icon: RefreshCw },
  { label: 'Mobile Postpaid', description: 'Postpaid mobile bills', category: 'mobile_postpaid', icon: Phone },
]

function NeoBankApp() {
  const navigate = useNavigate()
  const [user, setUser] = useState<{ id: string; email: string } | null>(null)
  const [authReady, setAuthReady] = useState(false)
  const [data, setData] = useState<DashboardData | null>(null)
  const [activeTab, setActiveTab] = useState<ActiveTab>('services')
  const [screen, setScreen] = useState<Screen>('home')
  const [historyFilter, setHistoryFilter] = useState('all')
  const [historySearch, setHistorySearch] = useState('')
  const [showBalance, setShowBalance] = useState(true)
  const [authMode, setAuthMode] = useState<'signin' | 'signup'>('signin')
  const [pinVerified, setPinVerified] = useState(false)
  const [pinNeedsSetup, setPinNeedsSetup] = useState(false)
  const [loading, setLoading] = useState(false)
  const [userError, setUserError] = useState('')
  const [selectedService, setSelectedService] = useState<ServiceInfo | null>(null)
  const [showAllBills, setShowAllBills] = useState(false)
  const [providerValues, setProviderValues] = useState<unknown>(null)
  const [adminList, setAdminList] = useState<'users' | 'transactions' | 'commissions'>('users')
  const [online, setOnline] = useState(true)

  const loadDashboard = useCallback(async () => {
    const { data: dashboard } = await getDashboard()
    setData(dashboard as DashboardData)
    setUserError('')
  }, [])

  useEffect(() => {
    let mounted = true
    supabase.auth.getUser().then(({ data: { user: currentUser } }) => {
      if (!mounted) return
      setUser(currentUser ? { id: currentUser.id, email: currentUser.email ?? '' } : null)
      setAuthReady(true)
    })
    const { data: authListener } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!mounted) return
      setUser(session?.user ? { id: session.user.id, email: session.user.email ?? '' } : null)
      if (!session) {
        setData(null)
        setPinVerified(false)
        setPinNeedsSetup(false)
        navigate({ to: '/', replace: true })
      }
    })
    return () => { mounted = false; authListener.subscription.unsubscribe() }
  }, [navigate])

  useEffect(() => {
    if (!user || !pinVerified) return
    const get = async () => {
      try { await loadDashboard() }
      catch { setUserError('Your account details could not be loaded. Please try again.') }
    }
    void get()
  }, [user, pinVerified, loadDashboard])

  useEffect(() => {
    if (!user || pinVerified) return
    const check = async () => {
      try {
        const result = await verifyMpin({ data: { pin: '000000' } })
        if (result.needsSetup) setPinNeedsSetup(true)
      } catch (error) {
        const message = error instanceof Error ? error.message : ''
        if (message.includes('six-digit MPIN')) setPinNeedsSetup(false)
        else if (message.includes('15 minutes')) setUserError(message)
      }
    }
    void check()
  }, [user, pinVerified])

  const formattedBalance = useMemo(() => new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(data?.balance ?? 0), [data?.balance])
  const filteredTransactions = useMemo(() => {
    const rows = data?.transactions ?? []
    return rows.filter((txn) => {
      const categoryMatch = historyFilter === 'all' || txn.category.includes(historyFilter)
      const searchMatch = `${txn.description} ${txn.category} ${txn.reference}`.toLowerCase().includes(historySearch.toLowerCase())
      return categoryMatch && searchMatch
    })
  }, [data?.transactions, historyFilter, historySearch])

  async function handleSignOut() {
    await supabase.auth.signOut()
    setUser(null)
    setData(null)
    setPinVerified(false)
    setScreen('home')
  }

  async function handleAuth(formData: FormData) {
    setLoading(true); setUserError('')
    const email = String(formData.get('email') ?? '')
    const password = String(formData.get('password') ?? '')
    try {
      if (authMode === 'signup') {
        await signUp({ data: { email, password, name: String(formData.get('name') ?? ''), phone: String(formData.get('phone') ?? ''), accountType: String(formData.get('accountType') ?? 'customer') as 'customer' | 'agent', shopName: String(formData.get('shopName') ?? '') } })
        setUserError('Check your email for a confirmation link before signing in.')
        setAuthMode('signin')
      } else {
        await signIn({ data: { email, password } })
        setUser({ id: 'signed-in', email })
      }
    } catch (error) { setUserError(error instanceof Error ? error.message : 'We could not complete that request.') }
    finally { setLoading(false) }
  }

  async function handlePin(formData: FormData) {
    setLoading(true); setUserError('')
    const pin = String(formData.get('pin') ?? '')
    try {
      if (pinNeedsSetup) {
        const confirmPin = String(formData.get('confirmPin') ?? '')
        await setMpin({ data: { pin, confirmPin } })
        setPinVerified(true)
      } else {
        await verifyMpin({ data: { pin } })
        setPinVerified(true)
      }
    } catch (error) { setUserError(error instanceof Error ? error.message : 'MPIN could not be verified.') }
    finally { setLoading(false) }
  }

  function openService(service: ServiceInfo) {
    setSelectedService(service)
    if (service.category === 'dmt') setScreen('transfer')
    else if (service.category.includes('bbps') || service.category.includes('electricity') || service.category.includes('recharge') || service.category === 'fastag' || service.category === 'dth') setScreen('bill')
    else setScreen('service')
  }

  async function loadEkoCatalog(kind: 'categories' | 'banks') {
    setLoading(true); setProviderValues(null)
    try { setProviderValues(await getEkoCatalog({ data: { kind } })) }
    catch (error) { toast.error(error instanceof Error ? error.message : 'Eko could not be reached.') }
    finally { setLoading(false) }
  }

  async function searchEkoSender(formData: FormData) {
    setLoading(true); setProviderValues(null)
    try { setProviderValues(await getEkoSender({ data: { mobile: String(formData.get('mobile') ?? '') } })) }
    catch (error) { toast.error(error instanceof Error ? error.message : 'Eko could not be reached.') }
    finally { setLoading(false) }
  }

  async function addTestCredit(formData: FormData) {
    const amount = Number(formData.get('amount'))
    setLoading(true)
    try { await applyInternalDemoCredit({ data: { amount } }); toast.success('Development credit recorded as pending — no money moved.'); await loadDashboard() }
    catch (error) { toast.error(error instanceof Error ? error.message : 'Could not record the test credit.') }
    finally { setLoading(false) }
  }

  async function adminChange(userId: string, field: 'kyc_status' | 'blocked', value: string | boolean) {
    try { await updateAdminUser({ data: { userId, field, value } }); await loadDashboard(); toast.success('Account updated.') }
    catch (error) { toast.error(error instanceof Error ? error.message : 'Could not update the account.') }
  }

  async function saveRate(formData: FormData) {
    const service = String(formData.get('service') ?? '')
    const percent = Number(formData.get('percent'))
    try { await updateCommission({ data: { service, percent } }); await loadDashboard(); toast.success('Commission saved.') }
    catch (error) { toast.error(error instanceof Error ? error.message : 'Could not save the commission.') }
  }

  if (!authReady) return <div className="neo-loading"><span className="neo-loader" /><span>Loading NeoBank</span></div>
  if (!user) return <AuthScreen mode={authMode} setMode={setAuthMode} onSubmit={handleAuth} busy={loading} error={userError} />
  if (!pinVerified) return <MpinScreen isSetup={pinNeedsSetup} busy={loading} error={userError} onSubmit={handlePin} email={user.email} onSignOut={handleSignOut} />
  if (!data?.profile) return <div className="neo-loading"><span className="neo-loader" /><span>{userError || 'Loading your account…'}</span><Button variant="outline" onClick={() => void loadDashboard()}>Retry</Button></div>

  const isAgent = data.profile.account_type === 'agent'
  const titleByTab: Record<ActiveTab, string> = { services: 'Services', history: 'History', help: 'Help', account: 'Account' }

  return (
    <div className="neo-app">
      <div className="neo-mobile-status"><span>9:41</span><span className="neo-device"><Smartphone size={13} /> 1 device</span><span className="neo-signal"><span>5G</span><span className="neo-signal-bars"><i /><i /><i /></span><ShieldCheck size={15} /><span>82%</span></span></div>
      <header className="neo-topbar">
        <div><div className="neo-balance-row"><span className="neo-balance-title">{showBalance ? `₹ ${formattedBalance}` : '₹ ••••••'}</span><Button size="icon" variant="ghost" aria-label={showBalance ? 'Hide balance' : 'Show balance'} onClick={() => setShowBalance(!showBalance)}>{showBalance ? <Eye size={20} /> : <EyeOff size={20} />}</Button></div><p>{isAgent ? 'Wallet Balance' : 'Available balance'}</p></div>
        <div className="neo-top-actions"><Button size="icon" variant="ghost" aria-label="Notifications" onClick={() => toast('You’re all caught up.')}><Bell size={21} /></Button><Button size="icon" variant="ghost" aria-label="Settings" onClick={() => setScreen('profile')}><Settings size={21} /></Button><span className="neo-avatar">{data.profile.full_name?.trim()?.[0]?.toUpperCase() || <User size={19} />}</span></div>
      </header>
      <main className="neo-main">
        <div className="neo-desktop-wrap">
          <aside className="neo-desktop-side">
            <div className="neo-brand"><span className="neo-brand-mark"><Wallet size={20} /></span><span>neo<span className="neo-brand-accent">bank</span></span></div>
            <nav className="neo-side-nav" aria-label="Main navigation">
              <button className={activeTab === 'services' ? 'active' : ''} onClick={() => { setActiveTab('services'); setScreen('home') }}><Home size={18} /> Overview</button>
              <button className={activeTab === 'history' ? 'active' : ''} onClick={() => setActiveTab('history')}><History size={18} /> Transactions</button>
              <button onClick={() => { setSelectedService(services[5]); setScreen('transfer') }}><ArrowUpRight size={18} /> Send money</button>
              <button onClick={() => setScreen('bill')}><Receipt size={18} /> Pay a bill</button>
              {data.isAdmin && <button onClick={() => setScreen('admin')}><Gauge size={18} /> Admin console</button>}
              <button onClick={() => setActiveTab('account')}><User size={18} /> My account</button>
              <button onClick={() => setActiveTab('help')}><CircleHelp size={18} /> Support</button>
            </nav>
            <div className="neo-side-user"><span className="neo-avatar">{data.profile.full_name?.trim()?.[0]?.toUpperCase() || <User size={19} />}</span><div><b>{data.profile.full_name || 'Welcome'}</b><small>{data.profile.account_type === 'agent' ? data.profile.shop_name || 'Merchant' : data.profile.email}</small></div><Button variant="ghost" size="icon" aria-label="Sign out" onClick={() => void handleSignOut()}><LogOut size={17} /></Button></div>
          </aside>
          <section className="neo-content">
            {screen === 'admin' && data.isAdmin ? <AdminView data={data} selected={adminList} setSelected={setAdminList} adminChange={adminChange} saveRate={saveRate} onRefresh={() => void loadDashboard()} /> : screen !== 'home' ? <FeatureScreen screen={screen} selectedService={selectedService} data={data} providerValues={providerValues} busy={loading} onBack={() => setScreen('home')} onCatalog={loadEkoCatalog} onSenderSearch={searchEkoSender} onTestCredit={addTestCredit} setProviderValues={setProviderValues} onFreeze={async () => { try { const { error } = await supabase.from('profiles').update({ card_frozen: !data.profile?.card_frozen }).eq('id', user.id); if(error) throw error; await loadDashboard(); toast.success(data.profile?.card_frozen ? 'Card unfrozen.' : 'Card frozen.') } catch { toast.error('Card status could not be updated.') } }} onSignOut={() => void handleSignOut()} /> : activeTab === 'history' ? <HistoryView transactions={filteredTransactions} filter={historyFilter} setFilter={setHistoryFilter} search={historySearch} setSearch={setHistorySearch} /> : activeTab === 'help' ? <HelpView /> : activeTab === 'account' ? <AccountView data={data} onSignOut={() => void handleSignOut()} onFreeze={() => setScreen('profile')} /> : <HomeView data={data} isAgent={isAgent} online={online} setOnline={setOnline} onService={openService} onOpenScreen={setScreen} showAllBills={showAllBills} setShowAllBills={setShowAllBills} />}
          </section>
        </div>
      </main>
      <nav className="neo-bottom-nav" aria-label="App tabs">
        <NavItem active={activeTab === 'services' && screen === 'home'} label={isAgent ? 'Services' : 'Home'} icon={<Home size={23} />} onClick={() => { setActiveTab('services'); setScreen('home') }} />
        <NavItem active={activeTab === 'history'} label="History" icon={<BookOpen size={22} />} onClick={() => { setActiveTab('history'); setScreen('home') }} />
        <NavItem active={activeTab === 'help'} label="Help" icon={<CircleHelp size={23} />} onClick={() => { setActiveTab('help'); setScreen('home') }} />
        <NavItem active={activeTab === 'account'} label="Account" icon={<User size={23} />} onClick={() => { setActiveTab('account'); setScreen('home') }} />
      </nav>
      <div className="neo-bottom-safe" />
    </div>
  )
}

function AuthScreen({ mode, setMode, onSubmit, busy, error }: { mode: 'signin' | 'signup'; setMode: (mode: 'signin' | 'signup') => void; onSubmit: (data: FormData) => void; busy: boolean; error: string }) {
  return <div className="neo-auth-page"><div className="neo-auth-card"><div className="neo-brand"><span className="neo-brand-mark"><Wallet size={22} /></span><span>neo<span className="neo-brand-accent">bank</span></span></div><div className="neo-auth-icon"><ShieldCheck size={26} /></div><p className="neo-kicker">BANKING, MADE SIMPLE</p><h1>{mode === 'signin' ? 'Welcome back' : 'Let’s get started'}</h1><p className="neo-subtitle">{mode === 'signin' ? 'Your money, all in one place.' : 'Open your secure digital account.'}</p>
    <form action={(formData) => onSubmit(formData)} className="neo-form">
      {mode === 'signup' && <><Field label="Your name" name="name" placeholder="Full name" required /><Field label="Mobile number" name="phone" placeholder="10-digit mobile number" inputMode="numeric" required /><label className="neo-field"><span>Account type</span><select name="accountType" defaultValue="customer"><option value="customer">Personal account</option><option value="agent">Merchant / agent</option></select></label><label className="neo-field"><span>Shop name <em>Optional</em></span><input name="shopName" placeholder="Your business name" /></label></>}
      <Field label="Email address" name="email" type="email" placeholder="you@example.com" required />
      <Field label="Password" name="password" type="password" placeholder="At least 8 characters" required minLength={8} />
      {error && <p className="neo-inline-message" role="status">{error}</p>}
      <Button type="submit" size="lg" className="neo-submit" disabled={busy}>{busy ? 'Please wait…' : mode === 'signin' ? 'Continue' : 'Create account'}<ArrowRight size={17} /></Button>
    </form><p className="neo-auth-switch">{mode === 'signin' ? 'New to NeoBank?' : 'Already have an account?'} <button onClick={() => setMode(mode === 'signin' ? 'signup' : 'signin')}>{mode === 'signin' ? 'Create account' : 'Sign in'}</button></p><div className="neo-secure-note"><LockKeyhole size={13} /> Protected with secure sign-in and MPIN</div></div></div>
}

function MpinScreen({ isSetup, busy, error, onSubmit, email, onSignOut }: { isSetup: boolean; busy: boolean; error: string; onSubmit: (data: FormData) => void; email: string; onSignOut: () => void }) {
  return <div className="neo-mpin-page"><div className="neo-mpin-panel"><div className="neo-brand"><span className="neo-brand-mark"><Wallet size={22} /></span><span>neo<span className="neo-brand-accent">bank</span></span></div><div className="neo-mpin-shield"><Fingerprint size={29} /></div><p className="neo-kicker">{isSetup ? 'SECURE YOUR ACCOUNT' : 'SECURE ACCESS'}</p><h1>{isSetup ? 'Set your MPIN' : 'Enter your MPIN'}</h1><p className="neo-subtitle">{isSetup ? 'Create a six-digit PIN to protect every visit.' : `A secure check for ${email}`}</p><form action={(formData) => onSubmit(formData)} className="neo-form"><label className="neo-field"><span>{isSetup ? 'Create 6-digit MPIN' : '6-digit MPIN'}</span><input name="pin" type="password" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" minLength={6} maxLength={6} placeholder="••••••" aria-label="Six-digit MPIN" required /></label>{isSetup && <label className="neo-field"><span>Confirm MPIN</span><input name="confirmPin" type="password" inputMode="numeric" pattern="[0-9]{6}" minLength={6} maxLength={6} placeholder="••••••" aria-label="Confirm six-digit MPIN" required /></label>}{error && <p className="neo-inline-message" role="status">{error}</p>}<Button type="submit" size="lg" disabled={busy} className="neo-submit">{busy ? 'Please wait…' : isSetup ? 'Set secure MPIN' : 'Unlock NeoBank'}<ArrowRight size={17} /></Button></form><p className="neo-mpin-secure"><ShieldCheck size={15} /> Your MPIN is stored securely and never shared.</p><button className="neo-signout-link" onClick={onSignOut}>Sign in to a different account</button></div></div>
}

function Field(props: { label: string; name: string; type?: string; placeholder?: string; required?: boolean; minLength?: number; inputMode?: 'numeric' | 'text' | 'email' | 'tel' | 'url' | 'search' | 'none' | 'decimal' }) {
  return <label className="neo-field"><span>{props.label}</span><input name={props.name} type={props.type ?? 'text'} placeholder={props.placeholder} required={props.required} minLength={props.minLength} inputMode={props.inputMode} /></label>
}

function HomeView({ data, isAgent, online, setOnline, onService, onOpenScreen, showAllBills, setShowAllBills }: { data: DashboardData; isAgent: boolean; online: boolean; setOnline: (online: boolean) => void; onService: (service: ServiceInfo) => void; onOpenScreen: (screen: Screen) => void; showAllBills: boolean; setShowAllBills: (show: boolean) => void }) {
  const mainServices = isAgent ? services.slice(0, 9) : services.slice(5, 9).concat(services.slice(9, 16))
  const bills = services.slice(9, 16)
  return <div className="neo-page-content">
    <div className="neo-greeting-row"><div><p className="neo-kicker">{isAgent ? 'MERCHANT SERVICES' : 'YOUR MONEY, AT A GLANCE'}</p><h1>Good morning, {data.profile?.full_name?.split(' ')[0] || 'there'}</h1><p className="neo-subtitle">{isAgent ? 'Everything your business needs, in one place.' : 'Here’s what’s happening with your account.'}</p></div>{isAgent && <Button variant={online ? 'outline' : 'secondary'} className="neo-status-pill" onClick={() => setOnline(!online)}><span className={`neo-status-dot ${online ? 'online' : 'offline'}`} />{online ? 'Online' : 'Offline'}</Button>}</div>
    <div className={isAgent ? 'neo-blue-card' : 'neo-account-card'}>
      <div className="neo-card-head"><span>{isAgent ? 'AGENT WALLET' : 'NEOBANK ACCOUNT'}</span><span className="neo-card-chip"><ShieldCheck size={14} /> {data.profile?.kyc_status === 'verified' ? 'Verified' : 'Verification pending'}</span></div>
      <div className="neo-card-balance">₹ {data.balance.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</div>
      <div className="neo-card-foot"><div><span>{isAgent ? 'SETTLEMENT WALLET' : 'ACCOUNT NUMBER'}</span><strong>{data.profile?.virtual_account_number || 'Complete account setup'}</strong></div><div><span>IFSC CODE</span><strong>{data.profile?.virtual_ifsc || 'NEOB0000001'}</strong></div></div>
      {!isAgent && <div className="neo-card-quick"><button onClick={() => onOpenScreen('transfer')}><ArrowUpRight size={17} /> Transfer</button><button onClick={() => onOpenScreen('bill')}><Receipt size={16} /> Pay bills</button><button onClick={() => onOpenScreen('profile')}><CreditCard size={17} /> Card</button></div>}
    </div>
    <div className="neo-quick-actions">{(isAgent ? [{label:'Manage Wallet',icon:Wallet,screen:'settlement' as Screen},{label:'Bank Settlement',icon:Landmark,screen:'settlement' as Screen},{label:'Request Funds',icon:HandCoins,screen:'settlement' as Screen},{label:'My Earnings',icon:Banknote,screen:'earnings' as Screen}] : [{label:'Add money',icon:ArrowDownLeft,screen:'settlement' as Screen},{label:'Send money',icon:ArrowUpRight,screen:'transfer' as Screen},{label:'Pay bills',icon:Receipt,screen:'bill' as Screen},{label:'My account',icon:User,screen:'profile' as Screen}]).map((action) => <button key={action.label} onClick={() => onOpenScreen(action.screen)}><span className="neo-quick-icon"><action.icon size={20} /></span><span>{action.label}</span></button>)}</div>
    {isAgent && <button className="neo-kyc-cta" onClick={() => onOpenScreen('profile')}><span className="neo-kyc-icon"><FileClock size={22} /></span><span><strong>{data.profile?.kyc_status === 'verified' ? 'KYC verified' : 'Complete your e-sign'}</strong><small>{data.profile?.kyc_status === 'verified' ? 'Your services are ready' : 'Finish verification to continue services'}</small></span><ChevronRight size={19} /></button>}
    <section className="neo-service-panel"><div className="neo-section-head"><div><p className="neo-kicker">{isAgent ? 'BANKING SERVICES' : 'EXPLORE SERVICES'}</p><h2>{isAgent ? 'Services for your shop' : 'Everything in one place'}</h2></div><button className="neo-text-link" onClick={() => setShowAllBills(!showAllBills)}>View more <ChevronDown size={16} className={showAllBills ? 'neo-rotate' : ''} /></button></div>
      <div className="neo-services-grid">{(showAllBills ? [...mainServices, ...bills.filter((bill) => !mainServices.includes(bill))] : mainServices).map((service) => <ServiceButton key={service.label} service={service} onClick={() => onService(service)} />)}</div>
    </section>
    {isAgent && <button className="neo-promo-strip" onClick={() => onOpenScreen('earnings')}><span className="neo-promo-mark">₹</span><span><strong>Grow your earnings</strong><small>Track your service commissions</small></span><ArrowRight size={18} /></button>}
    <section className="neo-activity-panel"><div className="neo-section-head"><div><p className="neo-kicker">YOUR ACTIVITY</p><h2>Recent transactions</h2></div><button className="neo-text-link" onClick={() => window.dispatchEvent(new Event('open-history'))}>See all <ChevronRight size={16} /></button></div><TransactionList transactions={(data.transactions ?? []).slice(0, 4)} /></section>
    <footer className="neo-footer-note"><ShieldCheck size={14} /> Your account is protected with secure sign-in and device-level safeguards.</footer>
  </div>
}

function ServiceButton({ service, onClick }: { service: ServiceInfo; onClick: () => void }) {
  return <button className="neo-service-button" onClick={onClick}><span className="neo-service-icon"><service.icon size={25} strokeWidth={1.8} /></span><span>{service.label}</span></button>
}
function NavItem({ active, label, icon, onClick }: { active: boolean; label: string; icon: React.ReactNode; onClick: () => void }) { return <button className={`neo-nav-item ${active ? 'active' : ''}`} onClick={onClick}>{icon}<span>{label}</span></button> }

function HistoryView({ transactions, filter, setFilter, search, setSearch }: { transactions: DashboardData['transactions']; filter: string; setFilter: (value: string) => void; search: string; setSearch: (value: string) => void }) {
  const filters = [{ value: 'all', label: 'All' }, { value: 'wallet', label: 'Wallet' }, { value: 'aeps', label: 'AePS' }, { value: 'dmt', label: 'DMT' }, { value: 'bbps', label: 'Bills' }, { value: 'recharge', label: 'Recharge' }]
  const downloadStatement = () => {
    const csv = ['Date,Description,Category,Direction,Amount,Reference', ...transactions.map((txn) => [new Date(txn.created_at).toLocaleString('en-IN'), txn.description, txn.category, txn.direction, txn.amount, txn.reference].map((part) => `"${String(part).replaceAll('"', '""')}"`).join(','))].join('\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a'); anchor.href = url; anchor.download = 'neobank-statement.csv'; anchor.click(); URL.revokeObjectURL(url)
  }
  return <div className="neo-page-content"><div className="neo-page-header"><div><p className="neo-kicker">YOUR ACCOUNT</p><h1>Transaction history</h1><p className="neo-subtitle">Your account activity, all in one place.</p></div><Button variant="outline" onClick={downloadStatement}><Download size={16} /> Statement</Button></div><div className="neo-history-filter-wrap"><div className="neo-history-tabs" role="tablist">{filters.map((item) => <button key={item.value} role="tab" aria-selected={filter === item.value} className={filter === item.value ? 'active' : ''} onClick={() => setFilter(item.value)}>{item.label}</button>)}</div><label className="neo-search-box"><Search size={17} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search transactions" aria-label="Search transactions" /></label></div>{transactions.length ? <div className="neo-transaction-stream"><TransactionList transactions={transactions} showFull /></div> : <EmptyState icon={<History size={24} />} title="No transactions yet" description="Your completed account activity will show up here." />}</div>
}

function TransactionList({ transactions, showFull = false }: { transactions: DashboardData['transactions']; showFull?: boolean }) {
  if (!transactions.length) return <EmptyState icon={<History size={23} />} title="No activity yet" description="Your latest account activity will appear here." />
  return <div className="neo-transaction-list">{transactions.map((txn) => {
    const credit = txn.direction === 'credit'
    const Icon = txn.category.includes('aeps') ? HandCoins : txn.category.includes('dmt') ? ArrowUpRight : txn.category.includes('bbps') || txn.category.includes('bill') ? Receipt : txn.category.includes('recharge') ? Smartphone : txn.category.includes('commission') ? Banknote : Wallet
    return <article className="neo-transaction-row" key={txn.id}><span className={`neo-txn-icon ${credit ? 'credit' : ''}`}><Icon size={18} /></span><div className="neo-txn-detail"><strong>{txn.description || txn.category.replaceAll('_', ' ')}</strong><span>{new Date(txn.created_at).toLocaleString('en-IN', showFull ? { dateStyle: 'medium', timeStyle: 'short' } : { dateStyle: 'medium' })}{showFull && txn.reference ? ` · ${txn.reference}` : ''}</span></div><div className="neo-txn-amount"><strong className={credit ? 'credit' : ''}>{credit ? '+' : '−'} ₹{Number(txn.amount).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</strong><small>{txn.status}</small></div></article>
  })}</div>
}

function FeatureScreen({ screen, selectedService, data, providerValues, busy, onBack, onCatalog, onSenderSearch, onTestCredit, setProviderValues, onFreeze, onSignOut }: { screen: Screen; selectedService: ServiceInfo | null; data: DashboardData; providerValues: unknown; busy: boolean; onBack: () => void; onCatalog: (kind: 'categories' | 'banks') => void; onSenderSearch: (data: FormData) => void; onTestCredit: (data: FormData) => void; setProviderValues: (value: unknown) => void; onFreeze: () => void; onSignOut: () => void }) {
  const titles: Record<string, string> = { transfer: 'Send money', bill: 'Recharges & bills', recharge: 'Mobile recharge', service: selectedService?.label ?? 'Banking service', settlement: 'Wallet & settlement', earnings: 'My earnings', mpin: 'MPIN settings', profile: 'Account settings' }
  const isAgent = data.profile?.account_type === 'agent'
  return <div className="neo-page-content"><div className="neo-page-header"><Button variant="outline" size="icon" aria-label="Back" onClick={onBack}><ArrowLeft size={19} /></Button><div><p className="neo-kicker">{isAgent ? 'MERCHANT SERVICES' : 'NEOBANK'}</p><h1>{titles[screen] ?? 'Account'}</h1></div></div>
    {screen === 'transfer' && <div className="neo-feature-panel"><FeatureIntro icon={<ArrowUpRight size={23} />} title="Domestic money transfer" text="Check Eko sender registration before continuing a bank transfer." /><form action={(formData) => onSenderSearch(formData)} className="neo-form"><Field label="Sender mobile number" name="mobile" placeholder="10-digit mobile number" inputMode="numeric" required /><Button disabled={busy} type="submit" className="neo-submit">{busy ? 'Checking…' : 'Check sender with Eko'}<ArrowRight size={16} /></Button></form><ProviderResponse value={providerValues} /><button className="neo-text-link" onClick={() => void onCatalog('banks')}>View Eko bank directory <ChevronRight size={15} /></button></div>}
    {screen === 'bill' && <div className="neo-feature-panel"><FeatureIntro icon={<Receipt size={23} />} title="Pay a bill or recharge" text="Choose a service, then continue with the provider’s biller details."/><div className="neo-services-grid neo-feature-services">{services.slice(9).map((service) => <ServiceButton key={service.label} service={service} onClick={() => toast(`${service.label} is available once your Eko account is approved for payment transactions.`)} />)}</div><div className="neo-action-row"><Button variant="outline" onClick={() => void onCatalog('categories')} disabled={busy}>{busy ? 'Loading…' : 'Load live bill categories'}</Button></div><ProviderResponse value={providerValues} /></div>}
    {screen === 'service' && <div className="neo-feature-panel"><FeatureIntro icon={selectedService ? <selectedService.icon size={23} /> : <Landmark size={23} />} title={selectedService?.label ?? 'Banking service'} text={selectedService?.description ?? 'Choose a banking service to continue.'}/>{selectedService?.category.startsWith('aeps') ? <><div className="neo-info-callout"><ShieldCheck size={18} /><span>AePS requires an approved Eko agent, Aadhaar consent, and a certified biometric device. No biometric or Aadhaar data is collected on this screen.</span></div><Button onClick={() => toast('AePS transactions are disabled until your Eko production credentials and biometric device are approved.')} className="neo-submit">Check service availability</Button></> : <div className="neo-info-callout"><Clock3 size={18} /><span>This service will appear here after your merchant account is approved and connected.</span></div>}</div>}
    {screen === 'settlement' && <div className="neo-feature-panel"><FeatureIntro icon={<Wallet size={22} />} title="Wallet management" text="View wallet status and account verification."/><div className="neo-wallet-summary"><span>Available wallet balance</span><strong>₹ {Number(data.balance).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</strong></div>{data.profile?.kyc_status !== 'verified' && <div className="neo-info-callout"><Clock3 size={17} />Account verification is required before adding money or settling funds.</div>}<div className="neo-info-callout"><Shield size={17} />Real-money wallet funding is not active yet. No deposit, settlement, or transfer is executed from this screen.</div><form action={(formData) => onTestCredit(formData)} className="neo-form"><Field name="amount" label="Development-only credit amount" type="number" placeholder="100" required /><Button type="submit" variant="outline" disabled={busy}>{busy ? 'Saving…' : 'Record pending test credit'}</Button></form></div>}
    {screen === 'earnings' && <div className="neo-feature-panel"><FeatureIntro icon={<Banknote size={22} />} title="Commission earnings" text="Commission summaries appear here as services complete."/><div className="neo-wallet-summary"><span>Available wallet balance</span><strong>₹ {Number(data.balance).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</strong></div><TransactionList transactions={data.transactions.filter((txn) => txn.category.includes('commission'))} showFull /></div>}
    {screen === 'profile' && <div className="neo-feature-panel"><FeatureIntro icon={<User size={22} />} title="Your account" text="Your verified details and account preferences."/><div className="neo-profile-info"><ProfileLine label="Name" value={data.profile?.full_name || 'Not set'} /><ProfileLine label="Email" value={data.profile?.email || ''} /><ProfileLine label="Account type" value={data.profile?.account_type === 'agent' ? 'Merchant / agent' : 'Personal customer'} /><ProfileLine label="Verification" value={data.profile?.kyc_status ?? 'Pending'} /><ProfileLine label="Virtual account" value={data.profile?.virtual_account_number || 'Not issued'} /><ProfileLine label="IFSC" value={data.profile?.virtual_ifsc || 'NEOB0000001'} /></div><div className="neo-action-row"><Button variant="outline" onClick={onFreeze}><CreditCard size={16} />{data.profile?.card_frozen ? 'Unfreeze card' : 'Freeze card'}</Button><Button variant="outline" onClick={onSignOut}><LogOut size={16} />Sign out</Button></div><div className="neo-info-callout"><ShieldCheck size={17} />Biometric login depends on your device. MPIN protects each new session.</div></div>}
    {screen === 'recharge' && <EmptyState icon={<Smartphone size={24} />} title="Recharge service" description="Connect your approved provider account to complete recharges." />}
    {screen === 'mpin' && <div className="neo-info-callout"><LockKeyhole size={18} />Your MPIN protects this app after email sign-in.</div>}
  </div>
}

function FeatureIntro({ icon, title, text }: { icon: React.ReactNode; title: string; text: string }) { return <div className="neo-feature-intro"><span className="neo-feature-icon">{icon}</span><div><h2>{title}</h2><p>{text}</p></div></div> }
function ProviderResponse({ value }: { value: unknown }) {
  if (!value) return null
  const obj = value as { status?: number; message?: string; param_attributes?: { list_elements?: EkoItem[] } }
  const items = obj.param_attributes?.list_elements ?? []
  return <div className="neo-provider-results"><div className="neo-provider-head"><strong>Eko service response</strong><span className={obj.status === 0 ? 'success' : 'pending'}>{obj.status === 0 ? 'Ready' : 'Review'}</span></div>{obj.message && <p>{obj.message}</p>}{items.length > 0 ? <ul>{items.slice(0, 20).map((item, index) => <li key={`${item.operator_category_id ?? item.operator_id ?? item.bank_id ?? 'row'}-${index}`}>{item.operator_category_name ?? item.operator_name ?? item.bank_name ?? 'Service'}</li>)}</ul> : !obj.message && <p>The service response is ready.</p>}</div>
}
function ProfileLine({ label, value }: { label: string; value: string }) { return <div className="neo-profile-line"><span>{label}</span><strong>{value}</strong></div> }
function EmptyState({ icon, title, description }: { icon: React.ReactNode; title: string; description: string }) { return <div className="neo-empty-state"><span>{icon}</span><strong>{title}</strong><p>{description}</p></div> }

function AccountView({ data, onSignOut, onFreeze }: { data: DashboardData; onSignOut: () => void; onFreeze: () => void }) {
  return <div className="neo-page-content"><div className="neo-page-header"><div><p className="neo-kicker">YOUR PROFILE</p><h1>Account</h1></div><Button variant="outline" size="icon" aria-label="Settings" onClick={onFreeze}><Settings size={18} /></Button></div><div className="neo-account-profile"><span className="neo-avatar neo-avatar-large">{data.profile?.full_name?.trim()?.[0]?.toUpperCase() || <User size={23} />}</span><div><strong>{data.profile?.full_name || 'NeoBank member'}</strong><span>{data.profile?.email}</span></div><BadgeCheck size={19} className={data.profile?.kyc_status === 'verified' ? 'neo-check' : 'neo-muted-icon'} /></div><div className="neo-feature-panel"><div className="neo-profile-info"><ProfileLine label="Account type" value={data.profile?.account_type === 'agent' ? 'Merchant / agent' : 'Personal customer'} /><ProfileLine label="Verification" value={data.profile?.kyc_status ?? 'Pending'} /><ProfileLine label="Account number" value={data.profile?.virtual_account_number || 'Not issued'} /><ProfileLine label="IFSC" value={data.profile?.virtual_ifsc || 'NEOB0000001'} /></div></div><div className="neo-settings-list"><button onClick={onFreeze}><span><CreditCard size={18} />Card controls</span><ChevronRight size={17} /></button><button onClick={() => toast('Your six-digit MPIN is enabled for this account.')}><span><LockKeyhole size={18} />Security & MPIN</span><ChevronRight size={17} /></button><button onClick={() => toast('Your account is up to date.')}><span><CircleHelp size={18} />Help & support</span><ChevronRight size={17} /></button></div><Button variant="outline" className="neo-signout" onClick={onSignOut}><LogOut size={16} />Sign out</Button></div>
}

function HelpView() { return <div className="neo-page-content"><div className="neo-page-header"><div><p className="neo-kicker">WE’RE HERE FOR YOU</p><h1>Help & support</h1><p className="neo-subtitle">How can we make things easier?</p></div></div><div className="neo-help-card"><div className="neo-help-icon"><CircleHelp size={22} /></div><h2>Frequently asked questions</h2><HelpRow title="How is my account protected?" text="Email verification and a separate six-digit MPIN help keep your account secure." /><HelpRow title="How do transfers and bills work?" text="Provider-supported payments become available after account and service approval." /><HelpRow title="Where can I find a receipt?" text="Open History to see completed account activity and download your statement." /></div><div className="neo-info-callout"><ShieldCheck size={18} />Never share your password, MPIN, Aadhaar, or one-time code with anyone.</div></div> }
function HelpRow({ title, text }: { title: string; text: string }) { return <details className="neo-help-row"><summary>{title}<ChevronDown size={16} /></summary><p>{text}</p></details> }

function AdminView({ data, selected, setSelected, adminChange, saveRate, onRefresh }: { data: DashboardData; selected: 'users' | 'transactions' | 'commissions'; setSelected: (value: 'users' | 'transactions' | 'commissions') => void; adminChange: (userId: string, field: 'kyc_status' | 'blocked', value: string | boolean) => void; saveRate: (data: FormData) => void; onRefresh: () => void }) {
  return <div className="neo-page-content"><div className="neo-page-header"><div><p className="neo-kicker">PLATFORM CONTROL</p><h1>Admin console</h1><p className="neo-subtitle">Manage verified users and merchant services.</p></div><Button variant="outline" size="icon" aria-label="Refresh admin dashboard" onClick={onRefresh}><RefreshCw size={17} /></Button></div><div className="neo-admin-metrics"><div><span>Accounts</span><strong>{data.users.length}</strong><small>Loaded accounts</small></div><div><span>Transactions</span><strong>{data.recentTransactions.length}</strong><small>Recent activity</small></div><div><span>Pending KYC</span><strong>{data.users.filter((user) => user.kyc_status === 'pending').length}</strong><small>Review required</small></div></div><div className="neo-admin-tabs">{(['users','transactions','commissions'] as const).map((tab) => <button key={tab} className={selected === tab ? 'active' : ''} onClick={() => setSelected(tab)}>{tab[0].toUpperCase() + tab.slice(1)}</button>)}</div>
  {selected === 'users' && <div className="neo-admin-list">{data.users.map((person) => <div className="neo-admin-user" key={person.id}><div className="neo-admin-user-top"><span className="neo-avatar">{person.full_name?.[0]?.toUpperCase() || <User size={18} />}</span><div><strong>{person.full_name || 'Account holder'}</strong><span>{person.email}</span></div><span className={`neo-status-tag ${person.kyc_status}`}>{person.kyc_status}</span></div><div className="neo-admin-user-actions"><select aria-label={`Update KYC status for ${person.email}`} value={person.kyc_status} onChange={(event) => adminChange(person.id, 'kyc_status', event.target.value)}><option value="pending">KYC pending</option><option value="verified">KYC verified</option><option value="rejected">KYC rejected</option></select><Button variant={person.blocked ? 'secondary' : 'outline'} size="sm" onClick={() => adminChange(person.id, 'blocked', !person.blocked)}>{person.blocked ? 'Unblock' : 'Pause account'}</Button></div></div>)}{!data.users.length && <EmptyState icon={<Users size={24} />} title="No accounts to review" description="New accounts will appear here." />}</div>}
  {selected === 'transactions' && <div className="neo-transaction-stream"><TransactionList transactions={data.recentTransactions.map((txn) => ({ ...txn, direction: 'debit', balance_after: null })) as DashboardData['transactions']} showFull /></div>}
  {selected === 'commissions' && <div className="neo-rates-list">{data.rates.map((rate) => <form action={(formData) => saveRate(formData)} key={rate.service} className="neo-rate-form"><span>{rate.service.replaceAll('_',' ')}</span><input name="percent" type="number" step="0.01" min="0" max="100" defaultValue={rate.percent} aria-label={`${rate.service} commission percentage`} /><input type="hidden" name="service" value={rate.service} /><Button size="sm">Save</Button></form>)}</div>}
  <div className="neo-info-callout"><ShieldCheck size={17} />Admin actions are recorded against the signed-in, verified platform administrator.</div></div>
}

export default NeoBankApp
