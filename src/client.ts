import { validateApiConfig, type ApiConfig } from './config.js';
import { externalJobIdSchema, type CandidateQuery, type CreateJob, type JobLink, type UpdateJob } from './schemas.js';

export interface ApiResponse {
  httpStatus: number;
  data: Record<string, unknown>;
  retryAfter?: string;
}

export class JobzynRequestError extends Error {
  constructor(public readonly code: string, message: string, public readonly outcomeUnknown = false) {
    super(message);
    this.name = 'JobzynRequestError';
  }
}

const MAX_RESPONSE_BYTES = 10 * 1024 * 1024;

export class JobzynClient {
  private readonly config: ApiConfig;

  constructor(config: ApiConfig) {
    this.config = validateApiConfig(config);
  }

  private jobPath(id: string): string {
    return `job/${encodeURIComponent(externalJobIdSchema.parse(id))}`;
  }

  createJob(job: CreateJob, signal?: AbortSignal): Promise<ApiResponse> {
    return this.request('POST', 'job', { job }, undefined, signal);
  }

  updateJob(externalJobId: string, job: UpdateJob, signal?: AbortSignal): Promise<ApiResponse> {
    return this.request('PUT', this.jobPath(externalJobId), { job }, undefined, signal);
  }

  unpublishJob(externalJobId: string, signal?: AbortSignal): Promise<ApiResponse> {
    return this.request('DELETE', this.jobPath(externalJobId), undefined, undefined, signal);
  }

  getCandidates(externalJobId: string, query: CandidateQuery = {}, signal?: AbortSignal): Promise<ApiResponse> {
    return this.request('GET', `${this.jobPath(externalJobId)}/candidates`, undefined, query, signal);
  }

  linkExternalIds(links: JobLink[], signal?: AbortSignal): Promise<ApiResponse> {
    return this.request('POST', 'job/link', { links }, undefined, signal);
  }

  private async request(method: string, path: string, body?: unknown, query?: CandidateQuery, signal?: AbortSignal): Promise<ApiResponse> {
    const url = new URL(`${this.config.baseUrl}/${path}`);
    for (const [key, value] of Object.entries(query ?? {})) {
      if (value !== undefined) url.searchParams.set(key, String(value));
    }
    const timeout = AbortSignal.timeout(this.config.requestTimeoutMs);
    const combined = AbortSignal.any([timeout, ...(signal ? [signal] : [])]);
    const write = method !== 'GET';
    try {
      const response = await fetch(url, {
        method,
        headers: { 'x-api-key': this.config.apiKey, Accept: 'application/json', ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: combined,
        redirect: 'error',
      });
      const chunks: Uint8Array[] = [];
      let size = 0;
      const reader = response.body?.getReader();
      if (reader) {
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            size += value.byteLength;
            if (size > MAX_RESPONSE_BYTES) {
              await reader.cancel();
              throw new JobzynRequestError('RESPONSE_TOO_LARGE', 'JobZyn response exceeded 10 MiB. For candidates, use a smaller pageSize.', write);
            }
            chunks.push(value);
          }
        } finally { reader.releaseLock(); }
      }
      // Redact even if an upstream error happens to echo the credential.
      const raw = Buffer.concat(chunks).toString('utf8');
      let data: unknown;
      try { data = JSON.parse(raw); } catch {
        throw new JobzynRequestError('INVALID_RESPONSE', `JobZyn returned a non-JSON response (HTTP ${response.status}).`, write);
      }
      if (data === null || typeof data !== 'object' || Array.isArray(data)) {
        throw new JobzynRequestError('INVALID_RESPONSE', `JobZyn returned an unexpected response (HTTP ${response.status}).`, write);
      }
      const redacted = redact(data, this.config.apiKey) as Record<string, unknown>;
      const retryAfter = response.headers.get('retry-after');
      return { httpStatus: response.status, data: redacted, ...(retryAfter ? { retryAfter: retryAfter.split(this.config.apiKey).join('[REDACTED]') } : {}) };
    } catch (error) {
      if (error instanceof JobzynRequestError) throw error;
      if (signal?.aborted) throw new JobzynRequestError('CANCELLED', 'JobZyn request was cancelled.', write);
      if (timeout.aborted) throw new JobzynRequestError('TIMEOUT', 'JobZyn request timed out.', write);
      // Fetch errors may contain URLs, headers, or proxy details; keep them out of tool output.
      throw new JobzynRequestError('NETWORK_ERROR', 'Unable to complete the JobZyn request. Check connectivity and the configured API base URL. Redirects are not followed.', write);
    }
  }
}

function redact(value: unknown, apiKey: string): unknown {
  if (typeof value === 'string') return value.split(apiKey).join('[REDACTED]');
  if (Array.isArray(value)) return value.map(item => redact(item, apiKey));
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key.split(apiKey).join('[REDACTED]'), redact(item, apiKey)]));
  }
  return value;
}
