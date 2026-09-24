import { expect, test } from 'vitest'
import { toLayout, toSlots, toValues, type TemplateLayout } from '../src/document/template.js'
import type { Slot } from '../src/document/types.js'
import type { TemplateTable } from '../src/document/table.js'

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

const table: TemplateTable = {
  id: 't1', page: 0, x: 40, y: 500,
  columns: [{ key: 'c1', name: 'No.', width: 30 }, { key: 'c2', name: 'Date', width: 60 }],
  rowHeights: [20, 20],
  style: { fontId: 'sans', size: 10, color: { r: 0, g: 0, b: 0 }, align: 'left', lineHeight: 1.2 },
}

test('a table\'s cells come back as ordinary slots, carrying what was typed into them', () => {
  const layout = { fileId: 'f', slots: [], tables: [table], updatedAt: 't' }
  const slots = toSlots(layout, { fileId: 'f', values: { 't1#1:c2': '04/11' }, updatedAt: 't' })
  expect(slots).toHaveLength(4)
  expect(slots.map((s) => s.id)).toEqual(['t1#0:c1', 't1#0:c2', 't1#1:c1', 't1#1:c2'])
  expect(slots[3]!.text).toBe('04/11')
  expect(slots[3]).toMatchObject({ x: 70, y: 480, width: 60 })
})

test('toLayout keeps the table but never writes its cells down as slots', () => {
  const slots = toSlots({ fileId: 'f', slots: [], tables: [table], updatedAt: 't' })
  const layout = toLayout('f', [...slots, slot({ id: 'free' })], { free: 'Signature' }, 't', [table])
  expect(layout.slots.map((s) => s.id)).toEqual(['free'])
  expect(layout.tables).toEqual([table])
})

test('layout -> slots -> layout round-trips with a table in it', () => {
  const original = toLayout('f', toSlots({ fileId: 'f', slots: [], tables: [table], updatedAt: 't' }), {}, 't', [table])
  const again = toLayout('f', toSlots(original), {}, 't', original.tables)
  expect(again).toEqual(original)
})

test('a layout saved before tables existed still opens', () => {
  const slots = toSlots({ fileId: 'f', slots: [{ ...slot({ id: 'x' }), name: 'A', order: 0, text: undefined as never }], updatedAt: 't' } as never)
  expect(slots).toHaveLength(1)
})
