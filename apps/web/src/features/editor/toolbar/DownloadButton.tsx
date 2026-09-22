'use client'

import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { downloadName } from './downloadName'

/**
 * How long the blob: URL is kept alive after the click. Generous on
 * purpose: revoking too early aborts the save with no error at all, while
 * holding one export in memory a few seconds longer costs nothing.
 */
const REVOKE_DELAY_MS = 30_000

/**
 * Performs the one render and saves exactly its bytes. `aria-disabled`,
 * not native `disabled`, while blocked: a native `disabled` makes the
 * element unfocusable and suppresses pointer events, so the Tooltip
 * explaining the block could never open. Blocking is enforced by the
 * guard at the top of `handleDownload`. Resolving `null` from `render`
 * (a failed render) saves nothing -- never the source or a stale file.
 */
export function DownloadButton({
  isRendering,
  render,
  downloadBlockedReason,
  fileName,
}: {
  isRendering: boolean
  render(): Promise<Uint8Array | null>
  downloadBlockedReason: string | null
  /** The uploaded file's name; the download keeps it (see downloadName). */
  fileName?: string
}) {
  const handleDownload = async () => {
    if (downloadBlockedReason) return
    // An unedited upload is still a legitimate download: with no slots the
    // render is just the source, re-saved.
    const data = await render()
    if (!data) return
    const blob = new Blob([data as Uint8Array<ArrayBuffer>], { type: 'application/pdf' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = downloadName(fileName)
    // The anchor has to be IN the document to be clicked (a detached one is
    // ignored outside Chrome), and the object URL has to outlive that click:
    // the browser reads the blob asynchronously, so revoking in the same
    // task can abort a download it has not finished reading -- silently, with
    // no file and no error. A small export always won that race; a 109-page
    // one (~1.2 MB out) did not. Both are cleaned up once the read is long
    // since done; until then the cost is one blob held in memory.
    document.body.append(a)
    a.click()
    // Saving is the one action with no visible result inside the app -- the
    // file lands wherever the browser puts it, under a name that may
    // already exist there. Say what was written, and how big, so a stale
    // copy opened by name is not mistaken for this one.
    toast.success(`Saved ${a.download}`, { description: `${(data.byteLength / 1024).toFixed(0)} KB` })
    window.setTimeout(() => {
      a.remove()
      URL.revokeObjectURL(url)
    }, REVOKE_DELAY_MS)
  }

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            variant="outline"
            size="sm"
            className="aria-disabled:cursor-not-allowed aria-disabled:opacity-50"
            aria-disabled={downloadBlockedReason !== null}
            onClick={() => {
              void handleDownload()
            }}
            data-testid="download-button"
          >
            {isRendering ? 'Rendering…' : 'Download'}
          </Button>
        }
      />
      <TooltipContent>{downloadBlockedReason ?? 'Download the PDF with your text in it'}</TooltipContent>
    </Tooltip>
  )
}
