"use client";

import { ChevronRight } from "lucide-react";

import {
  resolveSkillPrompt,
  type Skill,
  type SkillContext,
} from "@/lib/agent/skills";
import { cn } from "@/lib/utils";

export interface NextStepCardProps {
  question: string;
  skills: Skill[];
  context?: SkillContext;
  pageContext?: { page: string; accountId?: string; dealId?: string };
  helperText?: string;
  className?: string;
}

/**
 * Multi-choice "what do you want to do next?" card. For users who don't know
 * what to type, this is the primary entry point — choose one of 3-5 options
 * and the panel opens with that action pre-filled.
 */
export function NextStepCard({
  question,
  skills,
  context,
  pageContext,
  helperText,
  className,
}: NextStepCardProps) {
  if (skills.length === 0) return null;

  function trigger(skill: Skill) {
    const prompt = resolveSkillPrompt(skill, context ?? {});
    window.dispatchEvent(
      new CustomEvent("prospector:open-agent-panel", {
        detail: {
          agent: skill.agent,
          prompt,
          pageContext,
          panelTitle: skill.label,
        },
      }),
    );
  }

  return (
    <section
      className={cn(
        "rounded-xl border border-zinc-800 bg-gradient-to-br from-zinc-900 to-zinc-950 p-4",
        className,
      )}
      aria-label={question}
    >
      <header>
        <h3 className="text-sm font-semibold text-zinc-100">{question}</h3>
        {helperText && (
          <p className="mt-1 text-xs text-zinc-500">{helperText}</p>
        )}
      </header>
      <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {skills.map((skill) => (
          <button
            key={skill.id}
            type="button"
            onClick={() => trigger(skill)}
            className="group flex items-start justify-between gap-3 rounded-lg border border-zinc-800 bg-zinc-900 p-3 text-left transition-all hover:border-violet-600/60 hover:bg-violet-600/10"
          >
            <div className="min-w-0">
              <div className="text-sm font-medium text-zinc-100 group-hover:text-violet-100">
                {skill.label}
              </div>
              {skill.description && (
                <div className="mt-1 line-clamp-2 text-xs text-zinc-500 group-hover:text-zinc-400">
                  {skill.description}
                </div>
              )}
            </div>
            <ChevronRight className="mt-0.5 size-4 shrink-0 text-zinc-600 transition-colors group-hover:text-violet-300" />
          </button>
        ))}
      </div>
    </section>
  );
}
