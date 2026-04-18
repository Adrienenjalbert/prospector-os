"use client";

import { Sparkles } from "lucide-react";

import {
  resolveSkillPrompt,
  type Skill,
  type SkillContext,
} from "@/lib/agent/skills";
import { cn } from "@/lib/utils";

export interface SkillBarProps {
  skills: Skill[];
  context?: SkillContext;
  pageContext?: { page: string; accountId?: string; dealId?: string };
  className?: string;
  variant?: "row" | "stack";
}

/**
 * Horizontal row of skill chips. Each chip dispatches an event the dashboard
 * shell listens to. No empty text input, no chat thread — every action is a
 * single click with full context already loaded.
 */
export function SkillBar({
  skills,
  context,
  pageContext,
  className,
  variant = "row",
}: SkillBarProps) {
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
    <div
      className={cn(
        variant === "row"
          ? "flex flex-wrap items-center gap-2"
          : "flex flex-col gap-2",
        className,
      )}
      role="toolbar"
      aria-label="AI skill shortcuts"
    >
      {skills.map((skill) => (
        <button
          key={skill.id}
          type="button"
          onClick={() => trigger(skill)}
          title={skill.description}
          className="group inline-flex items-center gap-2 rounded-full border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-xs font-medium text-zinc-200 transition-all hover:border-violet-600/60 hover:bg-violet-600/10 hover:text-violet-100"
        >
          <Sparkles className="size-3.5 text-violet-300 transition-colors group-hover:text-violet-200" />
          {skill.label}
        </button>
      ))}
    </div>
  );
}
