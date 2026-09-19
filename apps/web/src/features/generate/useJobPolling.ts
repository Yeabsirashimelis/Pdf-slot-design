'use client'
import { useEffect, useState } from 'react'
import type { JobStatus } from '@pdf-slot/contracts'
import { fetchJob } from './jobsClient'

const INTERVAL_MS = 2000

/** Polls a job every 2 s until it is done or failed. */
export function useJobPolling(apiUrl: string, jobId: string | null): JobStatus | null {
  const [job, setJob] = useState<JobStatus | null>(null)
  useEffect(() => {
    if (!jobId) return
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | null = null
    const tick = async () => {
      const next = await fetchJob(apiUrl, jobId)
      if (cancelled) return
      if (next) setJob(next)
      if (!next || next.status === 'queued' || next.status === 'running') timer = setTimeout(() => void tick(), INTERVAL_MS)
    }
    void tick()
    return () => { cancelled = true; if (timer) clearTimeout(timer) }
  }, [apiUrl, jobId])
  return jobId ? job : null
}
