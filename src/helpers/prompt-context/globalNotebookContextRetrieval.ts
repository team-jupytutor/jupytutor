import { convert } from 'html-to-text';
import { devLog } from '../devLog';

// ADD INSTRUCTION FOR USING LINK + CONTEXT TO SOLVE THE ASSIGNMENT
// add into context
// export const STARTING_TEXTBOOK_CONTEXT: string =
//   'The following input is an aggregation of potentially relevant resources to the assignment.\n\n Keep in mind, some are relevant to each particular question, some are not. Each different source is started with its url surrounded by the tokens [LINK] and [/LINK] (e.g. [LINK]https://www.data8.org/[LINK]). Only when completely relevant and necessary, you should attempt to cite these source labels when you use the source contents in your response, formatted as link HTML tags. This should function to encourage student agency and help to not reveal answers directly.';
// Formatting instructions temporarily pre-pended here for backward compatibility.
export const STARTING_TEXTBOOK_CONTEXT: string = `
IMPORTANT - Response Formatting:
- Use markdown headers (## for h2, ### for h3) for ALL section titles if needed for clarity.
- Always add blank lines before and after headers
- Use proper markdown link syntax: [Link Text](URL), NOT <a> or [LINK] tags.
- Use **bold** or *italic* sparingly and only for emphasis within text (NOT for section headers)
The following input after this is an aggregation of potentially relevant resources to the assignment.
Keep in mind, some are relevant to each particular question, some are not. You should attempt to cite sources when you use the source contents in your response, formatted as Markdown links. This should function to encourage student agency and help to not reveal answers directly.
`;

/**
 * Configuration interface for ContextRetrieval constructor
 */
export interface ContextRetrievalConfig {
  sourceLinks?: string[];
  whitelistedURLs?: string[] | null;
  blacklistedURLs?: string[];
  jupyterbookURLs?: string[];
  attemptJupyterbookLinkExpansion?: boolean;
  debug?: boolean;
}

// Permit the plugin to start working before context is collected, if it takes longer than
// this amount of time. It'll keep running context collection in the background, if it takes
// longer.
const SOFT_TIMEOUT = 5000;

/**
 * Class to retrieve context for the assignment
 *
 * Assignments typically link the resources at the top, but retrieving these resources will be seen as a different step PotentialContextGathering.
 *
 * Possible URL types are:
 *  - standard page: need a best attempt to mine the body text and ignore the rest
 *  - textfile: need to extract the text
 *  - jupyter book page: need to extract text potentially with the _source prefix as a url transform
 *
 * Jupyterbook urls are expanded to include the whole subsection. If it's a subsection, the order is [subsection, main, other subsections in order]
 */
class GlobalNotebookContextRetrieval {
  private _context: string | null;
  private _loadedPromise: Promise<void>;
  private _softTimeoutPromise: Promise<void>;
  private _sourceLinks: string[];
  private _blacklistedURLs: string[];
  private _whitelistedURLs: string[];

  // TODO: WHITELIST
  constructor({
    sourceLinks = [],
    whitelistedURLs = null,
    blacklistedURLs = [
      'data8.org', // Includes references, policies, schedule, etc.
      'berkeley.edu', // Includes map, etc.
      'gradescope.com'
    ],
    jupyterbookURLs = [],
    attemptJupyterbookLinkExpansion = false,
    debug = false
  }: ContextRetrievalConfig = {}) {
    this._context = null;
    this._sourceLinks = sourceLinks;
    this._blacklistedURLs = blacklistedURLs;
    this._whitelistedURLs = whitelistedURLs ?? [];
    this._loadedPromise = (async () => {
      if (!debug) {
        if (attemptJupyterbookLinkExpansion) {
          await this._expandJupyterBookLinksAsync(jupyterbookURLs ?? []);
        }

        this.scrapeSourceLinks();
      }
    })();
    this._softTimeoutPromise = Promise.race([
      this._loadedPromise,
      new Promise<void>(resolve => setTimeout(resolve, SOFT_TIMEOUT))
    ]);
  }

  async scrapeSourceLinks(): Promise<void> {
    if (this._sourceLinks.length === 0) {
      this._context = null;
      return;
    }

    const isBlacklisted = (url: string) =>
      this._blacklistedURLs.some(blacklistedURL =>
        url.includes(blacklistedURL)
      );
    const isWhitelisted = (url: string) =>
      this._whitelistedURLs.some(whitelistedURL =>
        url.includes(whitelistedURL)
      );
    if (this._whitelistedURLs.length > 0) {
      this._sourceLinks = this._sourceLinks.filter(url => isWhitelisted(url));
    }
    if (this._blacklistedURLs.length > 0) {
      this._sourceLinks = this._sourceLinks.filter(url => !isBlacklisted(url));
    }
    const scrapedTexts = (
      await Promise.all(
        this._sourceLinks.map(async url => {
          return await scrapePageText(url);
        })
      )
    )
      .filter(text => text !== null)
      .join('\n\n');
    this._context = scrapedTexts ? scrapedTexts : '';
    if (this._context === '') {
      this._context = null;
    }
  }

  async getContext(enforcing: boolean = false): Promise<string | null> {
    if (enforcing) {
      await this._loadedPromise;
    } else {
      await this._softTimeoutPromise;
    }

    if (this._context === null) {
      console.warn('Context does not lead to any detected resource text.');
      return null;
    }
    return this._context;
  }

  async getSourceLinks(enforcing: boolean = false): Promise<string[]> {
    if (enforcing) {
      await this._loadedPromise;
    } else {
      await this._softTimeoutPromise;
    }

    return this._sourceLinks;
  }

  /**
   * Helper method to handle async JupyterBook link expansion
   * @param jupyterbookURL - the base domain for the JupyterBook
   */
  private async _expandJupyterBookLinksAsync(
    jupyterbookURLs: string[]
  ): Promise<void> {
    try {
      this._sourceLinks = await this.expandJupyterBookLinks(
        this._sourceLinks,
        jupyterbookURLs
      );
    } catch (error) {
      console.warn('Failed to expand JupyterBook links:', error);
    }
  }

  /**
   * Expand JupyterBook URLs by finding all links within the same chapter/section
   * @param sourceLinks - array of source URLs
   * @param jupyterbookURL - the base domain for the JupyterBook
   * @returns expanded array of URLs with additional chapter/section links
   */
  private async expandJupyterBookLinks(
    sourceLinks: string[],
    jupyterbookURLs: string[]
  ): Promise<string[]> {
    // Find URLs that belong to the JupyterBook domain
    const jupyterBookUrls = sourceLinks.filter(url =>
      jupyterbookURLs.some(jupyterbookURL => url.includes(jupyterbookURL))
    );

    // For each JupyterBook URL, find all internal links
    const linkPromises = jupyterBookUrls.map(async url => {
      try {
        const jupyterbookURL = jupyterbookURLs.find(jupyterbookURL =>
          url.includes(jupyterbookURL)
        );
        if (jupyterbookURL) {
          return await this.findJupyterBookLinks(url, jupyterbookURL);
        }
        return [];
      } catch (error) {
        console.warn(`Failed to expand links for ${url}:`, error);
        return [];
      }
    });

    // Wait for all link discovery to complete
    const allLinks = await Promise.all(linkPromises);

    // Build the final result by inserting expanded links after each original JupyterBook link
    const result: string[] = [];
    const seenUrls = new Set<string>();
    let jupyterBookIndex = 0;

    for (let i = 0; i < sourceLinks.length; i++) {
      const originalLink = sourceLinks[i];

      if (
        jupyterbookURLs.some(jupyterbookURL =>
          originalLink.includes(jupyterbookURL)
        )
      ) {
        // This is a JupyterBook link - add it and its expansions
        const normalizedOriginalLink = this.normalizeUrl(originalLink);
        if (!seenUrls.has(normalizedOriginalLink)) {
          result.push(originalLink);
          seenUrls.add(normalizedOriginalLink);
        }

        // Add the expanded links for this JupyterBook URL
        const expandedLinksForThisUrl = allLinks[jupyterBookIndex] || [];
        const uniqueExpandedLinks = expandedLinksForThisUrl.filter(link => {
          const normalizedLink = this.normalizeUrl(link);
          return (
            normalizedLink !== normalizedOriginalLink &&
            !seenUrls.has(normalizedLink)
          );
        });

        // Sort the expanded links: main chapter first, then subsections in order
        uniqueExpandedLinks.sort((a, b) => {
          const aPath = new URL(a).pathname;
          const bPath = new URL(b).pathname;

          // Extract chapter and subsection numbers
          const aMatch = aPath.match(/\/chapters\/(\d+)(?:\/(\d+))?/);
          const bMatch = bPath.match(/\/chapters\/(\d+)(?:\/(\d+))?/);

          if (aMatch && bMatch) {
            const aChapter = parseInt(aMatch[1]);
            const bChapter = parseInt(bMatch[1]);
            const aSubsection = aMatch[2] ? parseInt(aMatch[2]) : 0; // 0 for main chapter
            const bSubsection = bMatch[2] ? parseInt(bMatch[2]) : 0;

            // First sort by chapter
            if (aChapter !== bChapter) {
              return aChapter - bChapter;
            }

            // Then sort by subsection (0 = main chapter comes first)
            return aSubsection - bSubsection;
          }

          // Fallback to alphabetical
          return aPath.localeCompare(bPath);
        });

        // Add unique expanded links and track them in seenUrls
        for (const link of uniqueExpandedLinks) {
          const normalizedLink = this.normalizeUrl(link);
          if (!seenUrls.has(normalizedLink)) {
            result.push(link);
            seenUrls.add(normalizedLink);
          }
        }
        jupyterBookIndex++;
      } else {
        // This is a non-JupyterBook link - add it as-is if not already seen
        const normalizedLink = this.normalizeUrl(originalLink);
        if (!seenUrls.has(normalizedLink)) {
          result.push(originalLink);
          seenUrls.add(normalizedLink);
        }
      }
    }

    return result;
  }

  /**
   * Normalize a URL by removing hash fragments, trailing slashes, and other variations
   * @param url - the URL to normalize
   * @returns normalized URL
   */
  private normalizeUrl(url: string): string {
    try {
      const urlObj = new URL(url);
      // Remove hash fragment
      urlObj.hash = '';
      // Remove trailing slash from pathname (except for root)
      if (urlObj.pathname.length > 1 && urlObj.pathname.endsWith('/')) {
        urlObj.pathname = urlObj.pathname.slice(0, -1);
      }
      return urlObj.href;
    } catch (error) {
      // If URL parsing fails, return the original URL
      return url;
    }
  }

  /**
   * Find all chapter/section links within a JupyterBook page using regex parsing
   * @param pageUrl - the URL of the JupyterBook page
   * @param jupyterbookURL - the base domain for the JupyterBook
   * @returns array of chapter/section links found on the page
   */
  private async findJupyterBookLinks(
    pageUrl: string,
    jupyterbookURL: string
  ): Promise<string[]> {
    try {
      const response = await fetch(pageUrl);

      if (!response.ok) {
        return [];
      }

      const html = await response.text();
      const links: string[] = [];

      // Extract chapter number from the current URL to find related sections
      const currentPath = new URL(pageUrl).pathname;
      const chapterMatch = currentPath.match(/\/chapters\/(\d+)/);
      const subsectionMatch = currentPath.match(/\/chapters\/(\d+)\/(\d+)/);

      let targetChapter: string | null = null;
      let targetSubsection: string | null = null;

      if (subsectionMatch) {
        // We're in a subsection, get both chapter and subsection
        targetChapter = subsectionMatch[1];
        targetSubsection = subsectionMatch[2];
      } else if (chapterMatch) {
        // We're in a chapter, get just the chapter
        targetChapter = chapterMatch[1];
      }

      // Use regex to find all anchor tags with href attributes
      const linkRegex = /<a[^>]+href\s*=\s*["']([^"']+)["'][^>]*>/gi;
      let match: RegExpExecArray | null;

      while ((match = linkRegex.exec(html)) !== null) {
        const href = match[1];
        if (!href) continue;

        // Filter out unwanted links
        if (
          href.includes('.ipynb') ||
          href.includes('mybinder') ||
          href.includes('datahub') ||
          href.includes('_sources') ||
          href.includes('_static') ||
          href.includes('_images')
        ) {
          continue;
        }

        let fullUrl: string;

        // Handle relative URLs
        if (href.startsWith('/')) {
          fullUrl = new URL(href, pageUrl).href;
        } else if (href.startsWith('http')) {
          fullUrl = href;
        } else {
          // Relative path
          fullUrl = new URL(href, pageUrl).href;
        }

        // Only include links from the same JupyterBook domain
        if (fullUrl.includes(jupyterbookURL)) {
          // Normalize the URL to remove hash fragments and other variations
          const normalizedUrl = this.normalizeUrl(fullUrl);
          const pathname = new URL(normalizedUrl).pathname;

          // Check if this is a chapter/section link
          const isChapterSectionLink = this.isChapterSectionLink(
            pathname,
            targetChapter,
            targetSubsection
          );

          if (isChapterSectionLink) {
            links.push(normalizedUrl);
          }
        }
      }

      // Remove duplicates
      const uniqueLinks = [...new Set(links)];

      // Sort the links to maintain proper order
      return this.sortChapterSectionLinks(
        uniqueLinks,
        targetChapter,
        targetSubsection
      );
    } catch (error) {
      console.warn(`Error finding JupyterBook links for ${pageUrl}:`, error);
      return [];
    }
  }

  /**
   * Check if a pathname represents a chapter or section link
   * @param pathname - the pathname to check
   * @param targetChapter - the target chapter number
   * @param targetSubsection - the target subsection number (if any)
   * @returns whether this is a relevant chapter/section link
   */
  private isChapterSectionLink(
    pathname: string,
    targetChapter: string | null,
    targetSubsection: string | null
  ): boolean {
    // Must be a content page, not a resource
    if (
      pathname.includes('/_sources/') ||
      pathname.includes('/_static/') ||
      pathname.includes('/_images/') ||
      pathname.endsWith('.ipynb') ||
      pathname.endsWith('.pdf') ||
      pathname.endsWith('.zip') ||
      pathname.endsWith('.tar.gz')
    ) {
      return false;
    }

    // Must be a chapters path
    if (!pathname.includes('/chapters/')) {
      return false;
    }

    // Extract chapter and subsection numbers from the path
    const chapterMatch = pathname.match(/\/chapters\/(\d+)/);
    // const subsectionMatch = pathname.match(/\/chapters\/(\d+)\/(\d+)/);

    if (targetSubsection) {
      // We're in a subsection, so we want:
      // 1. The main chapter page
      // 2. All subsections of the same chapter
      if (chapterMatch) {
        const linkChapter = chapterMatch[1];
        if (linkChapter === targetChapter) {
          return true; // Same chapter
        }
      }
    } else if (targetChapter) {
      // We're in a chapter, so we want:
      // 1. The main chapter page
      // 2. All subsections of the same chapter
      if (chapterMatch) {
        const linkChapter = chapterMatch[1];
        if (linkChapter === targetChapter) {
          return true; // Same chapter
        }
      }
    }

    return false;
  }

  /**
   * Sort chapter/section links in proper order
   * @param links - array of links to sort
   * @param targetChapter - the target chapter number
   * @param targetSubsection - the target subsection number (if any)
   * @returns sorted array of links
   */
  private sortChapterSectionLinks(
    links: string[],
    targetChapter: string | null,
    targetSubsection: string | null
  ): string[] {
    return links.sort((a, b) => {
      const aPath = new URL(a).pathname;
      const bPath = new URL(b).pathname;

      // Extract chapter and subsection numbers for comparison
      const aChapterMatch = aPath.match(/\/chapters\/(\d+)/);
      const aSubsectionMatch = aPath.match(/\/chapters\/(\d+)\/(\d+)/);
      const bChapterMatch = bPath.match(/\/chapters\/(\d+)/);
      const bSubsectionMatch = bPath.match(/\/chapters\/(\d+)\/(\d+)/);

      const aChapter = aChapterMatch ? parseInt(aChapterMatch[1]) : 0;
      const aSubsection = aSubsectionMatch ? parseInt(aSubsectionMatch[2]) : 0;
      const bChapter = bChapterMatch ? parseInt(bChapterMatch[1]) : 0;
      const bSubsection = bSubsectionMatch ? parseInt(bSubsectionMatch[2]) : 0;

      // First sort by chapter
      if (aChapter !== bChapter) {
        return aChapter - bChapter;
      }

      // Then sort by subsection (0 means main chapter page)
      if (aSubsection !== bSubsection) {
        return aSubsection - bSubsection;
      }

      // Finally sort alphabetically by pathname
      return aPath.localeCompare(bPath);
    });
  }
}

/**
 * Extract text content from HTML string using html-to-text library
 * @param html - the HTML content to parse
 * @returns formatted text content
 */
const extractTextFromHTML = async (html: string): Promise<string> => {
  try {
    // Use html-to-text library for robust text extraction
    const text = convert(html, {
      wordwrap: false,
      selectors: [
        { selector: 'script', format: 'skip' },
        { selector: 'style', format: 'skip' },
        { selector: 'nav', format: 'skip' },
        { selector: 'header', format: 'skip' },
        { selector: 'footer', format: 'skip' },
        { selector: 'aside', format: 'skip' },
        { selector: '.navbar', format: 'skip' },
        { selector: '.navigation', format: 'skip' },
        { selector: '.sidebar', format: 'skip' },
        { selector: '.toc', format: 'skip' },
        { selector: '.table-of-contents', format: 'skip' },
        { selector: '.breadcrumb', format: 'skip' },
        { selector: '.pagination', format: 'skip' },
        { selector: '.social-share', format: 'skip' },
        { selector: '.comments', format: 'skip' },
        { selector: '.advertisement', format: 'skip' },
        { selector: '.ads', format: 'skip' },
        { selector: '.ad', format: 'skip' },
        { selector: '.sponsor', format: 'skip' },
        { selector: '.menu', format: 'skip' },
        { selector: '.navigation-menu', format: 'skip' },
        { selector: '.site-header', format: 'skip' },
        { selector: '.site-footer', format: 'skip' }
      ],
      // Focus on main content areas
      baseElements: {
        selectors: ['main', '.main-content', '#main', '.content', 'body']
      }
    });

    return text;
  } catch (error) {
    console.warn('Error converting HTML to text:', error);
    return html;
  }
};

/**
 * Scrape the text of a page
 * @param pageUrl - the url of the page to scrape
 * @param transformURL - a function to transform the url if needed
 *
 * @returns the formatted text of the page or null if the page is not found
 */
const scrapePageText = async (
  pageUrl: string,
  transformURL: (url: string) => string = url => url
): Promise<string | null> => {
  try {
    const response = await fetch(transformURL(pageUrl));

    if (!response.ok) {
      if (response.status === 404) {
        return null;
      }
      devLog(() => `HTTP ${response.status}: ${response.statusText}`);
      return null;
    }

    const html = await response.text();

    // Extract text using robust html-to-text library
    const pageText = await extractTextFromHTML(html);
    return `[LINK] ${pageUrl} [/LINK]\n${pageText}`;
  } catch (error) {
    if (
      error instanceof Error &&
      (error.message.includes('404') || error.message.includes('Not Found'))
    ) {
      return null;
    }
    console.error(`Error scraping page text: ${error}`);
    return null;
  }
};

export default GlobalNotebookContextRetrieval;
