export type TokenStatus = "healthy" | "warning" | "expired" | "unknown";

export interface TokenState {
  status: TokenStatus;
  daysRemaining: number | null;
  expiresAt: string | null;
}

export interface RefreshResult {
  success: boolean;
  expiresAt?: string;
  error?: string;
}

export interface ExchangeResult {
  success: boolean;
  accessToken?: string;
  expiresAt?: string;
  error?: string;
}
