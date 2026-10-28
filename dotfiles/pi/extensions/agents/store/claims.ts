/**
 * Claims log: what this conversation (one session branch) says it did. Appended to the
 * session as custom entries, so claims are forked/cloned with the session and rewound by
 * `/tree`. The store stays the authority on what is true now: claims never decide liveness.
 * Pure; no pi imports.
 */
import type { AgentInput, AgentRecord } from "./types.ts";

export const SPAWN_ENTRY = "agents.spawn";
export const RESULT_ENTRY = "agents.result";

export const CLAIM_OBJECTIVE_CHARS = 200;
export const CLAIM_SUMMARY_CHARS = 300;

export interface SpawnClaim {
	id: string;
	role: string;
	name: string;
	/** First CLAIM_OBJECTIVE_CHARS characters. */
	objective: string;
	profile: string;
	ts: number;
}

export interface ResultClaim {
	id: string;
	status: string;
	/** At most CLAIM_SUMMARY_CHARS characters. */
	summary: string;
	ts: number;
}

export interface Claim {
	spawn: SpawnClaim;
	result?: ResultClaim;
}

export const spawnClaim = (input: AgentInput, ts: number): SpawnClaim => ({
	id: input.id,
	role: input.role,
	name: input.name,
	objective: input.objective.slice(0, CLAIM_OBJECTIVE_CHARS),
	profile: input.profile.name,
	ts,
});

export const resultClaim = (id: string, status: string, body: string, ts: number): ResultClaim => ({
	id,
	status,
	summary: body.slice(0, CLAIM_SUMMARY_CHARS),
	ts,
});

interface EntryLike {
	type: string;
	customType?: string;
	data?: unknown;
}

/**
 * Claims on a session branch (`getBranch()`), by agent id. The latest result wins; a result
 * whose spawn is not on this branch is ignored.
 */
export function claimsFromBranch(entries: Iterable<EntryLike>): Map<string, Claim> {
	const claims = new Map<string, Claim>();
	for (const entry of entries) {
		if (entry.type !== "custom") continue;
		const data = entry.data as { id?: unknown } | undefined;
		if (typeof data?.id !== "string") continue;
		if (entry.customType === SPAWN_ENTRY) claims.set(data.id, { spawn: data as SpawnClaim });
		else if (entry.customType === RESULT_ENTRY) {
			const claim = claims.get(data.id);
			if (claim) claim.result = data as ResultClaim;
		}
	}
	return claims;
}

export interface Reconciled {
	/** Claimed in this branch, absent from the store. */
	unknown: Claim[];
	/** In the store (children of `selfId`), not claimed in this branch. */
	otherBranch: Set<string>;
}

/**
 * Compare this branch's claims with the store: `exists` says whether an agent has a record,
 * `children` are the store's agents whose parent is this one. A claimed agent that exists but
 * is not our child (a fork's inherited agent) is neither unknown nor another branch's.
 */
export function reconcileClaims(claims: Map<string, Claim>, children: AgentRecord[], exists: (id: string) => boolean): Reconciled {
	return {
		// Only a spawn with no result is interesting once its record is gone.
		unknown: [...claims.values()].filter((claim) => !claim.result && !exists(claim.spawn.id)),
		otherBranch: new Set(children.map((child) => child.input.id).filter((id) => !claims.has(id))),
	};
}
