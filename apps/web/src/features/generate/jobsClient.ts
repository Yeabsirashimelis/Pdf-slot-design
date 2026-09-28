import { jobStatusSchema, type JobStatus } from '@pdf-slot/contracts'

const base = (apiUrl: string) => apiUrl.replace(/\/$/, '')

export async function createJob(apiUrl: string, fileId: string, records: Record<string, string>[], apiKey: string): Promise<{ jobId: string } | { error: string }> {
  try {
    const res = await fetch(`${base(apiUrl)}/files/${fileId}/jobs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ records }),
    })
    const body = (await res.json()) as { jobId?: unknown; error?: { message?: string } }
    if (!res.ok) return { error: res.status === 401 ? 'The API key was refused' : body.error?.message ?? `Request failed (${res.status})` }
    // A 2xx is not proof of a job: a proxy or a drifted server can answer 202 with some other body,
    // and polling `/jobs/undefined` would spin until the user gave up.
    if (typeof body.jobId !== 'string' || body.jobId === '') return { error: 'The server did not return a job id' }
    return { jobId: body.jobId }
  } catch {
    return { error: 'The API is unreachable' }
  }
}

export async function fetchJob(apiUrl: string, jobId: string): Promise<JobStatus | null> {
  try {
    const res = await fetch(`${base(apiUrl)}/jobs/${jobId}`)
    if (!res.ok) return null
    return jobStatusSchema.parse(await res.json())
  } catch {
    return null
  }
}

export const zipUrl = (apiUrl: string, jobId: string) => `${base(apiUrl)}/jobs/${jobId}/zip`
