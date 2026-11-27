import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { z } from "zod";
import { assertSameOrigin, requireRequestActor } from "@/server/auth/session";
import { createMission, listMissions } from "@/server/missions/workflow";
import { checkIdempotency, saveIdempotency } from "@/server/audit/service";
import { errorJson, okJson } from "@/server/errors";

export const runtime = "nodejs";

const TaskSchema = z.object({
  tempKey: z.string().optional(),
  title: z.string().min(2, "Tên task tối thiểu 2 ký tự.").max(200),
  description: z.string().max(4000).optional(),
  deliverable: z.string().max(1000).optional(),
  requiresArtifact: z.boolean().optional(),
  ownerTeamId: z.string().uuid("Chọn tổ phụ trách hợp lệ."),
  collaboratingTeamIds: z.array(z.string().uuid()).optional(),
  ownerId: z.string().uuid().optional(),
  reviewerId: z.string().uuid().nullable().optional(),
  supervisorIds: z.array(z.string().uuid()).optional(),
  submissionMode: z.enum(["INDIVIDUAL", "SHARED"]).optional(),
  required: z.boolean().optional(),
  weight: z.number().positive().max(20).optional(),
  urgency: z.enum(["FLASH", "VERY_URGENT", "URGENT", "NORMAL"]).optional(),
  importance: z.enum(["KEY", "NORMAL"]).optional(),
  deadline: z.string().min(1),
  assigneeIds: z.array(z.string().uuid()).optional(),
  assigneeWeights: z.record(z.string(), z.number().positive()).optional(),
  predecessorTempKeys: z.array(z.string()).optional(),
  metricEnabled: z.boolean().optional(),
  metricUnit: z.string().max(80).optional(),
  metricTarget: z.number().positive().nullable().optional(),
  metricPointsPerUnit: z.number().positive().max(100).optional(),
});

const CreateMissionSchema = z.object({
  groupId: z.string().uuid("Chọn khối nhiệm vụ hợp lệ."),
  title: z.string().min(3, "Tên nhiệm vụ tối thiểu 3 ký tự.").max(240),
  description: z.string().min(3, "Mô tả yêu cầu tối thiểu 3 ký tự.").max(8000),
  expectedOutcome: z.string().max(4000).optional(),
  refs: z.array(z.object({ label: z.string().min(1), url: z.string().url("Link Ref không hợp lệ.") })).optional(),
  directiveAuthorities: z.array(z.string().min(1).max(200)).max(20).optional(),
  confidentiality: z.enum(["NORMAL", "CONFIDENTIAL", "TOP_SECRET"]).optional(),
  ownerId: z.string().uuid("Chọn người chủ trì hợp lệ."),
  teamIds: z.array(z.string().uuid()).optional(),
  importance: z.enum(["KEY", "NORMAL"]).optional(),
  urgency: z.enum(["FLASH", "VERY_URGENT", "URGENT", "NORMAL"]).optional(),
  urgencyOverrideReason: z.string().max(500).optional(),
  deadline: z.string().min(1, "Bắt buộc nhập deadline."),
  startsAt: z.string().optional(),
  completionMode: z.enum(["TASKS_ONLY", "TASKS_AND_PUBLICATIONS", "PUBLICATIONS_ONLY"]).optional(),
  completionModeReason: z.string().max(500).optional(),
  publicationChannels: z
    .array(
      z.object({
        channelId: z.string().uuid(),
        customChannelName: z.string().max(160).optional(),
        required: z.boolean().optional(),
        requiredCount: z.number().int().min(1).max(20).optional(),
      }),
    )
    .optional(),
  tasks: z.array(TaskSchema).default([]),
  saveAsDraft: z.boolean().optional(),
});

export async function GET(request: NextRequest) {
  try {
    const actor = await requireRequestActor(request);
    const url = new URL(request.url);
    const missions = await listMissions(actor, {
      groupId: url.searchParams.get("groupId") ?? undefined,
      teamId: url.searchParams.get("teamId") ?? undefined,
      status: url.searchParams.get("status") ?? undefined,
      urgency: url.searchParams.get("urgency") ?? undefined,
      importance: url.searchParams.get("importance") ?? undefined,
      search: url.searchParams.get("q") ?? undefined,
      overdueOnly: url.searchParams.get("overdueOnly") === "true",
      limit: Number(url.searchParams.get("limit")) || 50,
      offset: Number(url.searchParams.get("offset")) || 0,
    });
    return okJson(missions);
  } catch (err) {
    return errorJson(err);
  }
}

export async function POST(request: NextRequest) {
  try {
    assertSameOrigin(request);
    const actor = await requireRequestActor(request);
    const raw = await request.json();
    const idemKey = request.headers.get("idempotency-key");
    const idem = await checkIdempotency(actor.memberId, "mission.create", idemKey, raw);
    if (idem.hit) {
      return NextResponse.json(idem.body, { status: idem.status });
    }

    const input = CreateMissionSchema.parse(raw);
    const created = await createMission(actor, input);
    const responseBody = { data: created };
    await saveIdempotency(actor.memberId, "mission.create", idemKey, idem.hash, 201, responseBody);
    return okJson(created, 201);
  } catch (err) {
    return errorJson(err);
  }
}
