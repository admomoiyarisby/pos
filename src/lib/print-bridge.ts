// ============================================================
// Cleanter print bridge — the transport between this web app and a
// Bluetooth Classic (ESC/POS) thermal printer on an Android tablet.
//
// Cleanter (https://cleanter.cleancode.id/docs) is a free Android app
// that runs a localhost-only HTTP server on the tablet. We POST a
// receipt as JSON; Cleanter converts it into ESC/POS bytes and sends
// them to a printer already paired in Android settings. No SDK, no
// driver, no cloud — and the page never touches Bluetooth itself,
// which browsers cannot do for Bluetooth Classic printers.
//
// The bridge and the web app must run on the same tablet, so a missing
// bridge is the normal case on desktop: callers keep the browser print
// dialog as the fallback.
// ============================================================

import { z } from "zod";

/** Cleanter listens on loopback only; the port is not configurable. */
const BRIDGE_URL = "http://localhost:9100";

/**
 * /print answers only once the printer has taken the job, so it can block
 * for a few seconds while a slow head works through a long receipt. A
 * refused connection (no bridge installed) fails immediately, so a long
 * timeout costs nothing on desktop and never turns one print into two
 * through the caller's fallback path.
 */
const BRIDGE_TIMEOUT_MS = 20_000;

export type BridgeAlign = "left" | "center" | "right";
export type BridgeTextSize = "small" | "normal" | "large";
export type BridgeBarcodeFormat = "EAN13" | "CODE128" | "CODE39";

/**
 * One printable line, in the order submitted. Cleanter pads `row` out to
 * the paper width, so column alignment is its job; ours is the content.
 */
export type BridgeBlock =
  | {
      type: "text";
      text: string;
      align?: BridgeAlign;
      bold?: boolean;
      underline?: boolean;
      size?: BridgeTextSize;
    }
  | { type: "row"; left: string; right: string; bold?: boolean }
  | { type: "divider"; char?: string }
  | { type: "feed"; lines?: number }
  | { type: "qr"; data: string; size?: number; align?: BridgeAlign }
  | {
      type: "barcode";
      data: string;
      format: BridgeBarcodeFormat;
      align?: BridgeAlign;
      height?: number;
    }
  | { type: "image"; base64: string; align?: BridgeAlign; dither?: boolean };

export interface BridgePrintRequest {
  content: BridgeBlock[];
  /** 80 or 58 (mm) — sets Cleanter's line width to 48 or 32 characters. */
  paperWidth?: number;
  cut?: boolean;
  /**
   * Free label for Cleanter's own job list, so a failed receipt can be
   * identified and reprinted from the tablet. Never printed on paper.
   */
  reference?: string;
}

export type BridgePrintResult =
  | { kind: "printed" }
  /** Nothing answered on this device — caller falls back to the browser. */
  | { kind: "unavailable" }
  /**
   * The bridge answered but could not print. `message` is Cleanter's own
   * copy, written for the person standing at the counter.
   */
  | { kind: "failed"; message: string };

/** A 503 body names the failure and carries a counter-ready `fix` sentence. */
const bridgeErrorSchema = z.object({
  error: z.string().optional(),
  detail: z.string().optional(),
  fix: z.string().optional(),
});

export async function printViaBridge(request: BridgePrintRequest): Promise<BridgePrintResult> {
  let response: Response;
  try {
    response = await fetch(`${BRIDGE_URL}/print`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request),
      // Chrome refuses to let a secure page reach a private address unless the
      // device answers its Private Network Access preflight. Cleanter 1.1.0+
      // does, so the production https:// POS can print without extra setup.
      signal: AbortSignal.timeout(BRIDGE_TIMEOUT_MS),
    });
  } catch {
    return { kind: "unavailable" };
  }

  if (response.ok) return { kind: "printed" };

  const payload = await response.json().catch(() => null);
  const parsed = bridgeErrorSchema.safeParse(payload);
  return {
    kind: "failed",
    message: parsed.success
      ? (parsed.data.fix ?? parsed.data.detail ?? parsed.data.error ?? `HTTP ${response.status}`)
      : `HTTP ${response.status}`,
  };
}
