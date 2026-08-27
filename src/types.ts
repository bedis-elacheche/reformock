export type FlowDirection = "In" | "Out";

export type FlowSyntax = "UBL" | "CII" | "Factur-X" | "CDAR" | "FRR" | "Unknown";

export type AckStatus = "Pending" | "Ok" | "Error";

export type DocType = "Original" | "Converted" | "ReadableView";

export interface Acknowledgement {
  status: AckStatus;
  details?: unknown;
}

export interface FlowDocument {
  content: Buffer;
  contentType: string;
  filename: string;
}

export type FlowDocuments = Partial<Record<DocType, FlowDocument>>;

export interface Address {
  line1: string;
  postalCode: string;
  city: string;
  countryCode: string;
}

export interface Company {
  name: string;
  siren: string;
  siret: string;
  email: string;
  vatNumber: string;
  address: Address;
}

export interface InvoiceLine {
  id: number;
  name: string;
  unit: string;
  unitPrice: number;
  quantity: number;
  lineTotal: number;
  vatRate: number;
}

export interface InvoiceTotals {
  totalHT: number;
  totalVAT: number;
  vatRate: number;
  totalTTC: number;
}

export interface InvoiceData {
  invoiceNumber: string;
  issueDate: string;
  dueDate: string;
  currency: string;
  seller: Company;
  buyer: Company;
  lines: InvoiceLine[];
  totals: InvoiceTotals;
}

export interface PartyMetadata {
  name?: string | null;
  siren?: string;
  siret?: string;
  vatNumber?: string | null;
}

export interface FlowMetadata {
  seller?: PartyMetadata;
  buyer?: PartyMetadata;
  issueDate?: string | null;
  dueDate?: string;
  currency?: string | null;
  totalExclVat?: number;
  totalVat?: number;
  totalInclVat?: number;
  vatRate?: number | null;
  statusCode?: string | null;
  statusName?: string | null;
  relatedInvoice?: string;
  injectedVia?: string;
  receivedFilename?: string;
  size?: number;
}

export interface ParsedFlow {
  flowSyntax: FlowSyntax;
  invoiceNumber: string | null;
  metadata: FlowMetadata;
}

export interface Flow {
  flowId: string;
  trackingId: string | null;
  name: string;
  flowType: string;
  flowDirection: FlowDirection;
  flowSyntax: FlowSyntax;
  flowProfile: string;
  processingRule: string;
  processingRuleSource: string;
  acknowledgement: Acknowledgement;
  sha256: string | null;
  submittedAt: string;
  updatedAt: string;
  invoiceNumber: string | null;
  statusCode: string | null;
  statusName: string | null;
  metadata: FlowMetadata;
  documents: FlowDocuments;
}

export interface CreateFlowParams {
  flowType: string;
  flowDirection: FlowDirection;
  flowSyntax: FlowSyntax;
  name?: string | null;
  flowProfile?: string | null;
  processingRule?: string | null;
  processingRuleSource?: string | null;
  acknowledgement?: Acknowledgement | null;
  sha256?: string | null;
  trackingId?: string | null;
  invoiceNumber?: string | null;
  statusCode?: string | null;
  statusName?: string | null;
  metadata?: FlowMetadata;
  documents?: FlowDocuments;
}

export interface FlowStatusUpdate {
  statusCode?: string | null;
  statusName?: string | null;
  ackStatus?: AckStatus;
}

export interface FullFlowInfo {
  flowId: string;
  submittedAt: string;
  name: string;
  flowSyntax: FlowSyntax;
  trackingId?: string;
  processingRule?: string;
  flowProfile?: string;
  sha256?: string;
}

export interface FlowDTO {
  flowId: string;
  submittedAt: string;
  updatedAt: string;
  name: string;
  flowSyntax: FlowSyntax;
  flowProfile: string;
  flowType: string;
  flowDirection: FlowDirection;
  processingRule: string;
  processingRuleSource: string;
  acknowledgement: Acknowledgement;
  trackingId?: string;
}

export interface FlowSummary {
  flowId: string;
  trackingId: string | null;
  name: string;
  flowType: string;
  flowDirection: FlowDirection;
  flowSyntax: FlowSyntax;
  flowProfile: string;
  processingRule: string;
  acknowledgement: Acknowledgement;
  invoiceNumber: string | null;
  statusCode: string | null;
  statusName: string | null;
  submittedAt: string;
  updatedAt: string;
  createdDate: string;
  updatedDate: string;
  availableDocTypes: string[];
  metadata: FlowMetadata;
}

export interface SearchWhere {
  updatedAfter?: string;
  updatedBefore?: string;
  processingRule?: string[];
  flowType?: string[];
  flowDirection?: FlowDirection[];
  trackingId?: string;
  ackStatus?: AckStatus;
}

export interface SearchParams {
  where?: SearchWhere;
  limit?: number | string;
  cursor?: string;
}

export interface SearchSpecResult {
  limit: number;
  filters: SearchWhere;
  results: FlowDTO[];
  nextCursor?: string;
}

export interface InternalSearchCriteria {
  flowType?: string | string[];
  flowDirection?: FlowDirection | FlowDirection[];
  flowSyntax?: FlowSyntax | FlowSyntax[];
  trackingId?: string;
  invoiceNumber?: string;
  fromDate?: string;
  toDate?: string;
  limit?: number | string;
  offset?: number | string;
}

export interface InternalSearchResult {
  total: number;
  limit: number;
  offset: number;
  flows: FlowSummary[];
}

export interface LifecycleStatus {
  code: string;
  name: string;
  /** Phase CDV : transmission (statut plateforme) ou traitement (statut acheteur). */
  phase: "transmission" | "processing";
  requiresReason?: boolean;
  /** Motif (MDT-113) par défaut, dans la liste autorisée pour ce statut. */
  reasonCode?: string;
}

export interface WebhookRecord {
  webhookId: string;
  signingKey: string;
  signingKeyBuf: Buffer;
  createdAt: string;
  callbackUrl: string;
  flowTypes?: string[];
  flowDirection?: FlowDirection;
  ackStatus?: AckStatus;
}

export interface CreateWebhookParams {
  callbackUrl: string;
  flowTypes?: unknown;
  flowDirection?: FlowDirection;
  ackStatus?: AckStatus;
}

export interface WebhookIdParam {
  webhookId: string;
  signingKey: string;
  createdAt: string;
}

export interface WebhookDTO extends WebhookIdParam {
  callbackUrl: string;
  flowTypes?: string[];
  flowDirection?: FlowDirection;
  ackStatus?: AckStatus;
}
