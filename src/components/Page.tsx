import type { PropsWithChildren, ReactNode } from 'react';
import { Link } from 'react-router-dom';

type PageProps = PropsWithChildren<{
  className?: string;
  eyebrow?: string;
  title: string;
  introduction: ReactNode;
}>;

export function Page({ children, className, eyebrow, introduction, title }: PageProps) {
  return (
    <main className={['page-shell', className].filter(Boolean).join(' ')}>
      <header className="page-header">
        {eyebrow === undefined ? null : <p className="eyebrow">{eyebrow}</p>}
        <h1>{title}</h1>
        <div className="introduction">{introduction}</div>
      </header>
      {children}
    </main>
  );
}

export function BackLink() {
  return (
    <Link className="back-link" to="/">
      ← All experiments
    </Link>
  );
}
