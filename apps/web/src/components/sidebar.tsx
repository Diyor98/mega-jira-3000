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

// Deterministic project icon colors based on project key
const PROJECT_COLORS = ['#9EE7E3', '#F9AAEF', '#F1BD6C', '#A2D2FF', '#CDB4DB', '#B5E48C'];
function projectColor(key: string): string {
  let hash = 0;
  for (let i = 0; i < key.length; i++) hash = key.charCodeAt(i) + ((hash << 5) - hash);
  return PROJECT_COLORS[Math.abs(hash) % PROJECT_COLORS.length];
}

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

  const activeProjectKey = pathname.match(/^\/projects\/([^/]+)/)?.[1];

  return (
    <aside className="h-full w-72 min-[1440px]:w-72 lg:w-12 flex-shrink-0 bg-[#2E2E30] border-r border-[#565557] flex flex-col">
      {/* Top section */}
      <div className="flex flex-col gap-2 p-4 lg:p-2 min-[1440px]:p-4">
        {/* Create issue button — dispatches the same event as Cmd+N */}
        <div className="px-1 lg:px-0 min-[1440px]:px-1">
          <button
            type="button"
            onClick={() => {
              if (activeProjectKey) {
                window.dispatchEvent(
                  new CustomEvent('mega:command:create-issue', {
                    detail: { projectKey: activeProjectKey },
                  }),
                );
              }
            }}
            disabled={!activeProjectKey}
            className="flex items-center gap-2 h-9 pl-2 pr-4 lg:px-2 lg:justify-center min-[1440px]:pl-2 min-[1440px]:pr-4 min-[1440px]:justify-start rounded-[18px] border border-[#565557] bg-[#2E2E30] hover:bg-[#353638] transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            title={activeProjectKey ? 'Create issue (Cmd+N)' : 'Open a project first'}
          >
            <span className="flex items-center justify-center w-5 h-5 rounded-full bg-[#F06A6A] text-[#1E1F21] text-xs font-bold leading-none">+</span>
            <span className="text-sm text-[#F5F4F3] lg:hidden min-[1440px]:inline">Create</span>
          </button>
        </div>

        {/* Home link */}
        <nav className="flex flex-col">
          <Link
            href="/"
            className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm ${
              pathname === '/'
                ? 'text-[#F5F4F3] bg-[rgba(255,255,255,0.11)]'
                : 'text-[#F5F4F3] hover:bg-[rgba(255,255,255,0.06)]'
            }`}
          >
            <svg className="w-5 h-5 shrink-0" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M3 7.5L10 2.5L17 7.5V16a1 1 0 01-1 1H4a1 1 0 01-1-1V7.5z" />
              <path d="M7.5 17V10h5v7" />
            </svg>
            <span className="lg:hidden min-[1440px]:inline">Home</span>
          </Link>
        </nav>
      </div>

      {/* Projects section */}
      <div className="flex flex-col gap-2 pl-3 pr-4 pb-4 lg:px-2 min-[1440px]:pl-3 min-[1440px]:pr-4">
        <div className="flex items-center gap-3 px-3 h-5">
          <span className="text-sm font-semibold text-[#F5F4F3] lg:hidden min-[1440px]:inline">Projects</span>
          <Link
            href="/projects/new"
            title="New Project"
            className="text-[#A2A0A2] hover:text-[#F5F4F3] transition-colors lg:hidden min-[1440px]:block"
          >
            <svg className="w-3 h-3" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M6 1v10M1 6h10" />
            </svg>
          </Link>
          {/* Icon-only mode */}
          <Link
            href="/projects/new"
            title="New Project"
            className="hidden lg:block min-[1440px]:hidden text-[#A2A0A2] hover:text-[#F5F4F3] mx-auto"
          >
            <svg className="w-4 h-4" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M6 1v10M1 6h10" />
            </svg>
          </Link>
        </div>

        <div className="flex-1 overflow-y-auto flex flex-col">
          {loading && (
            <p className="px-3 py-1.5 text-xs text-[#A2A0A2] lg:hidden min-[1440px]:block">Loading...</p>
          )}

          {!loading && projects.map((project) => {
            const href = `/projects/${project.key}`;
            const isActive = activeProjectKey === project.key;
            const color = projectColor(project.key);

            return (
              <Link
                key={project.id}
                href={href}
                title={project.name}
                className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm ${
                  isActive
                    ? 'bg-[rgba(255,255,255,0.11)] text-[#F5F4F3]'
                    : 'text-[#F5F4F3] hover:bg-[rgba(255,255,255,0.06)]'
                }`}
              >
                <span
                  className="flex items-center justify-center min-w-[24px] h-5 px-1 rounded-[6px] shrink-0 text-[10px] font-bold text-[#1E1F21]"
                  style={{ backgroundColor: color }}
                >
                  {project.key}
                </span>
                <span className="truncate lg:hidden min-[1440px]:inline">{project.name}</span>
              </Link>
            );
          })}

          {!loading && projects.length === 0 && (
            <p className="px-3 py-1.5 text-xs text-[#A2A0A2] lg:hidden min-[1440px]:block">No projects yet</p>
          )}
        </div>
      </div>

      {/* Spacer */}
      <div className="flex-1" />

      {/* Bottom bar — Help opens the keyboard shortcut overlay (same as pressing ?) */}
      <div className="border-t border-[#565557] flex items-center justify-center px-5 h-14 lg:px-1 min-[1440px]:px-5">
        <button
          type="button"
          className="flex items-center gap-1.5 h-9 px-3 rounded-lg text-sm font-semibold text-[#A2A0A2] hover:text-[#F5F4F3] hover:bg-[rgba(255,255,255,0.06)] transition-colors lg:px-1 min-[1440px]:px-3"
          title="Keyboard shortcuts (?)"
          onClick={() => {
            window.dispatchEvent(
              new KeyboardEvent('keydown', { key: '?', bubbles: true }),
            );
          }}
        >
          <svg className="w-4 h-4 shrink-0" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
            <circle cx="8" cy="8" r="6" />
            <path d="M6 6a2 2 0 114 0c0 1.1-.9 1.5-1.5 2" />
            <circle cx="8" cy="11.5" r="0.5" fill="currentColor" />
          </svg>
          <span className="lg:hidden min-[1440px]:inline">Help</span>
        </button>
      </div>
    </aside>
  );
}
