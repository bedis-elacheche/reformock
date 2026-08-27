import type { LifecycleStatus } from "../types.ts";

function esc(s: unknown): string {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function dt(dateStr: string): string {
  return dateStr.slice(0, 10).replace(/-/g, "");
}

const PARIS_PARTS = new Intl.DateTimeFormat("fr-FR", {
  timeZone: "Europe/Paris",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

function dt204(date: Date): string {
  const p: Record<string, string> = {};
  for (const { type, value } of PARIS_PARTS.formatToParts(date)) {
    p[type] = value;
  }
  return `${p.year}${p.month}${p.day}${p.hour}${p.minute}${p.second}`;
}

const LIFECYCLE_STATUSES: readonly LifecycleStatus[] = [
  { code: "200", name: "Déposée", phase: "transmission" },
  { code: "201", name: "Émise par la plateforme", phase: "transmission" },
  { code: "202", name: "Reçue par la plateforme", phase: "transmission" },
  { code: "203", name: "Mise à disposition", phase: "transmission" },
  { code: "204", name: "Prise en charge", phase: "transmission" },
  { code: "205", name: "Approuvée", phase: "processing" },
  {
    code: "206",
    name: "Approuvée partiellement",
    phase: "processing",
    requiresReason: true,
    reasonCode: "AUTRE",
  },
  {
    code: "207",
    name: "En litige",
    phase: "processing",
    requiresReason: true,
    reasonCode: "AUTRE",
  },
  {
    code: "208",
    name: "Suspendue",
    phase: "processing",
    requiresReason: true,
    reasonCode: "JUSTIF_ABS",
  },
  { code: "209", name: "Complétée", phase: "processing" },
  {
    code: "210",
    name: "Refusée",
    phase: "processing",
    requiresReason: true,
    reasonCode: "NON_CONFORME",
  },
  { code: "211", name: "Paiement transmis", phase: "processing" },
  { code: "212", name: "Encaissée", phase: "processing" },
  {
    code: "213",
    name: "Rejetée",
    phase: "transmission",
    requiresReason: true,
    reasonCode: "REJ_SEMAN",
  },
];

const HAPPY_PATH: readonly string[] = ["201", "202", "203", "204", "205", "211", "212"];

const CASHED = "212";

interface GenerateCDARParams {
  statusCode: string;
  dateTime?: Date;
  comment?: string | null;
  reasonCode?: string | null;
  invoice: {
    number: string;
    date?: string | null;
  };
  seller: {
    siret: string;
    siren: string;
  };
  buyer: {
    siret: string;
    siren: string;
  };
  settlement?: {
    amount?: number | null;
    vatRate?: number | null;
    currency?: string | null;
  };
}

function statusReason(
  statusCode: string,
  reasonCode: string | null | undefined,
  comment: string | null | undefined,
): string {
  const known = LIFECYCLE_STATUSES.find((s) => s.code === statusCode);
  const code =
    reasonCode || (comment || known?.requiresReason ? known?.reasonCode || "AUTRE" : null);
  if (!code && !comment) {
    return "";
  }
  return `
        <ram:ReasonCode>${esc(code)}</ram:ReasonCode>${
          comment
            ? `
        <ram:Reason>${esc(comment)}</ram:Reason>`
            : ""
        }`;
}

function settlementCharacteristic(
  statusCode: string,
  settlement: GenerateCDARParams["settlement"],
): string {
  if (statusCode !== CASHED) {
    return "";
  }
  const currency = settlement?.currency || "EUR";
  const amount = (settlement?.amount ?? 0).toFixed(2);
  const vatRate = (settlement?.vatRate ?? 20).toFixed(2);
  return `
        <ram:SpecifiedDocumentCharacteristic>
          <ram:TypeCode>MEN</ram:TypeCode>
          <ram:ValueAmount currencyID="${esc(currency)}">${amount}</ram:ValueAmount>
          <ram:ValuePercent>${vatRate}</ram:ValuePercent>
        </ram:SpecifiedDocumentCharacteristic>`;
}

function generateCDAR({
  statusCode,
  dateTime,
  comment,
  reasonCode,
  invoice,
  seller,
  buyer,
  settlement,
}: GenerateCDARParams): string {
  const ts = dt204(dateTime || new Date());
  const transmission =
    LIFECYCLE_STATUSES.find((s) => s.code === statusCode)?.phase === "transmission";
  const issuer = transmission
    ? `      <ram:RoleCode>WK</ram:RoleCode>`
    : `      <ram:GlobalID schemeID="0002">${esc(buyer.siren)}</ram:GlobalID>
      <ram:RoleCode>BY</ram:RoleCode>`;
  const status = statusReason(statusCode, reasonCode, comment);
  // MDG-35 est obligatoire (BR-FR-CDV-11) : à défaut, le jour de l'événement.
  const invoiceDate = invoice.date ? dt(invoice.date) : ts.slice(0, 8);
  const characteristic = settlementCharacteristic(statusCode, settlement);

  return `<?xml version="1.0" encoding="UTF-8"?>
<rsm:CrossDomainAcknowledgementAndResponse
    xmlns:rsm="urn:un:unece:uncefact:data:standard:CrossDomainAcknowledgementAndResponse:100"
    xmlns:ram="urn:un:unece:uncefact:data:standard:ReusableAggregateBusinessInformationEntity:100"
    xmlns:qdt="urn:un:unece:uncefact:data:standard:QualifiedDataType:100"
    xmlns:udt="urn:un:unece:uncefact:data:standard:UnqualifiedDataType:100">
  <rsm:ExchangedDocumentContext>
    <ram:BusinessProcessSpecifiedDocumentContextParameter>
      <ram:ID>REGULATED</ram:ID>
    </ram:BusinessProcessSpecifiedDocumentContextParameter>
    <ram:GuidelineSpecifiedDocumentContextParameter>
      <ram:ID>urn.cpro.gouv.fr:1p0:CDV:invoice</ram:ID>
    </ram:GuidelineSpecifiedDocumentContextParameter>
  </rsm:ExchangedDocumentContext>
  <rsm:ExchangedDocument>
    <ram:ID>LC-${esc(invoice.number)}-${esc(statusCode)}</ram:ID>
    <ram:IssueDateTime>
      <udt:DateTimeString format="204">${ts}</udt:DateTimeString>
    </ram:IssueDateTime>
    <ram:SenderTradeParty>
      <ram:RoleCode>WK</ram:RoleCode>
    </ram:SenderTradeParty>
    <ram:IssuerTradeParty>
${issuer}
    </ram:IssuerTradeParty>
    <ram:RecipientTradeParty>
      <ram:GlobalID schemeID="0002">${esc(seller.siren)}</ram:GlobalID>
      <ram:RoleCode>SE</ram:RoleCode>
      <ram:URIUniversalCommunication>
        <ram:URIID schemeID="0009">${esc(seller.siret)}</ram:URIID>
      </ram:URIUniversalCommunication>
    </ram:RecipientTradeParty>
  </rsm:ExchangedDocument>
  <rsm:AcknowledgementDocument>
    <ram:MultipleReferencesIndicator>
      <udt:Indicator>false</udt:Indicator>
    </ram:MultipleReferencesIndicator>
    <ram:TypeCode>${transmission ? "305" : "23"}</ram:TypeCode>
    <ram:IssueDateTime>
      <udt:DateTimeString format="204">${ts}</udt:DateTimeString>
    </ram:IssueDateTime>
    <ram:ReferenceReferencedDocument>
      <ram:IssuerAssignedID>${esc(invoice.number)}</ram:IssuerAssignedID>
      <ram:TypeCode>380</ram:TypeCode>
      <ram:FormattedIssueDateTime>
        <qdt:DateTimeString format="102">${invoiceDate}</qdt:DateTimeString>
      </ram:FormattedIssueDateTime>
      <ram:ProcessConditionCode>${esc(statusCode)}</ram:ProcessConditionCode>
      <ram:IssuerTradeParty>
        <ram:GlobalID schemeID="0002">${esc(seller.siren)}</ram:GlobalID>
        <ram:RoleCode>SE</ram:RoleCode>
      </ram:IssuerTradeParty>${
        status || characteristic
          ? `
      <ram:SpecifiedDocumentStatus>${status}
        <ram:SequenceNumeric>1</ram:SequenceNumeric>${characteristic}
      </ram:SpecifiedDocumentStatus>`
          : ""
      }
    </ram:ReferenceReferencedDocument>
  </rsm:AcknowledgementDocument>
</rsm:CrossDomainAcknowledgementAndResponse>
`;
}

export { generateCDAR, LIFECYCLE_STATUSES, HAPPY_PATH };
