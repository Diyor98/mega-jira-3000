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
    <aside className="h-full w-60 min-[1440px]:w-60 lg:w-12 flex-shrink-0 bg-[var(--color-surface-1)] border-r border-[var(--color-surface-3)] flex flex-col">
      <div className="px-4 py-3 border-b border-[var(--color-surface-3)] lg:px-2 min-[1440px]:px-4">
        <h2 className="text-xs font-medium text-[var(--color-text-tertiary)] uppercase tracking-wide lg:hidden min-[1440px]:block">
          Projects
        </h2>
        <span className="hidden lg:block min-[1440px]:hidden text-center text-xs text-[var(--color-text-tertiary)]">
          ≡
        </span>
      </div>

      <nav className="flex-1 overflow-y-auto py-2">
        {loading && (
          <p className="px-4 py-2 text-xs text-[var(--color-text-tertiary)] lg:hidden min-[1440px]:block">Loading...</p>
        )}

        {!loading && projects.map((project) => {
          const href = `/projects/${project.key}`;
          const isActive = pathname === href;

          return (
            <Link
              key={project.id}
              href={href}
              title={project.name}
              className={`block text-sm px-4 py-2 lg:px-1 lg:py-2 lg:text-center min-[1440px]:px-4 min-[1440px]:text-left ${
                isActive
                  ? 'bg-[var(--color-surface-2)] text-[var(--color-text-primary)] font-medium'
                  : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-2)]'
              }`}
            >
              <span className="text-xs text-[var(--color-text-tertiary)] mr-2 lg:mr-0 min-[1440px]:mr-2">{project.key.slice(0, 3)}</span>
              <span className="lg:hidden min-[1440px]:inline">{project.name}</span>
            </Link>
          );
        })}

        {!loading && projects.length === 0 && (
          <p className="px-4 py-2 text-xs text-[var(--color-text-tertiary)] lg:hidden min-[1440px]:block">No projects yet</p>
        )}
      </nav>

      <div className="border-t border-[var(--color-surface-3)] p-2">
        <Link
          href="/projects/new"
          title="New Project"
          className="flex items-center justify-center gap-1 w-full py-2 text-sm rounded text-[var(--color-accent-blue)] hover:bg-[var(--color-surface-2)] transition-colors"
        >
          <span className="lg:hidden min-[1440px]:inline">+ New Project</span>
          <span className="hidden lg:inline min-[1440px]:hidden" aria-hidden>+</span>
        </Link>
      </div>
    </aside>
  );
}
