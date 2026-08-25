export type TextEmail = {
  to: string;
  subject: string;
  text: string;
  replyTo?: string | null;
  bcc?: string | null;
};

export type NotificationConfiguration = {
  recipient: string | null;
  directEmailReady: boolean;
  formsArchiveEnabled: true;
};

function cleanAddress(value: string | undefined): string | null {
  const address = value?.trim() ?? "";
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(address) ? address : null;
}

export function proposalMailerConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY && process.env.PROPOSAL_FROM_EMAIL);
}

/** The address that receives new enquiries and upload activity alerts. */
export function notificationConfiguration(): NotificationConfiguration {
  const recipient = cleanAddress(process.env.UNDERWRITING_NOTIFY_EMAIL);
  return {
    recipient,
    directEmailReady: Boolean(recipient && proposalMailerConfigured()),
    formsArchiveEnabled: true,
  };
}

/**
 * Small provider boundary shared by proposals and desk notifications. The caller
 * decides whether a failed delivery is fatal; this function only reports the result.
 */
export async function sendTextEmail(email: TextEmail): Promise<boolean> {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.PROPOSAL_FROM_EMAIL;
  if (!apiKey || !from) return false;

  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
      body: JSON.stringify({
        from,
        to: [email.to],
        subject: email.subject,
        text: email.text,
        ...(email.replyTo ? { reply_to: email.replyTo } : {}),
        ...(email.bcc ? { bcc: [email.bcc] } : {}),
      }),
    });
    if (!response.ok) {
      console.error("email delivery rejected", response.status);
      return false;
    }
    return true;
  } catch (error) {
    console.error("email delivery failed", error);
    return false;
  }
}
