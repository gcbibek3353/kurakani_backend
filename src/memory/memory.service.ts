import { ForbiddenException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Memory } from 'mem0ai/oss';
import type { MemoryItem } from 'mem0ai/oss';

/** How many facts get injected into the system prompt. More = more tokens on every turn. */
const RECALL_TOP_K = 5;

/** Upper bound for the settings page. Real users have tens of memories, not thousands. */
const LIST_TOP_K = 200;

@Injectable()
export class MemoryService {
  private readonly logger = new Logger(MemoryService.name);
  private readonly memory: Memory;

  constructor(config: ConfigService) {
    const embeddingDims = Number(
      config.get<string>('EMBEDDING_DIMENSIONS') ?? 768,
    );

    this.memory = new Memory({
      llm: {
        provider: 'groq',
        config: {
          apiKey: config.getOrThrow<string>('GROQ_API_KEY'),
          // Not optional. mem0's Groq default is `llama3-70b-8192`, which Groq
          // has decommissioned — leave it unset and every add() 404s.
          model: config.getOrThrow<string>('GROQ_CHAT_MODEL'),
        },
      },

      embedder: {
        provider: 'gemini',
        config: {
          apiKey: config.getOrThrow<string>('GOOGLE_API_KEY'),
          model: config.getOrThrow<string>('GOOGLE_EMBEDDING_MODEL'),
          embeddingDims,
        },
      },

      vectorStore: {
        provider: 'pgvector',
        config: {
          // The same Postgres Prisma uses, a different table. Prefer the
          // connection string over the split host/user/password fields: with
          // those, mem0 first connects to the `postgres` maintenance database
          // to check whether your database exists and create it if not.
          connectionString: config.getOrThrow<string>('DATABASE_URL'),
          collectionName:
            config.get<string>('POSTGRES_COLLECTION_NAME') ?? 'memories',
          // Note the different spelling from `embeddingDims` above. They are
          // two separate config objects and mem0 does not reconcile them. Set
          // only one and mem0 runs a probe embedding to auto-detect the other,
          // which can silently create a 3072-wide column — past pgvector's
          // 2,000-dim index ceiling, so every search becomes a seq scan.
          embeddingModelDims: embeddingDims,
          // Off by default. Cheap now, a backfill later.
          hnsw: true,
        },
      },

      // mem0 keeps a separate audit log of memory mutations, defaulting to
      // SQLite — which drops a `memory.db` file in the working directory and
      // needs `better-sqlite3`, a native build. The memories themselves are in
      // Postgres either way; this is only the change history, so keeping it in
      // RAM costs nothing unless you plan to show "memory history" in the UI.
      // `config` is required by the type but unused by the in-memory provider.
      historyStore: { provider: 'memory', config: {} },
    });
  }

  // ─────────────────────────────────────────────────────────────────────
  // Read path — on the critical path of every chat request
  // ─────────────────────────────────────────────────────────────────────

  /**
   * Facts relevant to what the user just said. Never throws.
   *
   * This runs before the first token of every reply, so it sits between the
   * user pressing enter and seeing anything. A Gemini rate-limit or a slow
   * pgvector query must degrade the answer, not 500 the endpoint — when mem0
   * ran in a container the network boundary gave you this for free; in-process
   * you have to write it.
   */
  async recall(userId: string, query: string): Promise<string[]> {
    try {
      const { results } = await this.memory.search(query, {
        // ── The asymmetry that costs people an hour ──────────────────────
        // Writes take a top-level camelCase `userId`. Reads take snake_case
        // `user_id` NESTED under `filters`. Passing `{ userId }` here throws
        // (mem0 calls rejectTopLevelEntityParams) — loud, so you'd catch it.
        // Passing `{ filters: { userId } }` is the dangerous one: it's just an
        // unrecognised filter key, so it silently matches nothing, or worse,
        // everything.
        filters: { user_id: userId },
        topK: RECALL_TOP_K,
      });

      // `.memory` holds the text, not `.content`.
      return results.map((r) => r.memory).filter(Boolean);
    } catch (error) {
      this.logger.warn(
        `recall failed for ${userId}: ${error instanceof Error ? error.message : String(error)}`,
      );
      return [];
    }
  }

  // ─────────────────────────────────────────────────────────────────────
  // Write path — off the critical path
  // ─────────────────────────────────────────────────────────────────────

  /**
   * Extract and store durable facts from one exchange. Returns immediately.
   *
   * `void`, not `Promise<void>`, and that is the whole point: mem0 runs its own
   * Groq call internally to decide what is worth remembering (and whether a new
   * fact REPLACES an existing one), which takes seconds. Awaiting it would add
   * that to the tail of every single message.
   *
   * The `.catch` is mandatory, not defensive style. A floating promise that
   * rejects with no handler is an unhandled rejection, and Node's default for
   * that is to terminate the process — one Gemini timeout would take the whole
   * API down.
   */
  remember(userId: string, userMessage: string, assistantReply: string): void {
    void this.memory
      .add(
        [
          { role: 'user', content: userMessage },
          { role: 'assistant', content: assistantReply },
        ],
        // camelCase again here. Yes, really.
        { userId },
      )
      .catch((error: unknown) => {
        this.logger.warn(
          `remember failed for ${userId}: ${error instanceof Error ? error.message : String(error)}`,
        );
      });
  }

  // ─────────────────────────────────────────────────────────────────────
  // Management — the /settings/memory page
  // ─────────────────────────────────────────────────────────────────────

  /**
   * Every fact stored about this user. Unlike recall(), this one is allowed to
   * throw: if the settings page can't load, showing an error beats showing an
   * empty list that reads as "we know nothing about you".
   *
   * Note `getAll` takes ONLY `filters` — unlike `add`/`deleteAll`, its options
   * type has no top-level `userId`, so a camelCase mistake here is a compile
   * error rather than a silent full-table read.
   */
  async list(userId: string): Promise<MemoryItem[]> {
    const { results } = await this.memory.getAll({
      filters: { user_id: userId },
      topK: LIST_TOP_K,
    });

    return results;
  }

  /**
   * Delete one memory, after proving the caller owns it.
   *
   * ⚠️ The ownership check is not optional. `memory.delete(id)` takes an id and
   * nothing else — no user scoping anywhere in its signature or its
   * implementation. Wire the route straight through and you have an IDOR: any
   * logged-in user can delete any other user's memories by id.
   *
   * Checking against getAll (rather than mem0's `get`, which returns the owner
   * as an undeclared runtime field) keeps the check inside the typed API.
   */
  async forget(userId: string, memoryId: string): Promise<void> {
    const owned = await this.list(userId);

    if (!owned.some((item) => item.id === memoryId)) {
      // Same reasoning as conversations: don't distinguish "no such memory"
      // from "someone else's memory".
      throw new ForbiddenException('Memory not found');
    }

    await this.memory.delete(memoryId);
  }
}
