'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { apiClient } from '../lib/api-client';

interface Project {
  id: string;
  name: string;
  key: string;
}

const AUTH_ROUTES = ['/login', '/register'];

export function Sidebar() {
  const pathname = usePathname();
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);

  const isAuthPage = AUTH_ROUTES.includes(pathname);

  useEffect(() => {
    if (isAuthPage) {
      setLoading(false);
      return;
    }
    async function loadProjects() {
      try {
        const response = await apiClient.get<Project[]>('/projects');
        if (response) setProjects(response);
      } catch {
        // User may not be authenticated yet
      } finally {
        setLoading(false);
      }
    }
    loadProjects();
  }, [pathname, isAuthPage]);

  if (isAuthPage) return null;

  return (
    <aside className="w-56 flex-shrink-0 bg-[var(--color-surface-1)] border-r border-[var(--color-surface-3)] flex flex-col">
      <div className="px-4 py-3 border-b border-[var(--color-surface-3)]">
        <h2 className="text-xs font-medium text-[var(--color-text-tertiary)] uppercase tracking-wide">
          Projects
        </h2>
      </div>

      <nav className="flex-1 overflow-y-auto py-2">
        {loading && (
          <p className="px-4 py-2 text-xs text-[var(--color-text-tertiary)]">Loading...</p>
        )}

        {!loading && projects.map((project) => {
          const href = `/projects/${project.key}`;
          const isActive = pathname === href;

          return (
            <Link
              key={project.id}
              href={href}
              className={`block px-4 py-2 text-sm ${
                isActive
                  ? 'bg-[var(--color-surface-2)] text-[var(--color-text-primary)] font-medium'
                  : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-2)]'
              }`}
            >
              <span className="text-xs text-[var(--color-text-tertiary)] mr-2">{project.key}</span>
              {project.name}
            </Link>
          );
        })}

        {!loading && projects.length === 0 && (
          <p className="px-4 py-2 text-xs text-[var(--color-text-tertiary)]">No projects yet</p>
        )}
      </nav>

      <div className="border-t border-[var(--color-surface-3)] p-2">
        <Link
          href="/projects/new"
          className="flex items-center justify-center gap-1 w-full py-2 text-sm rounded text-[var(--color-accent-blue)] hover:bg-[var(--color-surface-2)] transition-colors"
        >
          + New Project
        </Link>
      </div>
    </aside>
  );
}
