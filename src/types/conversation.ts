export type InterpretationKind = 'new-project' | 'addition' | 'correction' | 'rejection' | 'constraint' | 'decision' | 'question' | 'unresolved' | 'project-switch' | 'ordinary';
export type Confidence = 'HIGH' | 'INFERRED' | 'AMBIGUOUS';

export interface ConversationMessage {
  role: 'owner' | 'assistant';
  content: string;
  projectId?: string;
  createdAt: string;
}

export interface ConversationRecord {
  conversationId: string;
  ownerId: string;
  sessionId: string;
  activeProjectId?: string;
  messages: ConversationMessage[];
  recentProposal?: string;
  updatedAt: string;
}