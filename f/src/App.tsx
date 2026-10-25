import { lazy, Suspense } from 'react'
import { Routes, Route, Navigate, useLocation } from 'react-router-dom'
import { AppShell } from '@/components/shell'
import { LoadingState } from '@/components/ui'
import { useAuth } from '@/lib/AuthContext'
import { UserProfileProvider } from '@/lib/UserProfileContext'
import { ModuleGuard } from '@/components/ModuleGuard'
import { PageTransition } from '@/components/PageTransition'
import LoginPage from '@/pages/LoginPage'
import SignupPage from '@/pages/SignupPage'
import LandingPage from '@/pages/LandingPage'

// Route-level code splitting: each page loads in its own chunk so the initial
// bundle stays small and only what's visited is downloaded.
const DashboardPage = lazy(() => import('@/pages/DashboardPage').then(m => ({ default: m.DashboardPage })))
const PipelinePage = lazy(() => import('@/pages/PipelinePage').then(m => ({ default: m.PipelinePage })))
const ImportPage = lazy(() => import('@/pages/ImportPage').then(m => ({ default: m.ImportPage })))
const PeoplePage = lazy(() => import('@/pages/PeoplePage').then(m => ({ default: m.PeoplePage })))
const PersonDetailPage = lazy(() => import('@/pages/PersonDetailPage').then(m => ({ default: m.PersonDetailPage })))
const ResearchPage = lazy(() => import('@/pages/ResearchPage').then(m => ({ default: m.ResearchPage })))
const PersonalizationPage = lazy(() => import('@/pages/PersonalizationPage').then(m => ({ default: m.PersonalizationPage })))
const ReviewPage = lazy(() => import('@/pages/ReviewPage').then(m => ({ default: m.ReviewPage })))
const OutreachPage = lazy(() => import('@/pages/OutreachPage').then(m => ({ default: m.OutreachPage })))
const RepliesPage = lazy(() => import('@/pages/RepliesPage').then(m => ({ default: m.RepliesPage })))
const CampaignsPage = lazy(() => import('@/pages/CampaignsPage').then(m => ({ default: m.CampaignsPage })))
const CampaignDetailPage = lazy(() => import('@/pages/CampaignDetailPage').then(m => ({ default: m.CampaignDetailPage })))
const BulkSendPage = lazy(() => import('@/pages/BulkSendPage').then(m => ({ default: m.BulkSendPage })))
const AlumniPage = lazy(() => import('@/pages/AlumniPage').then(m => ({ default: m.AlumniPage })))

// Job Search module pages (lazy-loaded)
const JobDashboardPage = lazy(() => import('@/pages/jobs/JobDashboardPage').then(m => ({ default: m.JobDashboardPage })))
const JobDiscoveryPage = lazy(() => import('@/pages/jobs/JobDiscoveryPage').then(m => ({ default: m.JobDiscoveryPage })))
const JobResearchPage = lazy(() => import('@/pages/jobs/JobResearchPage').then(m => ({ default: m.JobResearchPage })))
const ResumeMatchPage = lazy(() => import('@/pages/jobs/ResumeMatchPage').then(m => ({ default: m.ResumeMatchPage })))
const JobPersonalizationPage = lazy(() => import('@/pages/jobs/JobPersonalizationPage').then(m => ({ default: m.JobPersonalizationPage })))
const ApplicationsPage = lazy(() => import('@/pages/jobs/ApplicationsPage').then(m => ({ default: m.ApplicationsPage })))
const RecruiterOutreachPage = lazy(() => import('@/pages/jobs/RecruiterOutreachPage').then(m => ({ default: m.RecruiterOutreachPage })))
const FollowUpsPage = lazy(() => import('@/pages/jobs/FollowUpsPage').then(m => ({ default: m.FollowUpsPage })))
const JobTrackingPage = lazy(() => import('@/pages/jobs/JobTrackingPage').then(m => ({ default: m.JobTrackingPage })))
const CandidateVaultPage = lazy(() => import('@/pages/jobs/CandidateVaultPage').then(m => ({ default: m.CandidateVaultPage })))


function AuthGuard({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth()
  if (loading) return <LoadingState label="Checking session…" />
  if (!user) return <Navigate to="/login" replace />
  return <>{children}</>
}

/** Wraps each page in a fade-in animation on route change. */
function AnimatedPage({ children }: { children: React.ReactNode }) {
  const location = useLocation()
  return (
    <PageTransition key={location.pathname}>
      {children}
    </PageTransition>
  )
}

function App() {
  return (
    <Routes>
      {/* Public auth routes (no shell, no auth required) */}
      <Route path="/login" element={<LoginPage />} />
      <Route path="/signup" element={<SignupPage />} />

      {/* Protected dashboard routes — Outreach module, gated by ModuleGuard */}
      <Route path="/dashboard" element={<AuthGuard><UserProfileProvider><AppShell><AnimatedPage><Suspense fallback={<LoadingState label="Loading…" />}><ModuleGuard module="outreach"><DashboardPage /></ModuleGuard></Suspense></AnimatedPage></AppShell></UserProfileProvider></AuthGuard>} />
      <Route path="/pipeline" element={<AuthGuard><UserProfileProvider><AppShell><AnimatedPage><Suspense fallback={<LoadingState label="Loading…" />}><ModuleGuard module="outreach"><PipelinePage /></ModuleGuard></Suspense></AnimatedPage></AppShell></UserProfileProvider></AuthGuard>} />
      <Route path="/import" element={<AuthGuard><UserProfileProvider><AppShell><AnimatedPage><Suspense fallback={<LoadingState label="Loading…" />}><ModuleGuard module="outreach"><ImportPage /></ModuleGuard></Suspense></AnimatedPage></AppShell></UserProfileProvider></AuthGuard>} />
      <Route path="/people" element={<AuthGuard><UserProfileProvider><AppShell><AnimatedPage><Suspense fallback={<LoadingState label="Loading…" />}><ModuleGuard module="outreach"><PeoplePage /></ModuleGuard></Suspense></AnimatedPage></AppShell></UserProfileProvider></AuthGuard>} />
      <Route path="/people/:id" element={<AuthGuard><UserProfileProvider><AppShell><AnimatedPage><Suspense fallback={<LoadingState label="Loading…" />}><ModuleGuard module="outreach"><PersonDetailPage /></ModuleGuard></Suspense></AnimatedPage></AppShell></UserProfileProvider></AuthGuard>} />
      <Route path="/research" element={<AuthGuard><UserProfileProvider><AppShell><AnimatedPage><Suspense fallback={<LoadingState label="Loading…" />}><ModuleGuard module="outreach"><ResearchPage /></ModuleGuard></Suspense></AnimatedPage></AppShell></UserProfileProvider></AuthGuard>} />
      <Route path="/personalization" element={<AuthGuard><UserProfileProvider><AppShell><AnimatedPage><Suspense fallback={<LoadingState label="Loading…" />}><ModuleGuard module="outreach"><PersonalizationPage /></ModuleGuard></Suspense></AnimatedPage></AppShell></UserProfileProvider></AuthGuard>} />
      <Route path="/review" element={<AuthGuard><UserProfileProvider><AppShell><AnimatedPage><Suspense fallback={<LoadingState label="Loading…" />}><ModuleGuard module="outreach"><ReviewPage /></ModuleGuard></Suspense></AnimatedPage></AppShell></UserProfileProvider></AuthGuard>} />
      <Route path="/outreach" element={<AuthGuard><UserProfileProvider><AppShell><AnimatedPage><Suspense fallback={<LoadingState label="Loading…" />}><ModuleGuard module="outreach"><OutreachPage /></ModuleGuard></Suspense></AnimatedPage></AppShell></UserProfileProvider></AuthGuard>} />
      <Route path="/replies" element={<AuthGuard><UserProfileProvider><AppShell><AnimatedPage><Suspense fallback={<LoadingState label="Loading…" />}><ModuleGuard module="outreach"><RepliesPage /></ModuleGuard></Suspense></AnimatedPage></AppShell></UserProfileProvider></AuthGuard>} />
      <Route path="/campaigns" element={<AuthGuard><UserProfileProvider><AppShell><AnimatedPage><Suspense fallback={<LoadingState label="Loading…" />}><ModuleGuard module="outreach"><CampaignsPage /></ModuleGuard></Suspense></AnimatedPage></AppShell></UserProfileProvider></AuthGuard>} />
      <Route path="/campaigns/:id" element={<AuthGuard><UserProfileProvider><AppShell><AnimatedPage><Suspense fallback={<LoadingState label="Loading…" />}><ModuleGuard module="outreach"><CampaignDetailPage /></ModuleGuard></Suspense></AnimatedPage></AppShell></UserProfileProvider></AuthGuard>} />
      <Route path="/bulk-send" element={<AuthGuard><UserProfileProvider><AppShell><AnimatedPage><Suspense fallback={<LoadingState label="Loading…" />}><ModuleGuard module="outreach"><BulkSendPage /></ModuleGuard></Suspense></AnimatedPage></AppShell></UserProfileProvider></AuthGuard>} />
      <Route path="/alumni" element={<AuthGuard><UserProfileProvider><AppShell><AnimatedPage><Suspense fallback={<LoadingState label="Loading…" />}><ModuleGuard module="outreach"><AlumniPage /></ModuleGuard></Suspense></AnimatedPage></AppShell></UserProfileProvider></AuthGuard>} />

      {/* Job Search module routes — gated by ModuleGuard('job_search') */}
      <Route path="/jobs/dashboard" element={<AuthGuard><UserProfileProvider><AppShell><AnimatedPage><Suspense fallback={<LoadingState label="Loading…" />}><ModuleGuard module="job_search"><JobDashboardPage /></ModuleGuard></Suspense></AnimatedPage></AppShell></UserProfileProvider></AuthGuard>} />
      <Route path="/jobs/discovery" element={<AuthGuard><UserProfileProvider><AppShell><AnimatedPage><Suspense fallback={<LoadingState label="Loading…" />}><ModuleGuard module="job_search"><JobDiscoveryPage /></ModuleGuard></Suspense></AnimatedPage></AppShell></UserProfileProvider></AuthGuard>} />
      <Route path="/jobs/research" element={<AuthGuard><UserProfileProvider><AppShell><AnimatedPage><Suspense fallback={<LoadingState label="Loading…" />}><ModuleGuard module="job_search"><JobResearchPage /></ModuleGuard></Suspense></AnimatedPage></AppShell></UserProfileProvider></AuthGuard>} />
      <Route path="/jobs/resume" element={<AuthGuard><UserProfileProvider><AppShell><AnimatedPage><Suspense fallback={<LoadingState label="Loading…" />}><ModuleGuard module="job_search"><ResumeMatchPage /></ModuleGuard></Suspense></AnimatedPage></AppShell></UserProfileProvider></AuthGuard>} />
      <Route path="/jobs/personalization" element={<AuthGuard><UserProfileProvider><AppShell><AnimatedPage><Suspense fallback={<LoadingState label="Loading…" />}><ModuleGuard module="job_search"><JobPersonalizationPage /></ModuleGuard></Suspense></AnimatedPage></AppShell></UserProfileProvider></AuthGuard>} />
      <Route path="/jobs/applications" element={<AuthGuard><UserProfileProvider><AppShell><AnimatedPage><Suspense fallback={<LoadingState label="Loading…" />}><ModuleGuard module="job_search"><ApplicationsPage /></ModuleGuard></Suspense></AnimatedPage></AppShell></UserProfileProvider></AuthGuard>} />
      <Route path="/jobs/recruiter" element={<AuthGuard><UserProfileProvider><AppShell><AnimatedPage><Suspense fallback={<LoadingState label="Loading…" />}><ModuleGuard module="job_search"><RecruiterOutreachPage /></ModuleGuard></Suspense></AnimatedPage></AppShell></UserProfileProvider></AuthGuard>} />
      <Route path="/jobs/follow-ups" element={<AuthGuard><UserProfileProvider><AppShell><AnimatedPage><Suspense fallback={<LoadingState label="Loading…" />}><ModuleGuard module="job_search"><FollowUpsPage /></ModuleGuard></Suspense></AnimatedPage></AppShell></UserProfileProvider></AuthGuard>} />
      <Route path="/jobs/tracking" element={<AuthGuard><UserProfileProvider><AppShell><AnimatedPage><Suspense fallback={<LoadingState label="Loading…" />}><ModuleGuard module="job_search"><JobTrackingPage /></ModuleGuard></Suspense></AnimatedPage></AppShell></UserProfileProvider></AuthGuard>} />
      <Route path="/jobs/vault" element={<AuthGuard><UserProfileProvider><AppShell><AnimatedPage><Suspense fallback={<LoadingState label="Loading…" />}><ModuleGuard module="job_search"><CandidateVaultPage /></ModuleGuard></Suspense></AnimatedPage></AppShell></UserProfileProvider></AuthGuard>} />

      {/* Root renders the marketing Hero landing page */}
      <Route path="/" element={<LandingPage />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}

export default App
