/**
 * ADMIN DESIGN PRIMITIVES
 *
 * The operator portal is a financial console. It is read by one person, at a
 * desk, deciding whether to move real money — so it is dense, quiet, and
 * numeric. That is a different job from the member wallet, which is large,
 * warm, and read by someone standing outside in the cold.
 *
 * Rules this file encodes:
 *   · Money is tabular-nums, always. Columns of figures must align or they
 *     cannot be scanned.
 *   · Status is never carried by colour alone — there is always a word.
 *   · No emoji as iconography. lucide-react, sized to the text.
 *   · Every surface has one job. Cards do not nest.
 */

import * as React from 'react'
import { cn, formatCAD } from '@/lib/utils'
import type { LucideIcon } from 'lucide-react'

// ── Section ────────────────────────────────────────────────────────────────

export function PageHeader({
  title,
  description,
  action,
}: {
  title: string
  description?: string
  action?: React.ReactNode
}) {
  return (
    <div className="flex items-start justify-between gap-4 pb-6 border-b border-slate-200">
      <div className="min-w-0">
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">{title}</h1>
        {description && (
          <p className="mt-1 text-sm text-slate-500 max-w-2xl">{description}</p>
        )}
      </div>
      {action && <div className="flex-none">{action}</div>}
    </div>
  )
}

export function Section({
  title,
  description,
  action,
  children,
  className,
}: {
  title?: string
  description?: string
  action?: React.ReactNode
  children: React.ReactNode
  className?: string
}) {
  return (
    <section className={cn('space-y-3', className)}>
      {(title || action) && (
        <div className="flex items-end justify-between gap-4">
          <div>
            {title && (
              <h2 className="text-sm font-semibold text-slate-900 tracking-tight">{title}</h2>
            )}
            {description && <p className="text-xs text-slate-500 mt-0.5">{description}</p>}
          </div>
          {action}
        </div>
      )}
      {children}
    </section>
  )
}

export function Panel({
  children,
  className,
  tone = 'default',
}: {
  children: React.ReactNode
  className?: string
  tone?: 'default' | 'dark' | 'warning' | 'danger'
}) {
  const tones = {
    default: 'bg-white border-slate-200',
    dark: 'bg-slate-900 border-slate-800 text-white',
    warning: 'bg-amber-50 border-amber-200',
    danger: 'bg-red-50 border-red-200',
  }
  return (
    <div className={cn('rounded-xl border shadow-sm', tones[tone], className)}>{children}</div>
  )
}

// ── Numbers ────────────────────────────────────────────────────────────────

/**
 * A single figure with a label. `tone` carries meaning that the label alone
 * cannot — money leaving vs. money owed — but the label always says it too.
 */
export function Stat({
  label,
  value,
  sub,
  icon: Icon,
  tone = 'neutral',
  href,
}: {
  label: string
  value: string | number
  sub?: string
  icon?: LucideIcon
  tone?: 'neutral' | 'positive' | 'warning' | 'danger'
  href?: string
}) {
  const tones = {
    neutral: 'text-slate-900',
    positive: 'text-emerald-700',
    warning: 'text-amber-700',
    danger: 'text-red-700',
  }
  const body = (
    <>
      <div className="flex items-center gap-2 text-slate-500">
        {Icon && <Icon className="h-3.5 w-3.5" strokeWidth={2} aria-hidden="true" />}
        <span className="text-xs font-medium uppercase tracking-wide">{label}</span>
      </div>
      <div className={cn('mt-2 text-2xl font-semibold tabular-nums tracking-tight', tones[tone])}>
        {value}
      </div>
      {sub && <div className="mt-1 text-xs text-slate-500">{sub}</div>}
    </>
  )
  return (
    <Panel className={cn('p-4', href && 'transition-colors hover:border-slate-300 hover:bg-slate-50')}>
      {href ? <a href={href} className="block focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-900 rounded">{body}</a> : body}
    </Panel>
  )
}

/** Money, right-aligned and tabular so columns line up. */
export function Money({
  cents,
  className,
  signed = false,
}: {
  cents: number | null | undefined
  className?: string
  signed?: boolean
}) {
  const v = Number(cents ?? 0)
  const sign = signed && v > 0 ? '+' : ''
  return (
    <span className={cn('tabular-nums', v < 0 && 'text-red-700', className)}>
      {sign}
      {formatCAD(v)}
    </span>
  )
}

// ── Status ─────────────────────────────────────────────────────────────────

const STATUS_TONES = {
  ok: 'bg-emerald-50 text-emerald-700 ring-emerald-600/20',
  info: 'bg-sky-50 text-sky-700 ring-sky-600/20',
  warn: 'bg-amber-50 text-amber-800 ring-amber-600/20',
  danger: 'bg-red-50 text-red-700 ring-red-600/20',
  muted: 'bg-slate-100 text-slate-600 ring-slate-500/20',
} as const

export function Status({
  children,
  tone = 'muted',
  icon: Icon,
}: {
  children: React.ReactNode
  tone?: keyof typeof STATUS_TONES
  icon?: LucideIcon
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs font-medium ring-1 ring-inset whitespace-nowrap',
        STATUS_TONES[tone]
      )}
    >
      {Icon && <Icon className="h-3 w-3" strokeWidth={2.5} aria-hidden="true" />}
      {children}
    </span>
  )
}

// ── Tables ─────────────────────────────────────────────────────────────────

export function Table({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <Panel className="overflow-hidden">
      <div className="overflow-x-auto">
        <table className={cn('w-full text-sm', className)}>{children}</table>
      </div>
    </Panel>
  )
}

export function THead({ children }: { children: React.ReactNode }) {
  return (
    <thead className="bg-slate-50 border-b border-slate-200">
      <tr>{children}</tr>
    </thead>
  )
}

export function TH({
  children,
  align = 'left',
  className,
}: {
  children?: React.ReactNode
  align?: 'left' | 'right' | 'center'
  className?: string
}) {
  return (
    <th
      scope="col"
      className={cn(
        'px-4 py-2.5 text-xs font-semibold uppercase tracking-wide text-slate-500',
        align === 'right' && 'text-right',
        align === 'center' && 'text-center',
        align === 'left' && 'text-left',
        className
      )}
    >
      {children}
    </th>
  )
}

export function TBody({ children }: { children: React.ReactNode }) {
  return <tbody className="divide-y divide-slate-100">{children}</tbody>
}

export function TR({
  children,
  className,
}: {
  children: React.ReactNode
  className?: string
}) {
  return <tr className={cn('hover:bg-slate-50/75 transition-colors', className)}>{children}</tr>
}

export function TD({
  children,
  align = 'left',
  className,
  mono = false,
}: {
  children?: React.ReactNode
  align?: 'left' | 'right' | 'center'
  className?: string
  mono?: boolean
}) {
  return (
    <td
      className={cn(
        'px-4 py-2.5 text-slate-700',
        align === 'right' && 'text-right',
        align === 'center' && 'text-center',
        mono && 'font-mono text-xs',
        className
      )}
    >
      {children}
    </td>
  )
}

// ── Empty & error states ───────────────────────────────────────────────────

/**
 * An empty table is ambiguous: nothing here yet, or something broken? Say
 * which, and say what would put something here.
 */
export function Empty({
  icon: Icon,
  title,
  description,
  action,
}: {
  icon?: LucideIcon
  title: string
  description?: string
  action?: React.ReactNode
}) {
  return (
    <div className="px-6 py-12 text-center">
      {Icon && (
        <Icon className="mx-auto h-8 w-8 text-slate-300" strokeWidth={1.5} aria-hidden="true" />
      )}
      <p className="mt-3 text-sm font-medium text-slate-900">{title}</p>
      {description && <p className="mt-1 text-sm text-slate-500 max-w-sm mx-auto">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  )
}

/** A dense sparkline-ish bar row. No chart library for one chart. */
export function BarRow({
  label,
  value,
  max,
  formatted,
}: {
  label: string
  value: number
  max: number
  formatted: string
}) {
  const pct = max > 0 ? Math.max(value > 0 ? 2 : 0, (value / max) * 100) : 0
  return (
    <div className="flex items-center gap-3 py-1">
      <div className="w-16 flex-none text-xs text-slate-500">{label}</div>
      <div className="flex-1 h-5 bg-slate-100 rounded-sm overflow-hidden">
        <div
          className="h-full bg-emerald-600/80 rounded-sm transition-all"
          style={{ width: `${pct}%` }}
        />
      </div>
      <div className="w-20 flex-none text-right text-xs tabular-nums text-slate-700">
        {formatted}
      </div>
    </div>
  )
}
