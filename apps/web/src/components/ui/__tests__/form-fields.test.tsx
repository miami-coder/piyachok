import { createRef } from 'react'
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'

const fields = [
  { name: 'Input', el: (p: object) => <Input aria-label="поле" {...p} />, tag: 'INPUT' },
  { name: 'Select', el: (p: object) => <Select aria-label="поле" {...p} />, tag: 'SELECT' },
  { name: 'Textarea', el: (p: object) => <Textarea aria-label="поле" {...p} />, tag: 'TEXTAREA' },
]

describe.each(fields)('$name', ({ el, tag }) => {
  const field = () => screen.getByLabelText('поле')

  it('default: заливка bg-raised без обрису', () => {
    render(el({}))
    expect(field().tagName).toBe(tag)
    expect(field()).toHaveClass('bg-raised', 'border-transparent')
    expect(field()).not.toHaveClass('border-strong', 'bg-bg')
  })

  it('outlined: обрис border-strong/bg-bg замість заливки', () => {
    render(el({ variant: 'outlined' }))
    expect(field()).toHaveClass('border-strong', 'bg-bg', 'w-full')
    expect(field()).not.toHaveClass('bg-raised', 'border-transparent')
  })

  it('variant не потрапляє в DOM, className додається до класів варіанта', () => {
    render(el({ variant: 'outlined', className: 'mt-1 text-sm' }))
    expect(field()).not.toHaveAttribute('variant')
    expect(field()).toHaveClass('border-strong', 'mt-1', 'text-sm')
  })

  it('...rest: disabled і aria-атрибути доходять до елемента', () => {
    render(el({ variant: 'outlined', disabled: true, 'aria-invalid': true, 'aria-describedby': 'err' }))
    expect(field()).toBeDisabled()
    expect(field()).toHaveAttribute('aria-invalid', 'true')
    expect(field()).toHaveAttribute('aria-describedby', 'err')
  })
})

describe('ref', () => {
  it('ref доходить до DOM-елемента (React 19: ref — звичайний проп)', () => {
    const input = createRef<HTMLInputElement>()
    const select = createRef<HTMLSelectElement>()
    const area = createRef<HTMLTextAreaElement>()
    render(
      <>
        <Input ref={input} />
        <Select ref={select} />
        <Textarea ref={area} />
      </>,
    )
    expect(input.current?.tagName).toBe('INPUT')
    expect(select.current?.tagName).toBe('SELECT')
    expect(area.current?.tagName).toBe('TEXTAREA')
  })
})

describe('Textarea', () => {
  it('default тримає min-h-24, outlined — ні (висоту задає rows)', () => {
    const { rerender } = render(<Textarea aria-label="поле" />)
    expect(screen.getByLabelText('поле')).toHaveClass('min-h-24')
    rerender(<Textarea aria-label="поле" variant="outlined" rows={3} />)
    expect(screen.getByLabelText('поле')).not.toHaveClass('min-h-24')
  })
})
