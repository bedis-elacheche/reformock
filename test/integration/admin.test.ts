import { test, before, beforeEach, after } from "node:test";
import assert from "node:assert/strict";

import {
  newApp,
  getToken,
  authHeader,
  multipart,
  UBL_XML,
  CDAR_XML,
  SAMPLE_UBL,
} from "../helpers.ts";
import type { MultipartField } from "../helpers.ts";
import * as store from "../../src/services/store.ts";
import type { FastifyInstance } from "fastify";

let app: FastifyInstance;
let token: string;

before(async () => {
  app = await newApp();
  token = await getToken(app);
});
after(() => app.close());
beforeEach(() => store.resetStore());

function injectFiles(
  fields: { direction?: string; type?: string; trackingId?: string },
  files: { name: string; content: string }[],
) {
  const parts: MultipartField[] = files.map((f) => ({
    name: "files",
    filename: f.name,
    contentType: "application/xml",
    content: f.content,
  }));
  if (fields.direction) {
    parts.push({ name: "flowDirection", value: fields.direction });
  }
  if (fields.type) {
    parts.push({ name: "flowType", value: fields.type });
  }
  if (fields.trackingId) {
    parts.push({ name: "trackingId", value: fields.trackingId });
  }
  const { payload, contentType } = multipart(parts);
  return app.inject({
    method: "POST",
    url: "/v1/admin/inject",
    headers: { ...authHeader(token), "content-type": contentType },
    payload,
  });
}

test("POST /v1/admin/inject imports multiple files and infers types", async () => {
  const res = await injectFiles({ direction: "In", trackingId: "LOT-1" }, [
    { name: "inv.xml", content: UBL_XML },
    { name: "lc.xml", content: CDAR_XML },
  ]);
  assert.equal(res.statusCode, 201);
  const body = res.json();
  assert.equal(body.injected, 2);
  const byName = Object.fromEntries(
    body.flows.map((f: { name: string; flowType: string }) => [f.name, f.flowType]),
  );
  assert.equal(byName["inv.xml"], "SupplierInvoice");
  assert.equal(byName["lc.xml"], "CustomerInvoiceLC");
  assert.ok(body.flows.every((f: { trackingId: string }) => f.trackingId === "LOT-1"));
});

test("POST /v1/admin/inject generates PDF + converted doc for invoices, but not for CDAR", async () => {
  const res = await injectFiles({ direction: "In" }, [
    { name: "invoice.xml", content: SAMPLE_UBL },
    { name: "status.xml", content: CDAR_XML },
  ]);
  assert.equal(res.statusCode, 201);
  const byName = Object.fromEntries(
    res
      .json()
      .flows.map((f: { name: string; availableDocTypes: string[] }) => [
        f.name,
        [...f.availableDocTypes].sort(),
      ]),
  );
  assert.deepEqual(byName["invoice.xml"], ["Converted", "Original", "ReadableView"]);
  assert.deepEqual(byName["status.xml"], ["Original"]);
});

test("POST /v1/admin/inject rejects a request with no files", async () => {
  const { payload, contentType } = multipart([{ name: "flowDirection", value: "In" }]);
  const res = await app.inject({
    method: "POST",
    url: "/v1/admin/inject",
    headers: { ...authHeader(token), "content-type": contentType },
    payload,
  });
  assert.equal(res.statusCode, 400);
  assert.equal(res.json().errorCode, "MISSING_REQUIRED_FIELD");
});

test("POST /v1/admin/flows/search returns an enriched, paginated view", async () => {
  await injectFiles({ direction: "In" }, [{ name: "inv.xml", content: UBL_XML }]);
  const res = await app.inject({
    method: "POST",
    url: "/v1/admin/flows/search",
    headers: authHeader(token),
    payload: { flowSyntax: "UBL", limit: 10, offset: 0 },
  });
  assert.equal(res.statusCode, 200);
  const body = res.json();
  assert.equal(body.total, 1);
  assert.equal(body.flows[0].invoiceNumber, "INV-UBL-001");
  assert.ok(Array.isArray(body.flows[0].availableDocTypes));
});

test("GET /v1/admin/lifecycle-statuses lists the reference statuses", async () => {
  const res = await app.inject({
    method: "GET",
    url: "/v1/admin/lifecycle-statuses",
    headers: authHeader(token),
  });
  assert.equal(res.statusCode, 200);
  const { statuses } = res.json();
  assert.ok(Array.isArray(statuses));
  assert.ok(statuses.some((s: { code: string }) => s.code === "204"));
  assert.ok(
    statuses.some(
      (s: { code: string; requiresReason?: boolean }) => s.code === "210" && s.requiresReason,
    ),
  );
});

test("POST /v1/admin/flows/:id/status forces a status and emits a CDAR lifecycle flow", async () => {
  const inj = await injectFiles({ direction: "In" }, [{ name: "inv.xml", content: UBL_XML }]);
  const flowId = inj.json().flows[0].flowId;

  const res = await app.inject({
    method: "POST",
    url: `/v1/admin/flows/${flowId}/status`,
    headers: authHeader(token),
    payload: { statusCode: "210", comment: "TVA incorrecte" },
  });
  assert.equal(res.statusCode, 200);
  const body = res.json();
  assert.equal(body.flow.statusCode, "210");
  assert.equal(body.flow.statusName, "Refusée");
  assert.ok(body.lifecycleFlow, "a lifecycle flow should be emitted");
  assert.equal(body.lifecycleFlow.flowSyntax, "CDAR");

  const cdar = store.getFlow(body.lifecycleFlow.flowId);
  const xml = cdar?.documents.Original?.content.toString("utf8") ?? "";
  assert.match(xml, /<ram:Reason>TVA incorrecte<\/ram:Reason>/);
  assert.match(xml, /<ram:ReasonCode>NON_CONFORME<\/ram:ReasonCode>/);

  assert.match(xml, /<ram:IssuerAssignedID>INV-UBL-001<\/ram:IssuerAssignedID>/);
  assert.match(xml, /<ram:ProcessConditionCode>210<\/ram:ProcessConditionCode>/);
  assert.match(xml, /<qdt:DateTimeString format="102">20260115<\/qdt:DateTimeString>/);
  assert.match(xml, /<ram:GlobalID schemeID="0002">123456789<\/ram:GlobalID>/);
  assert.match(xml, /<ram:GlobalID schemeID="0002">987654321<\/ram:GlobalID>/);
  assert.doesNotMatch(xml, /00000000000000|11111111111111/);
});

test("POST /v1/admin/flows/:id/status can skip the lifecycle flow", async () => {
  const inj = await injectFiles({ direction: "In" }, [{ name: "inv.xml", content: UBL_XML }]);
  const flowId = inj.json().flows[0].flowId;
  const res = await app.inject({
    method: "POST",
    url: `/v1/admin/flows/${flowId}/status`,
    headers: authHeader(token),
    payload: { statusCode: "206", emitLifecycleFlow: false },
  });
  assert.equal(res.json().lifecycleFlow, null);
});

test("POST /v1/admin/flows/:id/status rejects forcing a status on a CDAR flow", async () => {
  const inj = await injectFiles({ direction: "In" }, [{ name: "lc.xml", content: CDAR_XML }]);
  const cdarId = inj.json().flows[0].flowId;
  const res = await app.inject({
    method: "POST",
    url: `/v1/admin/flows/${cdarId}/status`,
    headers: authHeader(token),
    payload: { statusCode: "206" },
  });
  assert.equal(res.statusCode, 400);
  assert.equal(res.json().errorCode, "NOT_AN_INVOICE");
});

test("POST /v1/admin/flows/:id/status 404s for an unknown flow", async () => {
  const res = await app.inject({
    method: "POST",
    url: "/v1/admin/flows/nope/status",
    headers: authHeader(token),
    payload: { statusCode: "206" },
  });
  assert.equal(res.statusCode, 404);
});

test("POST /v1/admin/generate creates full invoice flows", async () => {
  const res = await app.inject({
    method: "POST",
    url: "/v1/admin/generate",
    headers: authHeader(token),
    payload: { count: 2 },
  });
  assert.equal(res.statusCode, 201);
  const body = res.json();
  assert.equal(body.generated, 2);
  for (const f of body.flows) {
    assert.deepEqual([...f.availableDocTypes].sort(), ["Converted", "Original", "ReadableView"]);
  }
});

test("POST /v1/admin/reset empties the store", async () => {
  await injectFiles({ direction: "In" }, [{ name: "inv.xml", content: UBL_XML }]);
  assert.ok(store.count() > 0);
  const res = await app.inject({
    method: "POST",
    url: "/v1/admin/reset",
    headers: authHeader(token),
  });
  assert.equal(res.statusCode, 200);
  assert.equal(res.json().total, 0);
  assert.equal(store.count(), 0);
});
