'use client'

import { useState } from 'react'
import type { EditorDocument } from '@pdf-slot/core'
import { Button } from '@/components/ui/button'
import { Dropzone } from '@/features/upload/Dropzone'
import { Editor } from '@/features/editor/Editor'

export default function Home() {
  const [doc, setDoc] = useState<EditorDocument | null>(null)
  const [zoom, setZoom] = useState(1)

  return (
    <main className="mx-auto flex min-h-dvh max-w-4xl flex-col justify-center px-6 py-10">
      <h1 className="text-2xl font-medium tracking-tight">PDF Slot Editor</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Upload a PDF or a document image, place text anywhere, and download it.
      </p>
      <div className="mt-6">
        {doc ? (
          <div className="flex flex-col items-start gap-3">
            {/*
              Minimal zoom control -- not the Task 17 toolbar (no font,
              color, or align controls) -- kept here only because Task 15's
              own invariant ("positions must survive a zoom change") has no
              other way to be exercised in the browser yet.
            */}
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="icon-sm"
                onClick={() => setZoom((z) => Math.max(0.25, z - 0.25))}
              >
                −
              </Button>
              <span className="min-w-12 text-center text-sm tabular-nums">
                {Math.round(zoom * 100)}%
              </span>
              <Button
                variant="outline"
                size="icon-sm"
                onClick={() => setZoom((z) => Math.min(3, z + 0.25))}
              >
                +
              </Button>
            </div>
            <Editor doc={doc} zoom={zoom} />
          </div>
        ) : (
          <Dropzone onDocument={setDoc} />
        )}
      </div>
    </main>
  )
}
