'use client'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Progress } from '@/components/ui/progress'
import { Separator } from '@/components/ui/separator'
import { Textarea } from '@/components/ui/textarea'
import { createJob, zipUrl } from './jobsClient'
import { parseRecords } from './parseRecords'
import { useJobPolling } from './useJobPolling'

const KEY_STORAGE = 'pdf-slot-api-key'
const readKey = () => { try { return localStorage.getItem(KEY_STORAGE) ?? '' } catch { return '' } }
const saveKey = (k: string) => { try { localStorage.setItem(KEY_STORAGE, k) } catch { /* storage blocked: the key just isn't remembered */ } }

/** Step 2: paste a list of records, get one PDF per record from the server, download the zip. */
export function GeneratePanel({ apiUrl, fileId }: { apiUrl: string; fileId: string }) {
  const [apiKey, setApiKey] = useState(readKey)
  const [text, setText] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [jobId, setJobId] = useState<string | null>(null)
  const job = useJobPolling(apiUrl, jobId)
  const running = job?.status === 'queued' || job?.status === 'running' || (jobId !== null && job === null)

  const submit = async () => {
    setError(null)
    const parsed = parseRecords(text)
    if ('error' in parsed) { setError(parsed.error); return }
    saveKey(apiKey)
    const result = await createJob(apiUrl, fileId, parsed.records, apiKey)
    if ('error' in result) { setError(result.error); return }
    setJobId(result.jobId)
  }

  const failures = job?.items.filter((i) => i.status === 'failed') ?? []
  return (
    <div className="grid gap-3" data-testid="generate-panel">
      <Separator />
      <div>
        <h3 className="text-sm font-medium">Generate from data</h3>
        <p className="text-xs text-muted-foreground">One PDF per row. Column names must match the slot names.</p>
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="generate-key">API key</Label>
        <Input id="generate-key" data-testid="generate-key" type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)} autoComplete="off" />
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="generate-records">Records (JSON array or CSV)</Label>
        <Textarea id="generate-records" data-testid="generate-records" rows={6} value={text} onChange={(e) => setText(e.target.value)}
          placeholder={'Name,Date\nAbel,18 Sep 2026'} />
      </div>
      {error && <p className="text-xs text-destructive" data-testid="generate-error">{error}</p>}
      <Button onClick={() => void submit()} disabled={running || text.trim() === ''} data-testid="generate-submit">
        {running ? 'Generating…' : 'Generate PDFs'}
      </Button>
      {job && (
        <div className="grid gap-2">
          <Progress value={job.total === 0 ? 0 : ((job.done + job.failed) / job.total) * 100} />
          <p className="text-xs text-muted-foreground" data-testid="generate-progress">
            {job.done + job.failed} / {job.total} {job.status === 'failed' ? `— failed: ${job.error ?? ''}` : ''}
          </p>
          {job.status === 'done' && (
            <Button render={<a href={zipUrl(apiUrl, job.id)} data-testid="generate-zip" />} variant="outline">
              Download zip ({job.done} PDFs)
            </Button>
          )}
          {failures.length > 0 && (
            <ul className="text-xs text-destructive" data-testid="generate-failures">
              {failures.map((f) => <li key={f.index}>Row {f.index + 1}: {f.error}</li>)}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}
