'use client'

import { clsx } from 'clsx'
import type { SortField } from '@/lib/sort-companies'

interface SortOption {
  field: SortField
  label: string
}

interface SortControlProps {
  options: SortOption[]
  active: SortField
  onChange: (field: SortField) => void
}

export function SortControl({ options, active, onChange }: SortControlProps) {
  return (
    <div className="flex items-center gap-1 text-xs">
      <span className="text-zinc-600 mr-1">Sort:</span>
      {options.map((opt) => (
        <button
          key={opt.field}
          onClick={() => onChange(opt.field)}
          className={clsx(
            'rounded-md px-2 py-1 font-medium transition-colors',
            active === opt.field
              ? 'bg-zinc-800 text-zinc-100'
              : 'text-zinc-500 hover:bg-zinc-800/50 hover:text-zinc-300',
          )}
        >
          {opt.label}
        </button>
      ))}
    </div>
  )
}
