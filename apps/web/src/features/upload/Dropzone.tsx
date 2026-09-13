'use client'

import { useCallback, useRef, useState, type DragEvent } from 'react'
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
 */
export function Dropzone({ onFile }: { onFile(file: UploadedFile): void }) {
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
        onFile({ bytes: await toPdfBytes(file), name: file.name })
      } catch (err) {
        // decodeImage / imageToPdf throw plain Errors with user-facing
        // messages (unsupported or undecodable image).
        toast.error(err instanceof Error ? err.message : 'Could not load that file.')
      } finally {
        setIsPending(false)
      }
    },
    [onFile],
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
