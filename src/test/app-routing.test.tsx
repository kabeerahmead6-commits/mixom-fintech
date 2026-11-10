import { QueryClient } from "@tanstack/react-query";
import { createRouter, rootRouteId } from "@tanstack/react-router";
import { describe, expect, it } from "vitest";

import { routeTree } from "@/routeTree.gen";
import { isSixDigitMpin, isValidCommissionPercent, isValidWalletTransferAmount } from "@/lib/neobank.validation";

// Match routes without running loaders or rendering: loaders may need a server or
// network the test run lacks, and jsdom never loads the stylesheets React waits on.
describe("App routing", () => {
  it("matches a page for / instead of falling back to not found", () => {
    const router = createRouter({ routeTree, context: { queryClient: new QueryClient() } });

    const matches = router.matchRoutes("/");

    expect(matches.at(-1)?.routeId).not.toBe(rootRouteId);
  });
});

describe("financial input validation", () => {
  it("requires MPINs to be exactly six digits", () => {
    expect(isSixDigitMpin("123456")).toBe(true);
    expect(isSixDigitMpin("12345")).toBe(false);
    expect(isSixDigitMpin("12345a")).toBe(false);
  });

  it("accepts only commission rates between 0 and 100 percent", () => {
    expect(isValidCommissionPercent(0)).toBe(true);
    expect(isValidCommissionPercent(100)).toBe(true);
    expect(isValidCommissionPercent(-0.01)).toBe(false);
    expect(isValidCommissionPercent(100.01)).toBe(false);
  });

  it("requires wallet transaction amounts to be finite and positive", () => {
    expect(isValidWalletTransferAmount(0.01)).toBe(true);
    expect(isValidWalletTransferAmount(0)).toBe(false);
    expect(isValidWalletTransferAmount(-1)).toBe(false);
    expect(isValidWalletTransferAmount(Number.POSITIVE_INFINITY)).toBe(false);
  });
});
