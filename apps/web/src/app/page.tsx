'use client'

import { useEffect, useState } from 'react'
import type { EditorDocument, Slot } from '@pdf-slot/core'
import { Dropzone } from '@/features/upload/Dropzone'
import { Editor } from '@/features/editor/Editor'
import { clearSession, loadSession } from '@/lib/persistence/indexeddb'

export default function Home() {
  const [doc, setDoc] = useState<EditorDocument | null>(null)
  const [initialSlots, setInitialSlots] = useState<Slot[]>([])
  // Starts true so the very first client render neither flashes the
  // dropzone nor the editor before the one-time IndexedDB check (Task 18)
  // has had a chance to answer "is there a session to restore?".
  const [isRestoring, setIsRestoring] = useState(true)

  useEffect(() => {
    let cancelled = false
    void loadSession().then((session) => {
      if (cancelled) return
      if (session) {
        setDoc(session.doc)
        setInitialSlots(session.slots)
      }
      setIsRestoring(false)
    })
    return () => {
      cancelled = true
    }
  }, [])

  const handleStartOver = () => {
    void clearSession()
    setDoc(null)
    setInitialSlots([])
  }

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

          isRestoring gates both branches (Task 18): rendering the Dropzone
          before the IndexedDB check resolves would flash it for a user
          who's about to be dropped back into a restored session.
        */}
        {isRestoring ? null : doc ? (
          <Editor doc={doc} initialSlots={initialSlots} onStartOver={handleStartOver} />
        ) : (
          <Dropzone onDocument={setDoc} />
        )}
      </div>
    </main>
  )
}
