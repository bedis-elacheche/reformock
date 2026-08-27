import { buildApp } from "../src/app.ts";
import { generateUBL } from "../src/generators/ubl.ts";
import { generateCII } from "../src/generators/cii.ts";

import type { FastifyInstance } from "fastify";
import type { InvoiceData } from "../src/types.ts";

export async function newApp(): Promise<FastifyInstance> {
  return buildApp();
}

export async function getToken(app: FastifyInstance): Promise<string> {
  const res = await app.inject({
    method: "POST",
    url: "/oauth/token",
    payload: {
      grant_type: "client_credentials",
      client_id: "test-client",
      client_secret: "test-secret",
    },
  });
  if (res.statusCode !== 200) {
    throw new Error(`token request failed: ${res.statusCode} ${res.payload}`);
  }
  return res.json().access_token as string;
}

export function authHeader(token: string): Record<string, string> {
  return { authorization: `Bearer ${token}` };
}

export interface MultipartField {
  name: string;
  value?: string;
  filename?: string;
  contentType?: string;
  content?: string | Buffer;
}

const BOUNDARY = "----ReformockTestBoundary";

export function multipart(fields: MultipartField[]): { payload: Buffer; contentType: string } {
  const parts: Buffer[] = [];
  for (const f of fields) {
    let header = `--${BOUNDARY}\r\nContent-Disposition: form-data; name="${f.name}"`;
    if (f.filename !== undefined) {
      header += `; filename="${f.filename}"`;
    }
    header += "\r\n";
    if (f.contentType) {
      header += `Content-Type: ${f.contentType}\r\n`;
    }
    header += "\r\n";
    const value = f.content ?? f.value ?? "";
    parts.push(Buffer.from(header, "utf8"));
    parts.push(Buffer.isBuffer(value) ? value : Buffer.from(String(value), "utf8"));
    parts.push(Buffer.from("\r\n", "utf8"));
  }
  parts.push(Buffer.from(`--${BOUNDARY}--\r\n`, "utf8"));
  return {
    payload: Buffer.concat(parts),
    contentType: `multipart/form-data; boundary=${BOUNDARY}`,
  };
}

export const UBL_XML = `<?xml version="1.0" encoding="UTF-8"?>
<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2"
         xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2"
         xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2">
  <cbc:ID>INV-UBL-001</cbc:ID>
  <cbc:IssueDate>2026-01-15</cbc:IssueDate>
  <cbc:DocumentCurrencyCode>EUR</cbc:DocumentCurrencyCode>
  <cac:AccountingSupplierParty>
    <cac:Party>
      <cac:PartyIdentification><cbc:ID schemeID="0009">12345678900011</cbc:ID></cac:PartyIdentification>
      <cac:PartyTaxScheme>
        <cbc:CompanyID>FR12345678901</cbc:CompanyID>
        <cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme>
      </cac:PartyTaxScheme>
      <cac:PartyLegalEntity>
        <cbc:RegistrationName>Vendeur SARL</cbc:RegistrationName>
        <cbc:CompanyID schemeID="0002">123456789</cbc:CompanyID>
      </cac:PartyLegalEntity>
    </cac:Party>
  </cac:AccountingSupplierParty>
  <cac:AccountingCustomerParty>
    <cac:Party>
      <cac:PartyIdentification><cbc:ID schemeID="0009">98765432100022</cbc:ID></cac:PartyIdentification>
      <cac:PartyTaxScheme>
        <cbc:CompanyID>FR98765432109</cbc:CompanyID>
        <cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme>
      </cac:PartyTaxScheme>
      <cac:PartyLegalEntity>
        <cbc:RegistrationName>Acheteur SAS</cbc:RegistrationName>
        <cbc:CompanyID schemeID="0002">987654321</cbc:CompanyID>
      </cac:PartyLegalEntity>
    </cac:Party>
  </cac:AccountingCustomerParty>
  <cac:LegalMonetaryTotal>
    <cbc:PayableAmount currencyID="EUR">1200.50</cbc:PayableAmount>
  </cac:LegalMonetaryTotal>
</Invoice>`;

export const CII_XML = `<?xml version="1.0" encoding="UTF-8"?>
<rsm:CrossIndustryInvoice xmlns:rsm="urn:un:unece:uncefact:data:standard:CrossIndustryInvoice:100"
                          xmlns:ram="urn:un:unece:uncefact:data:standard:ReusableAggregateBusinessInformationEntity:100">
  <rsm:ExchangedDocument>
    <ram:ID>INV-CII-002</ram:ID>
    <ram:IssueDateTime><udt:DateTimeString format="102">20260115</udt:DateTimeString></ram:IssueDateTime>
  </rsm:ExchangedDocument>
  <ram:SellerTradeParty>
    <ram:Name>Vendeur CII</ram:Name>
    <ram:SpecifiedLegalOrganization><ram:ID schemeID="0002">111222333</ram:ID></ram:SpecifiedLegalOrganization>
    <ram:SpecifiedTaxRegistration><ram:ID schemeID="VA">FR11111222333</ram:ID></ram:SpecifiedTaxRegistration>
  </ram:SellerTradeParty>
  <ram:BuyerTradeParty>
    <ram:Name>Acheteur CII</ram:Name>
    <ram:SpecifiedLegalOrganization><ram:ID schemeID="0002">444555666</ram:ID></ram:SpecifiedLegalOrganization>
  </ram:BuyerTradeParty>
  <ram:GrandTotalAmount>980.00</ram:GrandTotalAmount>
  <ram:InvoiceCurrencyCode>EUR</ram:InvoiceCurrencyCode>
</rsm:CrossIndustryInvoice>`;

export const CDAR_XML = `<?xml version="1.0" encoding="UTF-8"?>
<rsm:CrossDomainAcknowledgementAndResponse
    xmlns:rsm="urn:un:unece:uncefact:data:standard:CrossDomainAcknowledgementAndResponse:100"
    xmlns:ram="urn:un:unece:uncefact:data:standard:ReusableAggregateBusinessInformationEntity:100"
    xmlns:qdt="urn:un:unece:uncefact:data:standard:QualifiedDataType:100"
    xmlns:udt="urn:un:unece:uncefact:data:standard:UnqualifiedDataType:100">
  <rsm:ExchangedDocument>
    <ram:ID>LC-INV-CDAR-003-205</ram:ID>
    <ram:IssueDateTime>
      <udt:DateTimeString format="204">20260301103000</udt:DateTimeString>
    </ram:IssueDateTime>
    <ram:RecipientTradeParty>
      <ram:GlobalID schemeID="0002">111222333</ram:GlobalID>
      <ram:RoleCode>SE</ram:RoleCode>
    </ram:RecipientTradeParty>
  </rsm:ExchangedDocument>
  <rsm:AcknowledgementDocument>
    <ram:TypeCode>23</ram:TypeCode>
    <ram:ReferenceReferencedDocument>
      <ram:IssuerAssignedID>INV-CDAR-003</ram:IssuerAssignedID>
      <ram:TypeCode>380</ram:TypeCode>
      <ram:ProcessConditionCode>205</ram:ProcessConditionCode>
    </ram:ReferenceReferencedDocument>
  </rsm:AcknowledgementDocument>
</rsm:CrossDomainAcknowledgementAndResponse>`;

export function sampleInvoice(overrides: Partial<InvoiceData> = {}): InvoiceData {
  return {
    invoiceNumber: "FA-TEST-001",
    issueDate: "2026-03-01",
    dueDate: "2026-03-31",
    currency: "EUR",
    seller: {
      name: "Vendeur Test",
      siren: "111222333",
      siret: "11122233300019",
      email: "vendeur@test.fr",
      vatNumber: "FR11111222333",
      address: { line1: "1 rue A", postalCode: "75001", city: "Paris", countryCode: "FR" },
    },
    buyer: {
      name: "Acheteur & Fils",
      siren: "444555666",
      siret: "44455566600028",
      email: "acheteur@test.fr",
      vatNumber: "FR44444555666",
      address: { line1: "2 rue B", postalCode: "69002", city: "Lyon", countryCode: "FR" },
    },
    lines: [
      {
        id: 1,
        name: "Article Un",
        unit: "C62",
        unitPrice: 100,
        quantity: 2,
        lineTotal: 200,
        vatRate: 20,
      },
      {
        id: 2,
        name: "Article Deux",
        unit: "H87",
        unitPrice: 50,
        quantity: 3,
        lineTotal: 150,
        vatRate: 20,
      },
    ],
    totals: { totalHT: 350, totalVAT: 70, vatRate: 20, totalTTC: 420 },
    ...overrides,
  };
}

export const SAMPLE_UBL = generateUBL(sampleInvoice());
export const SAMPLE_CII = generateCII(sampleInvoice());
