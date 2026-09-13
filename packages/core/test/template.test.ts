import { expect, test } from 'vitest'
import { toLayout, toSlots, toValues, type TemplateLayout } from '../src/document/template.js'
import type { Slot } from '../src/document/types.js'

const slot = (over: Partial<Slot>): Slot => ({
  id: 'a', page: 0, x: 10, y: 700, width: 200, text: '', fontId: 'sans', size: 14,
  color: { r: 0, g: 0, b: 0 }, align: 'left', lineHeight: 1.2, ...over,
})

test('toSlots orders by `order`, fills text from values, and leaves text empty when there is no value', () => {
  const layout: TemplateLayout = {
    fileId: 'f', updatedAt: 't',
    slots: [
      { ...slot({ id: 'b' }), text: undefined as never, name: 'Date', order: 1 },
      { ...slot({ id: 'a' }), text: undefined as never, name: 'CO#', order: 0 },
    ].map(({ text: _t, ...rest }) => rest),
  }
  const slots = toSlots(layout, { fileId: 'f', updatedAt: 't', values: { a: '001' } })
  expect(slots.map((s) => s.id)).toEqual(['a', 'b'])
  expect(slots[0]!.text).toBe('001')
  expect(slots[1]!.text).toBe('')
  expect('name' in slots[0]!).toBe(false)
})

test('toLayout assigns order from array position and drops text', () => {
  const layout = toLayout('f', [slot({ id: 'x', text: 'sample' }), slot({ id: 'y' })], { x: 'Name', y: 'Other' }, 't')
  expect(layout.slots.map((s) => [s.id, s.name, s.order])).toEqual([['x', 'Name', 0], ['y', 'Other', 1]])
  expect('text' in layout.slots[0]!).toBe(false)
  expect(layout.fileId).toBe('f')
})

test('toLayout falls back to "Slot N" for a slot with no name', () => {
  const layout = toLayout('f', [slot({ id: 'x' })], {}, 't')
  expect(layout.slots[0]!.name).toBe('Slot 1')
})

test('toValues keeps only non-empty text, keyed by slot id', () => {
  const values = toValues('f', [slot({ id: 'x', text: 'hi' }), slot({ id: 'y', text: '' })], 't')
  expect(values.values).toEqual({ x: 'hi' })
})

test('layout -> slots -> layout round-trips', () => {
  const original = toLayout('f', [slot({ id: 'x', x: 1, y: 2 }), slot({ id: 'y', size: 20 })], { x: 'A', y: 'B' }, 't')
  const again = toLayout('f', toSlots(original), { x: 'A', y: 'B' }, 't')
  expect(again).toEqual(original)
})
