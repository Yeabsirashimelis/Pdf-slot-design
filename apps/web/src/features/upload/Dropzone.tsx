'use client'

import { useCallback, useRef, useState, type DragEvent } from 'react'
import { toast } from 'sonner'
import { Loader2, Upload } from 'lucide-react'
import { imageToPdf, normalizePdf, type EditorDocument } from '@pdf-slot/core'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { decodeImage } from './decodeImage'
import { validateFile } from './validate'

const ACCEPT = '.pdf,image/png,image/jpeg,image/webp,image/heic,image/heif'

function isPdfFile(file: File): boolean {
  return file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')
}

/** Convert a validated upload into a PDF-backed EditorDocument, or throw. */
async function toEditorDocument(file: File): Promise<EditorDocument> {
  const pdfBytes = isPdfFile(file)
    ? new Uint8Array(await file.arrayBuffer())
    : await imageToPdf(await decodeImage(file))
  return normalizePdf(pdfBytes, crypto.randomUUID())
}

export function Dropzone({ onDocument }: { onDocument(doc: EditorDocument): void }) {
  const [isPending, setIsPending] = useState(false)
  const [isDragOver, setIsDragOver] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const processFile = useCallback(
    async (file: File) => {
      const rejection = validateFile(file)
      if (rejection) {
        toast.error(rejection)
        return
      }

      setIsPending(true)
      try {
        const doc = await toEditorDocument(file)
        onDocument(doc)
      } catch (err) {
        // normalizePdf distinguishes InvalidPdfError / EncryptedPdfError by
        // message; decodeImage/imageToPdf throw plain Errors. Surfacing
        // err.message (rather than a single generic string) is what keeps
        // "password-protected" distinct from "not a readable PDF" for the
        // user -- see task-13 brief.
        toast.error(err instanceof Error ? err.message : 'Could not load that file.')
      } finally {
        setIsPending(false)
      }
    },
    [onDocument],
  )

  const handleDrop = useCallback(
    (event: DragEvent<HTMLDivElement>) => {
      event.preventDefault()
      setIsDragOver(false)
      const file = event.dataTransfer.files[0]
      if (file) void processFile(file)
    },
    [processFile],
  )

  const handleSelect = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0]
      // Reset so selecting the same file again still fires onChange.
      event.target.value = ''
      if (file) void processFile(file)
    },
    [processFile],
  )

  return (
    <div
      onDragOver={(event) => {
        event.preventDefault()
        setIsDragOver(true)
      }}
      onDragLeave={() => setIsDragOver(false)}
      onDrop={handleDrop}
      // Plain styled div, not a shadcn primitive: shadcn has no dropzone
      // component, so only the drop target itself is hand-rolled here. The
      // interactive control inside it (Button) is shadcn, per CLAUDE.md.
      className={cn(
        'flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed px-6 py-16 text-center transition-colors',
        isDragOver ? 'border-primary bg-muted/50' : 'border-border',
      )}
    >
      {isPending ? (
        <>
          <Loader2 className="size-6 animate-spin text-muted-foreground" aria-hidden />
          <p className="text-sm text-muted-foreground">Converting…</p>
        </>
      ) : (
        <>
          <Upload className="size-6 text-muted-foreground" aria-hidden />
          <p className="text-sm text-muted-foreground">Drag a PDF or image here, or</p>
          <Button type="button" onClick={() => inputRef.current?.click()}>
            Choose a file
          </Button>
        </>
      )}
      <input
        ref={inputRef}
        type="file"
        accept={ACCEPT}
        className="hidden"
        onChange={handleSelect}
        disabled={isPending}
      />
    </div>
  )
}
