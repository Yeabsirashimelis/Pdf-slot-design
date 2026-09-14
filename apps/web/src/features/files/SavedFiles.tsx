'use client'

import { useEffect, useState } from 'react'
import { FileText, Trash2 } from 'lucide-react'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { TooltipProvider } from '@/components/ui/tooltip'
import { HintButton } from '@/components/hint'
import type { StoredFileSummary, TemplateStore } from '@/lib/persistence/templateStore'

/**
 * The files this browser remembers, under the dropzone: open one again
 * without finding the PDF, or forget it (bytes, layout and values).
 * Deletion asks first -- it is the one irreversible action in the app.
 */
export function SavedFiles({ store, onOpen }: { store: TemplateStore; onOpen(fileId: string): void }) {
  const [files, setFiles] = useState<StoredFileSummary[] | null>(null)
  const [pendingDelete, setPendingDelete] = useState<StoredFileSummary | null>(null)

  useEffect(() => {
    let cancelled = false
    void store.listFiles().then((list) => {
      if (!cancelled) setFiles(list)
    })
    return () => {
      cancelled = true
    }
  }, [store])

  const confirmDelete = async () => {
    if (!pendingDelete) return
    const { fileId } = pendingDelete
    setPendingDelete(null)
    await store.deleteFile(fileId)
    setFiles((current) => current?.filter((f) => f.fileId !== fileId) ?? null)
  }

  if (!files || files.length === 0) return null

  return (
    <TooltipProvider>
      <section data-testid="saved-files" className="mt-8">
        <h2 className="text-sm font-medium">Saved files</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Files you have laid out in this browser. Open one to keep writing, or forget it.
        </p>
        <ul className="mt-3 flex flex-col gap-1.5">
          {files.map((file) => (
            <li
              key={file.fileId}
              data-testid={`saved-file-${file.fileId}`}
              className="flex items-center gap-3 rounded-md border border-border bg-card py-2 pr-2 pl-3 text-sm"
            >
              <FileText className="size-4 shrink-0 text-muted-foreground" aria-hidden />
              <div className="min-w-0 flex-1">
                <div className="truncate font-medium">{file.name}</div>
                <div className="text-xs text-muted-foreground tabular-nums">
                  {file.pageCount} page{file.pageCount === 1 ? '' : 's'} · {file.slotCount} slot
                  {file.slotCount === 1 ? '' : 's'} · edited {formatWhen(file.updatedAt)}
                </div>
              </div>
              <Button size="sm" onClick={() => onOpen(file.fileId)} data-testid={`saved-file-open-${file.fileId}`}>
                Open
              </Button>
              <HintButton
                hint="Forget this file: its layout and everything written into it"
                variant="ghost"
                size="icon-sm"
                aria-label={`Delete ${file.name}`}
                data-testid={`saved-file-delete-${file.fileId}`}
                onClick={() => setPendingDelete(file)}
              >
                <Trash2 />
              </HintButton>
            </li>
          ))}
        </ul>

        <AlertDialog
          open={pendingDelete !== null}
          onOpenChange={(open) => {
            if (!open) setPendingDelete(null)
          }}
        >
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Forget {pendingDelete?.name}?</AlertDialogTitle>
              <AlertDialogDescription>
                Its slot layout and everything written into it will be deleted from this browser. The PDF
                itself is not affected. This cannot be undone.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel data-testid="cancel-delete-file">Keep it</AlertDialogCancel>
              <AlertDialogAction
                variant="destructive"
                onClick={() => void confirmDelete()}
                data-testid="confirm-delete-file"
              >
                Delete
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </section>
    </TooltipProvider>
  )
}

/** "today", "yesterday", or a short date -- enough to tell files apart. */
function formatWhen(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return 'unknown'
  const days = Math.floor((Date.now() - date.getTime()) / 86_400_000)
  if (days <= 0) return 'today'
  if (days === 1) return 'yesterday'
  return date.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
}
