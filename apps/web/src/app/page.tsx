'use client'

import { useState } from 'react'
import type { EditorDocument } from '@pdf-slot/core'
import { Dropzone } from '@/features/upload/Dropzone'

export default function Home() {
  const [doc, setDoc] = useState<EditorDocument | null>(null)

  return (
    <main className="mx-auto flex min-h-dvh max-w-3xl flex-col justify-center px-6">
      <h1 className="text-2xl font-medium tracking-tight">PDF Slot Editor</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Upload a PDF or a document image, place text anywhere, and download it.
      </p>
      <div className="mt-6">
        {doc ? (
          // The page canvas and slot editor land in later tasks; for now,
          // confirm the upload pipeline produced a usable document.
          <p className="text-sm">
            Loaded a {doc.pages.length}-page document (id {doc.id}).
          </p>
        ) : (
          <Dropzone onDocument={setDoc} />
        )}
      </div>
    </main>
  )
}
