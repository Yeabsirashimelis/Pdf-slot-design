'use client'

import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { downloadName } from './downloadName'

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
    a.click()
    URL.revokeObjectURL(url)
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
