export interface ApiResponse<T> {
  data: T;
}

export interface PaginatedResponse<T> {
  data: T[];
  pagination: {
    nextCursor: string | null;
    limit: number;
  };
}

export interface ApiError {
  error: string;
  message: string;
  code: number;
}
