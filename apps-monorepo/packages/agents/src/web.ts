/**
 * Web research fetchers (architecture doc §6 ResearchTools.searchWeb /
 * searchCompanyInfo). Free, keyless sources only — mirrors the proven
 * fetchers from the outreach platform's research.service.js:
 *   - Wikipedia search + plain-text intro extract
 *   - DuckDuckGo Instant Answer (news/fallback)
 *
 * Every fetch is timeout-guarded and returns [] / null on failure so a
 * single flaky source degrades gracefully instead of failing the agent run.
 */

const TIMEOUT_MS = 8_000;
const WIKIPEDIA_API = 'https://en.wikipedia.org/w/api.php';
const DDG_API = 'https://api.duckduckgo.com/';

export interface WebFact {
  topic: 'company_overview' | 'tech_stack' | 'funding' | 'news';
  content: string;
  source: string;
  /** Heuristic source reliability in [0,1]. */
  confidence: number;
}

async function fetchWithTimeout(url: string, timeoutMs = TIMEOUT_MS): Promise<Response | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal });
    return res.ok ? res : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Wikipedia full-text search → top hits with snippets (HTML-stripped). */
export async function searchWikipedia(query: string, limit = 3): Promise<Array<{ title: string; snippet: string }>> {
  const params = new URLSearchParams({
    action: 'query',
    list: 'search',
    srsearch: query,
    srlimit: String(limit),
    format: 'json',
    origin: '*',
  });
  const res = await fetchWithTimeout(`${WIKIPEDIA_API}?${params}`);
  if (!res) return [];
  const body = (await res.json()) as { query?: { search?: Array<{ title: string; snippet?: string }> } };
  return (body.query?.search ?? []).map((hit) => ({
    title: hit.title,
    snippet: stripHtml(hit.snippet ?? ''),
  }));
}

/** Wikipedia plain-text intro extract for an exact article title. */
export async function fetchWikipediaExtract(title: string): Promise<string | null> {
  const params = new URLSearchParams({
    action: 'query',
    prop: 'extracts',
    exintro: '1',
    explaintext: '1',
    titles: title,
    format: 'json',
    origin: '*',
  });
  const res = await fetchWithTimeout(`${WIKIPEDIA_API}?${params}`);
  if (!res) return null;
  const body = (await res.json()) as { query?: { pages?: Record<string, { extract?: string }> } };
  const page = Object.values(body.query?.pages ?? {})[0];
  return page?.extract ?? null;
}

/** DuckDuckGo Instant Answer related topics — light news/fallback signal. */
export async function searchDuckDuckGo(query: string, limit = 3): Promise<Array<{ text: string; url: string }>> {
  const params = new URLSearchParams({
    q: query,
    format: 'json',
    no_html: '1',
    skip_disambig: '1',
  });
  const res = await fetchWithTimeout(`${DDG_API}?${params}`);
  if (!res) return [];
  const body = (await res.json()) as {
    AbstractText?: string;
    AbstractURL?: string;
    RelatedTopics?: Array<{ Text?: string; FirstURL?: string; Topics?: Array<{ Text?: string; FirstURL?: string }> }>;
  };
  const flat = [
    ...(body.AbstractText && body.AbstractURL ? [{ text: body.AbstractText, url: body.AbstractURL }] : []),
    ...(body.RelatedTopics ?? []).flatMap((t) =>
      t.Topics?.length ? t.Topics.map((s) => ({ text: s.Text ?? '', url: s.FirstURL ?? '' })) : [{ text: t.Text ?? '', url: t.FirstURL ?? '' }],
    ),
  ];
  return flat.filter((t) => t.text && t.url).slice(0, limit);
}

/** Gather raw web facts about a company for the research agent to synthesize. */
export async function gatherCompanyFacts(company: string, jobTitle: string): Promise<WebFact[]> {
  const facts: WebFact[] = [];
  const query = `${company} ${jobTitle}`;

  // 1. Wikipedia: overview + longer extract of the best hit
  const hits = await searchWikipedia(company, 2);
  const best = hits[0];
  if (best) {
    const extract = await fetchWikipediaExtract(best.title);
    if (extract) {
      facts.push({
        topic: 'company_overview',
        content: extract.slice(0, 1200),
        source: `https://en.wikipedia.org/wiki/${encodeURIComponent(best.title.replace(/ /g, '_'))}`,
        confidence: 0.85,
      });
    } else if (best.snippet) {
      facts.push({
        topic: 'company_overview',
        content: best.snippet,
        source: `https://en.wikipedia.org/wiki/${encodeURIComponent(best.title.replace(/ /g, '_'))}`,
        confidence: 0.6,
      });
    }
  }

  // 2. DDG instant answer: role/company news signals
  const ddg = await searchDuckDuckGo(query, 3);
  for (const item of ddg) {
    facts.push({
      topic: 'news',
      content: item.text.slice(0, 500),
      source: item.url,
      confidence: 0.55,
    });
  }

  return facts;
}

function stripHtml(s: string): string {
  return String(s ?? '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
