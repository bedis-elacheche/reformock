import crypto from "node:crypto";

import * as store from "../../services/store.ts";
import * as simulator from "../../services/simulator.ts";
import { buildDerivedDocuments } from "../../services/convert.ts";
import { parseFlowFile } from "../../utils/parse.ts";
import { sendError } from "../../utils/http.ts";

import type { Req, Res } from "../../utils/http.ts";
import type { FlowSyntax } from "../../types.ts";

interface FlowInfoInput {
  name?: string;
  flowSyntax?: FlowSyntax;
  trackingId?: string;
  processingRule?: string;
  flowProfile?: string;
  sha256?: string;
  flowType?: string;
}

export async function depositFlow(req: Req, res: Res): Promise<Res | void> {
  const body = req.body || {};

  let content: Buffer;
  let filename: string;
  let contentType: string;
  if (req.uploadedFile) {
    content = req.uploadedFile.buffer;
    filename = req.uploadedFile.originalname;
    contentType = req.uploadedFile.mimetype || "application/octet-stream";
  } else if (body.content) {
    content = Buffer.from(body.content, "base64");
    filename = body.filename || "flow.xml";
    contentType = body.contentType || "application/xml";
  } else {
    return sendError(
      res,
      400,
      "MISSING_REQUIRED_FIELD",
      "Fichier manquant : envoyez le flux en multipart/form-data (champ 'file').",
    );
  }

  let flowInfo: FlowInfoInput;
  if (body.flowInfo != null) {
    try {
      flowInfo = typeof body.flowInfo === "string" ? JSON.parse(body.flowInfo) : body.flowInfo;
    } catch {
      return sendError(
        res,
        400,
        "INVALID_FLOW_INFO",
        "Le part 'flowInfo' doit être un JSON valide.",
      );
    }
  } else {
    flowInfo = {
      name: body.name,
      flowSyntax: body.flowSyntax,
      trackingId: body.trackingId,
      processingRule: body.processingRule,
      flowProfile: body.flowProfile,
      sha256: body.sha256,
    };
  }

  const parsed = parseFlowFile(content);
  const flowSyntax: FlowSyntax = flowInfo.flowSyntax || parsed.flowSyntax;
  const name = flowInfo.name || filename;

  if (!name) {
    return sendError(res, 400, "MISSING_REQUIRED_FIELD", "flowInfo.name est obligatoire.");
  }
  if (!flowSyntax) {
    return sendError(res, 400, "MISSING_REQUIRED_FIELD", "flowInfo.flowSyntax est obligatoire.");
  }

  const computed = crypto.createHash("sha256").update(content).digest("hex");
  if (flowInfo.sha256 && String(flowInfo.sha256).toLowerCase() !== computed) {
    return sendError(
      res,
      400,
      "CHECKSUM_MISMATCH",
      "L'empreinte sha256 fournie ne correspond pas au fichier reçu.",
    );
  }

  const invoiceNumber: string | null = body.invoiceNumber || parsed.invoiceNumber;
  const trackingId: string | null = flowInfo.trackingId || null;
  const flowType: string = body.flowType || flowInfo.flowType || "CustomerInvoice";
  const hasRule = !!flowInfo.processingRule;

  const derived = await buildDerivedDocuments(content, flowSyntax, invoiceNumber);
  if (derived.skipReason) {
    req.log.warn(
      { flowSyntax, invoiceNumber, reason: derived.skipReason },
      "Uploaded invoice not converted",
    );
  }

  const flow = store.createFlow({
    flowType,
    flowDirection: "Out",
    flowSyntax,
    name,
    flowProfile: flowInfo.flowProfile || null,
    processingRule: flowInfo.processingRule || "B2B",
    processingRuleSource: hasRule ? "Input" : "Computed",
    acknowledgement: { status: "Ok" },
    sha256: computed,
    trackingId,
    invoiceNumber,
    metadata: { receivedFilename: filename, size: content.length },
    documents: {
      Original: { content, contentType, filename },
      ...(derived.skipReason === undefined && derived.documents),
    },
  });

  if (flowType === "CustomerInvoice" && invoiceNumber) {
    const md = parsed.metadata;
    simulator.scheduleLifecycleForDepositedInvoice({
      flowId: flow.flowId,
      invoice: { number: invoiceNumber, date: md.issueDate },
      seller: { siret: md.seller?.siret, siren: md.seller?.siren },
      buyer: { siret: md.buyer?.siret, siren: md.buyer?.siren },
      settlement: { amount: md.totalInclVat, vatRate: md.vatRate, currency: md.currency },
    });
  }

  res.status(202).send(store.toFullFlowInfo(flow));
}
