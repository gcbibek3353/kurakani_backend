/**
 * Shape of the POST /api/chat request body.
 *
 * `conversationId` is optional on purpose: omitting it means "start a new
 * conversation". The server creates the row and tells the client the new id
 * through a `conversation` SSE event, so the browser never invents ids.
 */
export interface ChatDto {
  message: string;
  conversationId?: string;
}

export function isValidChatDto(body: unknown): body is ChatDto {
  if (typeof body !== 'object' || body === null) return false;
  const dto = body as ChatDto;

  if (typeof dto.message !== 'string' || dto.message.trim().length === 0)
    return false;
  if (
    dto.conversationId !== undefined &&
    typeof dto.conversationId !== 'string'
  )
    return false;

  return true;
}
