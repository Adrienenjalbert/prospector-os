"use client";

import { useState } from "react";

type NotificationFrequency = "High" | "Medium" | "Low";
type CommunicationStyle = "Formal" | "Casual" | "Brief";
type OutreachTone = "Professional" | "Consultative" | "Direct";

export default function SettingsPage() {
  const [notificationFrequency, setNotificationFrequency] =
    useState<NotificationFrequency>("Medium");
  const [communicationStyle, setCommunicationStyle] =
    useState<CommunicationStyle>("Brief");
  const [outreachTone, setOutreachTone] =
    useState<OutreachTone>("Professional");
  const [focusStage, setFocusStage] = useState("");
  const [briefingTime, setBriefingTime] = useState("09:00");
  const [monthlyMeetings, setMonthlyMeetings] = useState<number | "">(20);
  const [monthlyProposals, setMonthlyProposals] = useState<number | "">(8);
  const [pipelineValue, setPipelineValue] = useState<number | "">(500_000);
  const [winRate, setWinRate] = useState<number | "">(25);

  function handleSave(e: React.FormEvent) {
    e.preventDefault();
    // Persist to Google Sheets / CRM when wired
  }

  const fieldClass =
    "mt-1 w-full rounded-lg border border-zinc-600 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 outline-none ring-zinc-500 focus:border-zinc-500 focus:ring-2 focus:ring-zinc-500/30";

  return (
    <div className="mx-auto max-w-2xl p-6 sm:p-8">
      <h1 className="text-2xl font-semibold tracking-tight text-zinc-50">
        Settings
      </h1>

      <form onSubmit={handleSave} className="mt-8 flex flex-col gap-8">
        <section className="rounded-xl border border-zinc-800 bg-zinc-800 p-6">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-300">
            Preferences
          </h2>
          <div className="mt-6 flex flex-col gap-5">
            <label className="block">
              <span className="text-sm text-zinc-300">
                Notification frequency
              </span>
              <select
                value={notificationFrequency}
                onChange={(e) =>
                  setNotificationFrequency(
                    e.target.value as NotificationFrequency,
                  )
                }
                className={fieldClass}
              >
                <option value="High">High</option>
                <option value="Medium">Medium</option>
                <option value="Low">Low</option>
              </select>
            </label>
            <label className="block">
              <span className="text-sm text-zinc-300">Communication style</span>
              <select
                value={communicationStyle}
                onChange={(e) =>
                  setCommunicationStyle(e.target.value as CommunicationStyle)
                }
                className={fieldClass}
              >
                <option value="Formal">Formal</option>
                <option value="Casual">Casual</option>
                <option value="Brief">Brief</option>
              </select>
            </label>
            <label className="block">
              <span className="text-sm text-zinc-300">Outreach tone</span>
              <select
                value={outreachTone}
                onChange={(e) =>
                  setOutreachTone(e.target.value as OutreachTone)
                }
                className={fieldClass}
              >
                <option value="Professional">Professional</option>
                <option value="Consultative">Consultative</option>
                <option value="Direct">Direct</option>
              </select>
            </label>
            <label className="block">
              <span className="text-sm text-zinc-300">Focus stage</span>
              <input
                type="text"
                value={focusStage}
                onChange={(e) => setFocusStage(e.target.value)}
                placeholder="e.g. Proposal"
                className={fieldClass}
              />
            </label>
            <label className="block">
              <span className="text-sm text-zinc-300">Daily briefing time</span>
              <input
                type="time"
                value={briefingTime}
                onChange={(e) => setBriefingTime(e.target.value)}
                className={fieldClass}
              />
            </label>
          </div>
        </section>

        <section className="rounded-xl border border-zinc-800 bg-zinc-800 p-6">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-300">
            KPI Targets
          </h2>
          <div className="mt-6 flex flex-col gap-5">
            <label className="block">
              <span className="text-sm text-zinc-300">Monthly meetings</span>
              <input
                type="number"
                min={0}
                value={monthlyMeetings}
                onChange={(e) =>
                  setMonthlyMeetings(
                    e.target.value === "" ? "" : Number(e.target.value),
                  )
                }
                className={fieldClass}
              />
            </label>
            <label className="block">
              <span className="text-sm text-zinc-300">Monthly proposals</span>
              <input
                type="number"
                min={0}
                value={monthlyProposals}
                onChange={(e) =>
                  setMonthlyProposals(
                    e.target.value === "" ? "" : Number(e.target.value),
                  )
                }
                className={fieldClass}
              />
            </label>
            <label className="block">
              <span className="text-sm text-zinc-300">Pipeline value (£)</span>
              <input
                type="number"
                min={0}
                value={pipelineValue}
                onChange={(e) =>
                  setPipelineValue(
                    e.target.value === "" ? "" : Number(e.target.value),
                  )
                }
                className={fieldClass}
              />
            </label>
            <label className="block">
              <span className="text-sm text-zinc-300">Win rate (%)</span>
              <input
                type="number"
                min={0}
                max={100}
                value={winRate}
                onChange={(e) =>
                  setWinRate(
                    e.target.value === "" ? "" : Number(e.target.value),
                  )
                }
                className={fieldClass}
              />
            </label>
          </div>
        </section>

        <div className="flex justify-end">
          <button
            type="submit"
            className="rounded-lg bg-zinc-100 px-5 py-2.5 text-sm font-semibold text-zinc-900 transition-colors hover:bg-zinc-200"
          >
            Save
          </button>
        </div>
      </form>
    </div>
  );
}
