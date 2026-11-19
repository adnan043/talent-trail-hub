import {Link} from '@tanstack/react-router';
import type {ReactNode} from 'react';

import {PageHeader} from '../../ui';

const TABS = [
  {to: '/manage/settings/branding', label: 'Branding'},
  {to: '/manage/settings/board', label: 'Board mode'},
  {to: '/manage/settings/moderation', label: 'Moderation mode'},
] as const;

/**
 * The one Settings screen (sidebar "Settings"): Branding · Board mode · Moderation mode as
 * tabs. Each tab is its own route, so a tab can be linked; the active link gets `aria-current`.
 */
export function SettingsPage({className, actions, children}: {className: string; actions?: ReactNode; children: ReactNode}) {
  return (
    <div className={`app-page screen-settings ${className}`}>
      <PageHeader title="Settings" description="How the public board looks and works." actions={actions} />
      <nav className="tab-list settings-tabs" aria-label="Settings sections">
        {TABS.map(tab => (
          <Link key={tab.to} to={tab.to} className="tab" activeOptions={{exact: true}}>
            {tab.label}
          </Link>
        ))}
      </nav>
      {children}
    </div>
  );
}
