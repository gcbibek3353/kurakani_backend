declare global {
  namespace Express {
    interface Request {
      /** Set by the auth module's bodyParser.rawBody option. Webhooks only. */
      rawBody?: Buffer;
    }
  }
}

export {};
