import { formatAccessCode, siteOrigin } from "./underwriting.js";
import { proposalMailerConfigured, sendTextEmail } from "./email.js";

export type ProposalInput = {
  reference: string;
  accessCode: string;
  uploadLink: string;
  expiresAt: Date;
  contactName?: string | null;
  organisation?: string | null;
  coverageInterest?: string | null;
  /** Free text the underwriter typed above the standard wording. */
  message?: string | null;
  senderName: string;
  senderEmail: string;
};

export type ProposalEmail = {
  subject: string;
  body: string;
  to: string;
  replyTo: string;
};

function formatDate(date: Date): string {
  return date.toLocaleDateString("en-AU", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
}

/**
 * The paragraph the desk already uses in correspondence, with the matter's own link
 * and code spliced in. Kept as plain text: it has to survive being pasted anywhere.
 */
export function invitationText(reference: string, accessCode: string, uploadLink: string, expiresAt: Date): string {
  return [
    `Please submit the package via our secure upload portal. The link below is tied to underwriting reference ${reference} and is open until ${formatDate(expiresAt)}.`,
    "",
    `Upload link: ${uploadLink}`,
    `Access code: ${formatAccessCode(accessCode)}`,
    "",
    "Once we have reviewed a complete set of documents we will revert with any clarifying questions and an indicative term sheet / consideration proposal.",
  ].join("\n");
}

export function proposalSubject(reference: string, organisation: string | null, projectName: string): string {
  return organisation
    ? `Sino Secure — ${organisation} — ${projectName} — ${reference}`
    : `Sino Secure — ${projectName} — ${reference}`;
}

/** Assembles the whole email so the underwriter has nothing left to write. */
export function proposalBody(input: ProposalInput): string {
  const salutation = input.contactName ? `Dear ${input.contactName},` : "Dear Sir or Madam,";
  const opening = input.coverageInterest
    ? `Thank you for your enquiry regarding ${input.coverageInterest.toLowerCase()} cover. We are pleased to progress this to underwriting review.`
    : "Thank you for your enquiry. We are pleased to progress this to underwriting review.";

  return [
    salutation,
    "",
    input.message?.trim() || opening,
    "",
    invitationText(input.reference, input.accessCode, input.uploadLink, input.expiresAt),
    "",
    "Kind regards,",
    input.senderName,
    "Sino Secure Pty Ltd",
    input.senderEmail,
    siteOrigin().replace(/^https?:\/\//, ""),
  ].join("\n");
}

/** A prefilled draft in the underwriter's own mail client — the no-provider path. */
export function mailtoLink(email: ProposalEmail): string {
  const params = new URLSearchParams({ subject: email.subject, body: email.body });
  return `mailto:${encodeURIComponent(email.to)}?${params.toString().replace(/\+/g, "%20")}`;
}

export function mailerConfigured(): boolean {
  return proposalMailerConfigured();
}

export type DeliveryResult = { delivered: boolean; note: string };

/**
 * Sends through Resend when the site has been given an API key and a verified From
 * address. Without them the caller falls back to a prefilled draft, which is the
 * better default anyway: the proposal then leaves the underwriter's own mailbox.
 */
export async function deliverProposal(email: ProposalEmail): Promise<DeliveryResult> {
  if (!mailerConfigured()) {
    return { delivered: false, note: "Opened in your mail client — review and send." };
  }

  const delivered = await sendTextEmail({
    to: email.to,
    replyTo: email.replyTo,
    subject: email.subject,
    text: email.body,
    bcc: process.env.PROPOSAL_BCC_EMAIL,
  });
  if (delivered) {
    return { delivered: true, note: `Sent to ${email.to}.` };
  }
  return { delivered: false, note: "The mail service could not deliver the message — a draft has been opened instead." };
}
