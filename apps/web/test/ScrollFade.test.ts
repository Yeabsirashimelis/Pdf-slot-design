import { createElement, useState } from 'react'
import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ScrollFade } from '@/components/scroll-fade'

describe('ScrollFade', () => {
  afterEach(() => cleanup())

  it('subscribes once, however often its parent renders', () => {
    // The effect used to be keyed on `children` -- a new object on every
    // render -- and it set state. Effect, state, render, effect: a loop
    // React only stops by throwing "maximum update depth exceeded",
    // which it did as soon as anything else kept the tree busy.
    const add = vi.spyOn(Element.prototype, 'addEventListener')
    let bump = () => {}
    function Parent() {
      const [n, setN] = useState(0)
      bump = () => setN((v) => v + 1)
      return createElement(ScrollFade, { 'data-testid': 'list' }, createElement('div', null, `row ${n}`))
    }
    render(createElement(Parent))
    // The scroll area brings listeners of its own, so the number at mount
    // is the baseline; what matters is that rendering again adds none.
    const atMount = add.mock.calls.filter(([type]) => type === 'scroll').length

    for (let i = 0; i < 5; i++) act(() => bump())
    const afterRenders = add.mock.calls.filter(([type]) => type === 'scroll').length
    expect(afterRenders - atMount).toBe(0)

    add.mockRestore()
  })

  it('shows the list, and no fade while there is nothing to scroll', () => {
    render(createElement(ScrollFade, { 'data-testid': 'list' }, createElement('div', null, 'one row')))
    expect(screen.getByTestId('list').textContent).toContain('one row')
    // jsdom lays nothing out, so both ends are reached: no fade either side.
    expect(screen.getByTestId('list-fade-top').className).not.toContain('opacity-100')
    expect(screen.getByTestId('list-fade-bottom').className).not.toContain('opacity-100')
  })
})
