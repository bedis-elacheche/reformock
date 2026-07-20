import { test } from "node:test";
import assert from "node:assert/strict";

import { parseFlowFile } from "../../src/utils/parse.ts";
import { UBL_XML, CII_XML, CDAR_XML } from "../helpers.ts";

// UBL where seller/buyer carry scheme-qualified SIRET (EndpointID schemeID="0225")
// and the buyer carries a scheme-qualified SIREN (ID schemeID="0002").
const UBL_WITH_IDS = `<?xml version="1.0" encoding="UTF-8"?>
<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2"
         xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2"
         xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2">
  <cbc:ID>INV-UBL-IDS</cbc:ID>
  <cac:AccountingSupplierParty>
    <cac:Party>
      <cbc:EndpointID schemeID="0225">12345678900011</cbc:EndpointID>
      <cac:PartyLegalEntity>
        <cbc:RegistrationName>Vendeur SARL</cbc:RegistrationName>
        <cbc:CompanyID>FR12345678901</cbc:CompanyID>
      </cac:PartyLegalEntity>
    </cac:Party>
  </cac:AccountingSupplierParty>
  <cac:AccountingCustomerParty>
    <cac:Party>
      <cbc:EndpointID schemeID="0225">98765432100022</cbc:EndpointID>
      <cac:PartyLegalEntity>
        <cbc:RegistrationName>Acheteur SAS</cbc:RegistrationName>
        <cbc:CompanyID>FR98765432109</cbc:CompanyID>
        <cbc:ID schemeID="0002">987654321</cbc:ID>
      </cac:PartyLegalEntity>
    </cac:Party>
  </cac:AccountingCustomerParty>
</Invoice>`;

// Same content but with unqualified identifiers, exercising the fallback branches.
const UBL_BARE_IDS = `<?xml version="1.0" encoding="UTF-8"?>
<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2"
         xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2"
         xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2">
  <cbc:ID>INV-UBL-BARE</cbc:ID>
  <cac:AccountingSupplierParty>
    <cac:Party>
      <cbc:EndpointID>11111111100011</cbc:EndpointID>
      <cac:PartyLegalEntity>
        <cbc:RegistrationName>Vendeur Bare</cbc:RegistrationName>
      </cac:PartyLegalEntity>
    </cac:Party>
  </cac:AccountingSupplierParty>
  <cac:AccountingCustomerParty>
    <cac:Party>
      <cbc:EndpointID>22222222200022</cbc:EndpointID>
      <cac:PartyLegalEntity>
        <cbc:RegistrationName>Acheteur Bare</cbc:RegistrationName>
        <cbc:ID>222222222</cbc:ID>
      </cac:PartyLegalEntity>
    </cac:Party>
  </cac:AccountingCustomerParty>
</Invoice>`;

test("parseFlowFile detects UBL and extracts metadata", () => {
  const r = parseFlowFile(Buffer.from(UBL_XML, "utf8"));
  assert.equal(r.flowSyntax, "UBL");
  assert.equal(r.invoiceNumber, "INV-UBL-001");
  assert.equal(r.metadata.issueDate, "2026-01-15");
  assert.equal(r.metadata.currency, "EUR");
  assert.equal(r.metadata.totalInclVat, 1200.5);
  assert.equal(r.metadata.seller?.name, "Vendeur SARL");
  assert.equal(r.metadata.seller?.vatNumber, "FR12345678901");
  assert.equal(r.metadata.buyer?.name, "Acheteur SAS");
  assert.equal(r.metadata.buyer?.vatNumber, "FR98765432109");
});

test("parseFlowFile leaves SIRET/SIREN null when the party carries no identifiers", () => {
  const r = parseFlowFile(Buffer.from(UBL_XML, "utf8"));
  assert.equal(r.metadata.seller?.siret, null);
  assert.equal(r.metadata.buyer?.siret, null);
  assert.equal(r.metadata.buyer?.siren, null);
});

test("parseFlowFile extracts scheme-qualified SIRET and SIREN from UBL parties", () => {
  const r = parseFlowFile(Buffer.from(UBL_WITH_IDS, "utf8"));
  assert.equal(r.flowSyntax, "UBL");
  assert.equal(r.metadata.seller?.siret, "12345678900011");
  assert.equal(r.metadata.buyer?.siret, "98765432100022");
  assert.equal(r.metadata.buyer?.siren, "987654321");
});

test("parseFlowFile falls back to unqualified EndpointID and ID for SIRET/SIREN", () => {
  const r = parseFlowFile(Buffer.from(UBL_BARE_IDS, "utf8"));
  assert.equal(r.flowSyntax, "UBL");
  assert.equal(r.metadata.seller?.siret, "11111111100011");
  assert.equal(r.metadata.buyer?.siret, "22222222200022");
  assert.equal(r.metadata.buyer?.siren, "222222222");
});

test("parseFlowFile detects CII and extracts metadata", () => {
  const r = parseFlowFile(Buffer.from(CII_XML, "utf8"));
  assert.equal(r.flowSyntax, "CII");
  assert.equal(r.invoiceNumber, "INV-CII-002");
  assert.equal(r.metadata.issueDate, "2026-01-15");
  assert.equal(r.metadata.currency, "EUR");
  assert.equal(r.metadata.totalInclVat, 980);
  assert.equal(r.metadata.seller?.name, "Vendeur CII");
  assert.equal(r.metadata.buyer?.name, "Acheteur CII");
});

test("parseFlowFile detects CDAR lifecycle status", () => {
  const r = parseFlowFile(Buffer.from(CDAR_XML, "utf8"));
  assert.equal(r.flowSyntax, "CDAR");
  assert.equal(r.invoiceNumber, "INV-CDAR-003");
  assert.equal(r.metadata.statusCode, "206");
  assert.equal(r.metadata.statusName, "Approuvée");
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
