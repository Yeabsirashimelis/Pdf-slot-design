'use client'

import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Dropzone, type UploadedFile } from '@/features/upload/Dropzone'
import { TemplateEditor } from '@/features/template/TemplateEditor'
import { openFile, type OpenedFile } from '@/features/template/openFile'
import { isFileId } from '@/lib/files/fileHash'
import { templateStore } from '@/lib/persistence/indexedDbTemplateStore'

export default function Home() {
  const [opened, setOpened] = useState<OpenedFile | null>(null)
  // Nothing renders until the restore has been attempted, so a saved
  // session never flashes the dropzone before landing in the editor.
  const [isRestoring, setIsRestoring] = useState(true)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const session = await templateStore.get()
        if (!session) return
        // A random id (no SubtleCrypto at the time) can't be recognised
        // again, so restoring it would land on a write step with no
        // slots. A session whose bytes are gone is dead too. Clear both
        // rather than re-trying them on every reload.
        const file = isFileId(session.fileId) ? await templateStore.getFile(session.fileId) : null
        if (!file) {
          await templateStore.clear()
          return
        }
        const result = await openFile(file.source, file.name, templateStore)
        // The session's step wins over openFile's landing rule: reload
        // puts the user back where they were, not where a fresh open
        // of the same file would start.
        if (!cancelled) setOpened({ ...result, step: session.step })
      } catch (err) {
        console.error('Failed to restore the last open file', err)
        toast.error("Couldn't reopen your last file. Upload it again to continue.")
        await templateStore.clear()
      } finally {
        // Always runs, so a failed restore shows the dropzone rather than
        // a blank page.
        if (!cancelled) setIsRestoring(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const handleFile = async ({ bytes, name }: UploadedFile) => {
    try {
      const result = await openFile(bytes, name, templateStore)
      // openFile falls back to a random id only when SubtleCrypto is
      // missing (insecure origin); anything else is a content hash.
      if (!isFileId(result.fileId)) {
        toast.warning("This browser can't remember layouts for this file (insecure connection).")
      }
      setOpened(result)
    } catch (err) {
      // normalizePdf's InvalidPdfError / EncryptedPdfError carry the
      // user-facing copy; keep them distinct rather than one generic line.
      toast.error(err instanceof Error ? err.message : 'Could not load that file.')
    }
  }

  return (
    <main className="mx-auto flex min-h-dvh max-w-6xl flex-col justify-center px-6 py-10">
      <h1 className="text-2xl font-medium tracking-tight">PDF Slot Editor</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Lay out named text slots on a PDF once; write into them every time after.
      </p>
      <div className="mt-6">
        {isRestoring ? null : opened ? (
          // Keyed on file + step so a restore or a fresh open remounts the
          // editor with new initial state instead of reusing stale hooks.
          <TemplateEditor
            key={`${opened.fileId}:${opened.step}`}
            opened={opened}
            store={templateStore}
            onStartOver={() => setOpened(null)}
          />
        ) : (
          <Dropzone onFile={handleFile} />
        )}
      </div>
    </main>
  )
}
