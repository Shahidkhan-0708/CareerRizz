import { config } from '../config/env.js';
import { logger } from '../utils/logger.js';

// ---------------------------------------------------------------------------
// LinkedIn enrichment via Apify actors (no cookies required).
//
// Actors used:
//   harvestapi/linkedin-profile-search-by-name  — find /in/ URLs from name + org
//   harvestapi/linkedin-profile-scraper         — full profile details from URL
//   harvestapi/linkedin-profile-posts           — recent posts from a profile URL
//
// All calls go through the Apify REST API with `run-sync-get-dataset-items`
// so the caller gets results in a single HTTP round-trip (with a generous
// timeout).  If the token is missing or the actor fails, callers fall back
// to the legacy OpenAlex / Wikipedia / DuckDuckGo pipeline.
// ---------------------------------------------------------------------------

const APIFY_BASE = 'https://api.apify.com/v2';
const SYNC_TIMEOUT_SECS = 120; // max wait for a sync actor run

// Actor IDs (Apify "owner~name" format)
const ACTOR_SEARCH_BY_NAME = 'harvestapi~linkedin-profile-search-by-name';
const ACTOR_SEARCH_FUZZY   = 'harvestapi~linkedin-profile-search';   // school / keyword search (no name required)
const ACTOR_PROFILE_SCRAPER = 'harvestapi~linkedin-profile-scraper';
const ACTOR_PROFILE_POSTS   = 'harvestapi~linkedin-profile-posts';

function hasToken() {
  return Boolean(config.apify?.token);
}

// ---- low-level helpers -----------------------------------------------------

async function fetchWithTimeout(url, options = {}, timeoutMs = 30_000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...options, signal: controller.signal });
    return res;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Run an Apify actor synchronously and return its dataset items.
 * Returns null on any failure so callers can fall back gracefully.
 */
async function runActorSync(actorId, input, timeoutSecs = SYNC_TIMEOUT_SECS) {
  if (!hasToken()) return null;

  const token = config.apify.token;
  const url = `${APIFY_BASE}/acts/${actorId}/run-sync-get-dataset-items?timeout=${timeoutSecs}&token=${token}`;

  try {
    const res = await fetchWithTimeout(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    }, (timeoutSecs + 10) * 1000);

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      logger.warn(`Apify actor ${actorId} returned HTTP ${res.status}: ${text.slice(0, 200)}`);
      return null;
    }

    const items = await res.json();
    return Array.isArray(items) ? items : [];
  } catch (err) {
    logger.warn(`Apify actor ${actorId} failed: ${err.message}`);
    return null;
  }
}

// ---- public API ------------------------------------------------------------

/**
 * Search LinkedIn for a person by name + optional org/company.
 * Returns an array of candidate objects with at minimum:
 *   { linkedinUrl, firstName, lastName, headline, location, currentCompany }
 * Returns [] on failure or when no token is set.
 */
export async function searchLinkedInByName(firstName, lastName, { company, location } = {}) {
  if (!hasToken()) return [];

  const input = {
    firstName: firstName || '',
    lastName: lastName || '',
    profileScraperMode: 'Short', // cheap: just search pages, no full profile open
    maxItems: 5,
  };
  if (company) {
    // The actor expects company URLs like "google" or full URLs
    input.currentCompanyUrls = [company];
  }
  if (location) {
    input.locations = [location];
  }

  const items = await runActorSync(ACTOR_SEARCH_BY_NAME, input, 90);
  if (!items) return [];

  return items.map(item => ({
    kind: 'linkedin',
    linkedinUrl: item.linkedinUrl || item.url || null,
    firstName: item.firstName || null,
    lastName: item.lastName || null,
    headline: item.headline || null,
    about: item.about || null,
    location: item.location || null,
    currentCompany: item.currentCompany || null,
    profileId: item.id || item.publicIdentifier || null,
  })).filter(c => c.linkedinUrl);
}

/**
 * Scrape a full LinkedIn profile from a known /in/... URL.
 * Returns a rich profile object or null on failure.
 */
export async function scrapeLinkedInProfile(linkedinUrl) {
  if (!hasToken() || !linkedinUrl) return null;

  const input = {
    profileUrls: [linkedinUrl],
  };

  const items = await runActorSync(ACTOR_PROFILE_SCRAPER, input, 90);
  if (!items || items.length === 0) return null;

  const item = items[0];
  return {
    linkedinUrl: item.linkedinUrl || linkedinUrl,
    firstName: item.firstName || null,
    lastName: item.lastName || null,
    headline: item.headline || null,
    about: item.about || null,
    location: item.location || null,
    currentCompany: item.currentCompany || item.experience?.[0]?.company || null,
    profileImage: item.profilePicture || item.imageUrl || null,
    experience: (item.experience || []).map(exp => ({
      title: exp.title || null,
      company: exp.company || exp.companyName || null,
      duration: exp.duration || exp.dateRange || null,
      description: exp.description || null,
    })),
    education: (item.education || []).map(edu => ({
      school: edu.school || edu.schoolName || null,
      degree: edu.degree || null,
      field: edu.fieldOfStudy || null,
      dates: edu.dateRange || edu.dates || null,
    })),
    skills: item.skills || [],
    connections: item.connections || null,
    followersCount: item.followersCount || null,
  };
}

/**
 * Scrape recent posts from a LinkedIn profile URL.
 * Returns an array of post objects or [] on failure.
 */
export async function scrapeLinkedInPosts(linkedinUrl, maxPosts = 5) {
  if (!hasToken() || !linkedinUrl) return [];

  const input = {
    targetUrls: [linkedinUrl],
    maxPosts,
    scrapeReactions: false,
    scrapeComments: false,
  };

  const items = await runActorSync(ACTOR_PROFILE_POSTS, input, 90);
  if (!items) return [];

  return items.map(item => ({
    id: item.id || null,
    url: item.linkedinUrl || null,
    content: item.content || null,
    author: item.author?.name || null,
    authorInfo: item.author?.info || null,
    postedAt: item.postedAt?.date || null,
    likeCount: item.likeCount || 0,
    commentCount: item.commentCount || 0,
    shareCount: item.shareCount || 0,
    repostCount: item.repostCount || 0,
    hasImages: Boolean(item.postImages?.length),
    hasVideo: Boolean(item.video || item.postVideo),
  }));
}

/**
 * Search LinkedIn for alumni of a specific school/college.
 * Uses the People Search actor with school filtering.
 * Returns an array of candidate objects or [] on failure.
 */
export async function searchLinkedInBySchool(school, { maxResults = 10, location } = {}) {
  if (!hasToken() || !school) return [];

  // Normalize common country/region abbreviations for LinkedIn search
  let normalizedLocation = location ? location.trim() : undefined;
  if (normalizedLocation) {
    const locUpper = normalizedLocation.toUpperCase();
    const locMap = {
      'US': 'United States',
      'USA': 'United States',
      'UK': 'United Kingdom',
      'IN': 'India',
      'IND': 'India',
      'CA': 'Canada',
      'AU': 'Australia',
      'DE': 'Germany',
      'FR': 'France',
      'SG': 'Singapore',
      'UAE': 'United Arab Emirates',
    };
    if (locMap[locUpper]) {
      normalizedLocation = locMap[locUpper];
    }
  }

  // Use the fuzzy-search actor (linkedin-profile-search).
  // Passing searchQuery with school name is robust across all institutions
  // without relying on exact LinkedIn URL slugs.
  const input = {
    searchQuery: school.trim(),
    profileScraperMode: 'Short',     // search pages only
    maxItems: Math.min(maxResults, 50),
    takePages: Math.ceil(Math.min(maxResults, 50) / 25),
  };

  if (normalizedLocation) {
    input.locations = [normalizedLocation];
  }

  const items = await runActorSync(ACTOR_SEARCH_FUZZY, input, 120);
  if (!items || items.length === 0) return [];

  // The fuzzy actor returns a different shape than the by-name actor:
  //   firstName, lastName, summary, currentPositions[].companyName,
  //   location.linkedinText, linkedinUrl, etc.
  return items.map(item => {
    const loc = item.location;
    const locText = typeof loc === 'string' ? loc : loc?.linkedinText || null;
    const positions = item.currentPositions || [];
    const current = positions.find(p => p.current) || positions[0];
    return {
      kind: 'linkedin',
      linkedinUrl: item.linkedinUrl || item.url || null,
      firstName: item.firstName || null,
      lastName: item.lastName || null,
      headline: current?.title || item.summary?.slice(0, 120) || null,
      about: item.summary || null,
      location: locText,
      currentCompany: current?.companyName || null,
      profileId: item.id || item.publicIdentifier || null,
    };
  }).filter(c => c.linkedinUrl);
}

/**
 * Full LinkedIn research pass: find profile URL → scrape profile → scrape posts.
 * Returns { profile, posts, linkedinUrl } or null on failure.
 */
export async function researchLinkedIn(profile, contact) {
  if (!hasToken()) return null;

  const name = (profile.full_name || '').trim();
  const org = (profile.organization || '').trim();
  const email = (contact?.email || '').trim();

  // Split name into first/last
  const nameParts = name.split(/\s+/);
  const firstName = nameParts[0] || '';
  const lastName = nameParts.slice(1).join(' ') || '';

  // Step 1: Find LinkedIn URL (search by name + company)
  let linkedinUrl = profile.linkedin_url || null;

  if (!linkedinUrl) {
    const candidates = await searchLinkedInByName(firstName, lastName, {
      company: org || undefined,
    });

    if (candidates.length > 0) {
      // Pick the best candidate — prefer headline match
      const best = candidates.find(c => {
        const hl = (c.headline || '').toLowerCase();
        return org && hl.includes(org.toLowerCase());
      }) || candidates[0];
      linkedinUrl = best.linkedinUrl;
    }
  }

  if (!linkedinUrl) {
    logger.info(`No LinkedIn URL found for profile ${profile.id} (${name})`);
    return null;
  }

  // Step 2: Scrape full profile
  const linkedinProfile = await scrapeLinkedInProfile(linkedinUrl);

  // Step 3: Scrape recent posts
  const posts = await scrapeLinkedInPosts(linkedinUrl, 5);

  return {
    linkedinUrl,
    profile: linkedinProfile,
    posts,
  };
}

/**
 * Convert LinkedIn profile data into enrichment facts (enrichment_results format).
 */
export function linkedinProfileToFacts(linkedinProfile, identityConfidence = 0.9) {
  const facts = [];
  const conf = (c) => Math.min(Math.max(c, 0), 0.98);

  if (!linkedinProfile) return facts;

  // Headline
  if (linkedinProfile.headline) {
    facts.push({
      relationship: 'headline',
      value: linkedinProfile.headline,
      url: linkedinProfile.linkedinUrl,
      confidence: conf(identityConfidence * 0.95),
    });
  }

  // About / bio
  if (linkedinProfile.about) {
    facts.push({
      relationship: 'bio',
      value: linkedinProfile.about.slice(0, 800),
      url: linkedinProfile.linkedinUrl,
      confidence: conf(identityConfidence * 0.9),
    });
  }

  // Location
  if (linkedinProfile.location) {
    facts.push({
      relationship: 'location',
      value: linkedinProfile.location,
      url: linkedinProfile.linkedinUrl,
      confidence: conf(identityConfidence * 0.85),
    });
  }

  // Work experience (up to 3 most recent)
  for (const exp of (linkedinProfile.experience || []).slice(0, 3)) {
    const parts = [exp.title, exp.company].filter(Boolean);
    if (parts.length > 0) {
      const value = parts.join(' at ') + (exp.duration ? ` (${exp.duration})` : '');
      facts.push({
        relationship: 'experience',
        value,
        url: linkedinProfile.linkedinUrl,
        confidence: conf(identityConfidence * 0.85),
      });
    }
  }

  // Education (up to 2)
  for (const edu of (linkedinProfile.education || []).slice(0, 2)) {
    const parts = [edu.degree, edu.field, edu.school].filter(Boolean);
    if (parts.length > 0) {
      facts.push({
        relationship: 'education',
        value: parts.join(' — '),
        url: linkedinProfile.linkedinUrl,
        confidence: conf(identityConfidence * 0.8),
      });
    }
  }

  // Skills (top 5)
  const skills = (linkedinProfile.skills || []).slice(0, 5);
  if (skills.length > 0) {
    const skillNames = skills.map(s => typeof s === 'string' ? s : s.name || s.skill || '').filter(Boolean);
    if (skillNames.length > 0) {
      facts.push({
        relationship: 'skills',
        value: skillNames.join(', '),
        url: linkedinProfile.linkedinUrl,
        confidence: conf(identityConfidence * 0.75),
      });
    }
  }

  // Follower count
  if (linkedinProfile.followersCount) {
    facts.push({
      relationship: 'followers',
      value: `${linkedinProfile.followersCount} LinkedIn followers`,
      url: linkedinProfile.linkedinUrl,
      confidence: conf(identityConfidence * 0.7),
    });
  }

  return facts;
}

/**
 * Convert LinkedIn posts into enrichment facts.
 */
export function linkedinPostsToFacts(posts, identityConfidence = 0.9) {
  const facts = [];
  const conf = (c) => Math.min(Math.max(c, 0), 0.98);

  for (const post of (posts || []).slice(0, 5)) {
    if (!post.content) continue;

    const engagement = [
      post.likeCount ? `${post.likeCount} likes` : null,
      post.commentCount ? `${post.commentCount} comments` : null,
      post.shareCount ? `${post.shareCount} shares` : null,
    ].filter(Boolean).join(', ');

    const value = [
      post.content.slice(0, 500),
      engagement ? `[${engagement}]` : null,
      post.postedAt ? `posted ${new Date(post.postedAt).toLocaleDateString()}` : null,
    ].filter(Boolean).join(' — ');

    facts.push({
      relationship: 'post',
      value,
      url: post.url,
      confidence: conf(identityConfidence * 0.7),
    });
  }

  return facts;
}
