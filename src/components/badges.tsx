"use client";

import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  Flame,
  PauseCircle,
  Send,
  XCircle,
  FileEdit,
  Zap,
} from "lucide-react";
import {
  ACTIVITY_STATUS_LABELS,
  APPROVAL_STATUS_LABELS,
  ASSIGNMENT_STATUS_LABELS,
  IMPORTANCE_LABELS,
  MISSION_STATUS_LABELS,
  ROLE_LABELS,
  TASK_STATUS_LABELS,
  URGENCY_LABELS,
  type ActivityStatus,
  type ApprovalStatus,
  type AssignmentStatus,
  type ImportanceLevel,
  type MemberRole,
  type MissionStatus,
  type TaskStatus,
  type UrgencyLevel,
} from "@/lib/constants";

export function UrgencyBadge({ urgency }: { urgency: UrgencyLevel }) {
  const styles: Record<UrgencyLevel, string> = {
    FLASH: "bg-red-100 text-red-800 border-red-200",
    VERY_URGENT: "bg-orange-100 text-orange-800 border-orange-200",
    URGENT: "bg-amber-100 text-amber-800 border-amber-200",
    NORMAL: "bg-slate-100 text-slate-700 border-slate-200",
  };
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium ${styles[urgency]}`}>
      {urgency === "FLASH" && <Flame className="h-3 w-3" />}
      {urgency === "VERY_URGENT" && <Zap className="h-3 w-3" />}
      {URGENCY_LABELS[urgency]}
    </span>
  );
}

export function ImportanceBadge({ importance }: { importance: ImportanceLevel }) {
  if (importance === "KEY") {
    return (
      <span className="inline-flex items-center rounded-full border border-blue-200 bg-blue-50 px-2 py-0.5 text-xs font-semibold text-blue-700">
        {IMPORTANCE_LABELS[importance]}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center rounded-full border border-slate-200 bg-white px-2 py-0.5 text-xs text-slate-600">
      {IMPORTANCE_LABELS[importance]}
    </span>
  );
}

export function StatusBadge({
  status,
  kind = "mission",
}: {
  status: string;
  kind?: "mission" | "task" | "assignment" | "approval" | "activity";
}) {
  const label =
    kind === "mission"
      ? MISSION_STATUS_LABELS[status as MissionStatus] ?? status
      : kind === "task"
        ? TASK_STATUS_LABELS[status as TaskStatus] ?? status
        : kind === "assignment"
          ? ASSIGNMENT_STATUS_LABELS[status as AssignmentStatus] ?? status
          : kind === "approval"
            ? APPROVAL_STATUS_LABELS[status as ApprovalStatus] ?? status
            : ACTIVITY_STATUS_LABELS[status as ActivityStatus] ?? status;

  let color = "bg-slate-100 text-slate-700 border-slate-200";
  let Icon = Clock;

  if (["COMPLETED", "APPLIED", "ACTIVE", "APPROVED"].includes(status)) {
    color = "bg-emerald-50 text-emerald-800 border-emerald-200";
    Icon = CheckCircle2;
  } else if (["IN_PROGRESS", "ACCEPTED", "READY_TO_APPLY"].includes(status)) {
    color = "bg-blue-50 text-blue-800 border-blue-200";
    Icon = Clock;
  } else if (["SUBMITTED", "AWAITING_REVIEW", "AWAITING_PUBLICATION", "PENDING"].includes(status)) {
    color = "bg-amber-50 text-amber-800 border-amber-200";
    Icon = Send;
  } else if (["REVISION_REQUIRED", "DECLINED", "REJECTED", "STALE", "INACTIVE"].includes(status)) {
    color = "bg-red-50 text-red-800 border-red-200";
    Icon = AlertTriangle;
  } else if (["ON_HOLD", "ON_LEAVE"].includes(status)) {
    color = "bg-purple-50 text-purple-800 border-purple-200";
    Icon = PauseCircle;
  } else if (["CANCELLED", "TRANSFERRED"].includes(status)) {
    color = "bg-slate-100 text-slate-500 border-slate-200 line-through";
    Icon = XCircle;
  } else if (status === "DRAFT") {
    color = "bg-slate-100 text-slate-700 border-dashed border-slate-300";
    Icon = FileEdit;
  }

  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-medium ${color}`}>
      <Icon className="h-3 w-3 shrink-0" />
      <span>{label}</span>
    </span>
  );
}

export function RoleBadge({ role }: { role: MemberRole }) {
  const styles: Record<MemberRole, string> = {
    HEAD: "bg-blue-900 text-white",
    ACTING_HEAD: "bg-blue-700 text-white",
    DEPUTY: "bg-blue-100 text-blue-900 border border-blue-200",
    TEAM_LEAD: "bg-indigo-50 text-indigo-800 border border-indigo-200",
    MEMBER: "bg-slate-100 text-slate-700 border border-slate-200",
  };
  return (
    <span className={`inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium ${styles[role]}`}>
      {ROLE_LABELS[role].code}
    </span>
  );
}
