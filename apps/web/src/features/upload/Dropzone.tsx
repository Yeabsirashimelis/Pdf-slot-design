'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { Loader2, Upload } from 'lucide-react'
import { imageToPdf } from '@pdf-slot/core'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { decodeImage } from './decodeImage'
import { validateFile } from './validate'

const ACCEPT = '.pdf,image/png,image/jpeg,image/webp,image/heic,image/heif'

function isPdfFile(file: File): boolean {
  return file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')
}

/** Convert a validated upload into PDF bytes (images are wrapped in a page), or throw. */
async function toPdfBytes(file: File): Promise<Uint8Array> {
  return isPdfFile(file) ? new Uint8Array(await file.arrayBuffer()) : imageToPdf(await decodeImage(file))
}

export type UploadedFile = { bytes: Uint8Array; name: string }

/**
 * Hands the caller PDF bytes plus the original name; it does not parse the
 * PDF. openFile does that, once it knows the file's id, so an invalid or
 * encrypted PDF is reported by the caller, not here.
 *
 * `onFile` may return a promise; the busy state lasts until it settles, so
 * the caller's parse/hash/store work does not leave an idle dropzone
 * sitting there before the editor appears.
 */
export function Dropzone({ onFile }: { onFile(file: UploadedFile): void | Promise<void> }) {
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
        await onFile({ bytes: await toPdfBytes(file), name: file.name })
      } catch (err) {
        // decodeImage / imageToPdf throw plain Errors with user-facing
        // messages (unsupported or undecodable image). The caller reports
        // its own failures; this catch only sees them if it rethrows.
        toast.error(err instanceof Error ? err.message : 'Could not load that file.')
      } finally {
        setIsPending(false)
      }
    },
    [onFile],
  )

  // The whole window is the drop target, not just the dashed box: people
  // drop wherever the cursor lands, and a file dropped outside a target
  // makes the browser navigate to it -- the app is simply gone. Listening
  // on `document` catches every drop; the box only shows where it lands.
  // Non-file drags (selected text) are left to the browser.
  useEffect(() => {
    const hasFiles = (event: DragEvent) => Array.from(event.dataTransfer?.types ?? []).includes('Files')
    const onDragEnter = (event: DragEvent) => {
      if (!hasFiles(event)) return
      event.preventDefault()
      setIsDragOver(true)
    }
    const onDragOver = (event: DragEvent) => {
      if (!hasFiles(event)) return
      // Required, or the browser refuses the drop.
      event.preventDefault()
      setIsDragOver(true)
    }
    const onDragLeave = (event: DragEvent) => {
      // relatedTarget is null when the pointer leaves the window itself.
      if (event.relatedTarget === null) setIsDragOver(false)
    }
    const onDrop = (event: DragEvent) => {
      if (!hasFiles(event)) return
      event.preventDefault()
      setIsDragOver(false)
      const file = event.dataTransfer?.files[0]
      if (file) void processFile(file)
    }
    document.addEventListener('dragenter', onDragEnter)
    document.addEventListener('dragover', onDragOver)
    document.addEventListener('dragleave', onDragLeave)
    document.addEventListener('drop', onDrop)
    return () => {
      document.removeEventListener('dragenter', onDragEnter)
      document.removeEventListener('dragover', onDragOver)
      document.removeEventListener('dragleave', onDragLeave)
      document.removeEventListener('drop', onDrop)
    }
  }, [processFile])

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
      data-testid="dropzone"
      data-drag-over={isDragOver}
      // Plain styled div, not a shadcn primitive: shadcn has no dropzone
      // component (checked the registry), so only the visual target is
      // hand-rolled here; the drop itself is handled document-wide above.
      // The interactive control inside it (Button) is shadcn, per CLAUDE.md.
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
          <p className="text-sm text-muted-foreground">{isDragOver ? 'Drop it anywhere' : 'Drag a PDF or image here, or'}</p>
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
