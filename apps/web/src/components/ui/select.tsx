'use client'

import type { ComponentProps } from 'react'

// default — заливка на сторінці; outlined — обрис для полів усередині модалок
const variantClasses = {
  default: 'w-full rounded-xl bg-raised border border-transparent px-3 py-2 text-ink placeholder:text-faint focus:border-amber-500 focus:outline-none',
  outlined: 'w-full rounded-xl border border-strong bg-bg px-3 py-2 text-ink focus:border-amber-500 focus:outline-none',
}

export function Select({
  variant = 'default',
  className,
  ...props
}: ComponentProps<'select'> & { variant?: keyof typeof variantClasses }) {
  const classes = variantClasses[variant]
  return <select className={className ? `${classes} ${className}` : classes} {...props} />
}
