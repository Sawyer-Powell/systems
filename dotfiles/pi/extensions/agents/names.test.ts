import assert from "node:assert/strict";
import { test } from "node:test";
import { agentLabel, agentName } from "./names.ts";
import { mkInput, useTempStore } from "./test-support.ts";

const root = { input: mkInput("main.r.0001", null, { name: "parent" }) };
const child = { input: mkInput("worker.c.0002", root.input.id, { name: "child" }) };
const grandchild = mkInput("worker.g.0003", child.input.id, { name: "subchild" });

test("lineage names follow parent IDs regardless of order and preserve addressing", () => {
	assert.equal(agentName(grandchild, [child, root]), "parent::child::subchild");
	assert.equal(agentName(grandchild, [root, child], { relativeTo: root.input.id }), "child::subchild");
	assert.equal(agentName(grandchild, [root, child], { relativeTo: child.input.id }), "subchild");
	assert.equal(grandchild.id, "worker.g.0003");
	assert.equal(agentName(root.input), "parent");
});

test("missing names/ancestors and cycles have deterministic safe fallbacks", () => {
	assert.equal(agentName(grandchild), "worker.c.0002::subchild");
	assert.equal(agentName({ ...root.input, name: "" }), root.input.id);
	assert.equal(agentName({ ...root.input, parent: child.input.id }, [child]), "child::parent");
	assert.equal(agentName({ ...root.input, name: "a\nb\x1b" }), "a b ");
	assert.equal(agentName({ ...root.input, name: "x".repeat(120) }, [], { maxLength: 96 }), `…${"x".repeat(95)}`);
});

const tmp = useTempStore("agents-names-");
test("store adapter resolves lineage and leaves external/unknown senders intact", () => {
	tmp.store.create(root.input); tmp.store.create(child.input); tmp.store.create(grandchild);
	assert.equal(agentLabel(tmp.store, grandchild.id), "parent::child::subchild");
	assert.equal(agentLabel(tmp.store, "user"), "user");
	assert.equal(agentLabel(tmp.store, "user:human"), "user:human");
});
