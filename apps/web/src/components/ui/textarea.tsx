'use client'

import type { ComponentProps } from 'react'

// Патерн Input (src/components/ui/input.tsx), лише тег <textarea>.
// default — з висотою під багаторядковий текст відгуку; outlined — обрис для
// модалок, висоту задає rows
const variantClasses = {
  default: 'w-full min-h-24 rounded-xl bg-raised border border-transparent px-3 py-2 text-ink placeholder:text-faint focus:border-amber-500 focus:outline-none',
  outlined: 'w-full rounded-xl border border-strong bg-bg px-3 py-2 text-ink focus:border-amber-500 focus:outline-none',
}

export function Textarea({
  variant = 'default',
  className,
  ...props
}: ComponentProps<'textarea'> & { variant?: keyof typeof variantClasses }) {
  const classes = variantClasses[variant]
  return <textarea className={className ? `${classes} ${className}` : classes} {...props} />
}
