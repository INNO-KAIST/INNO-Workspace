// Desktop result delivery receipts (protocol 1) turn on only for the exact string "1",
// on the Worker (wrangler vars) and the desktop connector (process environment) separately.
// See docs/DELIVERY-ACTIVATION.md for the order, checks and rollback.
export function deliveryReceiptVersionFromEnvironment(env) {
  return env?.INNO_DESKTOP_RECEIPT_VERSION === '1' ? 1 : 0;
}
