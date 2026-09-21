'use client'

import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent, type PointerEvent } from 'react'
import { TransformComponent, TransformWrapper, type ReactZoomPanPinchRef } from 'react-zoom-pan-pinch'
import { toPdfPoint, type EditorDocument, type Point, type Slot, type Viewport } from '@pdf-slot/core'
import { TooltipProvider } from '@/components/ui/tooltip'
import { PageCanvas } from './canvas/PageCanvas'
import { toStagePoint, type StagePoint } from './canvas/coordinates'
import { Ruler, RULER_THICKNESS } from './canvas/Ruler'
import { useSpaceHeld } from './canvas/useSpaceHeld'
import {
  ZOOM_MAX,
  ZOOM_MIN,
  fitPage,
  stepZoom,
  wheelZoomFactor,
  zoomAtCentre,
  zoomAtPoint,
  type ViewState,
} from './canvas/viewportMath'
import type { EditorStore } from './state/useEditorStore'
import { SlotOverlay, type SlotNaming } from './overlay/SlotOverlay'
import { layoutSlot } from './overlay/slotBox'
import { PageControls } from './toolbar/PageControls'
import { ZoomControls } from './toolbar/ZoomControls'
import type { EditorPipeline } from './useEditorPipeline'
import { useEditorShortcuts } from './useEditorShortcuts'
import { useSlotClipboard, type PasteTarget } from './useSlotClipboard'

/** Clear space around a page fitted to the workspace, in CSS px. */
const FIT_PADDING = 48

/** The slot being named in place: which one, and the editor's callbacks. */
export type NamingState = SlotNaming & { id: string }

/**
 * The workspace: an infinite dark canvas with the page on it, rulers
 * along its top and left edges and the zoom/page pills floating over it.
 *
 * Zoom and pan are react-zoom-pan-pinch's: the stage (the page and its
 * overlays) is laid out once at 1 px per PDF point and CSS-transformed,
 * so a pinch costs a transform and nothing re-lays out. What the library
 * does not do the way Figma does is done here on top of it -- ctrl/⌘ +
 * wheel zooms about the cursor on an exponential curve (viewportMath),
 * plain wheel pans, space + drag pans, the −/+ pills step through
 * presets -- and the current transform is mirrored into React state so
 * the rulers, the badge and the page canvas's resolution follow it.
 */
export function Editor({
  doc,
  store,
  pipeline,
  pageIndex,
  onPageChange,
  locked = false,
  names,
  naming = null,
  onPlaceSlot,
  onDuplicateSlot,
  onRemoveSlot,
  onPasteSlot,
}: {
  doc: EditorDocument
  store: EditorStore
  pipeline: EditorPipeline
  pageIndex: number
  onPageChange(page: number): void
  /** The layout is frozen: slots can be typed into but not moved, resized or added. */
  locked?: boolean
  /** Slot names by id: the placeholder an empty box shows. */
  names: Record<string, string>
  /** The slot being named in place, if any (see SlotOverlay's `naming`). */
  naming?: NamingState | null
  /** A click on empty page: the parent creates the slot (and starts naming it). */
  onPlaceSlot(atPdf: Point, page: number): void
  /** Ctrl/Cmd+D: the parent copies the slot (it owns the names). */
  onDuplicateSlot(id: string): void
  /** Delete/Backspace: the parent removes the slot (it owns the names). */
  onRemoveSlot(id: string): void
  /**
   * Ctrl/Cmd+V and Alt+drag both add a copy of a snapshot at a position;
   * the parent adds it (and names it after `label`, the copied slot's name
   * at the time it was copied) and returns the copy's id.
   */
  onPasteSlot(snapshot: Slot, label: string | undefined, target: PasteTarget): string
}) {
  const page = doc.pages[pageIndex]
  const transformRef = useRef<ReactZoomPanPinchRef | null>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  // The library's transform, mirrored: scale is CSS px per point (the
  // stage is 1 px per point), position is where the page corner sits in
  // the workspace, in CSS px.
  const [view, setView] = useState<ViewState>({ zoom: 1, pan: { x: 0, y: 0 } })
  const spaceHeld = useSpaceHeld()
  const [panning, setPanning] = useState(false)

  const applyView = useCallback((next: ViewState) => {
    transformRef.current?.setTransform(next.pan.x, next.pan.y, next.zoom, 0)
  }, [])

  /** The workspace's size, for fitting and centre-anchored zooms. */
  const workspaceSize = () => {
    const el = rootRef.current
    return { width: el?.clientWidth ?? 0, height: el?.clientHeight ?? 0 }
  }

  const fit = useCallback(() => {
    if (!page) return
    applyView(fitPage(workspaceSize(), page, FIT_PADDING))
  }, [applyView, page])

  // Fit the page once per (document, page): a fresh open and a page turn
  // both start centred and whole. `page` is stable per index, so this is
  // exactly "the page changed".
  const fittedForRef = useRef<string | null>(null)
  useEffect(() => {
    const key = `${doc.id}:${pageIndex}`
    if (fittedForRef.current === key) return
    fittedForRef.current = key
    fit()
  }, [doc.id, pageIndex, fit])

  // Ctrl/⌘ + wheel (a trackpad pinch arrives the same way) zooms about the
  // cursor, exponentially. The library's own wheel zoom is off: its curve
  // is linear in scale, which feels wrong across a 40x range; its
  // trackpad panning still takes every un-modified wheel. A native
  // listener because React's onWheel is passive and could not
  // preventDefault the browser's page zoom.
  useEffect(() => {
    const root = rootRef.current
    if (!root) return
    const onWheel = (event: WheelEvent) => {
      if (!event.ctrlKey && !event.metaKey) return
      event.preventDefault()
      const ref = transformRef.current
      if (!ref) return
      // The ref's `state` is the library's own (live) state object.
      const { scale, positionX, positionY } = ref.state
      const rect = root.getBoundingClientRect()
      const cursor = { x: event.clientX - rect.left, y: event.clientY - rect.top }
      const current = { zoom: scale, pan: { x: positionX, y: positionY } }
      applyView(zoomAtPoint(current, cursor, scale * wheelZoomFactor(event.deltaY, event.deltaMode)))
    }
    root.addEventListener('wheel', onWheel, { passive: false })
    return () => root.removeEventListener('wheel', onWheel)
  }, [applyView])

  const zoomBy = (direction: 1 | -1) => applyView(zoomAtCentre(view, workspaceSize(), stepZoom(view.zoom, direction)))
  const zoomTo = (zoom: number) => applyView(zoomAtCentre(view, workspaceSize(), zoom))

  const handleCanvasClick = (stage: StagePoint) => {
    if (locked || spaceHeld || !page) return
    // Stage px are points already, so the flip to PDF space is at zoom 1.
    onPlaceSlot(toPdfPoint(stage, { zoom: 1, pageHeight: page.height }), pageIndex)
  }

  // A click on the dark canvas outside the page deselects -- unless it is
  // the end of a pan.
  const handleBackdropClick = (event: MouseEvent<HTMLDivElement>) => {
    if (event.target !== event.currentTarget || spaceHeld) return
    store.select(null)
  }

  // The last pointer position over the page, in stage px (points), so a
  // paste can land under the pointer; null once it leaves the page.
  const pointerRef = useRef<StagePoint | null>(null)
  const trackPointer = (event: PointerEvent<HTMLDivElement>) => {
    // The stage's rect is the transformed one; the live zoom maps it back.
    const rect = event.currentTarget.getBoundingClientRect()
    pointerRef.current = toStagePoint(rect, { x: event.clientX, y: event.clientY }, view.zoom)
  }
  const clipboard = useSlotClipboard()
  const pasteCopied = () => {
    if (locked || !page) return
    const held = clipboard.take(pointerRef.current, { zoom: 1, pageHeight: page.height }, pageIndex)
    if (held) onPasteSlot(held.slot, held.label, held.target)
  }
  // Alt+drag: the copy starts exactly over its source, then follows the pointer.
  const cloneInPlace = (slot: Slot): string | null =>
    locked ? null : onPasteSlot(slot, names[slot.id], { page: slot.page, x: slot.x, y: slot.y })

  useEditorShortcuts({
    undo: store.undo,
    redo: store.redo,
    commit: pipeline.commit,
    duplicateSelected: () => {
      if (locked || !store.selectedId) return
      onDuplicateSlot(store.selectedId)
    },
    nudgeSelected: (dx, dy) => {
      if (locked || !store.selectedId) return
      store.nudgeSlot(store.selectedId, dx, dy)
      pipeline.commit()
    },
    copySelected: () => {
      const selected = store.slots.find((slot) => slot.id === store.selectedId)
      if (locked || !selected) return
      clipboard.copy(selected, names[selected.id])
    },
    pasteCopied,
    deleteSelected: () => {
      if (locked || !store.selectedId || naming) return
      onRemoveSlot(store.selectedId)
    },
    deselect: () => store.select(null),
    zoomIn: () => zoomBy(1),
    zoomOut: () => zoomBy(-1),
    zoomFit: fit,
  })

  const pageSlots = useMemo(() => store.slots.filter((slot) => slot.page === pageIndex), [store.slots, pageIndex])
  const selected = pageSlots.find((slot) => slot.id === store.selectedId) ?? null

  // The selected box's extent for the rulers, in points from the page's
  // top-left (y down): the same box SlotOverlay draws.
  const highlight = useMemo(() => {
    if (!selected || !pipeline.fontMetrics || !page) return null
    const { boxHeight } = layoutSlot(selected, pipeline.fontMetrics[selected.fontId], names[selected.id])
    const top = page.height - selected.y
    return {
      x: { from: selected.x, to: selected.x + selected.width },
      y: { from: top, to: top + boxHeight },
    }
  }, [selected, pipeline.fontMetrics, page, names])

  if (!page) return null
  const viewport: Viewport = { zoom: 1, pageHeight: page.height }

  return (
    <TooltipProvider>
      <div
        ref={rootRef}
        data-testid="workspace"
        data-zoom={view.zoom}
        className="relative h-full w-full overflow-hidden bg-canvas"
        style={{ cursor: spaceHeld ? (panning ? 'grabbing' : 'grab') : undefined }}
      >
        <TransformWrapper
          ref={transformRef}
          minScale={ZOOM_MIN}
          maxScale={ZOOM_MAX}
          limitToBounds={false}
          centerOnInit={false}
          disablePadding
          // The curve is ours (see the wheel listener above).
          wheel={{ disabled: true }}
          trackPadPanning={{ disabled: false, velocityDisabled: true }}
          // Left-drag pans only with space held; a plain drag is a slot's.
          panning={{ activationKeys: [' '], velocityDisabled: true, allowRightClickPan: false }}
          pinch={{ step: 5 }}
          doubleClick={{ disabled: true }}
          zoomAnimation={{ disabled: true }}
          autoAlignment={{ disabled: true }}
          velocityAnimation={{ disabled: true }}
          onTransform={(_ref, state) =>
            setView({ zoom: state.scale, pan: { x: state.positionX, y: state.positionY } })
          }
          onPanningStart={() => setPanning(true)}
          onPanningStop={() => setPanning(false)}
        >
          <TransformComponent
            wrapperStyle={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}
            wrapperProps={{ onClick: handleBackdropClick, 'data-testid': 'canvas-backdrop' } as React.HTMLAttributes<HTMLDivElement>}
            contentStyle={{ width: page.width, height: page.height }}
          >
            {/* The stage: the page at 1 px per point; everything in it is scaled together. */}
            <div
              data-testid="page-stage"
              // Nothing on the stage is text to select or a thing to drag
              // natively: a drag across the page would otherwise silently
              // select the overlay's lines, and the next press inside that
              // selection would start the browser's own drag-and-drop of it
              // (a "no drop" cursor, a ghost of the page) instead of our slot
              // drag. The textarea opts back in (SlotOverlay) so typing
              // still selects.
              style={{
                position: 'relative',
                width: page.width,
                height: page.height,
                background: '#fff',
                boxShadow: '0 0 0 1px rgba(0, 0, 0, 0.35), 0 8px 24px rgba(0, 0, 0, 0.35)',
                userSelect: 'none',
              }}
              onDragStart={(event) => event.preventDefault()}
              onPointerMove={trackPointer}
              onPointerLeave={() => {
                pointerRef.current = null
              }}
            >
              {/*
                Once a commit has produced real output bytes, those bytes --
                not doc.source -- are what pdf.js paints: from this point
                on the preview literally is a picture of the file a
                download would save. Before the first commit, the canvas
                still shows the unedited source PDF.
              */}
              <PageCanvas
                bytes={pipeline.bytes ?? doc.source}
                pageIndex={pageIndex}
                screenScale={view.zoom}
                onCanvasClick={handleCanvasClick}
                onRendered={pipeline.handlePainted}
              />
              {/*
                pointerEvents: 'none' on this wrapper (and 'auto' on each
                SlotOverlay) is what lets a click on empty page fall
                through to PageCanvas's own onClick instead of being
                swallowed by an overlay layer that covers the whole page.
              */}
              <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
                {pipeline.fontMetrics &&
                  pageSlots.map((slot) => (
                    <SlotOverlay
                      key={slot.id}
                      slot={slot}
                      name={names[slot.id]}
                      viewport={viewport}
                      screenScale={view.zoom}
                      metrics={pipeline.fontMetrics![slot.fontId]}
                      selected={store.selectedId === slot.id}
                      onSelect={() => store.select(slot.id)}
                      onChange={(patch: Partial<Slot>, targetId = slot.id) => store.updateSlot(targetId, patch)}
                      onCloneStart={() => cloneInPlace(slot)}
                      onCommit={pipeline.handleCommit}
                      textCommitted={pipeline.isSlotCommitted(slot)}
                      locked={locked}
                      naming={naming?.id === slot.id ? naming : null}
                    />
                  ))}
              </div>
              {/*
                While space is held the slots must not see the pointer: a
                drag is a pan. A shield over them takes the events, and
                the library's window mousedown handler (which pans when
                the target is inside its wrapper) sees this shield.
              */}
              {spaceHeld && <div data-testid="pan-shield" style={{ position: 'absolute', inset: 0 }} />}
            </div>
          </TransformComponent>
        </TransformWrapper>

        {/* Rulers over the canvas's edges; the page corner sits at the pan, less the ruler's own start. */}
        <Ruler orientation="horizontal" scale={view.zoom} offset={view.pan.x - RULER_THICKNESS} highlight={highlight?.x} />
        <Ruler orientation="vertical" scale={view.zoom} offset={view.pan.y - RULER_THICKNESS} highlight={highlight?.y} />
        <div
          aria-hidden
          className="absolute top-0 left-0 bg-ruler"
          style={{ width: RULER_THICKNESS, height: RULER_THICKNESS, boxShadow: 'inset -1px -1px 0 var(--border)' }}
        />

        <div className="absolute top-8 right-4 flex items-center gap-2">
          <ZoomControls scale={view.zoom} onZoomIn={() => zoomBy(1)} onZoomOut={() => zoomBy(-1)} onZoomTo={zoomTo} onFit={fit} />
          <PageControls pageIndex={pageIndex} pageCount={doc.pages.length} onPageChange={onPageChange} />
        </div>
      </div>
    </TooltipProvider>
  )
}

