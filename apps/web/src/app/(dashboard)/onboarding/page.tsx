"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  CheckCircle2,
  Database,
  Loader2,
  PlugZap,
  Sparkles,
  Target,
  TrendingUp,
  UserCog,
} from "lucide-react";

import {
  saveCrmCredentials,
  saveOnboardingPreferences,
  runFullOnboardingPipeline,
  getTenantDataSummary,
  getOnboardingProposals,
  applyIcpConfig,
  applyFunnelConfig,
  type SyncSummary,
} from "@/app/actions/onboarding";
import { recordOnboardingStepStarted } from "@/app/actions/onboarding-instrumentation";
import type {
  IcpProposal,
  FunnelProposal,
  IcpDimension,
  FunnelStage,
} from "@/lib/onboarding/proposals";
import { cn } from "@/lib/utils";

type CrmType = "hubspot" | "salesforce";
type StepId = "welcome" | "crm" | "sync" | "icp" | "funnel" | "preferences";

const STEPS: { id: StepId; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { id: "welcome", label: "Welcome", icon: Sparkles },
  { id: "crm", label: "Connect CRM", icon: PlugZap },
  { id: "sync", label: "Sync data", icon: Database },
  { id: "icp", label: "ICP fit", icon: Target },
  { id: "funnel", label: "Funnel", icon: TrendingUp },
  { id: "preferences", label: "You", icon: UserCog },
];

export default function OnboardingWizard() {
  const router = useRouter();
  const [stepId, setStepId] = useState<StepId>("welcome");

  // CRM state
  const [crmType, setCrmType] = useState<CrmType>("hubspot");
  const [hubspotToken, setHubspotToken] = useState("");
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [instanceUrl, setInstanceUrl] = useState("");
  const [savingCrm, setSavingCrm] = useState(false);
  const [crmError, setCrmError] = useState<string | null>(null);

  // Sync state
  const [syncing, setSyncing] = useState(false);
  const [syncDone, setSyncDone] = useState(false);
  const [syncSummary, setSyncSummary] = useState<SyncSummary | null>(null);
  const [syncError, setSyncError] = useState<string | null>(null);

  // Proposals state
  const [proposalsLoading, setProposalsLoading] = useState(false);
  const [icpProposal, setIcpProposal] = useState<IcpProposal | null>(null);
  const [funnelProposal, setFunnelProposal] = useState<FunnelProposal | null>(null);
  const [icpAccepted, setIcpAccepted] = useState<Record<string, boolean>>({});
  const [funnelAccepted, setFunnelAccepted] = useState<Record<string, boolean>>({});
  const [stageDays, setStageDays] = useState<Record<string, number>>({});

  // Preferences state — narrow to the enum values the saveOnboardingPreferences
  // server action accepts (it Zod-validates the payload). Without narrowing
  // here, the wizard could pass a typo (e.g. "very_high") and the validation
  // error would only surface on submit; this way TS catches it at the
  // <select> level when we type-check.
  type RoleValue = 'rep' | 'csm' | 'ad' | 'manager' | 'revops' | 'admin'
  type AlertFreqValue = 'high' | 'medium' | 'low'
  type CommStyleValue = 'formal' | 'casual' | 'brief'
  type OutreachToneValue = 'professional' | 'consultative' | 'direct' | 'warm' | 'executive'

  const [role, setRole] = useState<RoleValue>("rep");
  const [alertFreq, setAlertFreq] = useState<AlertFreqValue>("medium");
  const [commStyle, setCommStyle] = useState<CommStyleValue>("brief");
  const [outreachTone, setOutreachTone] = useState<OutreachToneValue>("consultative");
  const [focusStage, setFocusStage] = useState("");
  const [slackId, setSlackId] = useState("");
  const [savingPrefs, setSavingPrefs] = useState(false);

  // Lazy-load proposals when entering the ICP step for the first time
  useEffect(() => {
    if ((stepId === "icp" || stepId === "funnel") && !icpProposal && !funnelProposal) {
      void loadProposals();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stepId]);

  // Phase 3 T2.4 — emit `onboarding_step_started` whenever the user
  // lands on a new step. The wizard's existing server actions already
  // emit `onboarding_step_completed` from inside each step's
  // mutation; pairing them gives /admin/pilot the data it needs to
  // compute median + p95 step duration and per-step drop-off.
  //
  // Fire-and-forget: telemetry never blocks the wizard. The server
  // action also no-ops if the user is unauthenticated (e.g.
  // pre-login render of the welcome step).
  useEffect(() => {
    void recordOnboardingStepStarted({ step: stepId });
  }, [stepId]);

  // Auto-accept all dimensions/stages when proposals first load — user can opt out per item.
  useEffect(() => {
    if (icpProposal) {
      const next: Record<string, boolean> = {};
      for (const d of icpProposal.config.dimensions) next[d.name] = true;
      setIcpAccepted(next);
    }
  }, [icpProposal]);

  useEffect(() => {
    if (funnelProposal) {
      const next: Record<string, boolean> = {};
      const days: Record<string, number> = {};
      for (const s of funnelProposal.config.stages) {
        next[s.name] = true;
        days[s.name] = s.expected_velocity_days;
      }
      setFunnelAccepted(next);
      setStageDays(days);
    }
  }, [funnelProposal]);

  async function loadProposals() {
    setProposalsLoading(true);
    try {
      const result = await getOnboardingProposals();
      setIcpProposal(result.icp);
      setFunnelProposal(result.funnel);
    } finally {
      setProposalsLoading(false);
    }
  }

  const handleSaveCrm = useCallback(async () => {
    setSavingCrm(true);
    setCrmError(null);
    try {
      if (crmType === "hubspot") {
        await saveCrmCredentials({
          private_app_token: hubspotToken,
          crm_type: "hubspot",
        });
      } else {
        await saveCrmCredentials({
          client_id: clientId,
          client_secret: clientSecret,
          instance_url: instanceUrl,
          crm_type: "salesforce",
        });
      }
      setStepId("sync");
    } catch (e) {
      setCrmError(e instanceof Error ? e.message : "Could not save credentials");
    } finally {
      setSavingCrm(false);
    }
  }, [crmType, hubspotToken, clientId, clientSecret, instanceUrl]);

  const handleSync = useCallback(async () => {
    setSyncing(true);
    setSyncError(null);
    try {
      await runFullOnboardingPipeline();
      const summary = await getTenantDataSummary();
      setSyncSummary(summary);
      setSyncDone(true);
    } catch (e) {
      setSyncError(e instanceof Error ? e.message : "Sync failed. You can retry.");
    } finally {
      setSyncing(false);
    }
  }, []);

  const handleApplyIcp = useCallback(async () => {
    if (!icpProposal) return;
    const filtered = {
      ...icpProposal.config,
      dimensions: icpProposal.config.dimensions.filter((d) => icpAccepted[d.name]),
    };
    await applyIcpConfig(filtered, "Saved from onboarding wizard");
    setStepId("funnel");
  }, [icpProposal, icpAccepted]);

  const handleApplyFunnel = useCallback(async () => {
    if (!funnelProposal) return;
    const stages = funnelProposal.config.stages
      .filter((s) => funnelAccepted[s.name])
      .map((s) => ({
        ...s,
        expected_velocity_days: stageDays[s.name] ?? s.expected_velocity_days,
      }));
    const config = { ...funnelProposal.config, stages };
    await applyFunnelConfig(config, "Saved from onboarding wizard");
    setStepId("preferences");
  }, [funnelProposal, funnelAccepted, stageDays]);

  const [prefsError, setPrefsError] = useState<string | null>(null);

  const handleFinish = useCallback(async () => {
    setSavingPrefs(true);
    setPrefsError(null);
    try {
      // saveOnboardingPreferences Zod-validates the slack_user_id format
      // (`^[UW][A-Z0-9]+$`). Catch the parse error and surface a usable
      // message instead of an opaque thrown ZodError stack trace.
      await saveOnboardingPreferences({
        alert_frequency: alertFreq,
        comm_style: commStyle,
        focus_stage: focusStage || null,
        role,
        slack_user_id: slackId.trim() ? slackId.trim() : null,
        outreach_tone: outreachTone,
      });
      router.push("/inbox");
      router.refresh();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Could not save preferences';
      setPrefsError(
        /slack/i.test(msg)
          ? 'Slack user IDs look like U01ABCDEF — the one you entered does not match. Leave it blank to skip.'
          : msg,
      );
    } finally {
      setSavingPrefs(false);
    }
  }, [alertFreq, commStyle, focusStage, role, slackId, outreachTone, router]);

  const stepIndex = STEPS.findIndex((s) => s.id === stepId);
  const progressPct = Math.round(((stepIndex + 1) / STEPS.length) * 100);

  return (
    <div className="flex min-h-[calc(100vh-3.5rem)] flex-col items-center bg-zinc-950 px-4 py-10 sm:py-16">
      <div className="w-full max-w-3xl">
        <Stepper currentIndex={stepIndex} progressPct={progressPct} />

        <div className="mt-8 rounded-2xl border border-zinc-800 bg-zinc-900/60 shadow-xl">
          {stepId === "welcome" && (
            <WelcomeStep onNext={() => setStepId("crm")} />
          )}
          {stepId === "crm" && (
            <CrmStep
              crmType={crmType}
              setCrmType={setCrmType}
              hubspotToken={hubspotToken}
              setHubspotToken={setHubspotToken}
              clientId={clientId}
              setClientId={setClientId}
              clientSecret={clientSecret}
              setClientSecret={setClientSecret}
              instanceUrl={instanceUrl}
              setInstanceUrl={setInstanceUrl}
              error={crmError}
              saving={savingCrm}
              onBack={() => setStepId("welcome")}
              onNext={handleSaveCrm}
            />
          )}
          {stepId === "sync" && (
            <SyncStep
              syncing={syncing}
              syncDone={syncDone}
              summary={syncSummary}
              error={syncError}
              onSync={handleSync}
              onBack={() => setStepId("crm")}
              onNext={() => setStepId("icp")}
            />
          )}
          {stepId === "icp" && (
            <IcpStep
              proposal={icpProposal}
              loading={proposalsLoading}
              accepted={icpAccepted}
              setAccepted={setIcpAccepted}
              onBack={() => setStepId("sync")}
              onNext={handleApplyIcp}
            />
          )}
          {stepId === "funnel" && (
            <FunnelStep
              proposal={funnelProposal}
              loading={proposalsLoading}
              accepted={funnelAccepted}
              setAccepted={setFunnelAccepted}
              stageDays={stageDays}
              setStageDays={setStageDays}
              onBack={() => setStepId("icp")}
              onNext={handleApplyFunnel}
            />
          )}
          {stepId === "preferences" && (
            <PreferencesStep
              role={role}
              setRole={setRole}
              alertFreq={alertFreq}
              setAlertFreq={setAlertFreq}
              commStyle={commStyle}
              setCommStyle={setCommStyle}
              outreachTone={outreachTone}
              setOutreachTone={setOutreachTone}
              focusStage={focusStage}
              setFocusStage={setFocusStage}
              slackId={slackId}
              setSlackId={setSlackId}
              saving={savingPrefs}
              error={prefsError}
              onBack={() => setStepId("funnel")}
              onFinish={handleFinish}
            />
          )}
        </div>
      </div>
    </div>
  );
}

// ── Stepper ──────────────────────────────────────────────────────────────

function Stepper({ currentIndex, progressPct }: { currentIndex: number; progressPct: number }) {
  return (
    <div>
      <div className="flex items-center justify-between gap-2">
        {STEPS.map((s, i) => {
          const Icon = s.icon;
          const completed = i < currentIndex;
          const current = i === currentIndex;
          return (
            <div key={s.id} className="flex flex-1 items-center gap-2">
              <div
                className={cn(
                  "flex h-9 w-9 shrink-0 items-center justify-center rounded-full border-2 transition-colors",
                  completed
                    ? "border-emerald-500 bg-emerald-500/15 text-emerald-300"
                    : current
                    ? "border-violet-500 bg-violet-600/20 text-violet-200"
                    : "border-zinc-700 bg-zinc-900 text-zinc-500",
                )}
              >
                {completed ? <Check className="size-4" /> : <Icon className="size-4" />}
              </div>
              <div className="hidden min-w-0 sm:block">
                <div
                  className={cn(
                    "truncate text-xs font-medium",
                    current ? "text-zinc-100" : "text-zinc-500",
                  )}
                >
                  {s.label}
                </div>
              </div>
              {i < STEPS.length - 1 && (
                <div
                  className={cn(
                    "hidden h-px flex-1 sm:block",
                    completed ? "bg-emerald-500/60" : "bg-zinc-800",
                  )}
                />
              )}
            </div>
          );
        })}
      </div>
      <div className="mt-3 h-1 w-full overflow-hidden rounded-full bg-zinc-800">
        <div
          className="h-full rounded-full bg-violet-500 transition-all"
          style={{ width: `${progressPct}%` }}
        />
      </div>
    </div>
  );
}

// ── Step container helpers ───────────────────────────────────────────────

function StepHeader({ title, description }: { title: string; description: string }) {
  return (
    <div className="border-b border-zinc-800 px-6 pb-5 pt-6 sm:px-8">
      <h1 className="text-xl font-semibold tracking-tight text-zinc-50">{title}</h1>
      <p className="mt-2 text-sm leading-relaxed text-zinc-400">{description}</p>
    </div>
  );
}

function StepFooter({
  onBack,
  onNext,
  nextLabel,
  nextDisabled,
  nextLoading,
  hideBack,
}: {
  onBack?: () => void;
  onNext: () => void;
  nextLabel: string;
  nextDisabled?: boolean;
  nextLoading?: boolean;
  hideBack?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-3 border-t border-zinc-800 px-6 py-4 sm:px-8">
      {hideBack ? (
        <span />
      ) : (
        <button
          type="button"
          onClick={onBack}
          disabled={!onBack}
          className="inline-flex items-center gap-1.5 rounded-md border border-zinc-700 px-3 py-2 text-sm font-medium text-zinc-300 transition-colors hover:bg-zinc-800 disabled:opacity-40"
        >
          <ArrowLeft className="size-4" />
          Back
        </button>
      )}
      <button
        type="button"
        onClick={onNext}
        disabled={nextDisabled || nextLoading}
        className="inline-flex items-center gap-1.5 rounded-md bg-violet-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-violet-500 disabled:opacity-50"
      >
        {nextLoading ? <Loader2 className="size-4 animate-spin" /> : null}
        {nextLabel}
        {!nextLoading && <ArrowRight className="size-4" />}
      </button>
    </div>
  );
}

// ── Step 1: Welcome ──────────────────────────────────────────────────────

function WelcomeStep({ onNext }: { onNext: () => void }) {
  return (
    <div>
      <StepHeader
        title="Welcome to Revenue AI OS"
        description="Five short steps. ~5 minutes. We'll connect your CRM, study your real data, and configure scoring and benchmarks tailored to your business."
      />
      <div className="grid gap-3 px-6 py-6 sm:grid-cols-2 sm:px-8">
        {[
          { label: "Inbox", desc: "Daily ranked accounts and deals" },
          { label: "Pipeline", desc: "Live funnel and stall detection" },
          { label: "Accounts", desc: "Per-account scoring and signals" },
          { label: "Signals", desc: "Buying intent across the portfolio" },
          { label: "Forecast", desc: "Risk roll-up with confidence band" },
          { label: "Coach", desc: "Specialised agents for every surface" },
        ].map((s) => (
          <div
            key={s.label}
            className="rounded-lg border border-zinc-800 bg-zinc-900 p-3"
          >
            <div className="text-sm font-medium text-zinc-100">{s.label}</div>
            <div className="mt-1 text-xs text-zinc-500">{s.desc}</div>
          </div>
        ))}
      </div>
      <StepFooter
        hideBack
        onNext={onNext}
        nextLabel="Connect your CRM"
      />
    </div>
  );
}

// ── Step 2: CRM ──────────────────────────────────────────────────────────

interface CrmStepProps {
  crmType: CrmType;
  setCrmType: (t: CrmType) => void;
  hubspotToken: string;
  setHubspotToken: (v: string) => void;
  clientId: string;
  setClientId: (v: string) => void;
  clientSecret: string;
  setClientSecret: (v: string) => void;
  instanceUrl: string;
  setInstanceUrl: (v: string) => void;
  error: string | null;
  saving: boolean;
  onBack: () => void;
  onNext: () => void;
}

function CrmStep(props: CrmStepProps) {
  const ready =
    props.crmType === "hubspot"
      ? props.hubspotToken.length > 10
      : props.clientId.length > 0 && props.clientSecret.length > 0 && props.instanceUrl.length > 0;

  return (
    <div>
      <StepHeader
        title="Connect your CRM"
        description="Stored encrypted for your tenant. Used to read accounts, deals, contacts, and engagement — never written to without your action."
      />
      <div className="space-y-5 px-6 py-6 sm:px-8">
        <div>
          <label className="text-sm font-medium text-zinc-200">CRM provider</label>
          <div className="mt-2 flex gap-2">
            {(["hubspot", "salesforce"] as CrmType[]).map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => props.setCrmType(c)}
                className={cn(
                  "flex-1 rounded-md border px-3 py-2 text-sm font-medium transition-colors",
                  props.crmType === c
                    ? "border-violet-500 bg-violet-600/20 text-violet-200"
                    : "border-zinc-700 bg-zinc-800 text-zinc-400 hover:bg-zinc-700",
                )}
              >
                {c === "hubspot" ? "HubSpot" : "Salesforce"}
              </button>
            ))}
          </div>
        </div>

        {props.crmType === "hubspot" ? (
          <div>
            <label className="text-sm font-medium text-zinc-200">Private App token</label>
            <p className="mt-0.5 text-xs text-zinc-500">
              Create a Private App in HubSpot with CRM scopes, then paste the token below.
            </p>
            <input
              type="password"
              value={props.hubspotToken}
              onChange={(e) => props.setHubspotToken(e.target.value)}
              autoComplete="new-password"
              placeholder="pat-na1-..."
              className="mt-2 w-full rounded-md border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-100 focus:border-violet-500 focus:outline-none"
            />
          </div>
        ) : (
          <div className="space-y-3">
            <Field label="Client ID" hint="From your Salesforce Connected App.">
              <input
                value={props.clientId}
                onChange={(e) => props.setClientId(e.target.value)}
                autoComplete="off"
                className="w-full rounded-md border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-100 focus:border-violet-500 focus:outline-none"
              />
            </Field>
            <Field label="Client Secret" hint="Encrypted at rest.">
              <input
                type="password"
                value={props.clientSecret}
                onChange={(e) => props.setClientSecret(e.target.value)}
                autoComplete="new-password"
                className="w-full rounded-md border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-100 focus:border-violet-500 focus:outline-none"
              />
            </Field>
            <Field label="Instance URL" hint="Your Salesforce org base URL.">
              <input
                value={props.instanceUrl}
                onChange={(e) => props.setInstanceUrl(e.target.value)}
                placeholder="https://example.my.salesforce.com"
                className="w-full rounded-md border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-100 focus:border-violet-500 focus:outline-none"
              />
            </Field>
          </div>
        )}

        {props.error && <p className="text-sm text-rose-400">{props.error}</p>}
      </div>
      <StepFooter
        onBack={props.onBack}
        onNext={props.onNext}
        nextLabel={props.saving ? "Saving…" : "Save and continue"}
        nextDisabled={!ready}
        nextLoading={props.saving}
      />
    </div>
  );
}

// ── Step 3: Sync ─────────────────────────────────────────────────────────

function SyncStep({
  syncing,
  syncDone,
  summary,
  error,
  onSync,
  onBack,
  onNext,
}: {
  syncing: boolean;
  syncDone: boolean;
  summary: SyncSummary | null;
  error: string | null;
  onSync: () => void;
  onBack: () => void;
  onNext: () => void;
}) {
  return (
    <div>
      <StepHeader
        title="Pull your CRM data"
        description="We'll sync accounts, opportunities, and contacts, enrich them with firmographics, and run scoring. This typically takes 30-90 seconds."
      />
      <div className="px-6 py-6 sm:px-8">
        {!syncDone && !syncing && !error && (
          <button
            type="button"
            onClick={onSync}
            className="w-full rounded-lg border border-violet-600/40 bg-violet-600/10 px-4 py-6 text-center transition-colors hover:bg-violet-600/20"
          >
            <Database className="mx-auto size-7 text-violet-300" />
            <div className="mt-2 text-sm font-semibold text-violet-100">
              Start the sync
            </div>
            <div className="mt-1 text-xs text-violet-300/80">
              We'll show counts and a summary as it completes.
            </div>
          </button>
        )}

        {syncing && (
          <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-6 text-center">
            <Loader2 className="mx-auto size-7 animate-spin text-violet-300" />
            <div className="mt-3 text-sm font-medium text-zinc-200">
              Syncing your data…
            </div>
            <div className="mt-1 text-xs text-zinc-500">
              Pulling from CRM · enriching firmographics · scoring accounts.
            </div>
          </div>
        )}

        {syncDone && summary && (
          <div className="space-y-3">
            <div className="flex items-center gap-2 rounded-lg border border-emerald-700/40 bg-emerald-950/30 px-4 py-3">
              <CheckCircle2 className="size-5 text-emerald-300" />
              <span className="text-sm font-medium text-emerald-100">
                Done. We loaded your data.
              </span>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <SummaryTile label="Companies" value={summary.companies} />
              <SummaryTile label="Opportunities" value={summary.opportunities} />
              <SummaryTile label="Contacts" value={summary.contacts} />
            </div>
            {summary.companies < 10 && (
              <p className="text-xs text-amber-300/80">
                Only {summary.companies} companies found. Scoring works best with at least 25.
              </p>
            )}
          </div>
        )}

        {error && (
          <div className="rounded-lg border border-rose-800/40 bg-rose-950/30 p-4">
            <p className="text-sm text-rose-200">{error}</p>
            <button
              type="button"
              onClick={onSync}
              className="mt-2 text-xs font-medium text-rose-300 underline-offset-4 hover:underline"
            >
              Retry sync
            </button>
          </div>
        )}
      </div>
      <StepFooter
        onBack={onBack}
        onNext={onNext}
        nextLabel="Continue"
        nextDisabled={!syncDone}
      />
    </div>
  );
}

function SummaryTile({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-3 text-center">
      <div className="text-xs text-zinc-500">{label}</div>
      <div className="mt-1 text-2xl font-bold tabular-nums text-zinc-100">{value}</div>
    </div>
  );
}

// ── Step 4: ICP ──────────────────────────────────────────────────────────

function IcpStep({
  proposal,
  loading,
  accepted,
  setAccepted,
  onBack,
  onNext,
}: {
  proposal: IcpProposal | null;
  loading: boolean;
  accepted: Record<string, boolean>;
  setAccepted: (next: Record<string, boolean>) => void;
  onBack: () => void;
  onNext: () => void;
}) {
  const acceptedCount = Object.values(accepted).filter(Boolean).length;

  return (
    <div>
      <StepHeader
        title="Configure ICP scoring"
        description={
          proposal?.source === "derived"
            ? "We analysed your won deals and propose these scoring dimensions. Accept what makes sense — you can edit later in Admin."
            : "Not enough won-deal history to derive a profile from your data — we'll start with sensible defaults you can refine in Admin."
        }
      />
      <div className="space-y-3 px-6 py-6 sm:px-8">
        {loading && (
          <div className="flex items-center gap-2 text-sm text-zinc-500">
            <Loader2 className="size-4 animate-spin" />
            Analysing your won deals…
          </div>
        )}

        {proposal?.analysis && (
          <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-3 text-xs text-zinc-400">
            Based on{" "}
            <strong className="text-zinc-200">
              {proposal.analysis.won_deals_analyzed} won deals
            </strong>{" "}
            across {proposal.analysis.total_accounts} accounts. Top winning industries:{" "}
            {proposal.analysis.top_winning_industries.join(", ") || "n/a"}.
          </div>
        )}

        {proposal?.config.dimensions.map((dim) => (
          <DimensionCard
            key={dim.name}
            dim={dim}
            accepted={accepted[dim.name] ?? false}
            onToggle={() =>
              setAccepted({ ...accepted, [dim.name]: !accepted[dim.name] })
            }
          />
        ))}
      </div>
      <StepFooter
        onBack={onBack}
        onNext={onNext}
        nextLabel={`Save ICP (${acceptedCount} dimensions)`}
        nextDisabled={!proposal || acceptedCount === 0}
      />
    </div>
  );
}

function DimensionCard({
  dim,
  accepted,
  onToggle,
}: {
  dim: IcpDimension;
  accepted: boolean;
  onToggle: () => void;
}) {
  const tierLabels = dim.scoring_tiers
    .filter((t) => t.label)
    .map((t) => t.label)
    .join(" · ");

  return (
    <button
      type="button"
      onClick={onToggle}
      className={cn(
        "flex w-full items-start justify-between gap-3 rounded-lg border p-4 text-left transition-colors",
        accepted
          ? "border-emerald-700/60 bg-emerald-950/20"
          : "border-zinc-800 bg-zinc-900 hover:border-zinc-700",
      )}
    >
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-semibold text-zinc-100">
            {dim.name.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())}
          </h3>
          <span className="rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] font-mono text-zinc-400">
            weight {(dim.weight * 100).toFixed(0)}%
          </span>
        </div>
        <p className="mt-1 text-xs text-zinc-400">{dim.description}</p>
        {tierLabels && (
          <p className="mt-1.5 text-[11px] text-zinc-500">{tierLabels}</p>
        )}
      </div>
      <div
        className={cn(
          "flex size-7 shrink-0 items-center justify-center rounded-full border-2",
          accepted
            ? "border-emerald-500 bg-emerald-500/15 text-emerald-300"
            : "border-zinc-700 text-zinc-600",
        )}
      >
        {accepted ? <Check className="size-4" /> : null}
      </div>
    </button>
  );
}

// ── Step 5: Funnel ───────────────────────────────────────────────────────

function FunnelStep({
  proposal,
  loading,
  accepted,
  setAccepted,
  stageDays,
  setStageDays,
  onBack,
  onNext,
}: {
  proposal: FunnelProposal | null;
  loading: boolean;
  accepted: Record<string, boolean>;
  setAccepted: (next: Record<string, boolean>) => void;
  stageDays: Record<string, number>;
  setStageDays: (next: Record<string, number>) => void;
  onBack: () => void;
  onNext: () => void;
}) {
  const acceptedCount = Object.values(accepted).filter(Boolean).length;

  return (
    <div>
      <StepHeader
        title="Configure funnel benchmarks"
        description={
          proposal?.source === "derived"
            ? "We detected these stages from your pipeline and computed median days at each. Override stall thresholds where it doesn't match how you actually work."
            : "No pipeline data found yet — using common SaaS defaults. You can refine after you log a few real deals."
        }
      />
      <div className="space-y-3 px-6 py-6 sm:px-8">
        {loading && (
          <div className="flex items-center gap-2 text-sm text-zinc-500">
            <Loader2 className="size-4 animate-spin" />
            Reading your pipeline history…
          </div>
        )}

        {proposal?.config.stages.map((stage) => (
          <StageCard
            key={stage.name}
            stage={stage}
            accepted={accepted[stage.name] ?? false}
            days={stageDays[stage.name] ?? stage.expected_velocity_days}
            onToggle={() =>
              setAccepted({ ...accepted, [stage.name]: !accepted[stage.name] })
            }
            onDaysChange={(days) =>
              setStageDays({ ...stageDays, [stage.name]: days })
            }
          />
        ))}
      </div>
      <StepFooter
        onBack={onBack}
        onNext={onNext}
        nextLabel={`Save funnel (${acceptedCount} stages)`}
        nextDisabled={!proposal || acceptedCount === 0}
      />
    </div>
  );
}

function StageCard({
  stage,
  accepted,
  days,
  onToggle,
  onDaysChange,
}: {
  stage: FunnelStage;
  accepted: boolean;
  days: number;
  onToggle: () => void;
  onDaysChange: (days: number) => void;
}) {
  return (
    <div
      className={cn(
        "rounded-lg border p-4 transition-colors",
        accepted
          ? "border-emerald-700/60 bg-emerald-950/20"
          : "border-zinc-800 bg-zinc-900",
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <button
          type="button"
          onClick={onToggle}
          className="flex flex-1 items-start gap-3 text-left"
        >
          <div
            className={cn(
              "flex size-7 shrink-0 items-center justify-center rounded-full border-2",
              accepted
                ? "border-emerald-500 bg-emerald-500/15 text-emerald-300"
                : "border-zinc-700 text-zinc-600",
            )}
          >
            {accepted ? <Check className="size-4" /> : null}
          </div>
          <div className="min-w-0">
            <h3 className="text-sm font-semibold text-zinc-100">{stage.name}</h3>
            <p className="mt-1 text-xs text-zinc-500">{stage.description}</p>
            <p className="mt-1 text-[11px] text-zinc-600">
              Stage type: {stage.stage_type.replace(/_/g, " ")}
            </p>
          </div>
        </button>
        {accepted && stage.stage_type === "active" && (
          <div className="flex shrink-0 items-center gap-2">
            <label className="text-xs text-zinc-500">Median days</label>
            <input
              type="number"
              min={1}
              value={days}
              onChange={(e) => onDaysChange(Number(e.target.value) || 1)}
              className="w-16 rounded-md border border-zinc-700 bg-zinc-950 px-2 py-1 text-sm text-zinc-100 focus:border-violet-500 focus:outline-none"
            />
          </div>
        )}
      </div>
    </div>
  );
}

// ── Step 6: Preferences ──────────────────────────────────────────────────

// Mirror the narrowed enum unions defined on the wizard's parent state.
// Keeping these inline (vs. exported from a types file) because the shape
// is local to this file and nothing else needs to import it.
type PreferencesRole = 'rep' | 'csm' | 'ad' | 'manager' | 'revops' | 'admin'
type PreferencesAlertFreq = 'high' | 'medium' | 'low'
type PreferencesCommStyle = 'formal' | 'casual' | 'brief'
type PreferencesOutreachTone = 'professional' | 'consultative' | 'direct' | 'warm' | 'executive'

interface PreferencesStepProps {
  role: PreferencesRole;
  setRole: (v: PreferencesRole) => void;
  alertFreq: PreferencesAlertFreq;
  setAlertFreq: (v: PreferencesAlertFreq) => void;
  commStyle: PreferencesCommStyle;
  setCommStyle: (v: PreferencesCommStyle) => void;
  outreachTone: PreferencesOutreachTone;
  setOutreachTone: (v: PreferencesOutreachTone) => void;
  focusStage: string;
  setFocusStage: (v: string) => void;
  slackId: string;
  setSlackId: (v: string) => void;
  saving: boolean;
  error: string | null;
  onBack: () => void;
  onFinish: () => void;
}

function PreferencesStep(p: PreferencesStepProps) {
  return (
    <div>
      <StepHeader
        title="A bit about you"
        description="We'll use this to pick the right agent surface and tune the tone of every output."
      />
      <div className="space-y-5 px-6 py-6 sm:px-8">
        <Field label="Your role" hint="Determines which dashboards and skills you see by default.">
          <select
            value={p.role}
            onChange={(e) => p.setRole(e.target.value as PreferencesRole)}
            className="w-full rounded-md border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-100 focus:border-violet-500 focus:outline-none"
          >
            <option value="rep">Account Executive (AE)</option>
            <option value="csm">Customer Success Manager (CSM)</option>
            <option value="ad">Account Director (AD)</option>
            <option value="manager">Sales Leader</option>
            <option value="revops">RevOps</option>
            <option value="admin">Admin</option>
          </select>
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Alert frequency" hint="How often should we ping you?">
            <select
              value={p.alertFreq}
              onChange={(e) => p.setAlertFreq(e.target.value as PreferencesAlertFreq)}
              className="w-full rounded-md border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-100 focus:border-violet-500 focus:outline-none"
            >
              <option value="high">High — every signal and stall</option>
              <option value="medium">Medium — important alerts only</option>
              <option value="low">Low — daily briefing only</option>
            </select>
          </Field>
          <Field label="Communication style" hint="How the assistant talks to you.">
            <select
              value={p.commStyle}
              onChange={(e) => p.setCommStyle(e.target.value as PreferencesCommStyle)}
              className="w-full rounded-md border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-100 focus:border-violet-500 focus:outline-none"
            >
              <option value="brief">Brief and direct</option>
              <option value="formal">Formal and structured</option>
              <option value="casual">Casual and conversational</option>
            </select>
          </Field>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Outreach tone" hint="Default voice for drafted messages.">
            <select
              value={p.outreachTone}
              onChange={(e) => p.setOutreachTone(e.target.value as PreferencesOutreachTone)}
              className="w-full rounded-md border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-100 focus:border-violet-500 focus:outline-none"
            >
              {/* Match the OutreachTone enum in saveOnboardingPreferences */}
              <option value="professional">Professional</option>
              <option value="consultative">Consultative</option>
              <option value="direct">Direct</option>
              <option value="warm">Warm</option>
              <option value="executive">Executive</option>
            </select>
          </Field>
          <Field label="Focus stage" hint="Where you want extra coaching.">
            <select
              value={p.focusStage}
              onChange={(e) => p.setFocusStage(e.target.value)}
              className="w-full rounded-md border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-100 focus:border-violet-500 focus:outline-none"
            >
              <option value="">All stages</option>
              <option value="Lead">Lead</option>
              <option value="Qualified">Qualified</option>
              <option value="Proposal">Proposal</option>
              <option value="Negotiation">Negotiation</option>
            </select>
          </Field>
        </div>

        <Field
          label="Slack user ID (optional)"
          hint="We'll DM you alerts and briefs here if set. Find it in Slack: profile → ⋮ → Copy member ID."
        >
          <input
            value={p.slackId}
            onChange={(e) => p.setSlackId(e.target.value)}
            placeholder="U01ABCDEF"
            className="w-full rounded-md border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-100 focus:border-violet-500 focus:outline-none"
          />
        </Field>

        {p.error && (
          <div
            role="alert"
            aria-live="assertive"
            className="rounded-md border border-rose-800/40 bg-rose-950/30 px-3 py-2 text-sm text-rose-200"
          >
            {p.error}
          </div>
        )}
      </div>
      <StepFooter
        onBack={p.onBack}
        onNext={p.onFinish}
        nextLabel={p.saving ? "Finishing…" : "Take me to my inbox"}
        nextLoading={p.saving}
      />
    </div>
  );
}

// ── Shared form helpers ──────────────────────────────────────────────────

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="block text-sm font-medium text-zinc-200">{label}</label>
      <p className="mt-0.5 text-xs text-zinc-500">{hint}</p>
      <div className="mt-2">{children}</div>
    </div>
  );
}
