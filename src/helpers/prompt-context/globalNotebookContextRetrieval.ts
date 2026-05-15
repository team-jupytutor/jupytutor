import { buildAPIURL } from '../api/base-url';

export const STARTING_TEXTBOOK_CONTEXT: string = `
  The following information has been fetched from external sources representing resources that are potentially relevant to the assignment.
  Keep in mind, some are relevant to each particular question, some are not. You should attempt to cite sources when you use the source contents in your response, formatted as Markdown links. This should function to encourage student agency and help to not reveal answers directly.
`.trim();

export type ScrapeStatus = 'ready' | 'pending' | 'blocked' | 'failed';

export type ScrapeRef = {
  type: 'scrape_ref';
  url: string;
  status: ScrapeStatus;
  token?: string;
  message?: string;
};

export type ScrapeResources = Record<string, ScrapeRef>;

export interface ContextRetrievalConfig {
  sourceLinks?: string[];
  whitelistedURLs?: string[] | null;
  blacklistedURLs?: string[];
  enabled?: boolean;
  debug?: boolean;
}

const SOFT_TIMEOUT = 5000;
const INITIAL_POLL_DELAY = 3000;
const MAX_POLL_DELAY = 30000;

class GlobalNotebookContextRetrieval {
  private _sourceLinks: string[];
  private _resources: ScrapeResources | null = null;
  private _resolvePromise: Promise<void> | null = null;
  private _pollTimeout: ReturnType<typeof setTimeout> | null = null;
  private _pollDelay = INITIAL_POLL_DELAY;
  private _enabled: boolean;

  constructor({
    sourceLinks = [],
    whitelistedURLs = null,
    blacklistedURLs = [
      'data8.org',
      'berkeley.edu',
      'gradescope.com'
    ],
    enabled = true
  }: ContextRetrievalConfig = {}) {
    this._enabled = enabled;
    this._sourceLinks = this.filterLinks(
      Array.from(new Set(sourceLinks)),
      whitelistedURLs,
      blacklistedURLs
    );
  }

  async getResources(
    baseURL: string,
    enforcing: boolean = false
  ): Promise<ScrapeResources> {
    if (!this._enabled || this._sourceLinks.length === 0) {
      return {};
    }

    this.prefetch(baseURL);
    const resolvePromise = this._resolvePromise;
    if (!resolvePromise) {
      return this._resources ?? {};
    }

    if (!enforcing && this._resources) {
      return this._resources;
    }

    if (enforcing) {
      await resolvePromise;
    } else {
      await Promise.race([
        resolvePromise,
        new Promise<void>(resolve => setTimeout(resolve, SOFT_TIMEOUT))
      ]);
    }

    return this._resources ?? {};
  }

  async getSourceLinks(): Promise<string[]> {
    return this._sourceLinks;
  }

  prefetch(baseURL: string): void {
    if (!this._enabled || this._sourceLinks.length === 0 || !baseURL) {
      return;
    }

    this.ensureResolveStarted(baseURL);
  }

  private ensureResolveStarted(baseURL: string): void {
    if (this._resolvePromise) return;
    this._resolvePromise = this.resolve(baseURL);
  }

  private async resolve(baseURL: string): Promise<void> {
    try {
      const response = await fetch(buildAPIURL(baseURL, 'scrapes/resolve'), {
        method: 'POST',
        body: JSON.stringify({ urls: this._sourceLinks }),
        headers: {
          'Content-Type': 'application/json'
        },
        mode: 'cors',
        credentials: 'include',
        cache: 'no-cache'
      });

      if (!response.ok) {
        throw new Error(`Scrape resolve failed with status ${response.status}`);
      }

      const payload = (await response.json()) as { resources?: ScrapeResources };
      this._resources = payload.resources ?? {};
      this.schedulePendingRetry(baseURL);
    } catch (error) {
      console.warn('Failed to resolve scrape refs:', error);
      this._resources = this._resources ?? {};
    } finally {
      this._resolvePromise = null;
    }
  }

  private schedulePendingRetry(baseURL: string): void {
    const hasPending = Object.values(this._resources ?? {}).some(
      ref => ref.status === 'pending'
    );
    if (!hasPending) {
      this._pollDelay = INITIAL_POLL_DELAY;
      if (this._pollTimeout) {
        clearTimeout(this._pollTimeout);
        this._pollTimeout = null;
      }
      return;
    }

    if (this._pollTimeout) {
      return;
    }

    const delay = this._pollDelay;
    this._pollDelay = Math.min(this._pollDelay * 2, MAX_POLL_DELAY);
    this._pollTimeout = setTimeout(() => {
      this._pollTimeout = null;
      if (!this._resolvePromise) {
        this._resolvePromise = this.resolve(baseURL);
      }
    }, delay);
  }

  private filterLinks(
    links: string[],
    whitelistedURLs: string[] | null,
    blacklistedURLs: string[]
  ): string[] {
    const isBlacklisted = (url: string) =>
      blacklistedURLs.some(blacklistedURL => url.includes(blacklistedURL));
    const isWhitelisted = (url: string) =>
      (whitelistedURLs ?? []).some(whitelistedURL =>
        url.includes(whitelistedURL)
      );

    if (whitelistedURLs && whitelistedURLs.length > 0) {
      return links.filter(url => isWhitelisted(url));
    }

    return links.filter(url => !isBlacklisted(url));
  }
}

export default GlobalNotebookContextRetrieval;
