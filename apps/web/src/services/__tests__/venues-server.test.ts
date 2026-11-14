import { describe, expect, it, vi, beforeEach } from 'vitest'

const serverFetch = vi.fn()
vi.mock('@/lib/api/server-client', () => ({
  serverFetch: (...a: unknown[]) => serverFetch(...a),
}))

import { getVenueTaxonomy } from '../venues.server'

describe('venues.server — getVenueTaxonomy', () => {
  beforeEach(() => {
    serverFetch.mockReset()
  })

  it('публічні довідники кешуються (revalidate 300), три запити одним блоком', async () => {
    serverFetch.mockImplementation((path: string) => Promise.resolve(path.includes('tags') ? [{ id: 't1' }] : path.includes('types') ? [{ id: 'ty1' }] : [{ id: 'f1' }]))
    const tax = await getVenueTaxonomy()
    expect(tax).toEqual({
      tags: [{ id: 't1' }],
      types: [{ id: 'ty1' }],
      features: [{ id: 'f1' }],
    })
    expect(serverFetch).toHaveBeenCalledTimes(3)
    expect(serverFetch).toHaveBeenCalledWith('/venues/tags', expect.objectContaining({ revalidate: 300 }))
    expect(serverFetch).toHaveBeenCalledWith('/venues/types', expect.objectContaining({ revalidate: 300 }))
    expect(serverFetch).toHaveBeenCalledWith('/venues/features', expect.objectContaining({ revalidate: 300 }))
  })

  it('падіння одного довідника не ламає блок — гілка з порожнім дохідником у фільтрах', async () => {
    serverFetch.mockImplementation((path: string) => (path.includes('types') ? Promise.reject(new Error('boom')) : Promise.resolve([])))
    const tax = await getVenueTaxonomy()
    expect(tax).toEqual({ tags: [], types: [], features: [] })
  })
})
