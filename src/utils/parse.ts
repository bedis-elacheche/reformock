import type { FlowMetadata, FlowSyntax, ParsedFlow } from "../types.ts";

function m1(text: string, re: RegExp): string | null {
  const m = text.match(re);
  return m ? m[1].trim() : null;
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
      metadata.seller = {
        name: m1(supplier, /<cbc:RegistrationName>([^<]+)</) || m1(supplier, /<cbc:Name>([^<]+)</),
        vatNumber: m1(supplier, /<cbc:CompanyID>(FR[^<]+)</),
        siret:
          m1(supplier, /<cbc:EndpointID schemeID="0225">([^<]+)</) ||
          m1(supplier, /<cbc:EndpointID>([^<]+)</),
      };
    }
    if (customer) {
      metadata.buyer = {
        name: m1(customer, /<cbc:RegistrationName>([^<]+)</) || m1(customer, /<cbc:Name>([^<]+)</),
        vatNumber: m1(customer, /<cbc:CompanyID>(FR[^<]+)</),
        siret:
          m1(customer, /<cbc:EndpointID schemeID="0225">([^<]+)</) ||
          m1(customer, /<cbc:EndpointID>([^<]+)</),
        siren: m1(customer, /<cbc:ID schemeID="0002">([^<]+)</) || m1(customer, /<cbc:ID>([^<]+)</),
      };
    }
    const payable = m1(head, /<cbc:PayableAmount[^>]*>([^<]+)</);
    if (payable) {
      metadata.totalInclVat = parseFloat(payable);
    }
    metadata.currency = m1(head, /<cbc:DocumentCurrencyCode>([^<]+)</);
  } else if (flowSyntax === "CII") {
    invoiceNumber = m1(head, /<rsm:ExchangedDocument>[\s\S]*?<ram:ID>([^<]+)</);
    const issue = m1(head, /<ram:IssueDateTime>[\s\S]*?>(\d{8})</);
    if (issue) {
      metadata.issueDate = `${issue.slice(0, 4)}-${issue.slice(4, 6)}-${issue.slice(6, 8)}`;
    }
    const seller = m1(head, /<ram:SellerTradeParty>([\s\S]*?)<\/ram:SellerTradeParty>/);
    const buyer = m1(head, /<ram:BuyerTradeParty>([\s\S]*?)<\/ram:BuyerTradeParty>/);
    if (seller) {
      metadata.seller = { name: m1(seller, /<ram:Name>([^<]+)</) };
    }
    if (buyer) {
      metadata.buyer = { name: m1(buyer, /<ram:Name>([^<]+)</) };
    }
    const grand = m1(head, /<ram:GrandTotalAmount[^>]*>([^<]+)</);
    if (grand) {
      metadata.totalInclVat = parseFloat(grand);
    }
    metadata.currency = m1(head, /<ram:InvoiceCurrencyCode>([^<]+)</);
  } else if (flowSyntax === "CDAR") {
    invoiceNumber = m1(head, /<ram:IssuerAssignedID>([^<]+)</);
    metadata.statusCode = m1(head, /<ram:StatusCode>([^<]+)</);
    metadata.statusName = m1(head, /<ram:StatusName>([^<]+)</);
  }

  return { flowSyntax, invoiceNumber, metadata };
}

export { parseFlowFile };
