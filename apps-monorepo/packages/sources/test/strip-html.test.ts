import { describe, it, expect } from 'vitest';
import { stripHtml } from '../src/normalizer.js';

describe('stripHtml (double-escape regression)', () => {
  it('decodes single-escaped HTML then strips tags', () => {
    expect(stripHtml('<p>Hello &amp; welcome</p>')).toBe('Hello & welcome');
  });

  it('decodes double-escaped Greenhouse-style content', () => {
    const doubleEscaped = '&lt;div class=&quot;content-intro&quot;&gt;&lt;h2&gt;About Vercel:&lt;/h2&gt; We build AI &amp;&amp; infra.&lt;/div&gt;';
    const out = stripHtml(doubleEscaped);
    expect(out).toContain('About Vercel:');
    expect(out).toContain('AI && infra');
    expect(out).not.toContain('<div');
    expect(out).not.toContain('&lt;');
    expect(out).not.toContain('&quot;');
  });

  it('handles script/style removal after decoding', () => {
    const out = stripHtml('<p>ok</p><script>bad()</script>');
    expect(out).toBe('ok');
    expect(out).not.toContain('bad()');
  });

  it('returns null for empty/null input', () => {
    expect(stripHtml(null)).toBeNull();
    expect(stripHtml('')).toBeNull();
  });
});
