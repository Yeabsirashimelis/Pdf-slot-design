'use client'

import { useState } from 'react'
import type { EditorDocument } from '@pdf-slot/core'
import { Dropzone } from '@/features/upload/Dropzone'
import { Editor } from '@/features/editor/Editor'

export default function Home() {
  const [doc, setDoc] = useState<EditorDocument | null>(null)

  return (
    <main className="mx-auto flex min-h-dvh max-w-4xl flex-col justify-center px-6 py-10">
      <h1 className="text-2xl font-medium tracking-tight">PDF Slot Editor</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Upload a PDF or a document image, place text anywhere, and download it.
      </p>
      <div className="mt-6">
        {/*
          Zoom and page navigation now live entirely in Editor's own
          toolbar (Task 17) -- Task 15's standalone placeholder control is
          gone; Editor owns that state itself since nothing above it needs
          to read or set zoom.
        */}
        {doc ? <Editor doc={doc} /> : <Dropzone onDocument={setDoc} />}
      </div>
    </main>
  )
}
