import { beforeEach, describe, expect, it } from "vitest";
import { checkRateLimit, clientKey, resetRateLimits } from "./rateLimit";

describe("checkRateLimit", () => {
  beforeEach(() => resetRateLimits());

  it("allows up to the limit within the window, then blocks", () => {
    const now = 1_000_000;
    for (let i = 0; i < 3; i += 1) {
      expect(checkRateLimit("k", 3, 60_000, now + i).allowed).toBe(true);
    }
    const blocked = checkRateLimit("k", 3, 60_000, now + 10);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterSec).toBe(60);
  });

  it("allows again once old hits leave the window", () => {
    const now = 1_000_000;
    checkRateLimit("k", 1, 1_000, now);
    expect(checkRateLimit("k", 1, 1_000, now + 500).allowed).toBe(false);
    expect(checkRateLimit("k", 1, 1_000, now + 1_001).allowed).toBe(true);
  });

  it("tracks keys independently", () => {
    checkRateLimit("a", 1, 60_000, 0);
    expect(checkRateLimit("b", 1, 60_000, 0).allowed).toBe(true);
  });
});

describe("clientKey", () => {
  it("uses the first x-forwarded-for address", () => {
    const request = new Request("http://x", { headers: { "x-forwarded-for": "1.2.3.4, 10.0.0.1" } });
    expect(clientKey(request, "generate")).toBe("generate:1.2.3.4");
  });
});
