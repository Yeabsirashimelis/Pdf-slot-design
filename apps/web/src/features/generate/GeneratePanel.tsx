'use client'
import { ChevronRight } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Progress } from '@/components/ui/progress'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'
import { checkColumns, noColumnsMatch, noColumnsMatchMessage, validateBeforeSubmit, type ColumnCheck, type FillTargets } from './checkColumns'
import { createJob, zipUrl } from './jobsClient'
import { parseRecords } from './parseRecords'
import { useJobPolling } from './useJobPolling'

const KEY_STORAGE = 'pdf-slot-api-key'
const readKey = () => { try { return localStorage.getItem(KEY_STORAGE) ?? '' } catch { return '' } }
const saveKey = (k: string) => { try { localStorage.setItem(KEY_STORAGE, k) } catch { /* storage blocked: the key just isn't remembered */ } }

// Shut unless this browser has opened it before. The form is a few
// hundred pixels in a 256px column and it is step two: someone placing
// text on a page should not have to scroll past it to see their slots.
const OPEN_STORAGE = 'pdf-slot-generate-open'
const readOpen = () => { try { return localStorage.getItem(OPEN_STORAGE) === 'yes' } catch { return false } }
const saveOpen = (open: boolean) => { try { localStorage.setItem(OPEN_STORAGE, open ? 'yes' : 'no') } catch { /* storage blocked: it just opens shut next time */ } }

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
export function GeneratePanel({ apiUrl, fileId, targets }: { apiUrl: string; fileId: string; targets: FillTargets }) {
  const [apiKey, setApiKey] = useState(readKey)
  const [open, setOpen] = useState(readOpen)
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
    const check = checkColumns(parsed.records, targets)
    // An extra column or a deliberately blank slot is legitimate, so neither blocks. Nothing
    // matching at all never is: it is the wrong file, or a header row that was never these slots.
    const nothingMatches = noColumnsMatch(check, targets)
    return { kind: 'data', rows: parsed.records.length, nothingMatches, ...check }
  }, [text, targets])
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
    // The `disabled` prop on the button is a convenience, not the guard: this is the function that
    // actually calls the API, so it refuses on its own rather than trusting the button was disabled.
    const validated = validateBeforeSubmit({ text, targets, apiKey })
    if ('error' in validated) { setError(validated.error); return }
    saveKey(apiKey)
    const result = await createJob(apiUrl, fileId, validated.records, apiKey)
    if ('error' in result) { setError(result.error); return }
    setJobId(result.jobId)
  }

  const hasTables = targets.tables.length > 0
  const failures = job?.items.filter((i) => i.status === 'failed') ?? []
  return (
    <Collapsible
      open={open}
      onOpenChange={(next) => { setOpen(next); saveOpen(next) }}
      className="border-t border-border"
    >
      {/* The row reads like the Shortcuts row at the foot of the panel:
          same padding, same weight, a chevron that turns. */}
      <CollapsibleTrigger
        data-testid="generate-toggle"
        className="flex w-full items-center gap-1.5 px-3 py-2 text-left text-sm font-medium outline-none hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring"
      >
        <ChevronRight className={cn('size-3.5 shrink-0 opacity-70 transition-transform', open && 'rotate-90')} aria-hidden />
        Generate from data
      </CollapsibleTrigger>
      <CollapsibleContent>
        {/* px-3 lines this up with the "Slots" heading above it.

            The form controls are a size down from their defaults. This is
            a 256px sidebar whose every other line is text-xs; at the stock
            text-sm the fields read as a different, larger interface that
            happens to be sitting inside this one. (`md:` too, because that
            is the breakpoint the stock size comes back at.) */}
        <div className="grid gap-3 px-3 pb-3" data-testid="generate-panel">
          <p className="text-xs text-muted-foreground">
            {hasTables
              ? 'One PDF per record. Names must match your slots and tables; a table\'s rows go in a list under its name.'
              : 'One PDF per row. Column names must match the slot names.'}
          </p>
          <div className="grid gap-1.5">
            <Label htmlFor="generate-key" className="text-xs">API key</Label>
            <Input id="generate-key" className="text-xs md:text-xs" data-testid="generate-key" type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)} autoComplete="off" />
            <p className="text-xs text-muted-foreground">
              Set on the server that generates the PDFs; ask whoever runs it. Remembered in this browser.
            </p>
          </div>
          <div className="grid gap-1.5">
            <span className="text-xs leading-none font-medium">Import a file</span>
            {/* A real file input, hidden, with the button being its label --
                so the picker opens without any script, and the browser's own
                "Choose File / No file chosen" control, the one thing on this
                screen the app does not style, never appears. `peer` carries
                the keyboard focus ring across to the label. */}
            <input
              id="generate-file"
              data-testid="generate-file"
              type="file"
              accept=".csv,.json,text/csv,application/json"
              className="peer sr-only"
              onChange={(e) => {
                const picked = e.target.files?.[0]
                // Cleared so that picking the same file again -- after fixing it -- still fires a change.
                e.target.value = ''
                void importFile(picked)
              }}
            />
            <Button
              variant="outline"
              size="sm"
              nativeButton={false}
              className="w-full cursor-pointer peer-focus-visible:border-ring peer-focus-visible:ring-3 peer-focus-visible:ring-ring/50"
              render={<label htmlFor="generate-file" data-testid="generate-file-choose" />}
            >
              Choose a .csv or .json file
            </Button>
            {fileName && <p className="truncate text-xs text-muted-foreground" data-testid="generate-file-name">{fileName}</p>}
          </div>
          <div className="grid gap-1.5">
            {/* Always both, even with a table on the file: a CSV cannot
                fill the table, but it still fills the plain slots, and a
                label reading "JSON array" would be telling the user their
                spreadsheet is refused when it is not. What a CSV can and
                cannot do is said underneath, where it can be said properly. */}
            <Label htmlFor="generate-records" className="text-xs">Records (JSON array or CSV)</Label>
            <Textarea id="generate-records" className="text-xs md:text-xs" data-testid="generate-records" rows={4} value={text} onChange={(e) => setText(e.target.value)}
              placeholder={hasTables ? tableExample(targets) : 'Name,Date\nAbel,18 Sep 2026'} />
            {hasTables && (
              <p className="text-xs text-muted-foreground" data-testid="generate-csv-note">
                A CSV is one flat line per PDF, so it can fill slots but never a table. Use JSON for a table, or for both at once.
              </p>
            )}
          </div>
          {summary && <DataSummary summary={summary} targets={targets} />}
          {error && <p className="text-xs text-destructive" data-testid="generate-error">{error}</p>}
          <Button size="sm" onClick={() => void submit()} disabled={running || blocked} data-testid="generate-submit">
            {running ? 'Generating…' : 'Generate PDFs'}
          </Button>
          {job && (
            <div className="grid gap-2">
              <Progress value={job.total === 0 ? 0 : ((job.done + job.failed) / job.total) * 100} />
              <p className="text-xs text-muted-foreground" data-testid="generate-progress">
                {job.done + job.failed} / {job.total} {job.status === 'failed' ? `— failed: ${job.error ?? ''}` : ''}
              </p>
              {job.status === 'done' && (
                <Button size="sm" render={<a href={zipUrl(apiUrl, job.id)} data-testid="generate-zip" />} nativeButton={false} variant="outline">
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
      </CollapsibleContent>
    </Collapsible>
  )
}

/** The live read-out under the box: what the data holds, or the one reason it cannot be used. */
function DataSummary({ summary, targets }: { summary: Summary; targets: FillTargets }) {
  if (summary.kind === 'error') {
    return <p className="text-xs text-destructive" data-testid="generate-summary">{summary.message}</p>
  }
  const { rows, columns, unknown, missing, suggestions, nothingMatches, tables, wrongKind } = summary
  const thing = targets.tables.length === 0 ? 'slot' : 'slot or table'
  return (
    <div className="grid gap-0.5 text-xs" data-testid="generate-summary">
      <p className="text-muted-foreground">{`${rows} ${rows === 1 ? 'row' : 'rows'} · columns: ${columns.join(', ')}`}</p>
      {nothingMatches ? (
        <p className="text-destructive">{noColumnsMatchMessage(targets)}</p>
      ) : (
        <>
          {unknown.map((column) => (
            <p key={column} className="text-muted-foreground">
              {`Ignored: "${column}" matches no ${thing}.${suggestions[column] ? ` Did you mean "${suggestions[column]}"?` : ''}`}
            </p>
          ))}
          {missing.map((name) => (
            <p key={name} className="text-muted-foreground">{`Left blank: "${name}" has no column.`}</p>
          ))}
          {/* A name that matched but was given the wrong sort of value:
              worth its own line, because "Ignored: matches no slot" would
              be a lie and would send the user hunting for a typo. */}
          {wrongKind.map((note) => (
            <p key={note} className="text-destructive">{note}</p>
          ))}
          {tables.map((table) => (
            <div key={table.name} className="grid gap-0.5">
              {table.unknown.map((column) => (
                <p key={column} className="text-muted-foreground">
                  {`Ignored: "${column}" matches no column of "${table.name}".${table.suggestions[column] ? ` Did you mean "${table.suggestions[column]}"?` : ''}`}
                </p>
              ))}
              {table.missing.map((column) => (
                <p key={column} className="text-muted-foreground">{`Left blank: "${table.name}" column "${column}" has no data.`}</p>
              ))}
              {table.extraRows > 0 && (
                <p className="text-destructive" data-testid={`generate-extra-rows-${table.name}`}>
                  {`"${table.name}" has ${table.extraRows} more ${table.extraRows === 1 ? 'row' : 'rows'} of data than it has rows on the page; ${table.extraRows === 1 ? 'it' : 'they'} will not print. Add rows to the table, or shorten the data.`}
                </p>
              )}
            </div>
          ))}
        </>
      )}
    </div>
  )
}

/**
 * The shape to write, spelled out with this file's own names -- a shorter
 * road to a working file than any wording of the rule.
 */
function tableExample(targets: FillTargets): string {
  const slot = targets.slotNames[0]
  const table = targets.tables[0]
  const row = (table?.columns ?? []).slice(0, 2)
  const cells = row.length > 0 ? row.map((c, i) => `"${c}": "${i + 1}"`).join(', ') : '"Column 1": "1"'
  const lines = [
    '[',
    '  {',
    ...(slot ? [`    "${slot}": "…",`] : []),
    `    "${table?.name ?? 'Table 1'}": [`,
    `      { ${cells} }`,
    '    ]',
    '  }',
    ']',
  ]
  return lines.join('\n')
}
