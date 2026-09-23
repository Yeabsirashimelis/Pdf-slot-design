'use client'
import { useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Progress } from '@/components/ui/progress'
import { Separator } from '@/components/ui/separator'
import { Textarea } from '@/components/ui/textarea'
import { checkColumns, type ColumnCheck } from './checkColumns'
import { createJob, zipUrl } from './jobsClient'
import { parseRecords } from './parseRecords'
import { useJobPolling } from './useJobPolling'

const KEY_STORAGE = 'pdf-slot-api-key'
const readKey = () => { try { return localStorage.getItem(KEY_STORAGE) ?? '' } catch { return '' } }
const saveKey = (k: string) => { try { localStorage.setItem(KEY_STORAGE, k) } catch { /* storage blocked: the key just isn't remembered */ } }

const MB = 1024 * 1024
// The whole file is read into the textarea, so the cap is about what the browser can keep in a
// controlled input and re-parse on every keystroke, not about what the server would accept.
const MAX_IMPORT_MB = 5
const IMPORTABLE_NAME = /\.(csv|json)$/i

/** What the live check has to say about the text in the box: a reason it cannot be used, or what it holds. */
type Summary =
  | { kind: 'error'; message: string }
  | (ColumnCheck & { kind: 'data'; rows: number; nothingMatches: boolean })

/** Step 2: paste or import a list of records, get one PDF per record from the server, download the zip. */
export function GeneratePanel({ apiUrl, fileId, slotNames }: { apiUrl: string; fileId: string; slotNames: readonly string[] }) {
  const [apiKey, setApiKey] = useState(readKey)
  const [text, setText] = useState('')
  const [fileName, setFileName] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [jobId, setJobId] = useState<string | null>(null)
  const job = useJobPolling(apiUrl, jobId)
  const running = job?.status === 'queued' || job?.status === 'running' || (jobId !== null && job === null)

  const summary = useMemo<Summary | null>(() => {
    if (text.trim() === '') return null
    const parsed = parseRecords(text)
    if ('error' in parsed) return { kind: 'error', message: parsed.error }
    const check = checkColumns(parsed.records, slotNames)
    // An extra column or a deliberately blank slot is legitimate, so neither blocks. Nothing
    // matching at all never is: it is the wrong file, or a header row that was never these slots.
    const nothingMatches = slotNames.length > 0 && check.columns.length > 0 && check.unknown.length === check.columns.length
    return { kind: 'data', rows: parsed.records.length, nothingMatches, ...check }
  }, [text, slotNames])
  const blocked = summary === null || summary.kind === 'error' || summary.nothingMatches

  const importFile = async (file: File | undefined) => {
    if (!file) return
    setError(null)
    if (!IMPORTABLE_NAME.test(file.name)) { setError('Choose a .csv or .json file'); return }
    if (file.size > MAX_IMPORT_MB * MB) {
      setError(`That file is ${(file.size / MB).toFixed(1)} MB; the limit is ${MAX_IMPORT_MB} MB`)
      return
    }
    let contents: string
    try { contents = await file.text() } catch { setError('Could not read that file'); return }
    // Into the same box the user types in, so an import can be read and corrected in place.
    setText(contents)
    setFileName(file.name)
    // The zip and the failure list belong to the data that has just been replaced.
    setJobId(null)
  }

  const submit = async () => {
    setError(null)
    const parsed = parseRecords(text)
    if ('error' in parsed) { setError(parsed.error); return }
    if (apiKey.trim() === '') { setError('Enter your API key'); return }
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
        <Label htmlFor="generate-file">Import a file</Label>
        <Input id="generate-file" data-testid="generate-file" type="file" accept=".csv,.json,text/csv,application/json"
          onChange={(e) => {
            const picked = e.target.files?.[0]
            // Cleared so that picking the same file again -- after fixing it -- still fires a change.
            e.target.value = ''
            void importFile(picked)
          }} />
        {fileName && <p className="truncate text-xs text-muted-foreground" data-testid="generate-file-name">{fileName}</p>}
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="generate-records">Records (JSON array or CSV)</Label>
        <Textarea id="generate-records" data-testid="generate-records" rows={6} value={text} onChange={(e) => setText(e.target.value)}
          placeholder={'Name,Date\nAbel,18 Sep 2026'} />
      </div>
      {summary && <DataSummary summary={summary} slotNames={slotNames} />}
      {error && <p className="text-xs text-destructive" data-testid="generate-error">{error}</p>}
      <Button onClick={() => void submit()} disabled={running || blocked} data-testid="generate-submit">
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

/** The live read-out under the box: what the data holds, or the one reason it cannot be used. */
function DataSummary({ summary, slotNames }: { summary: Summary; slotNames: readonly string[] }) {
  if (summary.kind === 'error') {
    return <p className="text-xs text-destructive" data-testid="generate-summary">{summary.message}</p>
  }
  const { rows, columns, unknown, missing, suggestions, nothingMatches } = summary
  return (
    <div className="grid gap-0.5 text-xs" data-testid="generate-summary">
      <p className="text-muted-foreground">{`${rows} ${rows === 1 ? 'row' : 'rows'} · columns: ${columns.join(', ')}`}</p>
      {nothingMatches ? (
        <p className="text-destructive">{`None of these columns match your slots (${slotNames.join(', ')})`}</p>
      ) : (
        <>
          {unknown.map((column) => (
            <p key={column} className="text-muted-foreground">
              {`Ignored: "${column}" matches no slot.${suggestions[column] ? ` Did you mean "${suggestions[column]}"?` : ''}`}
            </p>
          ))}
          {missing.map((name) => (
            <p key={name} className="text-muted-foreground">{`Left blank: "${name}" has no column.`}</p>
          ))}
        </>
      )}
    </div>
  )
}
