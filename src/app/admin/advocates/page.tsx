import { createAdminClient } from '@/lib/supabase/admin'
import { formatDateHamilton } from '@/lib/utils'

export const dynamic = 'force-dynamic'

type AdvocateRow = {
  id: string
  full_name: string
  phone: string | null
  is_active: boolean
  created_at: string
  charity: { name: string } | null
}

export default async function AdminAdvocatesPage() {
  const admin = createAdminClient()

  const { data: rawAdvocates } = await admin
    .from('advocates')
    .select('*, charity:charities(name)')
    .order('created_at', { ascending: false })

  const advocates = rawAdvocates as AdvocateRow[] | null

  return (
    <div className="space-y-5">
      <h1 className="text-xl font-bold text-hope-dark">Advocates ({advocates?.length ?? 0})</h1>

      <div className="bg-white rounded-2xl shadow-sm overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b border-border">
            <tr>
              <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground">Name</th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground">Charity</th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground">Phone</th>
              <th className="text-center px-4 py-3 text-xs font-semibold text-muted-foreground">Active</th>
              <th className="text-right px-4 py-3 text-xs font-semibold text-muted-foreground">Added</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {advocates?.map(a => {
              const charity = a.charity as { name: string } | null
              return (
                <tr key={a.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 font-medium text-hope-dark">{a.full_name}</td>
                  <td className="px-4 py-3 text-muted-foreground text-xs">{charity?.name || '—'}</td>
                  <td className="px-4 py-3 text-xs">{a.phone || '—'}</td>
                  <td className="px-4 py-3 text-center">
                    {a.is_active
                      ? <span className="text-xs bg-hope-pale text-hope-dark px-2 py-0.5 rounded-full">Active</span>
                      : <span className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full">Inactive</span>}
                  </td>
                  <td className="px-4 py-3 text-right text-xs text-muted-foreground">{formatDateHamilton(a.created_at)}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
