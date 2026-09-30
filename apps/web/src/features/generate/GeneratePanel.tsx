'use client'
import { ChevronLeft, ChevronRight, Eye, EyeOff } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
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
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Progress } from '@/components/ui/progress'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'
import { checkColumns, noColumnsMatch, noColumnsMatchMessage, validateBeforeSubmit, type ColumnCheck, type FillTargets } from './checkColumns'
import type { JobRecord } from '@pdf-slot/contracts'
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
export function GeneratePanel({ apiUrl, fileId, targets, filledIn = [], onSaveNow, onPreviewRecord }: {
  apiUrl: string
  fileId: string
  targets: FillTargets
  /**
   * The boxes that have something typed into them, by name -- what the
   * user would see printed if they downloaded this one page. Offered as a
   * choice when the data leaves any of them out.
   */
  filledIn?: readonly string[]
  /**
   * Writes the layout as it stands and waits for it. A job renders from
   * the *saved* layout, and the editor's own writes are debounced, so
   * without this a change made in the last second before Generate is not
   * the one that prints.
   */
  onSaveNow?: () => Promise<unknown>
  /**
   * Pours one record into the boxes on the page. Called the moment a file
   * is imported, so what it will produce can be read off the document
   * rather than guessed at from a summary.
   */
  onPreviewRecord?: (record: JobRecord) => void
}) {
  const [apiKey, setApiKey] = useState(readKey)
  const [open, setOpen] = useState(readOpen)
  const [text, setText] = useState('')
  const [fileName, setFileName] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [jobId, setJobId] = useState<string | null>(null)
  const [asking, setAsking] = useState(false)
  const [keyShown, setKeyShown] = useState(false)
  /** Which record of the data the page is showing, or null for none. */
  const [previewing, setPreviewing] = useState<number | null>(null)
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
  /** Nothing has been laid out, so there is nowhere for a record to go. */
  const nothingLaidOut = targets.slotNames.length === 0 && targets.tables.length === 0
  const blocked = nothingLaidOut || summary === null || summary.kind === 'error' || summary.nothingMatches

  /** The records as parsed, or none if the box does not hold usable data. */
  const records = useMemo(() => {
    if (text.trim() === '') return []
    const parsed = parseRecords(text)
    return 'error' in parsed ? [] : parsed.records
  }, [text])

  /**
   * Which row is actually on the page.
   *
   * Worked out from the data rather than remembered alongside it: the
   * data can be edited after a row was chosen, and a remembered index
   * then outlives the row it pointed at -- "showing row 3 of 1". Cutting
   * the data short falls back to the last row there is.
   */
  const shown = previewing === null || records.length === 0
    ? null
    : Math.min(previewing, records.length - 1)

  /**
   * Puts a record on the page. Every box it names is filled and every box
   * it does not is emptied, so what is on the document is that record and
   * nothing else -- which is what generating it would produce.
   */
  const showRecord = (index: number) => {
    const record = records[index]
    if (!record || !onPreviewRecord || nothingLaidOut) return
    onPreviewRecord(record)
    setPreviewing(index)
  }

  // Held in a ref, not a dependency: the callback is rebuilt every time
  // the layout changes, and putting a record on the page changes the
  // layout -- so depending on it would re-run the effect below for ever.
  const putOnPage = useRef(onPreviewRecord)
  useEffect(() => {
    putOnPage.current = onPreviewRecord
  })

  /**
   * Once a row is on the page, keep it in step with the data: editing the
   * data re-reads that row onto the document. Without this the page goes
   * on showing a row the data no longer has, which is the one thing a
   * preview must never do.
   *
   * Only once a row is being shown -- typing into the box a letter at a
   * time must not take the page over -- and on a delay, so it follows the
   * typing rather than fighting it.
   */
  useEffect(() => {
    if (shown === null || nothingLaidOut) return
    const record = records[shown]
    if (!record) return
    const timer = setTimeout(() => putOnPage.current?.(record), 400)
    return () => clearTimeout(timer)
  }, [records, shown, nothingLaidOut])

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
    // On the page immediately: a summary says how many rows there are, but
    // only the document itself says what one of them will look like.
    const parsed = parseRecords(contents)
    // Nothing laid out means nowhere to put it: claiming to show a row
    // while the page stays empty is worse than saying nothing.
    if (!('error' in parsed) && parsed.records[0] && onPreviewRecord && !nothingLaidOut) {
      onPreviewRecord(parsed.records[0])
      setPreviewing(0)
    } else {
      setPreviewing(null)
    }
    // The zip and the failure list belong to the data that has just been replaced.
    setJobId(null)
  }

  /**
   * Boxes the user has filled in that this data file says nothing about.
   * Only these make the question worth asking: with none, both answers
   * print exactly the same thing.
   */
  const unanswered = useMemo(() => {
    const parsed = parseRecords(text)
    if ('error' in parsed) return []
    const named = new Set<string>()
    for (const record of parsed.records) for (const key of Object.keys(record)) named.add(key)
    return filledIn.filter((name) => !named.has(name))
  }, [text, filledIn])

  const submit = async (fillFromTemplate: boolean) => {
    setError(null)
    // The `disabled` prop on the button is a convenience, not the guard: this is the function that
    // actually calls the API, so it refuses on its own rather than trusting the button was disabled.
    const validated = validateBeforeSubmit({ text, targets, apiKey })
    if ('error' in validated) { setError(validated.error); return }
    saveKey(apiKey)
    // Before the job, not after: it reads the layout from the server.
    if (onSaveNow) {
      try {
        await onSaveNow()
      } catch {
        setError('Could not save the layout, so generating was stopped -- what printed would not have been what you see')
        return
      }
    }
    const result = await createJob(apiUrl, fileId, validated.records, apiKey, fillFromTemplate)
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
            {/* Hidden by default, because it is a key -- but a key typed
                blind is a key mistyped, and the error for a wrong one
                comes back only after a job is refused. */}
            <div className="relative">
              <Input
                id="generate-key"
                className="pr-7 text-xs md:text-xs"
                data-testid="generate-key"
                type={keyShown ? 'text' : 'password'}
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                autoComplete="off"
              />
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                className="absolute inset-y-0 right-0.5 my-auto text-muted-foreground"
                aria-label={keyShown ? 'Hide the API key' : 'Show the API key'}
                aria-pressed={keyShown}
                data-testid="generate-key-reveal"
                onClick={() => setKeyShown((was) => !was)}
              >
                {keyShown ? <EyeOff /> : <Eye />}
              </Button>
            </div>
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
          {records.length > 0 && onPreviewRecord && !nothingLaidOut && (
            <div className="flex items-center gap-1.5" data-testid="generate-preview">
              <Button
                variant="outline"
                size="xs"
                disabled={shown === null || shown <= 0}
                onClick={() => showRecord((shown ?? 0) - 1)}
                aria-label="Show the row before"
                data-testid="generate-preview-prev"
              >
                <ChevronLeft />
              </Button>
              <span className="min-w-0 flex-1 truncate text-center text-xs text-muted-foreground" data-testid="generate-preview-label">
                {shown === null
                  ? `${records.length} ${records.length === 1 ? 'row' : 'rows'} · show one on the page`
                  : `Showing row ${shown + 1} of ${records.length}`}
              </span>
              <Button
                variant="outline"
                size="xs"
                disabled={shown !== null && shown >= records.length - 1}
                onClick={() => showRecord(shown === null ? 0 : shown + 1)}
                aria-label="Show the next row"
                data-testid="generate-preview-next"
              >
                <ChevronRight />
              </Button>
            </div>
          )}
          {/* Only once there is data to say it about. Shown the moment the
              panel opens it reads as something already gone wrong, when
              in fact the user has not done anything yet -- and what it
              asks for is on the page behind the panel, not in it. */}
          {nothingLaidOut && records.length > 0 && (
            <p className="text-xs text-destructive" data-testid="generate-nothing-laid-out">
              This data has nowhere to go: the page has no slots or tables yet. Add one, then come back.
            </p>
          )}
          {summary && !nothingLaidOut && <DataSummary summary={summary} targets={targets} />}
          {error && <p className="text-xs text-destructive" data-testid="generate-error">{error}</p>}
          <Button
        size="sm"
        onClick={() => { if (unanswered.length > 0) setAsking(true); else void submit(false) }}
        disabled={running || blocked}
        data-testid="generate-submit"
      >
            {running ? 'Generating…' : 'Generate PDFs'}
          </Button>

          {/* Asked only when the answer changes what prints: boxes filled
              in here that the data file says nothing about. With none, both
              answers produce the same PDFs and there is nothing to ask. */}
          <AlertDialog open={asking} onOpenChange={(open) => { if (!open) setAsking(false) }}>
            <AlertDialogContent data-testid="generate-template-dialog">
              <AlertDialogHeader>
                <AlertDialogTitle>
                  {unanswered.length === 1
                    ? `Your data says nothing about "${unanswered[0]}".`
                    : `Your data says nothing about ${unanswered.length} of the boxes you filled in.`}
                </AlertDialogTitle>
                <AlertDialogDescription>
                  {`${unanswered.slice(0, 6).join(', ')}${unanswered.length > 6 ? `, and ${unanswered.length - 6} more` : ''}. ` +
                    'Print what you typed into them on every PDF, or leave them blank and fill them from the data alone?'}
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel
                  data-testid="generate-leave-blank"
                  onClick={() => { setAsking(false); void submit(false) }}
                >
                  Leave them blank
                </AlertDialogCancel>
                <AlertDialogAction
                  data-testid="generate-keep-typed"
                  onClick={() => { setAsking(false); void submit(true) }}
                >
                  Print what I typed
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
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
