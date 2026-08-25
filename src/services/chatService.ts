import { z } from 'zod';
import { listCapabilities } from './capabilityService';
import type { Capability } from './capabilityService';

export const ChatRequestSchema = z.object({
  message: z.string().min(1).max(4000),
  userId: z.string().optional(),
  appId: z.string().optional(),
  appName: z.string().optional(),
  sessionId: z.string().optional(),
});

export interface ChatRequest {
  message: string;
  userId?: string;
  appId?: string;
  appName?: string;
  sessionId?: string;
}

export interface ChatResponse {
  reply: string;
  appContext?: {
    appId?: string;
    appName?: string;
  };
  sessionId?: string;
}

export function generateChatReply(input: ChatRequest, getCapabilities: () => Capability[] = listCapabilities): ChatResponse {
  const appContext = input.appId || input.appName ? {
    appId: input.appId,
    appName: input.appName,
  } : undefined;

  const sanitizedMessage = input.message.trim();
  const normalized = sanitizedMessage.toLowerCase();

  if (normalized.includes('hello') || normalized.includes('hi')) {
    return {
      reply: `Hello! I am KC AI, the central assistant for the KC ecosystem. I can help in ${input.appName || 'your current KC application'} and across related KC services.`,
      appContext,
      sessionId: input.sessionId,
    };
  }

  if (normalized.includes('telecom')) {
    return {
      reply: 'KC AI can provide telecom account guidance and product information in context. No KC TELECOM data integration is currently configured, so I cannot claim to read or change an account.',
      appContext,
      sessionId: input.sessionId,
    };
  }

  if (normalized.includes('earn') || normalized.includes('wallet')) {
    return {
      reply: 'KC AI can provide KC Earn workflow guidance and insights in context. No KC Earn data integration is currently configured, so I cannot claim to read or change wallet data.',
      appContext,
      sessionId: input.sessionId,
    };
  }

  if (normalized.includes('capabilit') && (normalized.includes('available') || normalized.includes('registered') || normalized.includes('status'))) {
    try {
      const capabilities = getCapabilities();
      const capabilitySummary = capabilities.map((capability) => {
        const reason = capability.reason ? ` (${capability.reason})` : '';
        const ownerAccess = capability.requiresOwner ? ' [owner only]' : '';
        return `- ${capability.id}: ${capability.status}${ownerAccess} - ${capability.description}${reason}`;
      }).join('\n');

      return {
        reply: `Currently registered capabilities (${capabilities.length}):\n${capabilitySummary || 'No capabilities are currently registered.'}`,
        appContext,
        sessionId: input.sessionId,
      };
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'The capability registry could not be read.';
      return {
        reply: `Capability availability is currently unavailable because the live capability registry could not be read: ${reason}`,
        appContext,
        sessionId: input.sessionId,
      };
    }
  }

  return {
    reply: 'I am KC AI, the central assistant for the KC ecosystem. I can provide guidance and execute only capabilities currently registered and available in this environment.',
    appContext,
    sessionId: input.sessionId,
  };
}
