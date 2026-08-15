/**
 * The slice of Razorpay's webhook payload this app actually reads.
 *
 * Deliberately partial and deeply optional. This object arrives from the
 * network and is only ever a *hint* — every field that matters (who to credit,
 * how much) is re-read from our own Payment row in markPaid(). Typing it as a
 * full Razorpay entity would suggest a trust level it hasn't earned.
 */
export interface RazorpayWebhookBody {
  event: string;
  payload?: {
    payment?: {
      entity?: {
        id: string;
        order_id?: string;
        amount?: number;
        status?: string;
      };
    };
  };
}
