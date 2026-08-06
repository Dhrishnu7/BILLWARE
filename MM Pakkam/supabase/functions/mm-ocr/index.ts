/**
 * mm-ocr — read a supplier invoice with a vision model.
 *
 * WHY THIS EXISTS
 * ---------------
 * Tesseract is a character-shape matcher. It has no idea what an invoice is,
 * which is why js/ocr-*.js grew ~78 KB of code re-deriving meaning it threw
 * away: grouping words into rows, guessing column boundaries, erasing grid
 * lines welded onto characters, repairing decimal points from line totals,
 * fuzzy-matching mangled product names against the shop's catalogue.
 *
 * Measured against a 30-figure known-answer list on a real pharma invoice,
 * that whole stack peaked around 8/30 on a phone photo. The remaining errors
 * were character-level (BT4416 for BT4419) — the engine's floor, not the
 * parser's. A vision model reads the table as a table, so none of the
 * reconstruction is needed and low-resolution photos stop being fatal.
 *
 * THE KEY LIVES HERE, NOT IN THE BROWSER
 * --------------------------------------
 * ANTHROPIC_API_KEY is a billable secret. Anything shipped to the browser is
 * public, so the call is made from this function and the browser only ever
 * sends a photo. Every caller must present a real Supabase Auth token — the
 * anon publishable key is NOT enough, or this becomes an open Claude proxy
 * for anyone who opens devtools.
 *
 * DEPLOY: paste into Supabase → Edge Functions → mm-ocr.
 * SECRETS: ANTHROPIC_API_KEY (required), MM_OCR_DAILY_CAP (optional, default 60).
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const MODEL = 'claude-opus-5';

/* 6 MB of base64 is roughly a 4.5 MB photo. Above that the upload is slower
   than the scan and the model gains nothing — the client already downscales
   to 2400px, which is what the high-resolution vision tier reads at. */
const MAX_B64_BYTES = 6 * 1024 * 1024;
const MAX_PDF_B64_BYTES = 24 * 1024 * 1024;

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}

/* ── The schema IS the contract ─────────────────────────────────────────
   Every field is a STRING and every field is required. Two reasons:

   1. Downstream wants strings. purchase.html builds `dataRows` of strings
      and _parseExpiry / parseFloat do their own coercion. Numbers here
      would only be stringified again, and "0" would become indistinguishable
      from "not printed".
   2. Nullable numbers need anyOf gymnastics that structured outputs handles
      poorly. An empty string is an unambiguous "this was not readable",
      which is exactly the distinction that matters on a batch number. */
const LINE_PROPS = {
  productName: { type: 'string', description: 'Product/medicine name exactly as printed, including strength (e.g. "AZTHRAL 500 TAB"). Empty string if unreadable.' },
  pack: { type: 'string', description: 'Pack size as printed, e.g. "10X10", "60ML", "1X15". Empty string if not printed.' },
  hsn: { type: 'string', description: 'HSN code, usually 4-8 digits. Empty string if not printed.' },
  batchNo: { type: 'string', description: 'Batch number, transcribed CHARACTER BY CHARACTER. Never guess or normalise. Empty string if not fully legible.' },
  expiry: { type: 'string', description: 'Expiry as MM/YYYY (e.g. "06/2028"). Convert 2-digit years to 4. Empty string if not printed.' },
  quantity: { type: 'string', description: 'Billed quantity as a plain number, excluding free goods. Empty string if not printed.' },
  freeQty: { type: 'string', description: 'Free/scheme quantity as a plain number. Empty string if none.' },
  mrp: { type: 'string', description: 'MRP per unit, digits and one decimal point only, no currency symbol or commas.' },
  rate: { type: 'string', description: 'Purchase rate per unit as printed (the price the shop pays, before tax if the invoice is tax-exclusive). Digits and one decimal point only.' },
  gstPercent: { type: 'string', description: 'GST rate as a plain number without the % sign, e.g. "12". Empty string if not printed on the line.' },
  amount: { type: 'string', description: 'Line amount/value as printed, digits and one decimal point only.' },
  uncertain: {
    type: 'array',
    description: 'Names of THIS line\'s fields you are not confident you read correctly, e.g. ["batchNo","mrp"]. Empty array if confident in all.',
    items: { type: 'string' },
  },
};

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['supplierName', 'invoiceNo', 'invoiceDate', 'subTotal', 'grandTotal', 'taxExclusive', 'lines', 'notes'],
  properties: {
    supplierName: { type: 'string', description: 'Supplier/distributor firm name from the letterhead. Empty string if unreadable.' },
    invoiceNo: { type: 'string', description: 'Invoice/bill number as printed. Empty string if unreadable.' },
    invoiceDate: { type: 'string', description: 'Invoice date as DD/MM/YYYY. Empty string if unreadable.' },
    subTotal: { type: 'string', description: 'The printed Sub Total / taxable value of the goods, digits and one decimal point only. Empty string if not printed.' },
    grandTotal: { type: 'string', description: 'The printed final payable / grand total, digits and one decimal point only. Empty string if not printed.' },
    taxExclusive: { type: 'string', description: 'Exactly "yes" if the line rates are before GST (GST added at the bottom), "no" if the line rates already include GST, "unknown" if it cannot be told.' },
    lines: { type: 'array', items: { type: 'object', additionalProperties: false, required: Object.keys(LINE_PROPS), properties: LINE_PROPS } },
    notes: { type: 'array', description: 'Short plain-English notes for the shopkeeper about anything unclear, cut off, or unusual on this invoice. Empty array if nothing to say.', items: { type: 'string' } },
  },
};

const SYSTEM = `You read Indian pharmaceutical purchase invoices and return their line items.

You are transcribing a legal and financial document that a pharmacy will file GST returns from and trace a drug recall through. Accuracy of transcription matters far more than completeness of output.

RULES

1. TRANSCRIBE, DO NOT INFER. Report what is printed. Never repair, normalise, expand or "correct" a value into what it probably should be. A confidently wrong batch number is worse than a blank one, because nothing downstream can tell it was a guess.

2. WHEN YOU CANNOT READ SOMETHING, RETURN AN EMPTY STRING and name that field in the line's "uncertain" array. A blank the shopkeeper fills in from the paper costs ten seconds. A wrong value costs them a wrong return or an untraceable batch.

3. ONLY PRODUCT LINES. The "lines" array contains the goods rows of the table and nothing else. Exclude the letterhead, addresses, GSTIN/DL numbers, column headings, subtotal and tax rows, amount-in-words, bank details, terms, and any carried-forward or page-total rows.

4. ONE OBJECT PER PRINTED ROW, in the order printed. If a product's name wraps onto a second physical line, that is still one row. If a row is printed but you cannot read its name, still return the row with productName as an empty string — the other fields let the shopkeeper find it on the paper.

5. QUANTITY AND FREE ARE DIFFERENT COLUMNS. Indian pharma invoices bill a quantity and give additional free/scheme goods. Never add them together. Quantity is usually in strips/packs, not tablets.

6. NUMBERS ARE PLAIN. No currency symbols, no thousands separators, one decimal point. "1,499.20" becomes "1499.20".

7. RATE IS WHAT THE SHOP PAYS, MRP IS WHAT THE CUSTOMER PAYS. Rate is always the lower of the two. If you have them the other way round the whole invoice is wrong, so check this before answering.

8. USE THE ARITHMETIC AS A CHECK. On most invoices quantity x rate equals the line amount, and the line amounts sum to the printed Sub Total. Where a figure disagrees, re-read it rather than adjusting it — and if it still disagrees, report what is printed and say so in "notes".

9. If the photo is cut off, blurred, or a page is missing, say so in "notes". Do not pad the output to make it look complete.`;

const USER_TEXT = `Read every product line from this purchase invoice.

Follow the rules exactly. Return empty strings for anything you cannot read with confidence, and list those field names in that line's "uncertain" array.

Before you answer, check that quantity x rate is close to the line amount on each row, and that MRP is not below rate.`;

/* Used only on the no-schema attempt, where the shape has to be asked for in
   words because the API is not enforcing it. */
const USER_TEXT_JSON = USER_TEXT + `

Reply with ONLY a JSON object, no prose around it, in exactly this shape:
{"supplierName":"","invoiceNo":"","invoiceDate":"","subTotal":"","grandTotal":"","taxExclusive":"yes|no|unknown","notes":[],"lines":[{"productName":"","pack":"","hsn":"","batchNo":"","expiry":"MM/YYYY","quantity":"","freeQty":"","mrp":"","rate":"","gstPercent":"","amount":"","uncertain":[]}]}
Every value is a STRING. Use "" for anything not printed or not legible.`;

interface Attempt { fallbacks: boolean; effort: boolean; schema: boolean; label: string }

/* ── Degrade, do not die ───────────────────────────────────────────────
   The optional parts of this request — server-side refusal fallbacks, the
   effort hint, the JSON schema — are each worth having and none of them is
   worth losing the feature over. Different accounts have different betas
   enabled, so a 400 on the richest form must step down rather than fail.

   The FIRST version of this function retried only when the error text
   happened to say "fallback" or "beta", which meant any other 400 became a
   dead end that told the shop to "try a JPG or PNG photo" — advice that had
   nothing to do with the real problem. Guessing which 400s are recoverable
   was the mistake; try the next form and let the API decide. */
const ATTEMPTS: Attempt[] = [
  { fallbacks: true,  effort: true,  schema: true,  label: 'full' },
  { fallbacks: false, effort: true,  schema: true,  label: 'no-fallbacks' },
  { fallbacks: false, effort: false, schema: true,  label: 'no-effort' },
  { fallbacks: false, effort: false, schema: false, label: 'no-schema' },
];

async function callClaude(apiKey: string, contentBlock: unknown, a: Attempt) {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'x-api-key': apiKey,
    'anthropic-version': '2023-06-01',
  };
  const body: Record<string, unknown> = {
    model: MODEL,
    max_tokens: 16000,
    system: SYSTEM,
    messages: [{ role: 'user', content: [contentBlock, { type: 'text', text: a.schema ? USER_TEXT : USER_TEXT_JSON }] }],
  };

  const outputConfig: Record<string, unknown> = {};
  /* Extraction is a perception task, not a reasoning one. Medium keeps
     latency and thinking tokens down without measurably costing accuracy on
     a table read; raise it if a supplier's layout defeats it. */
  if (a.effort) outputConfig.effort = 'medium';
  if (a.schema) outputConfig.format = { type: 'json_schema', schema: SCHEMA };
  if (Object.keys(outputConfig).length) body.output_config = outputConfig;

  /* Safety classifiers can decline a request outright. An invoice will
     essentially never trip one, but a declined request returns HTTP 200 with
     no content, so this costs nothing when unused and turns a dead end into
     an answer if it ever fires. */
  if (a.fallbacks) {
    headers['anthropic-beta'] = 'server-side-fallback-2026-07-01';
    body.fallbacks = 'default';
  }

  return await fetch(ANTHROPIC_URL, { method: 'POST', headers, body: JSON.stringify(body) });
}

/* Without a schema the model writes JSON as ordinary text, which may arrive
   wrapped in a ```json fence or with a sentence in front of it. Pull out the
   outermost object rather than trusting the whole string to parse. */
function looseJson(text: string) {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fenced ? fenced[1] : text;
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('no JSON object in response');
  return JSON.parse(candidate.slice(start, end + 1));
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);

  const apiKey = Deno.env.get('ANTHROPIC_API_KEY');
  if (!apiKey) return json({ error: 'Invoice scanning is not configured on the server yet.' }, 503);

  /* ── Who is asking? ──
     A bare anon key is not an identity. supabase.auth.getUser() rejects the
     publishable key, which is exactly what we want: only a signed-in shop can
     spend money here. */
  const authHeader = req.headers.get('Authorization') || '';
  const token = authHeader.replace(/^Bearer\s+/i, '').trim();
  if (!token) return json({ error: 'Please sign in again before scanning.' }, 401);

  const admin = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    { auth: { persistSession: false } },
  );

  let userId = '';
  try {
    const { data, error } = await admin.auth.getUser(token);
    if (error || !data?.user) return json({ error: 'Your session has expired. Sign in again and retry.' }, 401);
    userId = data.user.id;
  } catch (_) {
    return json({ error: 'Could not verify your sign-in. Try again.' }, 401);
  }

  let payload: { image?: string; mimeType?: string; kind?: string };
  try {
    payload = await req.json();
  } catch (_) {
    return json({ error: 'Bad request.' }, 400);
  }

  const b64 = String(payload.image || '').replace(/^data:[^;]+;base64,/, '');
  const mime = String(payload.mimeType || 'image/jpeg');
  const isPdf = payload.kind === 'pdf' || mime === 'application/pdf';
  if (!b64) return json({ error: 'No image was received.' }, 400);

  const cap = isPdf ? MAX_PDF_B64_BYTES : MAX_B64_BYTES;
  if (b64.length > cap) {
    return json({ error: 'That file is too large to scan. Take the photo again at a normal size, or send fewer pages.' }, 413);
  }

  /* ── Daily cap, per shop ──
     The operator pays this bill, not the shop, so an unbounded loop or a
     bored user with a camera roll is a real cost. Best-effort: if the table
     has not been created the scan still runs, because a missing migration
     must not take the feature down. */
  const dailyCap = Number(Deno.env.get('MM_OCR_DAILY_CAP') || '60');
  const today = new Date().toISOString().slice(0, 10);
  try {
    const { count, error } = await admin
      .from('ocr_usage')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('day', today);
    if (!error && typeof count === 'number' && count >= dailyCap) {
      return json({ error: `You have scanned ${count} invoices today, which is the daily limit. Type this one in, or try again tomorrow.` }, 429);
    }
  } catch (_) { /* table missing — allow */ }

  const contentBlock = isPdf
    ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: b64 } }
    : { type: 'image', source: { type: 'base64', media_type: mime, data: b64 } };

  let res: Response | null = null;
  let used: Attempt = ATTEMPTS[0];
  let lastDetail = '';

  for (let i = 0; i < ATTEMPTS.length; i++) {
    used = ATTEMPTS[i];
    const r = await callClaude(apiKey, contentBlock, used);
    if (r.status !== 400) { res = r; break; }
    /* A 400 is the API telling us this exact request shape is not available
       here. Record WHY — verbatim — and try the next form down. */
    lastDetail = (await r.text()).slice(0, 800);
    console.error(`[mm-ocr] 400 on attempt "${used.label}":`, lastDetail);
    if (i === ATTEMPTS.length - 1) {
      /* Every form was rejected, so the problem is the request itself, not an
         unavailable beta. The real message goes back in `detail` so it lands
         in the browser console instead of dying in a log nobody opens. */
      return json({
        error: 'The scanner rejected this invoice. The exact reason is in the browser console and the function logs.',
        detail: lastDetail,
      }, 400);
    }
  }

  if (!res) return json({ error: 'The scanner could not be reached.', detail: lastDetail }, 502);
  if (used.label !== 'full') console.warn('[mm-ocr] succeeded on degraded attempt:', used.label);

  if (!res.ok) {
    const txt = await res.text();
    console.error('[mm-ocr] Anthropic error', res.status, txt.slice(0, 800));
    if (res.status === 429) return json({ error: 'The scanner is busy right now. Wait a minute and try again.', detail: txt.slice(0, 400) }, 429);
    if (res.status === 401) return json({ error: 'The scanner\'s API key is missing or wrong. (Server setup — not your device.)', detail: txt.slice(0, 400) }, 503);
    if (res.status === 403) return json({ error: 'The scanner\'s API account has no credit, or the key lacks permission. (Server setup — not your device.)', detail: txt.slice(0, 400) }, 503);
    return json({ error: 'The scanner could not be reached. Check your connection and try again.', detail: txt.slice(0, 400) }, 502);
  }

  const msg = await res.json();

  /* stop_reason is checked BEFORE content is read. On a refusal the content
     array is empty, and on max_tokens the JSON is truncated — indexing
     content[0] blind turns either into an unexplained crash. */
  if (msg.stop_reason === 'refusal') {
    return json({ error: 'The scanner declined to read this file. If it is a normal supplier invoice, please report this.' }, 422);
  }
  if (msg.stop_reason === 'max_tokens') {
    return json({ error: 'This invoice has more lines than one scan can hold. Photograph it in two halves and scan each.' }, 413);
  }

  const textBlock = (msg.content || []).find((b: { type: string }) => b.type === 'text');
  if (!textBlock || !textBlock.text) {
    console.error('[mm-ocr] no text block:', JSON.stringify(msg).slice(0, 600));
    return json({ error: 'The scanner returned nothing readable. Please try again.' }, 502);
  }

  let parsed;
  try {
    /* With a schema the whole text block IS the JSON. Without one it may be
       fenced or prefaced, so fall back to pulling the outermost object. */
    parsed = used.schema ? JSON.parse(textBlock.text) : looseJson(textBlock.text);
  } catch (_) {
    console.error('[mm-ocr] unparseable JSON:', String(textBlock.text).slice(0, 800));
    return json({ error: 'The scanner returned a malformed result. Please try again.' }, 502);
  }
  if (!parsed || !Array.isArray(parsed.lines)) {
    console.error('[mm-ocr] result had no lines array:', JSON.stringify(parsed).slice(0, 400));
    return json({ error: 'The scanner did not return any invoice lines. Please try again.' }, 502);
  }

  // Best-effort usage log — never blocks the answer.
  try {
    await admin.from('ocr_usage').insert({
      user_id: userId,
      day: today,
      lines: Array.isArray(parsed.lines) ? parsed.lines.length : 0,
      input_tokens: msg.usage?.input_tokens ?? null,
      output_tokens: msg.usage?.output_tokens ?? null,
      model: msg.model || MODEL,
    });
  } catch (_) { /* ignore */ }

  return json({
    ok: true,
    result: parsed,
    engine: msg.model || MODEL,
    usage: msg.usage || null,
  });
});
