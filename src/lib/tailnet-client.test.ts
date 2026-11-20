import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { tailnetClientHeader } from "./tailnet-client.ts";

describe("tailnet address relayed to the back office", () => {
  it("passes a Tailscale IPv4 address only", () => {
    assert.deepEqual(tailnetClientHeader(" 100.100.142.115 "), { "X-Tailnet-Client": "100.100.142.115" });
    assert.deepEqual(tailnetClientHeader("100.64.0.1"), { "X-Tailnet-Client": "100.64.0.1" });
    assert.deepEqual(tailnetClientHeader("100.128.0.1"), {});
    assert.deepEqual(tailnetClientHeader("10.0.0.1"), {});
    assert.deepEqual(tailnetClientHeader("100.70.1.2, 1.2.3.4"), {});
    assert.deepEqual(tailnetClientHeader(null), {});
  });
});
