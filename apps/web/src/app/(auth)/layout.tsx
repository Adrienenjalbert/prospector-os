import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Sign in',
  description: 'Sign in to Prospector OS',
}

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return children
}
