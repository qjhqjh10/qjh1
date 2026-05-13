import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import Button from '@/components/common/Button'
import GlassCard from '@/components/common/GlassCard'
import { MemoryRouter } from 'react-router-dom'

describe('Button', () => {
  it('renders children', () => {
    render(<Button>点击</Button>)
    expect(screen.getByText('点击')).toBeDefined()
  })

  it('renders primary variant by default', () => {
    render(<Button>按钮</Button>)
    const btn = screen.getByText('按钮')
    expect(btn).toBeDefined()
  })

  it('renders secondary variant', () => {
    render(<Button variant="secondary">取消</Button>)
    expect(screen.getByText('取消')).toBeDefined()
  })

  it('renders danger variant', () => {
    render(<Button variant="danger">删除</Button>)
    expect(screen.getByText('删除')).toBeDefined()
  })

  it('renders ghost variant', () => {
    render(<Button variant="ghost">关闭</Button>)
    expect(screen.getByText('关闭')).toBeDefined()
  })

  it('renders disabled state', () => {
    render(<Button disabled>禁用</Button>)
    const btn = screen.getByText('禁用')
    expect((btn.closest('button') as HTMLButtonElement).disabled).toBe(true)
  })
})

describe('GlassCard', () => {
  it('renders children', () => {
    render(
      <MemoryRouter>
        <GlassCard><span>内容</span></GlassCard>
      </MemoryRouter>
    )
    expect(screen.getByText('内容')).toBeDefined()
  })
})
