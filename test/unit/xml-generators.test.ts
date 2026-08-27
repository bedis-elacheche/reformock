import { test } from "node:test";
import assert from "node:assert/strict";

import { generateUBL } from "../../src/generators/ubl.ts";
import { generateCII } from "../../src/generators/cii.ts";
import { generateCDAR } from "../../src/generators/cdar.ts";
import { generateReadablePDF } from "../../src/generators/pdf.ts";
import { parseFlowFile } from "../../src/utils/parse.ts";
import type { InvoiceData } from "../../src/types.ts";

const INVOICE: InvoiceData = {
  invoiceNumber: "FA-2026-4242",
  issueDate: "2026-03-04",
  dueDate: "2026-04-03",
  currency: "EUR",
  seller: {
    name: "Vendeur & Fils",
    siren: "123456789",
    siret: "12345678900011",
    email: "vendeur@example.com",
    vatNumber: "FR32123456789",
    address: { line1: "1 rue du Test", postalCode: "75001", city: "Paris", countryCode: "FR" },
  },
  buyer: {
    name: "Acheteur SAS",
    siren: "987654321",
    siret: "98765432100022",
    email: "acheteur@example.com",
    vatNumber: "FR40987654321",
    address: { line1: "2 avenue Client", postalCode: "69002", city: "Lyon", countryCode: "FR" },
  },
  lines: [
    {
      id: 1,
      name: "Conseil",
      unit: "DAY",
      unitPrice: 850,
      quantity: 2,
      lineTotal: 1700,
      vatRate: 20,
    },
    {
      id: 2,
      name: "Licence <A&B>",
      unit: "C62",
      unitPrice: 100,
      quantity: 3,
      lineTotal: 300,
      vatRate: 20,
    },
  ],
  totals: { totalHT: 2000, totalVAT: 400, vatRate: 20, totalTTC: 2400 },
};

test("generateUBL round-trips through the parser", () => {
  const xml = generateUBL(INVOICE);
  const parsed = parseFlowFile(Buffer.from(xml, "utf8"));
  assert.equal(parsed.flowSyntax, "UBL");
  assert.equal(parsed.invoiceNumber, "FA-2026-4242");
  assert.equal(parsed.metadata.currency, "EUR");
  assert.equal(parsed.metadata.totalInclVat, 2400);
  assert.equal(parsed.metadata.issueDate, "2026-03-04");
  assert.equal(parsed.metadata.seller?.name, "Vendeur &amp; Fils");
});

test("generateUBL escapes XML special characters", () => {
  const xml = generateUBL(INVOICE);
  assert.ok(xml.includes("Vendeur &amp; Fils"), "ampersand should be escaped");
  assert.ok(xml.includes("Licence &lt;A&amp;B&gt;"), "line name should be escaped");
  assert.ok(!/&(?!amp;|lt;|gt;|quot;|apos;)/.test(xml), "no raw ampersands");
});

test("generateUBL declares the S1 CTC profile instead of the legacy Peppol one", () => {
  const xml = generateUBL(INVOICE);
  assert.ok(xml.includes("<cbc:ProfileID>S1</cbc:ProfileID>"));
  assert.ok(!xml.includes("peppol"), "legacy Peppol billing profile should be gone");
});

test("generateUBL carries the three mandatory French legal-mention notes", () => {
  const xml = generateUBL(INVOICE);
  assert.ok(xml.includes("<cbc:Note>#PMT#"), "late-payment fixed indemnity note (PMT)");
  assert.ok(xml.includes("recouvrement"), "PMT content");
  assert.ok(xml.includes("<cbc:Note>#PMD#"), "late-payment penalty rate note (PMD)");
  assert.ok(xml.includes("taux BCE + 10 points"), "PMD content");
  assert.ok(
    xml.includes("<cbc:Note>#AAB#Pas d'escompte pour paiement anticipé</cbc:Note>"),
    "AAB note",
  );
});

test("generateUBL exposes a payee IBAN in the payment means", () => {
  const xml = generateUBL(INVOICE);
  assert.ok(xml.includes("<cac:PayeeFinancialAccount>"));
  assert.ok(xml.includes("<cbc:ID>FR3710096000704155525246C13</cbc:ID>"));
});

test("generateCII round-trips through the parser", () => {
  const xml = generateCII(INVOICE);
  const parsed = parseFlowFile(Buffer.from(xml, "utf8"));
  assert.equal(parsed.flowSyntax, "CII");
  assert.equal(parsed.invoiceNumber, "FA-2026-4242");
  assert.equal(parsed.metadata.currency, "EUR");
  assert.equal(parsed.metadata.totalInclVat, 2400);
  assert.equal(parsed.metadata.issueDate, "2026-03-04");
  assert.equal(parsed.metadata.seller?.name, "Vendeur &amp; Fils");
});

test("generateCII carries the three legal-mention notes with their subject codes", () => {
  const xml = generateCII(INVOICE);
  for (const code of ["PMT", "PMD", "AAB"]) {
    assert.ok(xml.includes(`<ram:SubjectCode>${code}</ram:SubjectCode>`), `missing note ${code}`);
  }
  assert.ok(xml.includes("recouvrement"), "PMT content");
  assert.ok(xml.includes("taux BCE + 10 points"), "PMD content");
  assert.ok(xml.includes("Pas d'escompte pour paiement anticipé"), "AAB content");
});

test("generateCII exposes a creditor IBAN in the payment means", () => {
  const xml = generateCII(INVOICE);
  assert.ok(xml.includes("<ram:PayeePartyCreditorFinancialAccount>"));
  assert.ok(xml.includes("<ram:IBANID>FR3710096000704155525246C13</ram:IBANID>"));
});

test("generateCDAR embeds the invoice date and SIREN so the search triplet round-trips", () => {
  const xml = generateCDAR({
    statusCode: "210",
    reasonCode: "TX_TVA_ERR",
    comment: "Montant erroné",
    dateTime: new Date("2026-03-04T09:30:00.000Z"),
    invoice: { number: "FA-2026-4242", date: "2026-03-04" },
    seller: { siret: "12345678900011", siren: "123456789" },
    buyer: { siret: "98765432100022", siren: "987654321" },
  });
  assert.ok(xml.includes("<ram:ReasonCode>TX_TVA_ERR</ram:ReasonCode>"));
  assert.ok(xml.includes("<ram:Reason>Montant erroné</ram:Reason>"));
  assert.ok(xml.includes("<ram:SequenceNumeric>1</ram:SequenceNumeric>"));
  assert.ok(xml.includes('<qdt:DateTimeString format="102">20260304</qdt:DateTimeString>'));
  assert.ok(xml.includes('<udt:DateTimeString format="204">20260304103000</udt:DateTimeString>'));
  assert.ok(
    xml.includes('<ram:GlobalID schemeID="0002">123456789</ram:GlobalID>'),
    "seller SIREN present",
  );
  assert.ok(
    xml.includes('<ram:GlobalID schemeID="0002">987654321</ram:GlobalID>'),
    "buyer SIREN present",
  );

  const parsed = parseFlowFile(Buffer.from(xml, "utf8"));
  assert.equal(parsed.flowSyntax, "CDAR");
  assert.equal(parsed.invoiceNumber, "FA-2026-4242");
  assert.equal(parsed.metadata.statusCode, "210");
  assert.equal(parsed.metadata.statusName, "Refusée");
  assert.equal(parsed.metadata.issueDate, "2026-03-04");
  assert.equal(parsed.metadata.seller?.siren, "123456789");
});

test("generateCDAR falls back to the event date and omits the reason when it is not required", () => {
  const xml = generateCDAR({
    statusCode: "205",
    dateTime: new Date("2026-03-04T09:30:00.000Z"),
    invoice: { number: "X" },
    seller: { siret: "1", siren: "1" },
    buyer: { siret: "2", siren: "2" },
  });
  assert.ok(!xml.includes("SpecifiedDocumentStatus"));
  assert.ok(xml.includes('<qdt:DateTimeString format="102">20260304</qdt:DateTimeString>'));
});

test("generateCDAR carries a default reason code for the statuses that require one", () => {
  const xml = generateCDAR({
    statusCode: "208",
    invoice: { number: "X", date: "2026-03-04" },
    seller: { siret: "1", siren: "1" },
    buyer: { siret: "2", siren: "2" },
  });
  assert.ok(xml.includes("<ram:ReasonCode>JUSTIF_ABS</ram:ReasonCode>"));
  assert.ok(!xml.includes("<ram:Reason>"));
});

test("generateCDAR quantifies the cashed status, as BR-FR-CDV-14 requires", () => {
  const xml = generateCDAR({
    statusCode: "212",
    invoice: { number: "X", date: "2026-03-04" },
    seller: { siret: "1", siren: "1" },
    buyer: { siret: "2", siren: "2" },
    settlement: { amount: 1200, vatRate: 5.5, currency: "EUR" },
  });
  assert.ok(xml.includes("<ram:TypeCode>MEN</ram:TypeCode>"));
  assert.ok(xml.includes('<ram:ValueAmount currencyID="EUR">1200.00</ram:ValueAmount>'));
  assert.ok(xml.includes("<ram:ValuePercent>5.50</ram:ValuePercent>"));
});

test("generateCDAR marks platform statuses as a transmission message", () => {
  const params = {
    invoice: { number: "X", date: "2026-03-04" },
    seller: { siret: "1", siren: "1" },
    buyer: { siret: "2", siren: "987654321" },
  };
  const transmission = generateCDAR({ ...params, statusCode: "203" });
  assert.ok(transmission.includes("<ram:TypeCode>305</ram:TypeCode>"));
  assert.ok(!transmission.includes('<ram:GlobalID schemeID="0002">987654321</ram:GlobalID>'));
  const processing = generateCDAR({ ...params, statusCode: "205" });
  assert.ok(processing.includes("<ram:TypeCode>23</ram:TypeCode>"));
  assert.ok(processing.includes('<ram:GlobalID schemeID="0002">987654321</ram:GlobalID>'));
});

test("generateReadablePDF returns a real PDF buffer", async () => {
  const pdf = await generateReadablePDF(INVOICE);
  assert.ok(Buffer.isBuffer(pdf));
  assert.ok(pdf.length > 0);
  assert.equal(pdf.subarray(0, 5).toString("latin1"), "%PDF-");
  assert.equal(parseFlowFile(pdf).flowSyntax, "Factur-X");
});
