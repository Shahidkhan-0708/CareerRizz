import { z } from 'zod';

/**
 * Expected JSON output schema for hard technical keywords.
 */
export const ExtractedKeywordsSchema = z.object({
  languages: z.array(z.string()).default([]),
  frameworks: z.array(z.string()).default([]),
  databases: z.array(z.string()).default([]),
  infrastructure: z.array(z.string()).default([]),
  min_years_experience: z.number().int().nonnegative().default(0),
});

/**
 * Strips raw HTML tags, inline styles, script blocks, and HTML entities.
 * @param {string} html
 * @returns {string}
 */
export function sanitizeRawHtml(html) {
  if (!html) return '';

  return html
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, ' ')
    .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, ' ')
    .replace(/<noscript\b[^<]*(?:(?!<\/noscript>)<[^<]*)*<\/noscript>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Fallback heuristic extractor when LLM parsing fails or service is unavailable.
 * @param {string} cleanText
 */
export function fallbackHeuristicExtract(cleanText) {
  const lower = cleanText.toLowerCase();

  const langPatterns = ['typescript', 'javascript', 'python', 'golang', 'go', 'java', 'c\\+\\+', 'rust', 'ruby', 'c#', 'php', 'swift', 'kotlin', 'sql'];
  const fwPatterns = ['react', 'next\\.js', 'vue', 'angular', 'express', 'fastapi', 'django', 'spring', 'flask', 'nest\\.js', 'node\\.js', 'tailwind'];
  const dbPatterns = ['postgresql', 'postgres', 'mysql', 'mongodb', 'redis', 'elasticsearch', 'dynamodb', 'sqlite', 'cassandra', 'supabase', 'snowflake'];
  const infraPatterns = ['docker', 'kubernetes', 'k8s', 'aws', 'gcp', 'azure', 'terraform', 'ci/cd', 'github actions', 'linux', 'kafka', 'bullmq'];

  const matchKeywords = (patterns) =>
    patterns
      .filter((pat) => new RegExp(`\\b${pat}\\b`, 'i').test(lower))
      .map((k) => k.replace(/\\/g, ''));

  // Detect min years of experience: "3+ years", "minimum 5 years"
  let minYears = 0;
  const expMatch = cleanText.match(/(\d+)\s*\+?\s*(?:-\s*\d+)?\s*(?:years|yrs)\s+(?:of\s+)?experience/i);
  if (expMatch && expMatch[1]) {
    minYears = parseInt(expMatch[1], 10);
  }

  return {
    languages: matchKeywords(langPatterns),
    frameworks: matchKeywords(fwPatterns),
    databases: matchKeywords(dbPatterns),
    infrastructure: matchKeywords(infraPatterns),
    min_years_experience: minYears,
  };
}

/**
 * Calls Gemini / OpenAI / Groq API to extract hard engineering concepts.
 * @param {string} rawHtml
 * @param {Object} options
 */
export async function extractTechnicalKeywords(rawHtml, options = {}) {
  const sanitizedText = sanitizeRawHtml(rawHtml);
  if (!sanitizedText || sanitizedText.length < 30) {
    throw new Error('Sanitized HTML is empty or insufficient for technical extraction.');
  }

  const apiKey = options.apiKey || process.env.GEMINI_API_KEY || process.env.OPENAI_API_KEY || process.env.GROQ_API_KEY;

  if (!apiKey) {
    console.warn('[keyword-extractor] No LLM API key provided; routing to secondary fallback pipeline.');
    return fallbackHeuristicExtract(sanitizedText);
  }

  const systemPrompt = `You are a strict technical parser. Extract only hard technical concepts. Do not include adjectives, soft skills, or marketing text. 
Return strictly valid JSON conforming to this schema:
{
  "languages": ["TypeScript", "Python"],
  "frameworks": ["FastAPI", "React", "Express"],
  "databases": ["PostgreSQL", "Redis"],
  "infrastructure": ["Docker", "AWS"],
  "min_years_experience": 2
}`;

  const userPrompt = `Job description excerpt:\n${sanitizedText.slice(0, 5000)}`;

  try {
    let rawContent = '';

    // Handle Gemini endpoint if GEMINI_API_KEY is present
    if (process.env.GEMINI_API_KEY || options.apiKey?.startsWith('AIza')) {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${options.model || 'gemini-1.5-flash'}:generateContent?key=${apiKey}`;
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: `${systemPrompt}\n\n${userPrompt}` }] }],
          generationConfig: {
            temperature: 0.1,
            responseMimeType: 'application/json',
          },
        }),
      });

      if (!res.ok) {
        throw new Error(`Gemini API returned status ${res.status}`);
      }
      const data = await res.json();
      rawContent = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
    } else {
      // Standard OpenAI / Groq compatible endpoint
      const baseUrl = options.baseUrl || (process.env.GROQ_API_KEY ? 'https://api.groq.com/openai/v1' : 'https://api.openai.com/v1');
      const model = options.model || (process.env.GROQ_API_KEY ? 'llama-3.1-8b-instant' : 'gpt-4o-mini');

      const res = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt },
          ],
          response_format: { type: 'json_object' },
          temperature: 0.1,
        }),
      });

      if (!res.ok) {
        throw new Error(`LLM API returned status ${res.status}`);
      }
      const data = await res.json();
      rawContent = data?.choices?.[0]?.message?.content || '';
    }

    // Extract JSON block if surrounded by markdown code fences
    const cleanJson = rawContent.replace(/```json\n?|\n?```/g, '').trim();
    const parsed = JSON.parse(cleanJson);

    // Validate strictly against schema
    const validated = ExtractedKeywordsSchema.safeParse(parsed);
    if (!validated.success) {
      console.warn('[keyword-extractor] JSON schema mismatch, routing to secondary fallback pipeline:', validated.error);
      return fallbackHeuristicExtract(sanitizedText);
    }

    return validated.data;
  } catch (err) {
    console.warn('[keyword-extractor] Parsing failed, dropping payload into fallback pipeline:', err.message);
    return fallbackHeuristicExtract(sanitizedText);
  }
}
