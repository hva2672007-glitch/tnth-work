import type { NextRequest } from "next/server";
import { getRequestActor } from "@/server/auth/session";
import { getConfig } from "@/server/config";
import { can } from "@/server/authorization/policy";
import { errorJson, okJson } from "@/server/errors";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  try {
    const actor = await getRequestActor(request);
    if (!actor) {
      return okJson({
        authenticated: false,
        authMode: getConfig().portalAuthMode,
        actor: null,
      });
    }
    return okJson({
      authenticated: true,
      authMode: getConfig().portalAuthMode,
      actor,
      capabilities: {
        canCreateMission: can(actor, "mission.create"),
        canManageTeams: can(actor, "team.manage"),
        canManageGroups: can(actor, "group.manage"),
        canManageChannels: can(actor, "channel.manage"),
        canGrantAccess: can(actor, "member.access.grant"),
        canGrantCollaboratorOnly: actor.role === "TEAM_DEPUTY",
        canSearchPortal: can(actor, "portal.accounts.search"),
        canRequestPortalPerms: can(actor, "portal.permissions.request"),
        canProposeRegulation: can(actor, "regulation.propose"),
        canPromoteHead: can(actor, "member.role.promote_head"),
        canFinalizeKpi: can(actor, "kpi.finalize"),
        canViewAudit: can(actor, "audit.view"),
        canManageSettings: can(actor, "settings.manage"),
        canRecordConduct: can(actor, "conduct.create"),
        canViewAllConduct: can(actor, "conduct.view_all"),
        canSubmitDossier: can(actor, "conduct.submit_dossier"),
        canAccessCouncil: can(actor, "council.access"),
        canConcludeCouncil: can(actor, "council.conclude"),
        canSubmitInitiative: can(actor, "initiative.submit"),
        canReviewInitiative: can(actor, "initiative.review"),
        canViewGraphics: can(actor, "graphics.view"),
        canManageGraphics: can(actor, "graphics.manage"),
        isObserver: actor.role === "OBSERVER",
      },
    });
  } catch (err) {
    return errorJson(err);
  }
}
