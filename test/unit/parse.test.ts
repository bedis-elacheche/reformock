import { test } from "node:test";
import assert from "node:assert/strict";

import { parseFlowFile } from "../../src/utils/parse.ts";
import { UBL_XML, CII_XML, CDAR_XML } from "../helpers.ts";

test("parseFlowFile detects UBL and extracts metadata", () => {
  const r = parseFlowFile(Buffer.from(UBL_XML, "utf8"));
  assert.equal(r.flowSyntax, "UBL");
  assert.equal(r.invoiceNumber, "INV-UBL-001");
  assert.equal(r.metadata.issueDate, "2026-01-15");
  assert.equal(r.metadata.currency, "EUR");
  assert.equal(r.metadata.totalInclVat, 1200.5);
  assert.equal(r.metadata.seller?.name, "Vendeur SARL");
  assert.equal(r.metadata.seller?.vatNumber, "FR12345678901");
  assert.equal(r.metadata.seller?.siret, "12345678900011");
  assert.equal(r.metadata.seller?.siren, "123456789");
  assert.equal(r.metadata.buyer?.name, "Acheteur SAS");
  assert.equal(r.metadata.buyer?.vatNumber, "FR98765432109");
  assert.equal(r.metadata.buyer?.siret, "98765432100022");
  assert.equal(r.metadata.buyer?.siren, "987654321");
});

test("parseFlowFile derives seller SIREN from the SIRET or VAT number when absent", () => {
  const noLegalEntity = UBL_XML.replace(
    /<cbc:CompanyID schemeID="0002">123456789<\/cbc:CompanyID>/,
    "",
  );
  const r = parseFlowFile(Buffer.from(noLegalEntity, "utf8"));
  assert.equal(r.metadata.seller?.siren, "123456789");
});

test("parseFlowFile detects CII and extracts metadata", () => {
  const r = parseFlowFile(Buffer.from(CII_XML, "utf8"));
  assert.equal(r.flowSyntax, "CII");
  assert.equal(r.invoiceNumber, "INV-CII-002");
  assert.equal(r.metadata.issueDate, "2026-01-15");
  assert.equal(r.metadata.currency, "EUR");
  assert.equal(r.metadata.totalInclVat, 980);
  assert.equal(r.metadata.seller?.name, "Vendeur CII");
  assert.equal(r.metadata.seller?.siren, "111222333");
  assert.equal(r.metadata.seller?.vatNumber, "FR11111222333");
  assert.equal(r.metadata.buyer?.name, "Acheteur CII");
  assert.equal(r.metadata.buyer?.siren, "444555666");
});

test("parseFlowFile detects CDAR lifecycle status", () => {
  const r = parseFlowFile(Buffer.from(CDAR_XML, "utf8"));
  assert.equal(r.flowSyntax, "CDAR");
  assert.equal(r.invoiceNumber, "INV-CDAR-003");
  assert.equal(r.metadata.statusCode, "205");
  assert.equal(r.metadata.statusName, "Approuvée");
  assert.equal(r.metadata.seller?.siren, "111222333");
});

test("parseFlowFile detects Factur-X via PDF magic bytes", () => {
  const r = parseFlowFile(Buffer.from("%PDF-1.7\n...binary...", "latin1"));
  assert.equal(r.flowSyntax, "Factur-X");
  assert.equal(r.invoiceNumber, null);
});

test("parseFlowFile returns Unknown for unrecognised content", () => {
  const r = parseFlowFile(Buffer.from("just some text", "utf8"));
  assert.equal(r.flowSyntax, "Unknown");
  assert.equal(r.invoiceNumber, null);
  assert.deepEqual(r.metadata, {});
});

test("parseFlowFile only inspects the first 20k bytes", () => {
  const padding = " ".repeat(20050);
  const buf = Buffer.from(
    padding + "<cbc:ID>LATE</cbc:ID>" + "urn:oasis:names:specification:ubl",
    "utf8",
  );
  const r = parseFlowFile(buf);
  assert.equal(r.flowSyntax, "Unknown");
});
