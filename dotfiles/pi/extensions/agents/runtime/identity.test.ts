import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { mkInput, useTempStore } from "../test-support.ts";
import { chooseRoot, ROOT_ENTRY, savedRootId } from "./identity.ts";

const t = useTempStore("agents-identity-");
const entry = (id: unknown, type = "custom", customType = ROOT_ENTRY) => ({ type, customType, data: { id } });

describe("savedRootId", () => {
	it("returns the latest matching entry and ignores other entries", () => {
		assert.equal(savedRootId([entry("a"), { type: "message" }, entry("b"), entry("c", "custom", "other")]), "b");
		assert.equal(savedRootId([{ type: "message" }]), undefined);
		assert.equal(savedRootId([entry(42)]), undefined);
	});
});

describe("chooseRoot", () => {
	const fresh = () => mkInput("main.new.9999", null);

	it("reuses the root recorded in the session (resume shows that session's agents)", () => {
		t.store.create(mkInput("main.old.0001", null, { role: "main" }));
		assert.equal(chooseRoot(t.store, "main.old.0001", undefined, fresh).id, "main.old.0001");
	});
	it("prefers the session's root over the process's previous one", () => {
		t.store.create(mkInput("main.a.0001", null, { role: "main" }));
		t.store.create(mkInput("main.b.0002", null, { role: "main" }));
		const previous = t.store.readInput("main.b.0002");
		assert.equal(chooseRoot(t.store, "main.a.0001", previous, fresh).id, "main.a.0001");
	});
	it("keeps the previous root when the new session has none (/new carries agents forward)", () => {
		t.store.create(mkInput("main.a.0001", null, { role: "main" }));
		assert.equal(chooseRoot(t.store, undefined, t.store.readInput("main.a.0001"), fresh).id, "main.a.0001");
	});
	it("creates a root when nothing is usable", () => {
		assert.equal(chooseRoot(t.store, undefined, undefined, fresh).id, "main.new.9999");
		assert.equal(chooseRoot(t.store, "main.missing.0000", undefined, fresh).id, "main.new.9999");
	});
	it("skips a root another live process holds, and anything that is not a root", () => {
		t.store.create(mkInput("main.held.0001", null, { role: "main" }));
		t.store.acquireLock("main.held.0001", process.ppid); // a different live process
		assert.equal(chooseRoot(t.store, "main.held.0001", undefined, fresh).id, "main.new.9999");
		t.store.create(mkInput("worker.w.0002", "main.held.0001"));
		assert.equal(chooseRoot(t.store, "worker.w.0002", undefined, fresh).id, "main.new.9999");
	});
	it("reuses a root this very process holds (reload)", () => {
		t.store.create(mkInput("main.me.0001", null, { role: "main" }));
		t.store.acquireLock("main.me.0001");
		assert.equal(chooseRoot(t.store, "main.me.0001", undefined, fresh).id, "main.me.0001");
	});
});
