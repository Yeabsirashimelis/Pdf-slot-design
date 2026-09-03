import { expect, test } from 'vitest'
import {
  toPdfPoint, toScreenPoint, toPdfLength, toScreenLength,
} from '../src/geometry/transform'

const A4 = { zoom: 1, pageHeight: 842 }

test('origin flips between corners', () => {
  // Top-left of the screen is the top-left of the page: y = pageHeight in PDF.
  expect(toPdfPoint({ x: 0, y: 0 }, A4)).toEqual({ x: 0, y: 842 })
  expect(toScreenPoint({ x: 0, y: 842 }, A4)).toEqual({ x: 0, y: 0 })
})

test('zoom scales position', () => {
  const vp = { zoom: 2, pageHeight: 842 }
  expect(toPdfPoint({ x: 200, y: 0 }, vp)).toEqual({ x: 100, y: 842 })
  expect(toScreenPoint({ x: 100, y: 842 }, vp)).toEqual({ x: 200, y: 0 })
})

test('lengths scale but do not flip', () => {
  const vp = { zoom: 1.5, pageHeight: 842 }
  expect(toScreenLength(10, vp)).toBe(15)
  expect(toPdfLength(15, vp)).toBe(10)
})

test('round-trips for arbitrary points and zooms', () => {
  for (let i = 0; i < 500; i++) {
    const vp = { zoom: 0.1 + Math.random() * 4, pageHeight: 100 + Math.random() * 1500 }
    const p = { x: Math.random() * 2000, y: Math.random() * 2000 }
    const back = toScreenPoint(toPdfPoint(p, vp), vp)
    expect(back.x).toBeCloseTo(p.x, 6)
    expect(back.y).toBeCloseTo(p.y, 6)
  }
})
