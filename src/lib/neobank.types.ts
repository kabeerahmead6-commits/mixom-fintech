export type DashboardData = {
  profile: {
    id: string
    email: string
    full_name: string
    phone: string | null
    account_type: string
    shop_name: string | null
    kyc_status: string
    blocked: boolean
    virtual_account_number: string | null
    virtual_account_issued: boolean
    virtual_ifsc: string
    card_frozen: boolean
  } | null
  balance: number
  transactions: Array<{
    id: string
    category: string
    amount: number
    direction: string
    status: string
    reference: string
    description: string
    balance_after: number | null
    created_at: string
  }>
  isAdmin: boolean
  isApprovedAgent: boolean
  users: Array<{ id: string; email: string; full_name: string; account_type: string; kyc_status: string; blocked: boolean; created_at: string }>
  recentTransactions: Array<{ id: string; category: string; amount: number; status: string; reference: string; description: string; created_at: string }>
  rates: Array<{ service: string; percent: number }>
}
