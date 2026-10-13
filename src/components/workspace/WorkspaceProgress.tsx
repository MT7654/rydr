import Link from 'next/link';
import type { StageProgress } from '@/domain/workspace';

/**
 * Progress trail — local orientation, not a second navigation bar. Skipped or
 * not-required stages are shown accurately rather than pretending every case
 * passed through every stage.
 */
export function WorkspaceProgress({
  progress,
  basePath,
}: {
  progress: StageProgress[];
  basePath: string;
}) {
  const currentIndex = progress.findIndex((entry) => entry.state === 'current');
  return (
    <ol className="workspace-progress" aria-label="Case progress">
      {progress.map((entry, index) => (
        <li
          key={entry.stage}
          className={`workspace-progress__step is-${entry.state}`}
          aria-current={entry.state === 'current' ? 'step' : undefined}
        >
          <span className="workspace-progress__marker" aria-hidden="true">
            {entry.state === 'done' ? '✓' : entry.state === 'skipped' ? '–' : index + 1}
          </span>
          <span className="workspace-progress__label">{entry.stage}</span>
          <span className="small muted workspace-progress__detail">{entry.detail}</span>
        </li>
      ))}
      {currentIndex === -1 ? null : (
        <li className="sr-only">
          Current stage: {progress[currentIndex]?.stage}
          <Link href={basePath}>Open brief</Link>
        </li>
      )}
      <span className="sr-only" aria-live="polite">
        Case stage: {progress.find((entry) => entry.state === 'current')?.stage ?? 'complete'}
      </span>
    </ol>
  );
}
