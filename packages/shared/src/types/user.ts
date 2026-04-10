export const USER_ROLES = [
  'system_admin',
  'project_admin',
  'pm',
  'developer',
  'qa',
  'viewer',
] as const;

export type UserRole = (typeof USER_ROLES)[number];

export interface User {
  id: string;
  email: string;
  role: UserRole;
  createdAt: string;
  updatedAt: string;
}

export interface CreateUserDto {
  email: string;
  password: string;
}
