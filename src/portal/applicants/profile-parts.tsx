import {useState} from 'react';

import {initials} from '../ui';

/**
 * Small pieces of the job seeker's dashboard: the completion ring and the photo. Drawn from the
 * kit's tokens (src/styles/app.css `.profile-*`); sizes are SVG attributes, never inline styles (CSP).
 */

/** A ring that fills to `value` percent, with the number in the middle. */
export function CompletionRing({value, size = 'md', label}: {value: number; size?: 'sm' | 'md'; label?: string}) {
  const r = 26;
  const length = 2 * Math.PI * r;
  const filled = (Math.max(0, Math.min(100, value)) / 100) * length;
  return (
    <span className={`profile-ring profile-ring-${size}`} role="img" aria-label={label ?? `Profile ${value}% complete`}>
      <svg viewBox="0 0 64 64" aria-hidden="true">
        <circle className="profile-ring-track" cx="32" cy="32" r={r} fill="none" strokeWidth="6" />
        <circle
          className="profile-ring-fill"
          cx="32"
          cy="32"
          r={r}
          fill="none"
          strokeWidth="6"
          strokeLinecap="round"
          strokeDasharray={`${filled} ${length}`}
          transform="rotate(-90 32 32)"
        />
      </svg>
      <span className="profile-ring-value" aria-hidden="true">
        {value}%
      </span>
    </span>
  );
}

/** The photo (an access-checked image), or the initials when there is none or it does not load. */
export function ProfilePhoto({src, name, size = 'md'}: {src: string | null; name: string; size?: 'sm' | 'md' | 'lg'}) {
  const [broken, setBroken] = useState<string | null>(null);
  const show = src && broken !== src;
  return (
    <span className={`profile-photo profile-photo-${size}`}>
      {show ? <img src={src} alt="" width={160} height={160} decoding="async" onError={() => setBroken(src)} /> : <span aria-hidden="true">{initials(name) || '·'}</span>}
    </span>
  );
}
