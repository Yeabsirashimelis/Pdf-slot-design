import { expect, test } from 'vitest'
import {
  displayedPageSize,
  normalizeRotation,
  toUnrotatedPoint,
  type PageRotation,
} from '../src/geometry/rotation.js'

// An unrotated Letter page: 612 wide, 792 tall in user space.
const page = { width: 612, height: 792 }

test('normalizeRotation folds any multiple of 90 into 0..270', () => {
  expect(normalizeRotation(0)).toBe(0)
  expect(normalizeRotation(90)).toBe(90)
  expect(normalizeRotation(-90)).toBe(270)
  expect(normalizeRotation(450)).toBe(90)
  expect(normalizeRotation(-180)).toBe(180)
  expect(normalizeRotation(360)).toBe(0)
})

test('displayedPageSize swaps the axes for quarter turns only', () => {
  expect(displayedPageSize(page, 0)).toEqual({ width: 612, height: 792 })
  expect(displayedPageSize(page, 180)).toEqual({ width: 612, height: 792 })
  expect(displayedPageSize(page, 90)).toEqual({ width: 792, height: 612 })
  expect(displayedPageSize(page, 270)).toEqual({ width: 792, height: 612 })
})

test('rotation 0 is the identity', () => {
  expect(toUnrotatedPoint({ x: 100, y: 200 }, page, 0)).toEqual({ x: 100, y: 200 })
})

/**
 * /Rotate 90 displays the page turned a quarter turn clockwise. Walking the
 * four corners of the *displayed* page (792 wide, 612 tall, origin
 * bottom-left) back to the unrotated user space:
 *
 *   displayed bottom-left  -> unrotated bottom-right (612, 0)
 *   displayed top-left     -> unrotated bottom-left  (0, 0)
 *   displayed bottom-right -> unrotated top-right    (612, 792)
 *   displayed top-right    -> unrotated top-left     (0, 792)
 */
test('rotation 90 maps the displayed corners onto the unrotated corners', () => {
  expect(toUnrotatedPoint({ x: 0, y: 0 }, page, 90)).toEqual({ x: 612, y: 0 })
  expect(toUnrotatedPoint({ x: 0, y: 612 }, page, 90)).toEqual({ x: 0, y: 0 })
  expect(toUnrotatedPoint({ x: 792, y: 0 }, page, 90)).toEqual({ x: 612, y: 792 })
  expect(toUnrotatedPoint({ x: 792, y: 612 }, page, 90)).toEqual({ x: 0, y: 792 })
})

test('rotation 180 reflects through the page centre', () => {
  expect(toUnrotatedPoint({ x: 0, y: 0 }, page, 180)).toEqual({ x: 612, y: 792 })
  expect(toUnrotatedPoint({ x: 612, y: 792 }, page, 180)).toEqual({ x: 0, y: 0 })
  expect(toUnrotatedPoint({ x: 100, y: 200 }, page, 180)).toEqual({ x: 512, y: 592 })
})

/** /Rotate 270 displays the page turned a quarter turn anticlockwise. */
test('rotation 270 maps the displayed corners onto the unrotated corners', () => {
  expect(toUnrotatedPoint({ x: 0, y: 0 }, page, 270)).toEqual({ x: 0, y: 792 })
  expect(toUnrotatedPoint({ x: 0, y: 612 }, page, 270)).toEqual({ x: 612, y: 792 })
  expect(toUnrotatedPoint({ x: 792, y: 0 }, page, 270)).toEqual({ x: 0, y: 0 })
  expect(toUnrotatedPoint({ x: 792, y: 612 }, page, 270)).toEqual({ x: 612, y: 0 })
})

test('every rotation maps a point inside the displayed page to inside the unrotated page', () => {
  const rotations: PageRotation[] = [0, 90, 180, 270]
  for (const rotation of rotations) {
    const shown = displayedPageSize(page, rotation)
    for (const [fx, fy] of [[0.1, 0.1], [0.9, 0.2], [0.5, 0.5], [0.3, 0.95]] as const) {
      const p = toUnrotatedPoint({ x: fx * shown.width, y: fy * shown.height }, page, rotation)
      expect(p.x).toBeGreaterThanOrEqual(0)
      expect(p.x).toBeLessThanOrEqual(page.width)
      expect(p.y).toBeGreaterThanOrEqual(0)
      expect(p.y).toBeLessThanOrEqual(page.height)
    }
  }
})
