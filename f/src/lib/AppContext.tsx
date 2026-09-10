import React, { createContext, useContext, useEffect, useCallback, useState } from 'react';
import { toast } from 'sonner';
import type {
  Campaign,
  Contact,
  DashboardStats,
  ImportJob,
  Personalization,
  Profile,
  ReplyRow,
  OutreachRow,
  IntegrationHealth,
} from './api';
import {
  getCampaigns,
  getContacts,
  getOutreach,
  getReplies,
  getStats,
  getProfiles,
  getImportJobs,
  getReviewQueue,
  getBulkProgress,
  getIntegrationHealth,
  uploadImport,
  processImport,
  submitReview,
  generatePersonalization,
  triggerOutreach,
  triggerFollowups,
  triggerReplies,
  triggerRepliesReset,
  addLead,
  approveAndSendBulk,
} from './api';
import {
  fallbackStats,
  fallbackHealth,
  fallbackCampaigns,
  fallbackContacts,
  fallbackOutreach,
  fallbackReplies,
  fallbackProfiles,
  fallbackImportJobs,
  fallbackReviewQueue,
  fallbackBulkProgress,
} from './fallback-data';

interface AppContextType {
  loading: boolean;
  error: string | null;
  /** True when the backend is unreachable and the UI is using fallback data. */
  degradedMode: boolean;
  /** Human-readable names of endpoints that failed on the last refresh. */
  failedEndpoints: string[];
  /** How many automatic retries have been attempted (resets when healthy). */
  retryCount: number;
  // data
  stats: DashboardStats | null;
  health: Record<string, IntegrationHealth> | null;
  campaigns: Campaign[];
  contacts: Contact[];
  outreach: OutreachRow[];
  replies: ReplyRow[];
  profiles: Profile[];
  importJobs: ImportJob[];
  reviewQueue: Personalization[];
  bulkProgress: Record<string, number> | null;
  selectedCampaign: string;
  setSelectedCampaign: (id: string) => void;
  // refresh
  refresh: () => Promise<void>;
  refreshReviewQueue: () => Promise<void>;
  // actions
  uploadAndQueueImport: (file: File, fileType?: string) => Promise<string>;
  processImportJob: (jobId: string) => Promise<void>;
  approve: (id: string, opts?: { comments?: string; editedSubject?: string; editedBody?: string }) => Promise<void>;
  reject: (id: string, comments?: string) => Promise<void>;
  generateForProfile: (profileId: string) => Promise<void>;
  runOutreach: () => Promise<{ claimed: number; sent: number; failed: number } | null>;
  runFollowups: () => Promise<unknown>;
  runReplies: () => Promise<{ fetched: number; processed: number; skipped: number }>;
  runRepliesReset: () => Promise<{ fetched: number; processed: number; skipped: number }>;
  createLead: (data: { name: string; email: string; organization?: string; role?: string }) => Promise<void>;
  bulkApproveAndSend: () => Promise<void>;
}

const AppContext = createContext<AppContextType | undefined>(undefined);

export const AppProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [degradedMode, setDegradedMode] = useState(false);
  const [failedEndpoints, setFailedEndpoints] = useState<string[]>([]);
  const [retryCount, setRetryCount] = useState(0);
  const retryCountRef = React.useRef(0);
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [health, setHealth] = useState<Record<string, IntegrationHealth> | null>(null);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [outreach, setOutreach] = useState<OutreachRow[]>([]);
  const [replies, setReplies] = useState<ReplyRow[]>([]);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [importJobs, setImportJobs] = useState<ImportJob[]>([]);
  const [reviewQueue, setReviewQueue] = useState<Personalization[]>([]);
  const [bulkProgress, setBulkProgress] = useState<Record<string, number> | null>(null);
  const [selectedCampaign, setSelectedCampaign] = useState<string>('');

  const refresh = useCallback(async () => {
    try {
      // Use allSettled so one failed endpoint doesn't kill all the others.
      const [statsR, healthR, campsR, contactsR, outreachR, repliesR, profilesR, jobsR, reviewR, bulkR] =
        await Promise.allSettled([
          getStats(),
          getIntegrationHealth(),
          getCampaigns(),
          getContacts({ limit: 200 }),
          getOutreach({ limit: 200 }),
          getReplies(100),
          getProfiles(200),
          getImportJobs(20),
          getReviewQueue(undefined, 50),
          getBulkProgress(),
        ]);

      const ok = <T,>(r: PromiseSettledResult<T>, fallback: T): T =>
        r.status === 'fulfilled' ? r.value : fallback;

      const s = ok(statsR, fallbackStats);
      const h = ok(healthR, fallbackHealth);
      const c = ok(campsR, fallbackCampaigns);
      const co = ok(contactsR, fallbackContacts);
      const o = ok(outreachR, fallbackOutreach);
      const r = ok(repliesR, fallbackReplies);
      const p = ok(profilesR, fallbackProfiles);
      const j = ok(jobsR, fallbackImportJobs);
      const q = ok(reviewR, fallbackReviewQueue);
      const bp = ok(bulkR, fallbackBulkProgress);

      setStats(s);
      setHealth(h);
      setCampaigns(c);
      setContacts(co);
      setOutreach(o);
      setReplies(r);
      setProfiles(p);
      setImportJobs(j);
      setReviewQueue(q);
      setBulkProgress(bp);
      setSelectedCampaign(prev => prev || (c[0]?.id ?? ''));

      // Collect errors from failed calls with endpoint names
      const endpointNames = [
        'Dashboard stats', 'Integration health', 'Campaigns', 'Contacts',
        'Outreach', 'Replies', 'Profiles', 'Import jobs',
        'Review queue', 'Bulk progress',
      ]
      const allResults = [statsR, healthR, campsR, contactsR, outreachR, repliesR, profilesR, jobsR, reviewR, bulkR]
      const namedResults = endpointNames.map((name, i) => ({ name, result: allResults[i] }))
      const failed = namedResults
        .filter((r): r is { name: string; result: PromiseRejectedResult } => r.result.status === 'rejected')
        .map(r => r.name)
      const failureMsgs = namedResults
        .filter((r): r is { name: string; result: PromiseRejectedResult } => r.result.status === 'rejected')
        .map(r => `${r.name}: ${(r.result.reason as Error)?.message || 'unknown error'}`)
      if (failed.length > 0) {
        setError(`Some data failed to load: ${failureMsgs.join('; ')}`);
        setFailedEndpoints(failed);
        setDegradedMode(true);
      } else {
        setError(null);
        setFailedEndpoints([]);
        setDegradedMode(false);
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  const refreshReviewQueue = useCallback(async () => {
    try {
      const q = await getReviewQueue(undefined, 50);
      setReviewQueue(q);
    } catch (err) {
      toast.error(`Failed to load review queue: ${(err as Error).message}`);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Auto-retry with exponential backoff when in degraded mode.
  // Backoff schedule: 5s → 10s → 20s → 40s → 60s (capped), up to 8 attempts.
  useEffect(() => {
    if (!degradedMode) {
      // Reset retry state when connection is healthy
      retryCountRef.current = 0;
      setRetryCount(0);
      return;
    }

    const MAX_RETRIES = 8;
    const BASE_DELAY = 5000;
    const MAX_DELAY = 60000;

    if (retryCountRef.current >= MAX_RETRIES) return

    const delay = Math.min(MAX_DELAY, BASE_DELAY * Math.pow(2, retryCountRef.current))
    const attempt = retryCountRef.current + 1

    const timer = window.setTimeout(() => {
      retryCountRef.current = attempt
      setRetryCount(attempt)
      refresh()
    }, delay)

    return () => window.clearTimeout(timer)
  }, [degradedMode, retryCount, refresh]);

  const uploadAndQueueImport = async (file: File, fileType?: string) => {
    const jobId = await uploadImport(file, fileType);
    toast.success(`File "${file.name}" queued for import (${jobId.slice(0, 8)}…)`);
    setImportJobs(await getImportJobs(20));
    return jobId;
  };

  const processImportJob = async (jobId: string) => {
    toast.info('Processing import job…');
    await processImport(jobId);
    toast.success('Import job processed');
    await refresh();
  };

  const approve = async (id: string, opts?: { comments?: string; editedSubject?: string; editedBody?: string }) => {
    await submitReview(id, 'approved', opts || {});
    toast.success('Personalization approved');
    await refreshReviewQueue();
    await refresh();
  };

  const reject = async (id: string, comments?: string) => {
    await submitReview(id, 'rejected', { comments });
    toast.success('Personalization rejected');
    await refreshReviewQueue();
    await refresh(); // keep sidebar queue badge + approve-and-send count in sync
  };

  const generateForProfile = async (profileId: string) => {
    toast.info('Generating AI personalization…');
    await generatePersonalization(profileId);
    toast.success('Personalization generated — awaiting review');
    await refresh();
    await refreshReviewQueue();
  };

  const runOutreach = async () => {
    toast.info('Triggering outreach batch…');
    const result = await triggerOutreach();
    toast.success(`Outreach done — claimed ${result.claimed}, sent ${result.sent}, failed ${result.failed}`);
    await refresh();
    return result;
  };

  const runFollowups = async () => {
    toast.info('Triggering follow-up batch…');
    const result = await triggerFollowups();
    toast.success('Follow-ups processed');
    await refresh();
    return result;
  };

  const runReplies = async () => {
    toast.info('Checking inbox for replies…');
    const result = await triggerReplies();
    toast.success(`Reply check done — fetched ${result.fetched}, processed ${result.processed}`);
    await refresh();
    return result;
  };

  const runRepliesReset = async () => {
    toast.info('Clearing processed cache and rescanning inbox for replies…');
    const result = await triggerRepliesReset();
    toast.success(`Rescan done — fetched ${result.fetched}, processed ${result.processed}`);
    await refresh();
    return result;
  };

  const createLead = async (data: { name: string; email: string; organization?: string; role?: string }) => {
    await addLead(data);
    toast.success(`Lead created for ${data.name}`);
    await refresh();
  };

  const bulkApproveAndSend = async () => {
    toast.info('Approving pending personalizations & triggering send…');
    await approveAndSendBulk(selectedCampaign || undefined);
    toast.success('Bulk approve-and-send complete');
    await refresh();
    await refreshReviewQueue();
  };

  return (
    <AppContext.Provider
      value={{
        loading,
        error,
        degradedMode,
        failedEndpoints,
        retryCount,
        stats,
        health,
        campaigns,
        contacts,
        outreach,
        replies,
        profiles,
        importJobs,
        reviewQueue,
        bulkProgress,
        selectedCampaign,
        setSelectedCampaign,
        refresh,
        refreshReviewQueue,
        uploadAndQueueImport,
        processImportJob,
        approve,
        reject,
        generateForProfile,
        runOutreach,
        runFollowups,
        runReplies,
        runRepliesReset,
        createLead,
        bulkApproveAndSend,
      }}
    >
      {children}
    </AppContext.Provider>
  );
};

export const useApp = () => {
  const context = useContext(AppContext);
  if (!context) {
    throw new Error('useApp must be used within an AppProvider');
  }
  return context;
};
