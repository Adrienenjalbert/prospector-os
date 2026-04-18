'use client'

import { useEffect, useId, useRef, useState } from 'react'
import Link from 'next/link'
import { ChevronDown } from 'lucide-react'
import { clsx } from 'clsx'

interface DropdownItem {
  href: string
  label: string
}

interface NavDropdownProps {
  label: string
  items: DropdownItem[]
  isActive: boolean
}

export function NavDropdown({ label, items, isActive }: NavDropdownProps) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  // useId yields a deterministic, unique id per instance — safe across
  // SSR + multiple dropdowns on the same page. Wires the trigger's
  // aria-controls to the menu's id.
  const menuId = useId()

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  // Close on Escape and return focus to the trigger so keyboard users
  // don't get stuck in the menu (WCAG 2.1.2 — no keyboard trap).
  useEffect(() => {
    if (!open) return
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        setOpen(false)
        triggerRef.current?.focus()
      }
    }
    document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  }, [open])

  return (
    <div ref={ref} className="relative">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={clsx(
          'flex items-center gap-1 rounded-md px-3 py-2 text-sm font-medium transition-colors',
          isActive
            ? 'bg-zinc-800 text-zinc-50'
            : 'text-zinc-400 hover:bg-zinc-800/60 hover:text-zinc-200',
        )}
        // Full disclosure triplet: haspopup + expanded + controls so
        // screen readers announce both that this opens a menu and which
        // element it controls. (WCAG 4.1.2.)
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={menuId}
      >
        {label}
        <ChevronDown className={clsx('size-3.5 transition-transform', open && 'rotate-180')} />
      </button>
      {open && (
        <div
          id={menuId}
          role="menu"
          aria-label={label}
          className="absolute left-0 top-full z-50 mt-1 min-w-[160px] rounded-lg border border-zinc-700 bg-zinc-900 py-1 shadow-xl"
        >
          {items.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              role="menuitem"
              onClick={() => setOpen(false)}
              className="block px-3 py-2 text-sm text-zinc-300 transition-colors hover:bg-zinc-800 hover:text-zinc-100"
            >
              {item.label}
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
