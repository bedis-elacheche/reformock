import { LIFECYCLE_STATUSES } from "../generators/cdar.ts";

import type { FlowMetadata, FlowSyntax, ParsedFlow, PartyMetadata } from "../types.ts";

function m1(text: string, re: RegExp): string | null {
  const m = text.match(re);
  return m ? m[1].trim() : null;
}

function digits(s: string | null | undefined): string | null {
  if (!s) {
    return null;
  }
  const d = s.replace(/\D/g, "");
  return d || null;
}

function sirenFrom({
  siren,
  siret,
  vatNumber,
}: {
  siren?: string | null;
  siret?: string | null;
  vatNumber?: string | null;
}): string | null {
  for (const source of [siren, siret]) {
    const d = digits(source);
    if (d && d.length >= 9) {
      return d.slice(0, 9);
    }
  }
  const vat = digits(vatNumber);
  if (vat && vat.length >= 9) {
    return vat.slice(-9);
  }
  return null;
}

function assignParty(party: PartyMetadata, siret: string | null, sirenRaw: string | null): void {
  const siren = sirenFrom({ siren: sirenRaw, siret, vatNumber: party.vatNumber });
  if (siret) {
    party.siret = siret;
  }
  if (siren) {
    party.siren = siren;
  }
}

function parseUblParty(block: string): PartyMetadata {
  const party: PartyMetadata = {
    name: m1(block, /<cbc:RegistrationName>([^<]+)</) || m1(block, /<cbc:Name>([^<]+)</),
    vatNumber: m1(block, /<cbc:CompanyID>(FR[^<]+)</),
  };
  const siret =
    m1(block, /<cac:PartyIdentification>[\s\S]*?<cbc:ID schemeID="0009">([^<]+)</) ||
    m1(block, /<cbc:EndpointID schemeID="0009">([^<]+)</);
  const sirenRaw = m1(block, /<cbc:CompanyID schemeID="0002">([^<]+)</);
  assignParty(party, siret, sirenRaw);
  return party;
}

function parseCiiParty(block: string): PartyMetadata {
  const party: PartyMetadata = {
    name: m1(block, /<ram:Name>([^<]+)</),
    vatNumber: m1(block, /<ram:SpecifiedTaxRegistration>[\s\S]*?<ram:ID[^>]*>(FR[^<]+)</),
  };
  const siret = m1(block, /<ram:ID schemeID="0009">([^<]+)</);
  const sirenRaw = m1(
    block,
    /<ram:SpecifiedLegalOrganization>[\s\S]*?<ram:ID schemeID="0002">([^<]+)</,
  );
  assignParty(party, siret, sirenRaw);
  return party;
}

function parseFlowFile(content: Buffer): ParsedFlow {
  const head = content.subarray(0, 20000).toString("utf8");

  let flowSyntax: FlowSyntax = "Unknown";
  if (head.includes("CrossDomainAcknowledgementAndResponse")) {
    flowSyntax = "CDAR";
  } else if (head.includes("CrossIndustryInvoice")) {
    flowSyntax = "CII";
  } else if (head.includes("urn:oasis:names:specification:ubl")) {
    flowSyntax = "UBL";
  } else if (content.subarray(0, 5).toString("latin1") === "%PDF-") {
    flowSyntax = "Factur-X";
  }

  let invoiceNumber: string | null = null;
  const metadata: FlowMetadata = {};

  if (flowSyntax === "UBL") {
    invoiceNumber = m1(head, /<cbc:ID>([^<]+)<\/cbc:ID>/);
    metadata.issueDate = m1(head, /<cbc:IssueDate>([^<]+)</);
    const supplier = m1(
      head,
      /<cac:AccountingSupplierParty>([\s\S]*?)<\/cac:AccountingSupplierParty>/,
    );
    const customer = m1(
      head,
      /<cac:AccountingCustomerParty>([\s\S]*?)<\/cac:AccountingCustomerParty>/,
    );
    if (supplier) {
      metadata.seller = parseUblParty(supplier);
    }
    if (customer) {
      metadata.buyer = parseUblParty(customer);
    }
    const payable = m1(head, /<cbc:PayableAmount[^>]*>([^<]+)</);
    if (payable) {
      metadata.totalInclVat = parseFloat(payable);
    }
    metadata.currency = m1(head, /<cbc:DocumentCurrencyCode>([^<]+)</);
    const ublVatRate = m1(head, /<cac:TaxCategory>[\s\S]*?<cbc:Percent>([^<]+)</);
    if (ublVatRate) {
      metadata.vatRate = parseFloat(ublVatRate);
    }
  } else if (flowSyntax === "CII") {
    invoiceNumber = m1(head, /<rsm:ExchangedDocument>[\s\S]*?<ram:ID>([^<]+)</);
    const issue = m1(head, /<ram:IssueDateTime>[\s\S]*?>(\d{8})</);
    if (issue) {
      metadata.issueDate = `${issue.slice(0, 4)}-${issue.slice(4, 6)}-${issue.slice(6, 8)}`;
    }
    const seller = m1(head, /<ram:SellerTradeParty>([\s\S]*?)<\/ram:SellerTradeParty>/);
    const buyer = m1(head, /<ram:BuyerTradeParty>([\s\S]*?)<\/ram:BuyerTradeParty>/);
    if (seller) {
      metadata.seller = parseCiiParty(seller);
    }
    if (buyer) {
      metadata.buyer = parseCiiParty(buyer);
    }
    const grand = m1(head, /<ram:GrandTotalAmount[^>]*>([^<]+)</);
    if (grand) {
      metadata.totalInclVat = parseFloat(grand);
    }
    metadata.currency = m1(head, /<ram:InvoiceCurrencyCode>([^<]+)</);
    const ciiVatRate = m1(head, /<ram:RateApplicablePercent>([^<]+)</);
    if (ciiVatRate) {
      metadata.vatRate = parseFloat(ciiVatRate);
    }
  } else if (flowSyntax === "CDAR") {
    invoiceNumber = m1(head, /<ram:IssuerAssignedID>([^<]+)</);
    // MDT-105 : le libellé n'est pas porté par le CDV, il se déduit du code.
    const statusCode = m1(head, /<ram:ProcessConditionCode>([^<]+)</);
    metadata.statusCode = statusCode;
    metadata.statusName = statusCode
      ? (LIFECYCLE_STATUSES.find((s) => s.code === statusCode)?.name ?? null)
      : null;
    const refDate = m1(head, /<ram:FormattedIssueDateTime>[\s\S]*?>(\d{8})</);
    if (refDate) {
      metadata.issueDate = `${refDate.slice(0, 4)}-${refDate.slice(4, 6)}-${refDate.slice(6, 8)}`;
    }
    const sellerSiren = m1(
      head,
      /<ram:RecipientTradeParty>[\s\S]*?<ram:GlobalID schemeID="0002">([^<]+)</,
    );
    if (sellerSiren) {
      metadata.seller = { siren: sellerSiren.trim() };
    }
  }

  return { flowSyntax, invoiceNumber, metadata };
}

export { parseFlowFile };
