import { vi } from 'vitest'

// jsdom has no 2D canvas backend. @scena/react-ruler draws on mount and
// would throw on the null context, so every suite sees an inert ruler;
// the tick maths it is given is covered on its own (rulerTicks.test.ts).
vi.mock('@scena/react-ruler', () => ({ default: () => null }))
